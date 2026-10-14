import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import http from "node:http";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { once } from "node:events";
import { S3Client, CreateBucketCommand } from "@aws-sdk/client-s3";
import { createS3Storage } from "../src/lib/object-storage/s3";
import { storageConfiguration } from "../src/lib/object-storage/config";
import { createAliStorage } from "../src/lib/object-storage/ali";
import { createTencentStorage } from "../src/lib/object-storage/tencent";
import { createHuaweiStorage } from "../src/lib/object-storage/huawei";
import { guardImmutableStorage } from "../src/lib/object-storage/immutable";
import { nativeError, noVersioning, xmlEscape } from "../src/lib/object-storage/native";

const defaults = { OSS_REGION: "cn-test-1", OSS_ACCESS_KEY_ID: "test-id", OSS_SECRET_ACCESS_KEY: "test-secret" };
const conflict = (error: unknown) => (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 412;
test("provider config preserves old MinIO settings and validates explicit cloud selection", () => {
  const old = storageConfiguration({ S3_ENDPOINT: "http://127.0.0.1:9000", S3_ACCESS_KEY_ID: "id", S3_SECRET_ACCESS_KEY: "secret" });
  assert.equal(old.provider, "minio"); assert.equal(old.forcePathStyle, true); assert.equal(old.region, "us-east-1");
  for (const provider of ["aws", "ali", "tencent", "huawei"]) {
    const config = storageConfiguration({ ...defaults, OSS_PROVIDER: provider }); assert.equal(config.provider, provider); assert.equal(config.forcePathStyle, false);
  }
  assert.equal(storageConfiguration({ ...defaults, OSS_PROVIDER: "s3", OSS_ENDPOINT: "https://s3.example.com" }).forcePathStyle, true);
  for (const provider of ["unknown", "constructor", "__proto__"]) assert.throws(() => storageConfiguration({ ...defaults, OSS_PROVIDER: provider }));
  assert.throws(() => storageConfiguration({ ...defaults, OSS_PROVIDER: "ali", OSS_FORCE_PATH_STYLE: "true" }));
  assert.throws(() => storageConfiguration({ ...defaults, OSS_PROVIDER: "huawei", OSS_CUSTOM_DOMAIN: "true", OSS_ENDPOINT: "https://one-bucket.example.com" }));
  assert.throws(() => storageConfiguration({ ...defaults, OSS_PROVIDER: "aws", OSS_ENDPOINT: "https://user:password@example.com" }));
  assert.equal(storageConfiguration({ ...defaults, OSS_PROVIDER: "ali", OSS_CUSTOM_DOMAIN: "true", OSS_ENDPOINT: "https://{bucket}.example.com" }).customDomain, true);
  assert.throws(() => noVersioning("Enabled")); assert.throws(() => noVersioning("Suspended")); noVersioning(undefined);
  assert.equal(conflict(nativeError("ali", { status: 409, code: "FileAlreadyExists" })), true);
  assert.equal(conflict(nativeError("tencent", { status: 409, code: "OperationAborted" })), false);
});

test("AWS S3 uses regional virtual-host signing, temporary credentials and regional bucket creation", async t => {
  const config = storageConfiguration({ ...defaults, OSS_PROVIDER: "aws", OSS_REGION: "ap-southeast-1", OSS_SESSION_TOKEN: "temporary-token" });
  const client = createS3Storage(config); t.after(() => client.destroy());
  const url = new URL(await client.signDownload({ Bucket: "union-link-test", Key: "package.zip" }, { expiresIn: 300 }));
  assert.equal(url.hostname, "union-link-test.s3.ap-southeast-1.amazonaws.com");
  assert.equal(url.searchParams.get("X-Amz-Expires"), "300"); assert.equal(url.searchParams.get("X-Amz-Security-Token"), "temporary-token");
  t.mock.method(S3Client.prototype, "send", async (command: CreateBucketCommand) => {
    assert(command instanceof CreateBucketCommand); assert.equal(command.input.CreateBucketConfiguration?.LocationConstraint, "ap-southeast-1"); return {};
  });
  await client.createBucket({ Bucket: "union-link-test" });
});

test("recycling uses the provider copy limit, exact ranges, pinned ETag and aborts failed copies", async t => {
  const { storageClient } = await import("../src/lib/storage");
  const { copyStoredObject } = await import("../src/lib/recycle-storage");
  const env = { OSS_PROVIDER: "minio", OSS_ENDPOINT: "http://127.0.0.1:9000", OSS_ACCESS_KEY_ID: "test", OSS_SECRET_ACCESS_KEY: "test", OSS_CUSTOM_DOMAIN: "false" };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]])); Object.assign(process.env, env);
  const client = storageClient(); Object.defineProperty(client, "singleCopyLimitBytes", { value: 1_000_000_000 });
  t.after(() => { client.destroy(); for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const size = 1_000_000_001, ranges: string[] = [], metadata = { sha256: "test-digest" }; let fail = false, aborted = false, completed = false;
  t.mock.method(client, "headObject", async () => ({ ContentLength: size, Metadata: metadata, ETag: '"source-etag"' }));
  t.mock.method(client, "copyObject", async () => { assert.fail("Ali-sized objects must use multipart copy below the S3 limit"); });
  t.mock.method(client, "createMultipartUpload", async (input: { Metadata: unknown }) => { assert.deepEqual(input.Metadata, metadata); return { UploadId: "copy-job" }; });
  t.mock.method(client, "uploadPartCopy", async (input: { CopySourceIfMatch: string; CopySourceRange: string }) => {
    assert.equal(input.CopySourceIfMatch, '"source-etag"'); if (fail) throw new Error("copy failed"); ranges.push(input.CopySourceRange); return { CopyPartResult: { ETag: '"part-etag"' } };
  });
  t.mock.method(client, "completeMultipartUpload", async () => { completed = true; });
  t.mock.method(client, "abortMultipartUpload", async () => { aborted = true; });
  await copyStoredObject("test-bucket", "source", "target");
  assert.deepEqual(ranges, ["bytes=0-536870911", "bytes=536870912-1000000000"]); assert(completed);
  fail = true; completed = false; await assert.rejects(copyStoredObject("test-bucket", "source", "target"), /copy failed/); assert(aborted); assert(!completed);
});

