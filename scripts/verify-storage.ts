import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { storageClient, packagesBucket, casBucket, environmentsBucket, digest, readObject, signedDownloadInfo } from "../src/lib/storage";
import { storageConfiguration } from "../src/lib/object-storage/config";

const precondition = (error: unknown) => (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 412;
async function verifyBucket(Bucket: string) {
  const client = storageClient(), prefix = `.union-link-storage-verification/${randomUUID()}`;
  const keys = ["object", "multipart", "copy"].map(name => `${prefix}/${name}`), active = new Map<string, string>();
  const bytes = Buffer.from("Union Link storage verification"), sha256 = digest(bytes);
  try {
    await client.headBucket({ Bucket });
    await client.putObject({ Bucket, Key: keys[0], Body: bytes, Metadata: { sha256 }, ContentType: "application/octet-stream",
      ChecksumSHA256: Buffer.from(sha256, "hex").toString("base64"), IfNoneMatch: "*" });
    await assert.rejects(client.putObject({ Bucket, Key: keys[0], Body: Buffer.from("must not replace"), IfNoneMatch: "*" }), precondition);
    const head = await client.headObject({ Bucket, Key: keys[0] });
    assert.equal(head.ContentLength, bytes.length); assert.equal(head.Metadata?.sha256, sha256); assert(head.ETag);
    assert.deepEqual(await readObject(keys[0], Bucket), bytes);
    const signed = await signedDownloadInfo(keys[0], Bucket, "storage-check.bin");
    const range = await fetch(signed.url, { headers: { Range: "bytes=1-", "If-Match": head.ETag }, redirect: "error" });
    assert.equal(range.status, 206); assert.equal(range.headers.get("etag"), head.ETag);
    assert.equal(range.headers.get("content-range"), `bytes 1-${bytes.length - 1}/${bytes.length}`);
    assert.deepEqual(Buffer.from(await range.arrayBuffer()), bytes.subarray(1));
    const wrong = await fetch(signed.url, { headers: { "If-Match": '"incorrect-etag"' }, redirect: "error" });
    assert.equal(wrong.status, 412); await wrong.arrayBuffer();
    const create = async () => {
      const { UploadId } = await client.createMultipartUpload({ Bucket, Key: keys[1], Metadata: { sha256 } }); assert(UploadId); active.set(UploadId, keys[1]);
      const identity = { Bucket, Key: keys[1], UploadId };
      const url = await client.signUploadPart({ ...identity, PartNumber: 1, ContentLength: bytes.length }, { expiresIn: 600 });
      // Reject an over-size part at the storage boundary, before completion.
      for (const body of [Buffer.concat([bytes, Buffer.from("extra")]), bytes.subarray(1)]) {
        const rejected = await fetch(url, { method: "PUT", body, redirect: "error" });
        assert.equal(rejected.status, 403, "Storage must enforce the signed part length"); await rejected.arrayBuffer();
      }
      const response = await fetch(url, { method: "PUT", body: bytes, redirect: "error" }); assert.equal(response.status, 200); await response.arrayBuffer();
      const etag = response.headers.get("etag"); assert(etag);
      const listed = await client.listParts(identity); assert.equal(listed.IsTruncated, false); assert.equal(listed.Parts?.[0].Size, bytes.length); assert.equal(listed.Parts?.[0].ETag, etag);
      return { ...identity, MultipartUpload: { Parts: [{ PartNumber: 1, ETag: etag }] }, IfNoneMatch: "*" as const };
    };
    const first = await create(); await client.completeMultipartUpload(first); active.delete(first.UploadId);
    await assert.rejects(client.completeMultipartUpload(await create()), precondition);
    assert.deepEqual(await readObject(keys[1], Bucket), bytes);
    const CopySource = `${encodeURIComponent(Bucket)}/${keys[0].split("/").map(encodeURIComponent).join("/")}`;
    await client.copyObject({ Bucket, Key: keys[2], CopySource, CopySourceIfMatch: head.ETag });
    assert.equal((await client.headObject({ Bucket, Key: keys[2] })).Metadata?.sha256, sha256);
    assert.deepEqual(await readObject(keys[2], Bucket), bytes);
    console.log(`Verified private storage operations: ${Bucket}`);
  } finally {
    for (const [UploadId, Key] of active) await client.abortMultipartUpload({ Bucket, Key, UploadId });
    for (const Key of keys) await client.deleteObject({ Bucket, Key });
  }
}
async function main() {
  const provider = storageConfiguration().provider;
  try { for (const bucket of new Set([packagesBucket(), casBucket(), environmentsBucket()])) await verifyBucket(bucket); }
  finally { storageClient().destroy(); }
  console.log(`Storage verification passed (${provider}). Browser CORS and actual large-file/cloud deployment still require separate validation.`);
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Storage verification failed"); process.exitCode = 1; });
