import { diagnosticText } from "@/lib/diagnostics";
import "server-only";

import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { invariant } from "./errors";
import { storageConfiguration, storageBucket } from "./object-storage/config";
import { createS3Storage } from "./object-storage/s3";
import { createAliStorage } from "./object-storage/ali";
import { createTencentStorage } from "./object-storage/tencent";
import { createHuaweiStorage } from "./object-storage/huawei";
import { guardImmutableStorage } from "./object-storage/immutable";
import type { ObjectStorage } from "./object-storage/types";

export const digest = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
export const casKey = (sha256: string) => `sha256/${sha256.slice(0, 2)}/${sha256}`;
export const packagesBucket = () => storageBucket("PACKAGES");
export const casBucket = () => storageBucket("CAS");
export const environmentsBucket = () => storageBucket("ENVIRONMENTS");
let cached: { configuration: string; client: ObjectStorage } | undefined;
export function storageClient() {
  const settings = storageConfiguration();
  const configuration = JSON.stringify(settings);
  if (cached?.configuration === configuration) return cached.client;
  cached?.client.destroy();
  const native = settings.provider === "ali" ? createAliStorage(settings) : settings.provider === "tencent" ? createTencentStorage(settings)
    : settings.provider === "huawei" ? createHuaweiStorage(settings) : undefined;
  const client = native ? guardImmutableStorage(native) : createS3Storage(settings);
  cached = { configuration, client }; return client;
}
export const missingObject = (error: unknown) => !!error && typeof error === "object" && "$metadata" in error &&
  (error.$metadata as { httpStatusCode?: number }).httpStatusCode === 404;