// Real SDKs talk to a disposable HTTP fixture. Only the network destination is redirected;
// native URL signing, request encoding, XML parsing, metadata and errors run unchanged.
async function fixture(t: TestContext, provider: "ali" | "tencent" | "huawei") {
  const prefix = `x-${provider === "ali" ? "oss" : provider === "tencent" ? "cos" : "obs"}-`;
  const objects = new Map<string, { bytes: Buffer; headers: Record<string, string>; etag: string }>();
  const uploads = new Map<string, { key: string; headers: Record<string, string>; parts: Map<number, Buffer> }>();
  const requests: { method?: string; key: string; query: URLSearchParams; headers: http.IncomingHttpHeaders }[] = [];
  let versioning = "", ignoreForbid = false, embeddedError = false, uploadSequence = 0, paginated = false;
  const etag = (bytes: Buffer) => `"${createHash("md5").update(bytes).digest("hex")}"`;
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url!, "http://storage.test"), key = decodeURIComponent(url.pathname.slice(1));
    requests.push({ method: request.method, key, query: url.searchParams, headers: request.headers });
    const body = Buffer.concat(await Array.fromAsync(request as AsyncIterable<Buffer>));
    const xml = (value: string, status = 200) => { response.writeHead(status, { "Content-Type": "application/xml" }); response.end(value); };
    const fail = (status: number, code: string) => xml(`<Error><Code>${code}</Code><Message>fixture</Message></Error>`, status);
    const stored = objects.get(key);
    if (url.searchParams.has("versioning")) return xml(`<VersioningConfiguration>${versioning ? `<Status>${versioning}</Status>` : ""}</VersioningConfiguration>`);
    if (url.searchParams.has("bucketInfo")) return xml("<BucketInfo><Bucket><Name>test-bucket</Name></Bucket></BucketInfo>");
    const uploadId = url.searchParams.get("uploadId");
    if (request.method === "POST" && url.searchParams.has("uploads")) {
      const id = `upload-${++uploadSequence}`; uploads.set(id, { key, headers: request.headers as Record<string, string>, parts: new Map() });
      return xml(`<InitiateMultipartUploadResult><Bucket>test-bucket</Bucket><Key>${xmlEscape(key)}</Key><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`);
    }
    if (uploadId) {
      const upload = uploads.get(uploadId); if (!upload) return fail(404, "NoSuchUpload");
      const part = Number(url.searchParams.get("partNumber"));
      if (request.method === "PUT") {
        let bytes: Buffer = body;
        const source = request.headers[`${prefix}copy-source`] as string | undefined;
        if (source) {
          const sourceKey = decodeURIComponent(source.replace(/^\/?[^/]+\//, "")), original = objects.get(sourceKey);
          if (!original) return fail(404, "NoSuchKey");
          if (request.headers[`${prefix}copy-source-if-match`] !== original.etag) return fail(412, "PreconditionFailed");
          const range = /bytes=(\d+)-(\d+)/.exec(String(request.headers[`${prefix}copy-source-range`]));
          bytes = range ? original.bytes.subarray(Number(range[1]), Number(range[2]) + 1) : original.bytes;
        }
        upload.parts.set(part, bytes); response.setHeader("ETag", etag(bytes));
        return source ? xml(`<CopyPartResult><ETag>${xmlEscape(etag(bytes))}</ETag></CopyPartResult>`) : response.end();
      }
      if (request.method === "GET") return xml(`<ListPartsResult><IsTruncated>false</IsTruncated>${[...upload.parts].map(([number, bytes]) => `<Part><PartNumber>${number}</PartNumber><ETag>${xmlEscape(etag(bytes))}</ETag><Size>${bytes.length}</Size></Part>`).join("")}</ListPartsResult>`);
      if (request.method === "DELETE") { uploads.delete(uploadId); response.writeHead(204); return response.end(); }
      if (request.method === "POST") {
        if (embeddedError) return xml("<Error><Code>InternalError</Code></Error>");
        if (stored && !ignoreForbid && request.headers[`${prefix}forbid-overwrite`] === "true") return fail(409, "FileAlreadyExists");
        const bytes = Buffer.concat([...upload.parts.values()]); objects.set(key, { bytes, headers: upload.headers, etag: etag(bytes) }); uploads.delete(uploadId);
        return xml(`<CompleteMultipartUploadResult><ETag>${xmlEscape(etag(bytes))}</ETag></CompleteMultipartUploadResult>`);
      }
    }
    if (!key && url.searchParams.has("uploads")) return xml(`<ListMultipartUploadsResult>${[...uploads].map(([id, value]) => `<Upload><Key>${xmlEscape(value.key)}</Key><UploadId>${id}</UploadId></Upload>`).join("")}</ListMultipartUploadsResult>`);
    if (!key) {
      const second = url.searchParams.has("marker") || url.searchParams.has("continuation-token");
      const names = paginated ? [second ? "second-page" : "first-page"] : [...objects.keys()];
      return xml(`<ListBucketResult><IsTruncated>${paginated && !second}</IsTruncated><NextMarker>next page+%</NextMarker><NextContinuationToken>next page+%</NextContinuationToken>${names.map(name => `<Contents><Key>${xmlEscape(name)}</Key></Contents>`).join("")}</ListBucketResult>`);
    }
    if (request.method === "DELETE") { objects.delete(key); response.writeHead(204); return response.end(); }
    if (request.method === "PUT") {
      if (stored && !ignoreForbid && request.headers[`${prefix}forbid-overwrite`] === "true") return fail(409, "FileAlreadyExists");
      const source = request.headers[`${prefix}copy-source`] as string | undefined;
      if (source) {
        const original = objects.get(decodeURIComponent(source.replace(/^\/?[^/]+\//, ""))); if (!original) return fail(404, "NoSuchKey");
        if (request.headers[`${prefix}copy-source-if-match`] !== original.etag) return fail(412, "PreconditionFailed");
        objects.set(key, original); response.setHeader("ETag", original.etag); return xml(`<CopyObjectResult><ETag>${xmlEscape(original.etag)}</ETag></CopyObjectResult>`);
      }
      objects.set(key, { bytes: body, headers: request.headers as Record<string, string>, etag: etag(body) }); response.setHeader("ETag", etag(body)); return response.end();
    }
    if (!stored) return fail(404, "NoSuchKey");
    if (request.headers["if-match"] && request.headers["if-match"] !== stored.etag) return fail(412, "PreconditionFailed");
    for (const [name, value] of Object.entries(stored.headers)) if (name.startsWith(`${prefix}meta-`) || ["content-type", "cache-control"].includes(name)) response.setHeader(name, value);
    response.setHeader("ETag", stored.etag); response.setHeader("Content-Length", stored.bytes.length);
    if (request.method === "HEAD") return response.end();
    if (request.headers.range) { response.statusCode = 206; response.setHeader("Content-Range", `bytes 1-${stored.bytes.length - 1}/${stored.bytes.length}`); response.setHeader("Content-Length", stored.bytes.length - 1); return response.end(stored.bytes.subarray(1)); }
    response.end(stored.bytes);
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  const originalRequest = http.request.bind(http), originalFetch = globalThis.fetch;
  t.mock.method(http, "request", (options: http.RequestOptions, callback?: (res: http.IncomingMessage) => void) => originalRequest({ ...options, hostname: "127.0.0.1", host: "127.0.0.1", port }, callback));
  t.mock.method(globalThis, "fetch", (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input)), host = url.host; url.hostname = "127.0.0.1"; url.port = String(port);
    return originalFetch(url, { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), host } });
  });
  const config = storageConfiguration({ ...defaults, OSS_PROVIDER: provider, OSS_ENDPOINT: `http://${provider === "tencent" ? "{bucket}." : ""}storage.test:${port}` });
  const raw = provider === "ali" ? createAliStorage(config) : provider === "tencent" ? createTencentStorage(config) : createHuaweiStorage(config);
  const adapter = guardImmutableStorage(raw);
  t.after(async () => { adapter.destroy(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  return { adapter, raw, objects, requests, setVersioning: (value: string) => { versioning = value; }, ignoreForbid: () => { ignoreForbid = true; }, embeddedError: () => { embeddedError = true; }, paginate: () => { paginated = true; } };
}

for (const provider of ["ali", "tencent", "huawei"] as const) {
  test(`${provider} native SDK preserves upload, download, metadata, ETags, copy and immutability`, async t => {
    const f = await fixture(t, provider), client = f.adapter, Bucket = provider === "tencent" ? "test-bucket-1234567890" : "test-bucket", Key = "folder/空 格+%.json";
    const bytes = Buffer.from("native storage"), sha = createHash("sha256").update(bytes).digest("hex");
    await client.headBucket({ Bucket });
    await client.putObject({ Bucket, Key, Body: bytes, Metadata: { sha256: sha }, ChecksumSHA256: Buffer.from(sha, "hex").toString("base64"), IfNoneMatch: "*", ContentType: "application/json" });
    const head = await client.headObject({ Bucket, Key }); assert.equal(head.ContentLength, bytes.length); assert.equal(head.Metadata?.sha256, sha); assert(head.ETag?.startsWith('"'));
    await assert.rejects(client.putObject({ Bucket, Key, Body: Buffer.from("different"), IfNoneMatch: "*" }), conflict);
    assert.deepEqual(Buffer.concat(await Array.fromAsync((await client.getObject({ Bucket, Key })).Body!)), bytes);
    const download = await client.signDownload({ Bucket, Key, ResponseContentDisposition: "attachment; filename=test.zip" }, { expiresIn: 300 });
    const query = new URL(download).searchParams;
    assert(provider === "ali" ? query.get("x-oss-expires") === "300" : provider === "tencent" ? Number(query.get("q-sign-time")?.split(";")[1]) - Number(query.get("q-sign-time")?.split(";")[0]) === 300 : query.has("Expires"));
    assert.equal(query.get("response-content-disposition"), "attachment; filename=test.zip");
    const range = await fetch(download, { headers: { Range: "bytes=1-", "If-Match": head.ETag! } }); assert.equal(range.status, 206); assert.deepEqual(Buffer.from(await range.arrayBuffer()), bytes.subarray(1));
    await client.copyObject({ Bucket, Key: "copied", CopySource: `${Bucket}/${Key.split("/").map(encodeURIComponent).join("/")}`, CopySourceIfMatch: head.ETag });
    assert.equal((await client.headObject({ Bucket, Key: "copied" })).Metadata?.sha256, sha);
    await assert.rejects(client.copyObject({ Bucket, Key: "bad-copy", CopySource: `${Bucket}/copied`, CopySourceIfMatch: '"wrong"' }), conflict);
    const upload = await client.createMultipartUpload({ Bucket, Key: "multipart", Metadata: { sha256: sha } }); assert(upload.UploadId);
    const identity = { Bucket, Key: "multipart", UploadId: upload.UploadId };
    const partUrl = await client.signUploadPart({ ...identity, PartNumber: 1 }, { expiresIn: 600 });
    const put = await fetch(partUrl, { method: "PUT", body: bytes }); assert.equal(put.status, 200);
    const parts = await client.listParts(identity); assert.equal(parts.IsTruncated, false); assert.equal(parts.Parts?.[0].Size, bytes.length); assert.equal(parts.Parts?.[0].ETag, put.headers.get("etag"));
    assert((await client.listMultipartUploads({ Bucket })).Uploads?.some(row => row.UploadId === upload.UploadId));
    await client.completeMultipartUpload({ ...identity, MultipartUpload: { Parts: [{ PartNumber: 1, ETag: put.headers.get("etag")! }] }, IfNoneMatch: "*" });
    assert.equal((await client.headObject({ Bucket, Key: "multipart" })).Metadata?.sha256, sha);
    const copy = await client.createMultipartUpload({ Bucket, Key: "part-copy" });
    const copyIdentity = { Bucket, Key: "part-copy", UploadId: copy.UploadId! };
    const copied = await client.uploadPartCopy({ ...copyIdentity, PartNumber: 1, CopySource: `${Bucket}/copied`, CopySourceIfMatch: head.ETag, CopySourceRange: "bytes=0-5" });
    await assert.rejects(client.uploadPartCopy({ ...copyIdentity, PartNumber: 2, CopySource: `${Bucket}/copied`, CopySourceIfMatch: '"changed-source"', CopySourceRange: "bytes=6-10" }), conflict);
    assert(copied.CopyPartResult?.ETag); await client.abortMultipartUpload(copyIdentity);
    await client.putObject({ Bucket, Key: "stream", Body: Readable.from([bytes]), ContentLength: bytes.length, ChecksumSHA256: Buffer.from(sha, "hex").toString("base64"), Metadata: { sha256: sha }, IfNoneMatch: "*" });
    assert.equal((await client.headObject({ Bucket, Key: "stream" })).ContentLength, bytes.length);
    assert((await client.listObjects({ Bucket })).Contents?.some(row => row.Key === Key));
    f.paginate(); const page = await client.listObjects({ Bucket }); assert.equal(page.NextContinuationToken, "next page+%");
    assert.equal((await client.listObjects({ Bucket, ContinuationToken: page.NextContinuationToken })).Contents?.[0].Key, "second-page");
    await client.deleteObject({ Bucket, Key: "copied" }); await assert.rejects(client.headObject({ Bucket, Key: "copied" }), (error: unknown) => (error as { $metadata: { httpStatusCode: number } }).$metadata.httpStatusCode === 404);
    const aborted = new AbortController(); aborted.abort(); await assert.rejects(client.getObject({ Bucket, Key }, { abortSignal: aborted.signal }));
    await assert.rejects(client.createMultipartUpload({ Bucket, Key: "cancelled" }, { abortSignal: aborted.signal }));
    await assert.rejects(client.putObject({ Bucket, Key: "bad-hash", Body: bytes, ChecksumSHA256: Buffer.alloc(32).toString("base64"), IfNoneMatch: "*" }));
    assert(!f.objects.has("bad-hash")); assert(!f.objects.has("cancelled"));
    f.setVersioning("Enabled"); await assert.rejects(client.putObject({ Bucket, Key: "versioned", Body: bytes, IfNoneMatch: "*" }), /版本控制/); assert(!f.objects.has("versioned"));
    f.setVersioning(""); f.embeddedError(); const broken = await client.createMultipartUpload({ Bucket, Key: "broken" });
    await assert.rejects(client.completeMultipartUpload({ Bucket, Key: "broken", UploadId: broken.UploadId!, MultipartUpload: { Parts: [] } }));
    assert.equal(f.objects.has("broken"), false);
  });
  test(`${provider} refuses formal immutable writes if the service ignores forbid-overwrite`, async t => {
    const f = await fixture(t, provider); f.ignoreForbid();
    await assert.rejects(f.adapter.putObject({ Bucket: provider === "tencent" ? "test-bucket-1234567890" : "test-bucket", Key: "formal-manifest", Body: Buffer.from("signed"), IfNoneMatch: "*" }), /原子禁止覆盖/);
    assert(!f.objects.has("formal-manifest")); assert.equal(f.objects.size, 0);
  });
}
