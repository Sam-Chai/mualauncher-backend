import { createRequire } from "node:module";
import http from "node:http";
import https from "node:https";
import { checkServerIdentity } from "node:tls";
import type { ObjectStorage, StorageConfiguration, PutInput } from "./types";
import { nativeError, nativePut, noVersioning, signedRead, signedRequest, truncated, completeXml, completedResponse, createdUpload } from "./native";

type ObsResult = { CommonMsg: { Status: number; Code?: string }; InterfaceResult?: Record<string, unknown> };
type ObsClient = {
  [method: string]: (input: Record<string, unknown>, callback: (error: unknown, result: ObsResult) => void) => unknown;
} & { close(): void; createSignedUrlSync(input: Record<string, unknown>): { SignedUrl: string; ActualSignedRequestHeaders: Record<string, string> };
  createV4SignedUrlSync(input: Record<string, unknown>): { SignedUrl: string; ActualSignedRequestHeaders: Record<string, string> } };
export function createHuaweiStorage(config: StorageConfiguration): ObjectStorage {
  const OBS = createRequire(import.meta.url)("esdk-obs-nodejs") as new (options: Record<string, unknown>) => ObsClient;
  const clients = new Map<string, ObsClient>();
  const client = (bucket: string, signature = "obs") => {
    const cacheKey = `${signature}:${bucket}`;
    let found = clients.get(cacheKey);
    if (!found) { found = new OBS({ access_key_id: config.accessKeyId, secret_access_key: config.secretAccessKey, security_token: config.sessionToken,
      server: config.endpoint?.replaceAll("{bucket}", bucket), region: config.region, path_style: false, signature, is_signature_negotiation: false,
      is_cname: config.customDomain, ssl_verify: true, timeout: 120, max_retry_count: 3,
      // Preserve native SDK request construction while restoring TLS hostname verification.
      third_http_lib: { request: (options: https.RequestOptions) => config.endpoint?.startsWith("http:")
        ? http.request(options) : https.request({ ...options, checkServerIdentity }) },
    }); clients.set(cacheKey, found); }
    return found;
  };
  const call = <T>(method: string, input: Record<string, unknown>) => new Promise<T>((resolve, reject) => {
    client(String(input.Bucket))[method](input, (error, result) => {
      if (error) return reject(nativeError("huawei", error));
      if (result.CommonMsg.Status >= 300) return reject(nativeError("huawei", { status: result.CommonMsg.Status, code: result.CommonMsg.Code }));
      resolve(result.InterfaceResult as T);
    });
  });
  const immutable = async (bucket: string, condition?: string) => {
    if (condition) noVersioning((await call<{ VersionStatus?: string }>("getBucketVersioningConfiguration", { Bucket: bucket })).VersionStatus);
  };
  const sign = (input: { Bucket: string; Key: string }, method: string, expires: number, queries: Record<string, string | number> = {}, headers: Record<string, string> = {}) => {
    const result = client(input.Bucket).createSignedUrlSync({ ...input, Method: method, Expires: expires, QueryParams: queries, Headers: headers });
    // Host is part of the SDK signature and is supplied by the URL, not by browsers.
    return { url: result.SignedUrl, headers: Object.fromEntries(Object.entries(result.ActualSignedRequestHeaders).filter(([key]) => key.toLowerCase() !== "host")) };
  };
  const putHeaders = (input: PutInput) => ({
    ...Object.fromEntries(Object.entries(input.Metadata ?? {}).map(([key, value]) => [`x-obs-meta-${key}`, value])),
    ...(input.ContentType ? { "Content-Type": input.ContentType } : {}), ...(input.CacheControl ? { "Cache-Control": input.CacheControl } : {}),
    ...(input.ContentLength !== undefined ? { "Content-Length": String(input.ContentLength) } : {}),
    ...(input.IfNoneMatch ? { "x-obs-forbid-overwrite": "true" } : {}),
  });
  return {
    singleCopyLimitBytes: 5_000_000_000,
    destroy: () => { for (const entry of clients.values()) entry.close(); clients.clear(); },
    headBucket: input => call("headBucket", input),
    createBucket: input => call("createBucket", { ...input, ACL: "private", Location: config.region }),
    deleteBucket: input => call("deleteBucket", input),
    headObject: async input => {
      const result = await call<{ ContentLength?: string; ContentType?: string; ETag?: string; Metadata?: Record<string, string> }>("getObjectMetadata", input);
      return { ...result, ContentLength: result.ContentLength === undefined ? undefined : Number(result.ContentLength) };
    },
    getObject: async (input, options) => signedRead("huawei", sign(input, "GET", 300).url, "x-obs-meta-", options),
    putObject: async (input, options) => {
      await immutable(input.Bucket, input.IfNoneMatch);
      const { body, md5 } = nativePut(input), headers = putHeaders(input);
      if (md5) Object.assign(headers, { "Content-MD5": md5 });
      // 3.26.x does not expose forbid-overwrite in putObject's parameter model. The native signer supports it.
      const response = await signedRequest("huawei", sign(input, "PUT", 600, {}, headers), "PUT", body, options);
      await response.arrayBuffer(); return {};
    },
    deleteObject: input => call("deleteObject", input),
    deleteObjects: input => call("deleteObjects", { Bucket: input.Bucket, Objects: input.Delete.Objects }),
    listObjects: async input => {
      const result = await call<{ Contents: { Key: string; Size?: number | string }[]; IsTruncated: string; NextMarker?: string }>("listObjects", { Bucket: input.Bucket, Prefix: input.Prefix, Marker: input.ContinuationToken });
      return { Contents: result.Contents.map(object => ({ Key: object.Key, Size: object.Size === undefined ? undefined : Number(object.Size) })), KeyCount: result.Contents.length, IsTruncated: truncated(result.IsTruncated), NextContinuationToken: truncated(result.IsTruncated) ? result.NextMarker || result.Contents.at(-1)?.Key : undefined };
    },
    createMultipartUpload: (input, options) => createdUpload(() => call("initiateMultipartUpload", input), options,
      id => call("abortMultipartUpload", { ...input, UploadId: id })),
    uploadPart: async (input, options) => {
      const response = await signedRequest("huawei", sign(input, "PUT", 600, { uploadId: input.UploadId, partNumber: input.PartNumber }), "PUT", input.Body, options);
      await response.arrayBuffer(); return { ETag: response.headers.get("etag") ?? undefined };
    },
    completeMultipartUpload: async (input, options) => {
      await immutable(input.Bucket, input.IfNoneMatch);
      const headers: Record<string, string> = input.IfNoneMatch ? { "x-obs-forbid-overwrite": "true" } : {};
      const response = await signedRequest("huawei", sign(input, "POST", 600, { uploadId: input.UploadId }, headers), "POST", completeXml(input), options);
      return completedResponse("huawei", response);
    },
    listParts: async input => {
      const result = await call<{ IsTruncated: string; Parts: { PartNumber: string; ETag: string; Size: string }[] }>("listParts", input);
      return { IsTruncated: truncated(result.IsTruncated), Parts: result.Parts.map(part => ({ PartNumber: Number(part.PartNumber), ETag: part.ETag, Size: Number(part.Size) })) };
    },
    abortMultipartUpload: input => call("abortMultipartUpload", input),
    listMultipartUploads: input => call("listMultipartUploads", input),
    copyObject: async input => {
      // SDK copyObject URI-encodes an already encoded CopySource, including its separators.
      const headers = { "x-obs-copy-source": `/${input.CopySource}`,
        ...(input.CopySourceIfMatch ? { "x-obs-copy-source-if-match": input.CopySourceIfMatch } : {}) };
      return completedResponse("huawei", await signedRequest("huawei", sign(input, "PUT", 600, {}, headers), "PUT"));
    },
    uploadPartCopy: async input => {
      // OBS SDK copyPart omits CopySourceIfMatch. Sign the documented source condition explicitly.
      const headers = { "x-obs-copy-source": `/${input.CopySource}`, "x-obs-copy-source-range": input.CopySourceRange,
        ...(input.CopySourceIfMatch ? { "x-obs-copy-source-if-match": input.CopySourceIfMatch } : {}) };
      const response = await signedRequest("huawei", sign(input, "PUT", 600, { uploadId: input.UploadId, partNumber: input.PartNumber }, headers), "PUT");
      const text = await response.text();
      if (/<Error[\s>]/.test(text)) throw nativeError("huawei", { status: 500 });
      const etag = /<ETag>([^<]+)<\/ETag>/.exec(text)?.[1]?.replaceAll("&quot;", '"');
      return { CopyPartResult: { ETag: etag } };
    },
    // OBS V2 does not authenticate Content-Length. Use the native SDK's V4
    // signer for browser parts only; keep OBS signing for other operations.
    // 3.26.x maps signature:"v4" to V2 in createSignedUrlSync; invoke its
    // explicit V4 method so Content-Length cannot silently become unsigned.
    signUploadPart: async (input, options) => client(input.Bucket, "v4").createV4SignedUrlSync({
      Bucket: config.customDomain ? undefined : input.Bucket, Key: input.Key, Method: "PUT", Expires: options.expiresIn,
      QueryParams: { uploadId: input.UploadId, partNumber: input.PartNumber }, Headers: { "content-length": String(input.ContentLength) },
    }).SignedUrl,
    signDownload: async (input, options) => sign(input, "GET", options.expiresIn, input.ResponseContentDisposition ? { "response-content-disposition": input.ResponseContentDisposition } : {}).url,
  };
}
