import { createRequire } from "node:module";
import { Readable } from "node:stream";
import type { ObjectStorage, StorageConfiguration, PutInput, CreateMultipartInput } from "./types";
import { array, headerHead, nativeError, nativePut, noVersioning, signedRead, signedRequest, truncated, completeXml, completedResponse, createdUpload } from "./native";

type AliClient = Record<string, (...args: unknown[]) => Promise<unknown>>;
type AliResult = { res: { headers: Record<string, string> }; etag?: string; uploadId?: string; versionStatus?: string };
export function createAliStorage(config: StorageConfiguration): ObjectStorage {
  const OSS = createRequire(import.meta.url)("ali-oss") as new (options: Record<string, unknown>) => AliClient;
  const clients = new Map<string, AliClient>();
  const client = (bucket: string) => {
    let found = clients.get(bucket);
    if (!found) { found = new OSS({ region: config.region.startsWith("oss-") ? config.region : `oss-${config.region}`, bucket,
      endpoint: config.endpoint?.replaceAll("{bucket}", bucket), accessKeyId: config.accessKeyId, accessKeySecret: config.secretAccessKey,
      stsToken: config.sessionToken, cname: config.customDomain, authorizationV4: true, secure: true, timeout: 120000 }); clients.set(bucket, found); }
    return found;
  };
  const call = async <T>(bucket: string, method: string, ...args: unknown[]) => {
    try { return await client(bucket)[method](...args) as T; } catch (error) { throw nativeError("ali", error); }
  };
  const immutable = async (bucket: string, condition?: string) => { if (condition) noVersioning((await call<AliResult>(bucket, "getBucketVersioning", bucket)).versionStatus); };
  const uploadOptions = (input: PutInput | CreateMultipartInput) => ({ mime: input.ContentType, meta: input.Metadata, headers: {
    ...(input.CacheControl ? { "Cache-Control": input.CacheControl } : {}),
    ...("IfNoneMatch" in input && input.IfNoneMatch ? { "x-oss-forbid-overwrite": "true" } : {}),
  } });
  const sign = (bucket: string, key: string, method: string, expires: number, queries: Record<string, string | number> = {}, headers: Record<string, string> = {}) =>
    call<string>(bucket, "signatureUrlV4", method, expires, { queries, headers }, key, Object.keys(headers));
  return {
    singleCopyLimitBytes: 1_000_000_000,
    destroy: () => { for (const entry of clients.values()) entry.cancel?.(); clients.clear(); },
    headBucket: input => call(input.Bucket, "getBucketInfo", input.Bucket),
    createBucket: input => call(input.Bucket, "putBucket", input.Bucket, { acl: "private" }),
    deleteBucket: input => call(input.Bucket, "deleteBucket", input.Bucket),
    headObject: async input => headerHead((await call<AliResult>(input.Bucket, "head", input.Key)).res.headers, "x-oss-meta-"),
    getObject: async (input, options) => signedRead("ali", await sign(input.Bucket, input.Key, "GET", 300), "x-oss-meta-", options),
    putObject: async input => {
      await immutable(input.Bucket, input.IfNoneMatch);
      const { body, md5 } = nativePut(input), options = uploadOptions(input);
      if (md5) Object.assign(options.headers, { "Content-MD5": md5 });
      return body instanceof Readable ? call(input.Bucket, "putStream", input.Key, body, { ...options, contentLength: input.ContentLength })
        : call(input.Bucket, "put", input.Key, body, options);
    },
    deleteObject: input => call(input.Bucket, "delete", input.Key),
    deleteObjects: input => call(input.Bucket, "deleteMulti", input.Delete.Objects.map(object => object.Key)),
    listObjects: async input => {
      const result = await call<{ objects?: { name: string; size?: number }[]; nextContinuationToken?: string; isTruncated: boolean }>(input.Bucket, "listV2", { prefix: input.Prefix, "continuation-token": input.ContinuationToken });
      return { Contents: result.objects?.map(object => ({ Key: object.name, Size: object.size })), KeyCount: result.objects?.length ?? 0, IsTruncated: truncated(result.isTruncated), NextContinuationToken: truncated(result.isTruncated) ? result.nextContinuationToken : undefined };
    },
    createMultipartUpload: (input, options) => createdUpload(async () => ({ UploadId: (await call<AliResult>(input.Bucket, "initMultipartUpload", input.Key, uploadOptions(input))).uploadId }), options,
      id => call(input.Bucket, "abortMultipartUpload", input.Key, id)),
    uploadPart: async (input, options) => {
      const response = await signedRequest("ali", { url: await sign(input.Bucket, input.Key, "PUT", 600, { uploadId: input.UploadId, partNumber: input.PartNumber }) }, "PUT", input.Body, options);
      await response.arrayBuffer(); return { ETag: response.headers.get("etag") ?? undefined };
    },
    completeMultipartUpload: async (input, options) => {
      await immutable(input.Bucket, input.IfNoneMatch);
      const headers: Record<string, string> = input.IfNoneMatch ? { "x-oss-forbid-overwrite": "true" } : {};
      // Use the native signer to retain AbortSignal support for Worker completion.
      const response = await signedRequest("ali", { url: await sign(input.Bucket, input.Key, "POST", 600, { uploadId: input.UploadId }, headers), headers }, "POST", completeXml(input), options);
      return completedResponse("ali", response);
    },
    listParts: async input => {
      const result = await call<{ isTruncated: string | boolean; parts?: { PartNumber: string; ETag: string; Size: string } | { PartNumber: string; ETag: string; Size: string }[] }>(input.Bucket, "listParts", input.Key, input.UploadId);
      return { IsTruncated: truncated(result.isTruncated), Parts: array(result.parts).map(part => ({ PartNumber: Number(part.PartNumber), ETag: part.ETag, Size: Number(part.Size) })) };
    },
    abortMultipartUpload: input => call(input.Bucket, "abortMultipartUpload", input.Key, input.UploadId),
    listMultipartUploads: async input => ({ Uploads: (await call<{ uploads: { name: string; uploadId: string }[] }>(input.Bucket, "listUploads")).uploads.map(row => ({ Key: row.name, UploadId: row.uploadId })) }),
    copyObject: input => {
      const [bucket, ...key] = input.CopySource.split("/");
      return call(input.Bucket, "copy", input.Key, key.map(decodeURIComponent).join("/"), decodeURIComponent(bucket),
        { headers: input.CopySourceIfMatch ? { "if-match": input.CopySourceIfMatch } : {} });
    },
    uploadPartCopy: async input => {
      const [bucket, ...key] = input.CopySource.split("/");
      const result = await call<AliResult>(input.Bucket, "uploadPartCopy", input.Key, input.UploadId, input.PartNumber, input.CopySourceRange.replace(/^bytes=/, ""),
        { sourceBucketName: decodeURIComponent(bucket), sourceKey: key.map(decodeURIComponent).join("/") }, { headers: { "x-oss-copy-source-if-match": input.CopySourceIfMatch } });
      return { CopyPartResult: { ETag: result.etag } };
    },
    signUploadPart: (input, options) => sign(input.Bucket, input.Key, "PUT", options.expiresIn, { uploadId: input.UploadId, partNumber: input.PartNumber }),
    signDownload: (input, options) => sign(input.Bucket, input.Key, "GET", options.expiresIn, input.ResponseContentDisposition ? { "response-content-disposition": input.ResponseContentDisposition } : {}),
  };
}