export async function initializeStorage() {
  const client = storageClient();
  for (const Bucket of [packagesBucket(), casBucket(), environmentsBucket()]) {
    try { await client.headBucket({ Bucket }); }
    catch (error) { if (!missingObject(error)) throw error; await client.createBucket({ Bucket }); }
  }
}
export async function readObject(key: string, bucket = packagesBucket(), maximum = 64 * 1024 * 1024) {
  const result = await storageClient().getObject({ Bucket: bucket, Key: key });
  if ((result.ContentLength ?? 0) > maximum) (result.Body as NodeJS.ReadableStream & { destroy?: () => void })?.destroy?.();
  invariant(result.Body && (result.ContentLength ?? 0) <= maximum, 422, diagnosticText("diagnostics.storage.theFileIndexExceedsTheReadLimit"));
  const chunks: Buffer[] = []; let length = 0;
  for await (const chunk of result.Body as AsyncIterable<Uint8Array>) {
    length += chunk.length; invariant(length <= maximum, 422, diagnosticText("diagnostics.storage.theFileIndexExceedsTheReadLimit")); chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
export async function putJson(key: string, value: unknown) {
  const bytes = Buffer.from(JSON.stringify(value));
  invariant(bytes.length <= 64 * 1024 * 1024, 422, diagnosticText("diagnostics.storage.theFileManifestExceeds64MibReduceTheFileCount"));
  await storageClient().putObject({ Bucket: packagesBucket(), Key: key, Body: bytes,
    ContentType: "application/json", ChecksumSHA256: createHash("sha256").update(bytes).digest("base64"), IfNoneMatch: "*" });
  return { sha256: digest(bytes), bytes };
}
export async function putCas(sha256: string, path: string, size: number) {
  const client = storageClient(); const Bucket = casBucket(); const Key = casKey(sha256);
  try {
    const found = await client.headObject({ Bucket, Key });
    invariant(found.ContentLength === size && found.Metadata?.sha256 === sha256, 422, diagnosticText("diagnostics.storage.casObjectValidationFailed"));
    return false;
  } catch (error) { if (!missingObject(error)) throw error; }
  try {
    await client.putObject({ Bucket, Key, Body: createReadStream(path), ContentLength: size,
      ContentType: "application/octet-stream", Metadata: { sha256 }, ChecksumSHA256: Buffer.from(sha256, "hex").toString("base64"), IfNoneMatch: "*" });
    return true;
  } catch (error) {
    if (!(error && typeof error === "object" && "$metadata" in error && (error.$metadata as { httpStatusCode?: number }).httpStatusCode === 412)) throw error;
    const found = await client.headObject({ Bucket, Key });
    invariant(found.ContentLength === size && found.Metadata?.sha256 === sha256, 422, diagnosticText("diagnostics.storage.concurrentCasObjectValidationFailed")); return false;
  }
}
export async function beginMultipart(key: string) {
  const result = await storageClient().createMultipartUpload({ Bucket: packagesBucket(), Key: key, ContentType: "application/zip" });
  invariant(result.UploadId, 503, diagnosticText("diagnostics.storage.unableToCreateAnUploadSession")); return result.UploadId;
}
export function signPart(key: string, uploadId: string, partNumber: number) {
  return storageClient().signUploadPart({ Bucket: packagesBucket(), Key: key, UploadId: uploadId, PartNumber: partNumber }, { expiresIn: 600 });
}
export async function completeMultipart(key: string, uploadId: string, size: number, partSize: number, parts: { partNumber: number; etag: string }[]) {
  const client = storageClient(); const identity = { Bucket: packagesBucket(), Key: key, UploadId: uploadId };
  // A completion retry may arrive after S3 succeeded but before the database committed.
  try { const existing = await client.headObject({ Bucket: identity.Bucket, Key: key }); invariant(existing.ContentLength === size, 409, diagnosticText("diagnostics.storage.theUploadSizeDoesNotMatch")); return; }
  catch (error) { if (!missingObject(error)) throw error; }
  const listed = await client.listParts(identity);
  const count = Math.ceil(size / partSize);
  invariant(!listed.IsTruncated && parts.length === count && listed.Parts?.length === count, 409, diagnosticText("diagnostics.storage.uploadPartsAreIncomplete"));
  const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber);
  for (let i = 0; i < count; i++) {
    const found = listed.Parts.find(part => part.PartNumber === i + 1);
    invariant(sorted[i].partNumber === i + 1 && sorted[i].etag === found?.ETag && found.Size === Math.min(partSize, size - i * partSize), 409, diagnosticText("diagnostics.storage.uploadPartSizeOrEtagDoesNotMatch"));
  }
  await client.completeMultipartUpload({ ...identity, IfNoneMatch: "*",
    MultipartUpload: { Parts: sorted.map(part => ({ PartNumber: part.partNumber, ETag: part.etag })) } });
  const head = await client.headObject({ Bucket: identity.Bucket, Key: key });
  invariant(head.ContentLength === size, 409, diagnosticText("diagnostics.storage.theCompleteClientSizeDoesNotMatch"));
}
export async function abortMultipart(key: string, uploadId: string) {
  try { await storageClient().abortMultipartUpload({ Bucket: packagesBucket(), Key: key, UploadId: uploadId }); }
  catch (error) { if (!missingObject(error)) throw error; }
}
export async function signedDownloadInfo(key: string, bucket = packagesBucket(), fileName?: string) {
  const disposition = fileName ? `attachment; filename="client.muapack"; filename*=UTF-8''${encodeURIComponent(fileName).replaceAll("'", "%27")}` : undefined;
  const signingDate = new Date(Math.floor(Date.now() / 1000) * 1000), expiresIn = 300;
  const url = await storageClient().signDownload({ Bucket: bucket, Key: key, ResponseContentDisposition: disposition }, { expiresIn, signingDate });
  return { url, expiresIn, expiresAt: new Date(signingDate.getTime() + expiresIn * 1000).toISOString() };
}
export async function signedDownload(key: string, bucket = packagesBucket(), fileName?: string) {
  return (await signedDownloadInfo(key, bucket, fileName)).url;
}
