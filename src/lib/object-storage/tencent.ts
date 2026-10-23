import { createRequire } from "node:module";
import type { ObjectStorage, StorageConfiguration, PutInput, CreateMultipartInput } from "./types";
import { headerHead, nativeError, nativePut, noVersioning, signedRead, signedRequest, truncated, completeXml, completedResponse, createdUpload } from "./native";

type CosResult = { headers: Record<string, string>; ETag?: string; UploadId?: string };
type CosClient = Record<string, (input: Record<string, unknown>, callback: (error: unknown, data: unknown) => void) => unknown>;
export function createTencentStorage(config: StorageConfiguration): ObjectStorage {
  const COS = createRequire(import.meta.url)("cos-nodejs-sdk-v5") as new (options: Record<string, unknown>) => CosClient;
  const client = new COS({ SecretId: config.accessKeyId, SecretKey: config.secretAccessKey, SecurityToken: config.sessionToken,
    Domain: config.endpoint?.replaceAll("{bucket}", "{Bucket}"), Protocol: config.endpoint?.startsWith("http:") ? "http:" : "https:",
    Timeout: 120000, UploadCheckContentMd5: true });
  const call = <T>(method: string, input: Record<string, unknown>) => new Promise<T>((resolve, reject) => {
    client[method]({ ...input, Region: config.region }, (error, data) => error ? reject(nativeError("tencent", error)) : resolve(data as T));
  });
  const immutable = async (bucket: string, condition?: string) => {
    if (condition) noVersioning((await call<{ VersioningConfiguration?: { Status?: string } }>("getBucketVersioning", { Bucket: bucket })).VersioningConfiguration?.Status);
  };
  const headers = (input: PutInput | CreateMultipartInput) => ({
    ...Object.fromEntries(Object.entries(input.Metadata ?? {}).map(([key, value]) => [`x-cos-meta-${key}`, value])),
    ...("IfNoneMatch" in input && input.IfNoneMatch ? { "x-cos-forbid-overwrite": "true" } : {}),
  });
  const sign = async (input: Record<string, unknown>, method: string, expires: number, query: Record<string, string | number> = {}) =>
    (await call<{ Url: string }>("getObjectUrl", { ...input, Method: method, Expires: expires, Query: query })).Url;
  const copySource = (value: string) => { const [bucket, ...key] = value.split("/"); return `${bucket}.cos.${config.region}.myqcloud.com/${key.join("/")}`; };
  return {
    singleCopyLimitBytes: 5_000_000_000,
    destroy: () => {},
    headBucket: input => call("headBucket", input),
    createBucket: input => call("putBucket", { ...input, ACL: "private" }),
    deleteBucket: input => call("deleteBucket", input),
    headObject: async input => headerHead((await call<CosResult>("headObject", input)).headers, "x-cos-meta-"),
    getObject: async (input, options) => signedRead("tencent", await sign(input, "GET", 300), "x-cos-meta-", options),
    putObject: async input => {
      await immutable(input.Bucket, input.IfNoneMatch);
      const { body, md5 } = nativePut(input);
      return call("putObject", { ...input, Body: body, Headers: { ...headers(input), ...(md5 ? { "Content-MD5": md5 } : {}) } });
    },
    deleteObject: input => call("deleteObject", input),
    deleteObjects: input => call("deleteMultipleObject", { Bucket: input.Bucket, Objects: input.Delete.Objects }),
    listObjects: async input => {
      const result = await call<{ Contents: { Key: string; Size?: number | string }[]; IsTruncated: string; NextMarker?: string }>("getBucket", { Bucket: input.Bucket, Prefix: input.Prefix, Marker: input.ContinuationToken });
      return { Contents: result.Contents.map(object => ({ Key: object.Key, Size: object.Size === undefined ? undefined : Number(object.Size) })), KeyCount: result.Contents.length, IsTruncated: truncated(result.IsTruncated), NextContinuationToken: truncated(result.IsTruncated) ? result.NextMarker || result.Contents.at(-1)?.Key : undefined };
    },
    createMultipartUpload: (input, options) => createdUpload(() => call<CosResult>("multipartInit", { ...input, Headers: headers(input) }), options,
      id => call("multipartAbort", { ...input, UploadId: id })),
    uploadPart: async (input, options) => {
      const response = await signedRequest("tencent", { url: await sign(input, "PUT", 600, { uploadId: input.UploadId, partNumber: input.PartNumber }) }, "PUT", input.Body, options);
      await response.arrayBuffer(); return { ETag: response.headers.get("etag") ?? undefined };
    },
    completeMultipartUpload: async (input, options) => {
      await immutable(input.Bucket, input.IfNoneMatch);
      const condition: Record<string, string> = input.IfNoneMatch ? { "x-cos-forbid-overwrite": "true" } : {};
      // getObjectUrl accepts signed headers in the native SDK, although its published types omit them.
      const response = await signedRequest("tencent", { url: await sign({ ...input, Headers: condition }, "POST", 600, { uploadId: input.UploadId }), headers: condition }, "POST", completeXml(input), options);
      return completedResponse("tencent", response);
    },
    listParts: async input => {
      const result = await call<{ IsTruncated: string; Part: { PartNumber: string; ETag: string; Size: string }[] }>("multipartListPart", input);
      return { IsTruncated: truncated(result.IsTruncated), Parts: result.Part.map(part => ({ PartNumber: Number(part.PartNumber), ETag: part.ETag, Size: Number(part.Size) })) };
    },
    abortMultipartUpload: input => call("multipartAbort", input),
    listMultipartUploads: async input => ({ Uploads: (await call<{ Upload: { Key: string; UploadId: string }[] }>("multipartList", input)).Upload }),
    copyObject: input => call("putObjectCopy", { ...input, CopySource: copySource(input.CopySource) }),
    uploadPartCopy: async input => ({ CopyPartResult: { ETag: (await call<CosResult>("uploadPartCopy", { ...input, CopySource: copySource(input.CopySource) })).ETag } }),
    signUploadPart: (input, options) => sign({ ...input, Headers: { "content-length": String(input.ContentLength) } }, "PUT", options.expiresIn, { uploadId: input.UploadId, partNumber: input.PartNumber }),
    signDownload: (input, options) => sign(input, "GET", options.expiresIn, input.ResponseContentDisposition ? { "response-content-disposition": input.ResponseContentDisposition } : {}),
  };
}
