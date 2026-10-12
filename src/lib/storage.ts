import "server-only";
import { S3Client, CreateBucketCommand, HeadBucketCommand, HeadObjectCommand, GetObjectCommand, PutObjectCommand, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, ListPartsCommand, AbortMultipartUploadCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { invariant } from "./errors";

export const digest = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
export const casKey = (sha256: string) => `sha256/${sha256.slice(0, 2)}/${sha256}`;
export const packagesBucket = () => process.env.S3_PACKAGES_BUCKET ?? "mua-packages";
export const casBucket = () => process.env.S3_CAS_BUCKET ?? "mua-cas";
export const environmentsBucket = () => process.env.S3_ENVIRONMENTS_BUCKET ?? "mua-environments";
let cached: { configuration: string; client: S3Client } | undefined;
export function storageClient() {
  invariant(process.env.S3_ENDPOINT && process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY, 503, "对象存储未配置");
  const configuration = [process.env.S3_ENDPOINT, process.env.S3_REGION, process.env.S3_ACCESS_KEY_ID, process.env.S3_SECRET_ACCESS_KEY].join("\0");
  if (cached?.configuration === configuration) return cached.client;
  cached?.client.destroy();
  const client = new S3Client({ endpoint: process.env.S3_ENDPOINT, region: process.env.S3_REGION ?? "us-east-1", forcePathStyle: true,
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY },
    requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED", maxAttempts: 3 });
  cached = { configuration, client }; return client;
}
export const missingObject = (error: unknown) => !!error && typeof error === "object" && "$metadata" in error &&
  (error.$metadata as { httpStatusCode?: number }).httpStatusCode === 404;
export async function initializeStorage() {
  const client = storageClient();
  for (const Bucket of [packagesBucket(), casBucket(), environmentsBucket()]) {
    try { await client.send(new HeadBucketCommand({ Bucket })); }
    catch (error) { if (!missingObject(error)) throw error; await client.send(new CreateBucketCommand({ Bucket })); }
  }
}
export async function readObject(key: string, bucket = packagesBucket(), maximum = 64 * 1024 * 1024) {
  const result = await storageClient().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if ((result.ContentLength ?? 0) > maximum) (result.Body as NodeJS.ReadableStream & { destroy?: () => void })?.destroy?.();
  invariant(result.Body && (result.ContentLength ?? 0) <= maximum, 422, "文件索引超过读取限制");
  const chunks: Buffer[] = []; let length = 0;
  for await (const chunk of result.Body as AsyncIterable<Uint8Array>) {
    length += chunk.length; invariant(length <= maximum, 422, "文件索引超过读取限制"); chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
export async function putJson(key: string, value: unknown) {
  const bytes = Buffer.from(JSON.stringify(value));
  invariant(bytes.length <= 64 * 1024 * 1024, 422, "文件清单超过 64 MiB，请减少文件数量或路径长度");
  await storageClient().send(new PutObjectCommand({ Bucket: packagesBucket(), Key: key, Body: bytes,
    ContentType: "application/json", ChecksumSHA256: createHash("sha256").update(bytes).digest("base64"), IfNoneMatch: "*" }));
  return { sha256: digest(bytes), bytes };
}
export async function putCas(sha256: string, path: string, size: number) {
  const client = storageClient(); const Bucket = casBucket(); const Key = casKey(sha256);
  try {
    const found = await client.send(new HeadObjectCommand({ Bucket, Key }));
    invariant(found.ContentLength === size && found.Metadata?.sha256 === sha256, 422, "CAS 对象校验失败");
    return false;
  } catch (error) { if (!missingObject(error)) throw error; }
  try {
    await client.send(new PutObjectCommand({ Bucket, Key, Body: createReadStream(path), ContentLength: size,
      ContentType: "application/octet-stream", Metadata: { sha256 }, ChecksumSHA256: Buffer.from(sha256, "hex").toString("base64"), IfNoneMatch: "*" }));
    return true;
  } catch (error) {
    if (!(error && typeof error === "object" && "$metadata" in error && (error.$metadata as { httpStatusCode?: number }).httpStatusCode === 412)) throw error;
    const found = await client.send(new HeadObjectCommand({ Bucket, Key }));
    invariant(found.ContentLength === size && found.Metadata?.sha256 === sha256, 422, "CAS 并发对象校验失败"); return false;
  }
}
export async function beginMultipart(key: string) {
  const result = await storageClient().send(new CreateMultipartUploadCommand({ Bucket: packagesBucket(), Key: key, ContentType: "application/zip" }));
  invariant(result.UploadId, 503, "无法建立上传会话"); return result.UploadId;
}
export function signPart(key: string, uploadId: string, partNumber: number) {
  return getSignedUrl(storageClient(), new UploadPartCommand({ Bucket: packagesBucket(), Key: key, UploadId: uploadId, PartNumber: partNumber }), { expiresIn: 600 });
}
export async function completeMultipart(key: string, uploadId: string, size: number, partSize: number, parts: { partNumber: number; etag: string }[]) {
  const client = storageClient(); const identity = { Bucket: packagesBucket(), Key: key, UploadId: uploadId };
  // A completion retry may arrive after S3 succeeded but before the database committed.
  try { const existing = await client.send(new HeadObjectCommand({ Bucket: identity.Bucket, Key: key })); invariant(existing.ContentLength === size, 409, "上传大小不匹配"); return; }
  catch (error) { if (!missingObject(error)) throw error; }
  const listed = await client.send(new ListPartsCommand(identity));
  const count = Math.ceil(size / partSize);
  invariant(!listed.IsTruncated && parts.length === count && listed.Parts?.length === count, 409, "上传分片不完整");
  const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber);
  for (let i = 0; i < count; i++) {
    const found = listed.Parts.find(part => part.PartNumber === i + 1);
    invariant(sorted[i].partNumber === i + 1 && sorted[i].etag === found?.ETag && found.Size === Math.min(partSize, size - i * partSize), 409, "上传分片大小或 ETag 不匹配");
  }
  await client.send(new CompleteMultipartUploadCommand({ ...identity, IfNoneMatch: "*",
    MultipartUpload: { Parts: sorted.map(part => ({ PartNumber: part.partNumber, ETag: part.etag })) } }));
  const head = await client.send(new HeadObjectCommand({ Bucket: identity.Bucket, Key: key }));
  invariant(head.ContentLength === size, 409, "完整客户端大小不匹配");
}
export async function abortMultipart(key: string, uploadId: string) {
  try { await storageClient().send(new AbortMultipartUploadCommand({ Bucket: packagesBucket(), Key: key, UploadId: uploadId })); }
  catch (error) { if (!missingObject(error)) throw error; }
}
export async function signedDownloadInfo(key: string, bucket = packagesBucket(), fileName?: string) {
  const disposition = fileName ? `attachment; filename="client.muapack"; filename*=UTF-8''${encodeURIComponent(fileName).replaceAll("'", "%27")}` : undefined;
  const signingDate = new Date(Math.floor(Date.now() / 1000) * 1000), expiresIn = 300;
  const url = await getSignedUrl(storageClient(), new GetObjectCommand({ Bucket: bucket, Key: key, ResponseContentDisposition: disposition }), { expiresIn, signingDate });
  return { url, expiresIn, expiresAt: new Date(signingDate.getTime() + expiresIn * 1000).toISOString() };
}
export async function signedDownload(key: string, bucket = packagesBucket(), fileName?: string) {
  return (await signedDownloadInfo(key, bucket, fileName)).url;
}
