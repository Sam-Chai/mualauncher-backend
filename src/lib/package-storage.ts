import { diagnosticText } from "@/lib/diagnostics";
import "server-only";

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { storageClient, missingObject, digest, packagesBucket } from "./storage";
import { invariant } from "./errors";

export async function storedHead(bucket: string, key: string) {
  try { return await storageClient().headObject({ Bucket: bucket, Key: key }); }
  catch (error) { if (missingObject(error)) return null; throw error; }
}
export async function putImmutableBytes(bucket: string, key: string, bytes: Buffer) {
  const sha256 = digest(bytes);
  try { await storageClient().putObject({ Bucket: bucket, Key: key, Body: bytes, ContentType: "application/json",
    Metadata: { sha256 }, ChecksumSHA256: Buffer.from(sha256, "hex").toString("base64"), IfNoneMatch: "*" }); }
  catch (error) { if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 412) throw error;
    const found = await storedHead(bucket, key); invariant(found?.Metadata?.sha256 === sha256 && found.ContentLength === bytes.length, 409, diagnosticText("diagnostics.packageStorage.conflictingCachedContent")); }
  return sha256;
}
export async function downloadStoredFile(bucket: string, key: string, path: string, sha256: string, size: number, signal: AbortSignal) {
  const response = await storageClient().getObject({ Bucket: bucket, Key: key }, { abortSignal: signal });
  const body = response.Body as NodeJS.ReadableStream & { destroy(): void };
  if (!body || response.ContentLength !== size) body?.destroy();
  invariant(body && response.ContentLength === size, 422, diagnosticText("diagnostics.packageStorage.theObjectSizeDoesNotMatch"));
  let length = 0; const hash = createHash("sha256");
  await pipeline(body, new Transform({ transform(chunk, _, callback) { length += chunk.length;
    if (length > size) { callback(new Error(diagnosticText("diagnostics.packageStorage.theObjectExceedsItsManifestSize"))); return; } hash.update(chunk); callback(null, chunk); } }), createWriteStream(path, { flags: "wx" }), { signal });
  invariant(length === size && hash.digest("hex") === sha256, 422, diagnosticText("diagnostics.packageStorage.objectSha256ValidationFailed"));
}
export async function uploadPackageFile(key: string, path: string, signal: AbortSignal) {
  const size = (await stat(path)).size; const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) { signal.throwIfAborted(); hash.update(chunk); }
  const sha256 = hash.digest("hex"); const Bucket = packagesBucket(); const s3 = storageClient();
  const created = await s3.createMultipartUpload({ Bucket, Key: key, ContentType: "application/zip", Metadata: { sha256 },
    CacheControl: "public, max-age=31536000, immutable" }, { abortSignal: signal });
  invariant(created.UploadId, 503, diagnosticText("diagnostics.packageStorage.packageUploadInitializationFailed")); const identity = { Bucket, Key: key, UploadId: created.UploadId };
  const file = await open(path, "r"); const parts = [];
  try {
    const partSize = 64 * 1024 ** 2;
    for (let offset = 0, number = 1; offset < size; offset += partSize, number++) {
      signal.throwIfAborted(); const bytes = Buffer.alloc(Math.min(partSize, size - offset)); let filled = 0;
      while (filled < bytes.length) { const read = await file.read(bytes, filled, bytes.length - filled, offset + filled); invariant(read.bytesRead, 422, diagnosticText("diagnostics.packageStorage.packageFileReadingWasInterrupted")); filled += read.bytesRead; }
      const part = await s3.uploadPart({ ...identity, PartNumber: number, Body: bytes, ContentLength: bytes.length }, { abortSignal: signal });
      invariant(part.ETag, 503, diagnosticText("diagnostics.packageStorage.packageMultipartUploadFailed")); parts.push({ PartNumber: number, ETag: part.ETag });
    }
    await s3.completeMultipartUpload({ ...identity, MultipartUpload: { Parts: parts }, IfNoneMatch: "*" }, { abortSignal: signal });
    const found = await storedHead(Bucket, key); invariant(found?.Metadata?.sha256 === sha256 && found.ContentLength === size, 422, diagnosticText("diagnostics.packageStorage.packageStorageValidationFailed"));
    return { key, sha256, size };
  } catch (error) { await s3.abortMultipartUpload(identity).catch(() => {}); throw error; }
  finally { await file.close(); }
}
