import "dotenv/config";
import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { randomBytes, generateKeyPairSync, createPublicKey, verify } from "node:crypto";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import pg from "pg";
import crc32 from "crc-32";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { ListObjectsV2Command, DeleteObjectsCommand, DeleteBucketCommand, ListMultipartUploadsCommand, AbortMultipartUploadCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { prisma } from "../src/lib/prisma";
import { locked, tokenDigest, COOKIE_NAME, type Actor, type Db } from "../src/lib/auth";
import { AppError } from "../src/lib/errors";
import * as m from "../src/lib/management";
import * as c from "../src/lib/client-service";
import { runUploadWorker, claimUpload } from "../src/lib/client-worker";
import { ZipFile as YazlZipFile } from "yazl";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { storageClient, initializeStorage, digest, casKey, casBucket, packagesBucket, missingObject, readObject } from "../src/lib/storage";
import { indexClientStorage, maintainRecycleBin, recycleSettings, updateRecycleSettings } from "../src/lib/recycle-storage";
import { parseClientPack, filePolicy } from "../src/lib/pack-parser";
import { publicManifest, publicFile } from "../src/lib/client-download";
import { apiActor, createApiToken, revokeApiToken } from "../src/lib/api-auth";
import { signingIdentity } from "../src/lib/signing";
import type { ClientMetadata, ReleaseManifest, UploadView } from "../src/lib/client-contract";
import { detectPackFormat, inspectPackLayout, inspectPackMods } from "../src/lib/pack-inspection";

const suffix = randomBytes(8).toString("hex"); const schema = "mua_upload_test_" + suffix;
process.env.S3_PACKAGES_BUCKET = "mua-upload-test-" + suffix + "-packages"; process.env.S3_CAS_BUCKET = "mua-upload-test-" + suffix + "-cas";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: "-c search_path=" + schema + ",pg_catalog" });
const client = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) });
let created = false; let temp = "";
let root: Actor; let admin: Actor; let reviewer: Actor; let publisher: Actor; let operator: Actor; let reader: Actor;
const denied = (status: number) => (error: unknown) => error instanceof AppError && error.status === status;
const work = <T>(callback: (db: Db) => Promise<T>) => locked(callback, client);
function rawZip(files: { name: string; data: Buffer; attributes?: number }[]) {
  const locals: Buffer[] = []; const directory: Buffer[] = []; let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name); const crc = crc32.buf(file.data) >>> 0;
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6);
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(file.data.length, 18); header.writeUInt32LE(file.data.length, 22); header.writeUInt16LE(name.length, 26);
    locals.push(header, name, file.data);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(0x314, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(file.data.length, 20); central.writeUInt32LE(file.data.length, 24); central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(file.attributes ?? 0, 38); central.writeUInt32LE(offset, 42); directory.push(central, name); offset += header.length + name.length + file.data.length;
  }
  const dir = Buffer.concat(directory); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}
const shared = Buffer.alloc(100, 1);
const v1 = rawZip([{ name: ".minecraft/mods/shared.jar", data: shared }, { name: ".minecraft/config/game.txt", data: Buffer.from("old") },
  { name: ".minecraft/config/remove.txt", data: Buffer.from("removed") }, { name: ".minecraft/options.txt", data: Buffer.from("yes") },
  { name: ".minecraft/launcher_accounts.json", data: Buffer.from('{"token":"must-stay-private"}') }]);
const v2 = rawZip([{ name: "mods/shared.jar", data: shared }, { name: "config/game.txt", data: Buffer.from("new") },
  { name: "mods/new.jar", data: Buffer.from("newmod") }, { name: "options.txt", data: Buffer.from("no!") }]);
const fields: ClientMetadata = { name: "NPUcraft", versionLabel: "1.0.0", minecraftVersion: "1.21.1", javaVersion: 21, mods: ["shared.jar"], summary: "Initial client", description: "# NPU\nComplete client" };
async function prepare(bytes: Buffer, actor = admin, serverId = "NPA", processNow = true) {
  const publication = await client.client.findUniqueOrThrow({ where: { id: serverId } });
  const upload = await work(db => c.createUpload(db, actor, { clientId: serverId, fileName: "client.zip", size: bytes.length,
    baseReleaseId: publication.currentReleaseId, basePublicationRevision: publication.revision }));
  const parts: { partNumber: number; etag: string }[] = [];
  for (let start = 0, partNumber = 1; start < bytes.length; start += upload.partSize, partNumber++) {
    const signed = await work(db => c.uploadPartUrl(db, actor, upload.id, { partNumber }));
    const response = await fetch(signed.url, { method: "PUT", headers: { Origin: "http://localhost:3001" }, body: new Uint8Array(bytes.subarray(start, start + upload.partSize)) });
    assert.equal(response.status, 200, await response.text());
    assert(response.headers.get("access-control-expose-headers")?.toLowerCase().includes("etag"), "Browser must be able to read multipart ETag");
    parts.push({ partNumber, etag: response.headers.get("etag")! });
  }
  const completion = await work(db => c.prepareCompletion(db, actor, upload.id, { parts }));
  if (parts.length > 1) {
    const incomplete = await work(db => c.prepareCompletion(db, actor, upload.id, { parts: parts.slice(0, -1) }));
    await assert.rejects(c.transferCompletion(incomplete), denied(409));
  }
  await c.transferCompletion(completion);
  await work(db => c.queueCompletedUpload(db, actor, upload.id));
  if (processNow) assert.equal(await runUploadWorker(client), true);
  return c.uploadView(await c.findUpload(client, actor, upload.id));
}
async function submitted(upload: UploadView, versionLabel: string) { return work(db => c.submitUpload(db, admin, upload.id, { ...fields, versionLabel })); }
async function approved(draftId: string) { return work(db => c.reviewClient(db, reviewer, "NPA", draftId, { decision: "approve", note: "Checked", contentRevision: 1 })); }
before(async () => {
  await pool.query('CREATE SCHEMA "' + schema + '"'); created = true;
  for (const migration of ["202610080001_initial", "202610080002_invariants", "202610080003_client_uploads", "202610080004_upload_integrity", "202610090001_independent_clients", "202610090002_client_inspection", "202610090003_client_recycle"]) await pool.query((await readFile("prisma/migrations/" + migration + "/migration.sql", "utf8")).replace('CREATE SCHEMA IF NOT EXISTS "public";', ""));
  temp = await mkdtemp(join(tmpdir(), "mua-upload-test-")); process.env.SIGNING_PRIVATE_KEY_PATH = join(temp, "key.pem");
  await writeFile(process.env.SIGNING_PRIVATE_KEY_PATH, generateKeyPairSync("ed25519").privateKey.export({ format: "pem", type: "pkcs8" }));
  await initializeStorage();
  await work(async db => {
    root = await db.account.create({ data: { displayName: "root", isSuperAdmin: true } });
    admin = await db.account.create({ data: { displayName: "NPU admin" } }); reviewer = await db.account.create({ data: { displayName: "reviewer" } });
    publisher = await db.account.create({ data: { displayName: "publisher" } }); operator = await db.account.create({ data: { displayName: "operator" } }); reader = await db.account.create({ data: { displayName: "reader" } });
    const org = await m.createOrganization(db, root, { displayName: "NPU" }); const other = await m.createOrganization(db, root, { displayName: "Other" });
    await m.createServer(db, root, { organizationId: org.id, serverId: "NPA", displayName: "NPU release" }); await m.createServer(db, root, { organizationId: other.id, serverId: "OTH", displayName: "Other server" });
    for (const server of await db.server.findMany()) {
      await db.client.create({ data: { id: server.serverId, organizationId: server.organizationId, name: fields.name, nameKey: c.normalizeName(fields.name), scopeServerId: server.serverId } });
      await db.serverPublication.update({ where: { serverId: server.serverId }, data: { clientId: server.serverId } });
    }
    for (const [actor, role] of [[admin, "ORG_ADMIN"], [reviewer, "REVIEWER"], [publisher, "PUBLISHER"], [operator, "RELEASE_OPERATOR"], [reader, "READ_ONLY"]] as const) await m.setMember(db, root, org.id, actor.id, { roles: [role], status: "ACTIVE" });
    await m.updateServer(db, root, "NPA", { isListed: true });
  });
});
after(async () => {
  const s3 = storageClient();
  for (const Bucket of [process.env.S3_PACKAGES_BUCKET!, process.env.S3_CAS_BUCKET!]) {
    assert.match(Bucket, /^mua-upload-test-[0-9a-f]{16}-(packages|cas)$/);
    const incomplete = await s3.send(new ListMultipartUploadsCommand({ Bucket }));
    for (const upload of incomplete.Uploads ?? []) await s3.send(new AbortMultipartUploadCommand({ Bucket, Key: upload.Key, UploadId: upload.UploadId }));
    for (;;) { const listed = await s3.send(new ListObjectsV2Command({ Bucket })); if (!listed.Contents?.length) break; await s3.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: listed.Contents.map(object => ({ Key: object.Key! })) } })); }
    await s3.send(new DeleteBucketCommand({ Bucket }));
  }
  await client.$disconnect(); await pool.end(); await prisma.$disconnect();
  if (created) { assert.match(schema, /^mua_upload_test_[0-9a-f]{16}$/); const cleanup = new pg.Pool({ connectionString: process.env.DATABASE_URL }); await cleanup.query('DROP SCHEMA "' + schema + '" CASCADE'); await cleanup.end(); }
  if (temp) { assert(resolve(temp).startsWith(resolve(tmpdir()) + (process.platform === "win32" ? "\\" : "/"))); await rm(temp, { recursive: true, force: true }); }
});

test("upload authorization and API Tokens keep real RBAC, account revocation and server scopes", async () => {
  await assert.rejects(work(db => c.createUpload(db, admin, { clientId: "OTH", fileName: "x.zip", size: 5, baseReleaseId: null, basePublicationRevision: 0 })), denied(404));
  await assert.rejects(work(db => c.createUpload(db, reader, { clientId: "NPA", fileName: "x.zip", size: 5, baseReleaseId: null, basePublicationRevision: 0 })), denied(403));
  const token = await work(db => createApiToken(db, admin, { name: "Actions", serverIds: ["NPA"], permissions: ["SERVER_READ", "DRAFT_READ", "DRAFT_CREATE", "DRAFT_EDIT", "DRAFT_SUBMIT"], expiresInDays: 30 }));
  const record = await client.apiToken.findUniqueOrThrow({ where: { id: token.id } }); assert.equal(record.tokenHash, tokenDigest(token.token)); assert.notEqual(record.tokenHash, token.token);
  const request = new Request("http://localhost/api/v1/clients", { headers: { Authorization: "Bearer " + token.token } });
  const actor = await apiActor(client, request, undefined); assert.equal((await c.clientList(client, actor)).length, 1);
  await assert.rejects(work(db => createApiToken(db, admin, { name: "escalation", serverIds: ["NPA"], permissions: ["SERVER_READ", "RELEASE_PUBLISH"], expiresInDays: 30 })), denied(403));
  const organizationId = (await client.server.findUniqueOrThrow({ where: { serverId: "NPA" } })).organizationId;
  await work(db => m.setMember(db, root, organizationId, admin.id, { roles: ["ORG_ADMIN"], status: "DISABLED" }));
  await assert.rejects(work(db => c.createUpload(db, actor, { clientId: "NPA", fileName: "x.zip", size: 5, baseReleaseId: null, basePublicationRevision: 0 })), denied(404));
  await work(db => m.setMember(db, root, organizationId, admin.id, { roles: ["ORG_ADMIN"], status: "ACTIVE" }));
  await work(db => m.updateAccount(db, root, admin.id, { status: "DISABLED" }));
  await assert.rejects(apiActor(client, request, undefined), denied(401));
  await work(db => m.updateAccount(db, root, admin.id, { status: "ACTIVE" }));
  await work(db => revokeApiToken(db, admin, token.id)); await assert.rejects(apiActor(client, request, undefined), denied(401));
});
test("a full ZIP becomes private CAS files and a reviewed, signed immutable current release", async () => {
  const upload = await prepare(v1); assert.equal(upload.status, "READY"); assert.equal(upload.statistics?.fileCount, 4); assert.equal(upload.statistics?.fullSize, 113);
  assert.deepEqual(upload.detectedMods, ["shared.jar"]); assert(upload.warnings.some(warning => warning.includes("忽略")));
  const anonymous = await fetch(process.env.S3_ENDPOINT + "/" + casBucket() + "/" + casKey(digest(shared))); assert.equal(anonymous.status, 403);
  const { draftId } = await work(db => c.submitUpload(db, admin, upload.id, { ...fields, mods: ["forged.jar"] })); assert.equal((await client.serverPublication.findUniqueOrThrow({ where: { serverId: "NPA" } })).releaseId, null);
  assert.equal((await work(db => c.submitUpload(db, admin, upload.id, fields))).draftId, draftId, "Submission retry is idempotent");
  await assert.rejects(work(db => c.publishClient(db, root, "NPA", draftId, { activate: true })), denied(409));
  await assert.rejects(work(db => c.reviewClient(db, admin, "NPA", draftId, { decision: "approve", note: "", contentRevision: 1 })), denied(403));
  await approved(draftId);
  await assert.rejects(work(db => c.publishClient(db, publisher, "NPA", draftId, { activate: true })), denied(403));
  const released = await work(db => c.publishClient(db, publisher, "NPA", draftId, { activate: false }));
  assert.equal((await client.serverPublication.findUniqueOrThrow({ where: { serverId: "NPA" } })).releaseId, null);
  await work(db => c.activateClient(db, operator, "NPA", released.releaseId, { publicationRevision: 0 }));
  const published = await publicManifest(client, "NPA"); const manifest = JSON.parse(published.bytes.toString()) as ReleaseManifest;
  assert.equal(manifest.version, "1.0.0"); assert(!manifest.files.some(file => file.path.includes("launcher_accounts")));
  assert.deepEqual(manifest.mods, ["shared.jar"], "submitted mod names cannot replace Worker detection");
  assert.deepEqual((await client.clientDraft.findUniqueOrThrow({ where: { id: draftId } })).candidateMetadata, { ...fields, mods: ["shared.jar"] });
  assert.equal(manifest.files.find(file => file.path === "options.txt")?.policy, "preserve");
  const identity = await signingIdentity(); const key = createPublicKey({ key: Buffer.from(identity.publicKey, "base64"), type: "spki", format: "der" });
  assert(verify(null, published.bytes, key, Buffer.from(published.release.signature, "base64")));
  assert(!verify(null, Buffer.from("tampered"), key, Buffer.from(published.release.signature, "base64")));
  const download = await publicFile(client, "NPA", digest(shared)); const response = await fetch(download.url); assert.deepEqual(Buffer.from(await response.arrayBuffer()), shared);
  await assert.rejects(publicFile(client, "NPA", digest("private")), denied(404));
  await assert.rejects(work(db => m.saveDraft(db, admin, "NPA", { versionLabel: "1.0.0", name: "edited", description: "", changelog: "edit", contentRevision: 1 }, draftId)), denied(409));
  await assert.rejects(client.clientRelease.update({ where: { id: released.releaseId }, data: { name: "mutated" } }));
});
test("updates compute real CAS reuse and managed/preserve delta, enforce new versions and switch only on publish", async () => {
  const upload = await prepare(v2); assert.equal(upload.status, "READY");
  assert.deepEqual(upload.statistics, { previousVersion: "1.0.0", addedFiles: 1, modifiedFiles: 2, deletedFiles: 1, fullSize: 112, newDataSize: 12,
    estimatedDownloadSize: 9, casReusePercent: 89.29, fileCount: 4, sourceSize: v2.length });
  await assert.rejects(submitted(upload, "1.0.0"), denied(409));
  const original = (await client.serverPublication.findUniqueOrThrow({ where: { serverId: "NPA" } })).releaseId;
  const { draftId } = await submitted(upload, "1.1.0"); await approved(draftId);
  assert.equal((await client.serverPublication.findUniqueOrThrow({ where: { serverId: "NPA" } })).releaseId, original);
  await work(db => c.publishClient(db, root, "NPA", draftId, { activate: true }));
  assert.equal(JSON.parse((await publicManifest(client, "NPA")).bytes.toString()).version, "1.1.0");
  assert.deepEqual(JSON.parse((await publicManifest(client, "NPA")).bytes.toString()).mods, ["new.jar", "shared.jar"], "updates replace the entire detected mod list");
  assert.equal(await client.clientRelease.count(), 2);
});
test("ZIP traversal, case collisions, symlinks, unsupported formats and bad CRC never become releases", async () => {
  const bad = [rawZip([{ name: "../config/escape.txt", data: Buffer.from("escape") }]),
    rawZip([{ name: "mods/a.jar", data: Buffer.from("a") }, { name: "mods/A.jar", data: Buffer.from("b") }]),
    rawZip([{ name: "mods/link.jar", data: Buffer.from("../secret"), attributes: 0xa1ff0000 }]),
    rawZip([{ name: "modrinth.index.json", data: Buffer.from("{}") }])];
  const corrupt = Buffer.from(v2); corrupt[30 + Buffer.byteLength("mods/shared.jar")] ^= 0xff; bad.push(corrupt);
  for (const bytes of bad) { const upload = await prepare(bytes); assert.equal(upload.status, "FAILED"); assert.equal(upload.draftId, null); await assert.rejects(submitted(upload, "invalid"), denied(409)); }
  assert.equal(await client.clientRelease.count(), 2);
});
test("competing updates cannot silently replace a newly published baseline; archive stops public distribution", async () => {
  const first = await prepare(v2); const second = await prepare(v2); assert.equal(first.statistics?.newDataSize, 0); assert.equal(first.statistics?.casReusePercent, 100);
  const a = await submitted(first, "1.2.0"); const b = await submitted(second, "1.3.0"); await approved(a.draftId); await approved(b.draftId);
  await work(db => c.publishClient(db, root, "NPA", a.draftId, { activate: true }));
  await assert.rejects(work(db => c.publishClient(db, root, "NPA", b.draftId, { activate: true })), denied(409));
  await work(db => c.archiveClient(db, admin, "NPA", { archived: true })); await assert.rejects(publicManifest(client, "NPA"), denied(404));
  assert.equal(await client.clientRelease.count(), 3); assert.equal(await client.clientDraft.count(), 4);
});
test("a ZIP larger than one 64 MiB part verifies all parts and streams to CAS without incomplete publication", async () => {
  const data = randomBytes(65 * 1024 * 1024);
  const bytes = rawZip([{ name: "Example/.minecraft/mods/large.jar", data }]);
  const upload = await prepare(bytes, root, "OTH");
  assert.equal(upload.status, "READY");
  assert.equal(upload.statistics?.fullSize, data.length);
  assert.equal(upload.statistics?.newDataSize, data.length);
  assert.equal(upload.statistics?.fileCount, 1);
  assert.equal((await client.serverPublication.findUniqueOrThrow({ where: { serverId: "OTH" } })).releaseId, null);
});
test("deflate, ZIP64 and Unicode paths are parsed; a crashed Worker lease can be reclaimed", async () => {
  const zip = new YazlZipFile();
  zip.addBuffer(Buffer.from("compressed configuration\n".repeat(1000)), "Example/.minecraft/config/中文.json");
  zip.addBuffer(shared, "Example/.minecraft/mods/shared.jar");
  zip.end({ forceZip64Format: true, comment: "" });
  const chunks: Buffer[] = []; for await (const chunk of zip.outputStream) chunks.push(Buffer.from(chunk));
  const upload = await prepare(Buffer.concat(chunks), root, "OTH", false);
  const claimed = await claimUpload(client); assert.equal(claimed?.id, upload.id);
  await client.clientUpload.update({ where: { id: upload.id }, data: { leaseUntil: new Date(Date.now() - 1000) } });
  assert.equal(await runUploadWorker(client), true);
  const complete = await client.clientUpload.findUniqueOrThrow({ where: { id: upload.id } }); assert.equal(complete.status, "READY"); assert.equal(complete.attempts, 2);
  const inventory = await c.readInventory(complete.filesObjectKey!, complete.filesSha256!);
  assert(inventory.files.some(file => file.path === "config/中文.json"));
  await assert.rejects(client.clientUpload.update({ where: { id: upload.id }, data: { status: "QUEUED" } }));
  await assert.rejects(client.clientUpload.update({ where: { id: upload.id }, data: { sourceObjectKey: "other.zip" } }));
});
test("the standard HTTP API and Actions upload script share the reviewed release pipeline", { skip: !process.env.MUA_HTTP_TEST_DIST, timeout: 45000 }, async () => {
  const probe = createServer(); await new Promise<void>(resolve => probe.listen(0, "127.0.0.1", resolve));
  const port = (probe.address() as { port: number }).port; await new Promise<void>(resolve => probe.close(() => resolve()));
  const origin = "http://127.0.0.1:" + port;
  const databaseUrl = new URL(process.env.DATABASE_URL!); databaseUrl.searchParams.set("options", "-c search_path=" + schema + ",pg_catalog");
  const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port), "-H", "127.0.0.1"], {
    windowsHide: true, env: { ...process.env, NODE_ENV: "production", DATABASE_URL: databaseUrl.toString(), DATABASE_SCHEMA: schema,
      NEXT_DIST_DIR: process.env.MUA_HTTP_TEST_DIST!, APP_ORIGIN: origin }, stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = new Promise<void>(resolve => server.once("exit", () => resolve()));
  let output = ""; server.stdout.on("data", chunk => { output += chunk.toString(); }); server.stderr.on("data", chunk => { output += chunk.toString(); });
  try {
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch(origin + "/login", { signal: AbortSignal.timeout(500) })).ok) { ready = true; break; } } catch { /* Wait for Next to bind the isolated test port. */ }
      if (server.exitCode !== null) break; await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert(ready, output.slice(-2000)); assert.equal((await fetch(origin + "/api/v1/clients")).status, 401);
    const token = await work(db => createApiToken(db, root, { name: "HTTP pipeline", serverIds: ["OTH"], expiresInDays: 1,
      permissions: ["SERVER_READ", "DRAFT_READ", "DRAFT_CREATE", "DRAFT_EDIT", "DRAFT_SUBMIT", "DRAFT_REVIEW", "RELEASE_READ", "RELEASE_PUBLISH", "RELEASE_ACTIVATE", "CLIENT_BIND", "CLIENT_ARCHIVE", "CLIENT_DELETE"] }));
    const authorization = { Authorization: "Bearer " + token.token };
    assert.equal((await fetch(origin + "/api/v1/clients/NPA", { headers: authorization })).status, 404);
    const sourcePath = join(temp, "complete.zip"); const metadataPath = join(temp, "metadata.json");
    const { mods: _mods, ...automaticMetadata } = fields; void _mods;
    await writeFile(sourcePath, v2); await writeFile(metadataPath, JSON.stringify({ ...automaticMetadata, versionLabel: "1.0.0" }));
    const cli = spawn(process.execPath, ["--import", "tsx", "scripts/upload-client.ts", sourcePath, metadataPath, "OTH"], {
      windowsHide: true, env: { ...process.env, MUA_API_URL: origin, MUA_API_TOKEN: token.token }, stdio: ["ignore", "pipe", "pipe"],
    });
    let cliOutput = ""; let cliErrors = ""; let done = false;
    cli.stdout.on("data", chunk => { cliOutput += chunk.toString(); }); cli.stderr.on("data", chunk => { cliErrors += chunk.toString(); });
    const cliFinished = new Promise<number | null>(resolve => cli.once("exit", code => { done = true; resolve(code); }));
    const deadline = Date.now() + 20000;
    while (!done && Date.now() < deadline) { await runUploadWorker(client); await new Promise(resolve => setTimeout(resolve, 250)); }
    if (!done) cli.kill(); assert.equal(await cliFinished, 0, cliErrors);
    const result = JSON.parse(cliOutput.split("\n").find(line => line.startsWith("{"))!);
    assert.equal(result.status, "SUBMITTED");
    const post = async (path: string, body: unknown) => {
      const response = await fetch(origin + path, { method: "POST", headers: { ...authorization, "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await response.json(); assert.equal(response.status, 200, JSON.stringify(json)); return json;
    };
    await post("/api/v1/clients/OTH/drafts/" + result.draftId + "/review", { decision: "approve", note: "HTTP verified", contentRevision: 1 });
    await post("/api/v1/clients/OTH/drafts/" + result.draftId + "/publish", { activate: true });
    await work(db => m.updateServer(db, root, "OTH", { isListed: true }));
    const manifestResponse = await fetch(origin + "/api/v1/servers/OTH/manifest"); assert.equal(manifestResponse.status, 200);
    const bytes = Buffer.from(await manifestResponse.arrayBuffer()); assert.equal(digest(bytes), manifestResponse.headers.get("x-mua-manifest-sha256"));
    const identity = await signingIdentity();
    assert(verify(null, bytes, createPublicKey(identity.privateKey), Buffer.from(manifestResponse.headers.get("x-mua-signature")!, "base64")));
    const fileResponse = await fetch(origin + "/api/v1/servers/OTH/files/" + digest(shared)); assert.equal(fileResponse.status, 200);
    const file = await fileResponse.json(); assert.deepEqual(Buffer.from(await (await fetch(file.url)).arrayBuffer()), shared);
    // The same standard HTTP endpoint handles instance selection and early runtime metadata.
    const multi = rawZip([{ name: "versions/pcl/pcl.json", data: Buffer.from('{"id":"pcl","clientVersion":"1.21.1"}') },
      { name: "versions/hmcl/hmcl.json", data: Buffer.from('{"id":"hmcl","patches":[{"id":"game","version":"26.1"}]}') },
      { name: "versions/hmcl/mods/api.jar", data: randomBytes(39) }]);
    const currentClient = await client.client.findUniqueOrThrow({ where: { id: "OTH" } });
    const createdUpload = await fetch(origin + "/api/v1/clients/uploads", { method: "POST", headers: { ...authorization, "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: "OTH", fileName: "multi.zip", size: multi.length, baseReleaseId: currentClient.currentReleaseId, basePublicationRevision: currentClient.revision }) });
    assert.equal(createdUpload.status, 201); const multiUpload = await createdUpload.json();
    const signed = await post(`/api/v1/clients/uploads/${multiUpload.id}/parts`, { partNumber: 1 });
    const put = await fetch(signed.url, { method: "PUT", body: new Uint8Array(multi) }); assert.equal(put.status, 200);
    await post(`/api/v1/clients/uploads/${multiUpload.id}/complete`, { parts: [{ partNumber: 1, etag: put.headers.get("etag") }] });
    await runUploadWorker(client);
    const paused = await (await fetch(origin + `/api/v1/clients/uploads/${multiUpload.id}`, { headers: authorization })).json();
    assert.equal(paused.processingPhase, "SELECT_INSTANCE"); assert.equal(paused.detectedInfo.candidates.length, 2);
    await post(`/api/v1/clients/uploads/${multiUpload.id}/select-instance`, { instanceId: "hmcl" });
    await runUploadWorker(client);
    const detected = await (await fetch(origin + `/api/v1/clients/uploads/${multiUpload.id}`, { headers: authorization })).json();
    assert.equal(detected.status, "READY"); assert.equal(detected.detectedInfo.minecraftVersion, "26.1"); assert.equal(detected.detectedInfo.javaVersion, 25);
    await post(`/api/v1/clients/uploads/${multiUpload.id}/cancel`, {});
    const org = (await client.server.findUniqueOrThrow({ where: { serverId: "OTH" } })).organizationId;
    const binding = await client.serverPublication.findUniqueOrThrow({ where: { serverId: "OTH" } });
    const create = (body: unknown) => fetch(origin + "/api/v1/clients", { method: "POST", headers: { ...authorization, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const target = { organizationId: org, serverId: "OTH", publicationRevision: binding.revision, expectedClientId: "OTH", replaceConfirmed: true };
    const duplicate = await create({ ...target, name: "npucraft" }); assert.equal(duplicate.status, 409); assert((await duplicate.json()).error.includes("更新"));
    assert.equal((await create({ organizationId: org, name: "Unbound token" })).status, 403);
    assert.equal((await create({ ...target, name: "HTTP alternate", replaceConfirmed: false })).status, 409);
    const alternate = await create({ ...target, name: "HTTP alternate" }); assert.equal(alternate.status, 201);
    const newId = (await alternate.json()).clientId; assert.match(newId, /^[0-9a-f-]{36}$/);
    assert.equal((await fetch(origin + "/api/v1/clients/" + newId, { headers: authorization })).status, 200);
    assert.equal((await client.serverPublication.findUniqueOrThrow({ where: { serverId: "OTH" } })).clientId, "OTH");
    await post("/api/v1/clients/" + newId + "/unbind", { serverId: null, publicationRevision: null });
    await post("/api/v1/clients/OTH/unbind", { serverId: "OTH", publicationRevision: binding.revision });
    await post("/api/v1/clients/" + newId + "/bind", { serverId: "OTH", publicationRevision: binding.revision + 1, expectedClientId: null, replaceConfirmed: false });
    assert.equal((await client.serverPublication.findUniqueOrThrow({ where: { serverId: "OTH" } })).clientId, newId);
    const failedDelete = await fetch(origin + `/api/v1/clients/${newId}/delete`, { method: "POST", headers: { ...authorization, "Content-Type": "application/json" }, body: "{}" });
    assert.equal(failedDelete.status, 409);
    await post(`/api/v1/clients/${newId}/archive`, { archived: true });
    await post(`/api/v1/clients/${newId}/delete`, {});
    assert.equal((await fetch(origin + "/api/v1/clients/" + newId, { headers: authorization })).status, 404);
    const sessionHeaders = async (actor: Actor) => {
      const value = randomBytes(32).toString("hex"); await client.session.create({ data: { tokenHash: tokenDigest(value), accountId: actor.id, expiresAt: new Date(Date.now() + 60000) } });
      return { Cookie: `${COOKIE_NAME}=${value}`, Origin: origin, "Content-Type": "application/json" };
    };
    const adminHeaders = await sessionHeaders(admin), rootHeaders = await sessionHeaders(root);
    assert.equal((await fetch(origin + "/api/admin/recycle-settings", { headers: adminHeaders })).status, 403);
    assert.equal((await fetch(origin + "/api/admin/recycle-settings", { method: "PATCH", headers: adminHeaders, body: '{"recycleRetentionDays":1}' })).status, 403);
    const settings = await fetch(origin + "/api/admin/recycle-settings", { headers: rootHeaders }); assert.equal(settings.status, 200); assert.equal((await settings.json()).recycleRetentionDays, 7);
    const updated = await fetch(origin + "/api/admin/recycle-settings", { method: "PATCH", headers: rootHeaders, body: '{"recycleRetentionDays":7}' }); assert.equal(updated.status, 200);
    assert.equal((await fetch(origin + "/api/admin/recycle-settings", { method: "PATCH", headers: { ...rootHeaders, Origin: "https://other.example" }, body: '{"recycleRetentionDays":1}' })).status, 403);
  } finally {
    server.kill(); await exited;
  }
});

test("multiple clients retain independent history, replacing a server only after approval and publication", async () => {
  const org = (await client.server.findUniqueOrThrow({ where: { serverId: "NPA" } })).organizationId;
  await work(db => m.createServer(db, root, { organizationId: org, serverId: "BND", displayName: "Binding test" }));
  const original = await work(db => c.createClient(db, admin, { organizationId: org, name: "Original", serverId: "BND", publicationRevision: 0, expectedClientId: null }));
  const release = async (id: string, name: string, bytes: Buffer) => {
    const upload = await prepare(bytes, admin, id);
    const draft = await work(db => c.submitUpload(db, admin, upload.id, { ...fields, name }));
    await work(db => c.reviewClient(db, reviewer, id, draft.draftId, { decision: "approve", note: "", contentRevision: 1 }));
    return { upload, draftId: draft.draftId };
  };
  const initial = await release(original.clientId, "Original", v1);
  const first = await work(db => c.publishClient(db, root, original.clientId, initial.draftId, { activate: true }));
  await work(db => m.updateServer(db, root, "BND", { isListed: true }));
  const snapshot = await publicManifest(client, "BND");
  const target = await client.serverPublication.findUniqueOrThrow({ where: { serverId: "BND" } });
  const request = { organizationId: org, name: "Alternate", serverId: "BND", publicationRevision: target.revision, expectedClientId: original.clientId };
  await assert.rejects(work(db => c.createClient(db, admin, request)), denied(409));
  assert.equal(await client.client.count({ where: { organizationId: org, name: "Alternate" } }), 0, "failed creation must roll back");
  const alternate = await work(db => c.createClient(db, admin, { ...request, replaceConfirmed: true }));
  assert.equal((await publicManifest(client, "BND")).release.id, first.releaseId);
  const next = await release(alternate.clientId, "Alternate", v2);
  assert(next.upload.statistics!.casReusePercent > 0, "independent clients still reuse CAS");
  assert.equal((await publicManifest(client, "BND")).release.id, first.releaseId);
  const second = await work(db => c.publishClient(db, root, alternate.clientId, next.draftId, { activate: true }));
  assert.equal((await publicManifest(client, "BND")).release.id, second.releaseId);
  const saved = await client.clientRelease.findUniqueOrThrow({ where: { id: first.releaseId } });
  assert.equal(saved.manifestSha256, digest(snapshot.bytes));
  assert.equal((await client.client.findUniqueOrThrow({ where: { id: original.clientId } })).currentReleaseId, first.releaseId);
  const bound = await client.serverPublication.findUniqueOrThrow({ where: { serverId: "BND" } });
  await work(db => c.unbindClient(db, admin, alternate.clientId, { serverId: "BND", publicationRevision: bound.revision }));
  await assert.rejects(publicManifest(client, "BND"), denied(404));
  const empty = await client.serverPublication.findUniqueOrThrow({ where: { serverId: "BND" } });
  await work(db => c.bindClient(db, admin, original.clientId, { serverId: "BND", publicationRevision: empty.revision, expectedClientId: null, replaceConfirmed: false }));
  assert.equal((await publicManifest(client, "BND")).release.id, first.releaseId);
  assert.equal((await client.client.findUniqueOrThrow({ where: { id: alternate.clientId } })).currentReleaseId, second.releaseId);

  const current = await client.serverPublication.findUniqueOrThrow({ where: { serverId: "BND" } });
  const third = await work(db => c.createClient(db, admin, { ...request, name: "Third", publicationRevision: current.revision, replaceConfirmed: true }));
  const stale = await release(third.clientId, "Third", v2);
  await work(db => c.unbindClient(db, admin, original.clientId, { serverId: "BND", publicationRevision: current.revision }));
  await assert.rejects(work(db => c.publishClient(db, root, third.clientId, stale.draftId, { activate: true })), denied(409));
  assert.equal((await client.clientDraft.findUniqueOrThrow({ where: { id: stale.draftId } })).status, "APPROVED");
  assert.equal((await client.serverPublication.findUniqueOrThrow({ where: { serverId: "BND" } })).clientId, null);
  await work(db => c.unbindClient(db, admin, third.clientId, { serverId: null, publicationRevision: null }));
  await work(db => c.publishClient(db, root, third.clientId, stale.draftId, { activate: true }));
  assert.equal((await client.serverPublication.findUniqueOrThrow({ where: { serverId: "BND" } })).clientId, null);
});

test("format detection and mod discovery use one adapter registry", () => {
  assert.equal(detectPackFormat(["modrinth.index.json", "overrides/config/a"]), "modrinth");
  assert.equal(detectPackFormat(["Pack/manifest.json", "Pack/overrides/a"]), "curseforge");
  assert.equal(detectPackFormat(["Pack/mmc-pack.json", "Pack/.minecraft/mods/a.jar"]), "multimc");
  for (const marker of ["manifest.json", "modrinth.index.json", "mmc-pack.json"])
    assert.throws(() => inspectPackLayout([marker, ".minecraft/mods/a.jar"]), denied(422));
  assert.throws(() => inspectPackLayout(["manifest.json", "modrinth.index.json"]), denied(422));
  assert.deepEqual(inspectPackLayout(["Pack/.minecraft/mods/a.jar", "Pack/.minecraft/config/a.json"]), { format: "minecraft-zip", rootPrefix: "Pack/.minecraft/" });
  assert.deepEqual(inspectPackLayout([".minecraft/manifest.json", ".minecraft/mods/a.jar"]), { format: "minecraft-zip", rootPrefix: ".minecraft/" });
  assert.deepEqual(inspectPackLayout(["mods/a.jar"]), { format: "minecraft-zip", rootPrefix: "" });
  assert.deepEqual(inspectPackLayout(["Client/mods/a.jar", "Client/config/a.json"]), { format: "minecraft-zip", rootPrefix: "Client/" });
  assert.throws(() => inspectPackLayout(["A/.minecraft/mods/a.jar", "B/.minecraft/mods/b.jar"]), denied(422));
  const files = Array.from({ length: 2001 }, (_, index) => ({ path: "mods/" + index + ".jar", size: 1, sha256: "a".repeat(64), policy: "managed" as const }));
  assert.throws(() => inspectPackMods("minecraft-zip", files), denied(422));
});

test("Worker discovers only mods JARs, including nested paths; API submission needs no hand-written list", async () => {
  const source = rawZip([
    { name: "Pack/.minecraft/mods/Fabric.JAR", data: Buffer.from("fabric") },
    { name: "Pack/.minecraft/mods/nested/shared.jar", data: shared },
    { name: "Pack/.minecraft/mods/README.txt", data: Buffer.from("read me") },
    { name: "Pack/.minecraft/mods/disabled.jar.disabled", data: Buffer.from("disabled") },
    { name: "Pack/.minecraft/config/example.jar", data: Buffer.from("not a mod") },
    { name: "Pack/.minecraft/libraries/other.jar", data: Buffer.from("library") },
    { name: "Pack/outside.jar", data: Buffer.from("outside") },
  ]);
  const upload = await prepare(source, root, "OTH");
  assert.equal(upload.status, "READY");
  assert.deepEqual(upload.detectedMods, ["Fabric.JAR", "nested/shared.jar"]);
  const { mods: _mods, ...details } = fields; void _mods;
  const { draftId } = await work(db => c.submitUpload(db, root, upload.id, { ...details, versionLabel: "auto-mods" }));
  const manifest = await c.draftManifest(client, root, "OTH", draftId);
  assert.deepEqual(manifest.mods, upload.detectedMods);
  assert.equal((await work(db => c.submitUpload(db, root, upload.id, { ...details, versionLabel: "auto-mods", mods: ["invented.jar"] }))).draftId, draftId);
  const empty = await prepare(rawZip([{ name: ".minecraft/config/only.json", data: Buffer.from("{}") }]), root, "OTH");
  assert.equal(empty.status, "READY"); assert.deepEqual(empty.detectedMods, []);
});

test("runtime inspection is awaited before the first CAS write; embedded JARs and isolated policies are checked", async () => {
  const mod = randomBytes(61); const game = rawZip([{ name: "version.json", data: Buffer.from(JSON.stringify({ id: "26.1", java_version: 25, java_component: "java-runtime-epsilon" })) }]);
  const bytes = rawZip([{ name: ".minecraft/versions/test/test.json", data: Buffer.from(JSON.stringify({ id: "test", patches: [{ id: "game", version: "26.1" }, { id: "fabric", version: "0.19.5" }] })) },
    { name: ".minecraft/versions/test/test.jar", data: game }, { name: ".minecraft/versions/test/mods/api.jar", data: mod },
    { name: ".minecraft/versions/test/options.txt", data: Buffer.from("settings") }, { name: ".minecraft/versions/test/.hmcl/accounts.json", data: Buffer.from("private") }]);
  const path = join(temp, "inspection-first.zip"); await writeFile(path, bytes);
  const stages: string[] = [];
  const parsed = await parseClientPack(path, temp, [], null, bytes.length, () => {}, undefined, {
    onInspecting: async () => { stages.push("INSPECTING"); },
    onInspected: async (info, mods) => {
      stages.push("IDENTIFIED"); assert.equal(info.minecraftVersion, "26.1"); assert.equal(info.javaVersion, 25);
      assert.deepEqual(mods, ["versions/test/mods/api.jar"]);
      assert(!(await storageClient().send(new ListObjectsV2Command({ Bucket: casBucket() }))).Contents?.some(object => object.Key === casKey(digest(mod))), "CAS must wait for the metadata checkpoint");
    },
  });
  assert.deepEqual(stages, ["INSPECTING", "IDENTIFIED"]); assert(parsed);
  assert.equal(parsed.files.find(file => file.path.endsWith("options.txt"))?.policy, "preserve");
  assert.equal(filePolicy("versions/test/saves/world/level.dat"), "preserve");
  assert(!parsed.files.some(file => file.path.includes(".hmcl")));
  assert((await storageClient().send(new ListObjectsV2Command({ Bucket: casBucket() }))).Contents?.some(object => object.Key === casKey(digest(mod))));
});

test("multiple instances pause without CAS, selection enforces ownership and scope, and API submission uses detected runtime", async () => {
  const org = (await client.server.findUniqueOrThrow({ where: { serverId: "OTH" } })).organizationId;
  const identity = await work(db => c.createClient(db, root, { organizationId: org, name: "Runtime selection" }));
  const bytes = rawZip([{ name: "versions/pcl/pcl.json", data: Buffer.from(JSON.stringify({ id: "pcl", clientVersion: "1.21.1", javaVersion: { majorVersion: 21 } })) },
    { name: "versions/hmcl/hmcl.json", data: Buffer.from(JSON.stringify({ id: "hmcl", patches: [{ id: "game", version: "26.1" }] })) },
    { name: "versions/pcl/mods/old.jar", data: randomBytes(81) }, { name: "versions/hmcl/mods/new.jar", data: randomBytes(82) }]);
  const before = (await storageClient().send(new ListObjectsV2Command({ Bucket: casBucket() }))).KeyCount;
  const upload = await prepare(bytes, root, identity.clientId);
  assert.equal(upload.status, "QUEUED"); assert.equal(upload.processingPhase, "SELECT_INSTANCE"); assert.equal(upload.detectedInfo?.candidates.length, 2);
  assert.equal(await runUploadWorker(client), false, "paused tasks must not be repeatedly claimed");
  assert.equal((await storageClient().send(new ListObjectsV2Command({ Bucket: casBucket() }))).KeyCount, before);
  await assert.rejects(work(db => c.selectUploadInstance(db, admin, upload.id, { instanceId: "hmcl" })), denied(404));
  await assert.rejects(work(db => c.selectUploadInstance(db, root, upload.id, { instanceId: "outside" })), denied(400));
  await work(db => c.selectUploadInstance(db, root, upload.id, { instanceId: "hmcl" }));
  assert.equal(await runUploadWorker(client), true);
  const saved = await c.findUpload(client, root, upload.id); const ready = c.uploadView(saved);
  assert.equal(ready.status, "READY"); assert.equal(ready.detectedInfo?.minecraftVersion, "26.1"); assert.equal(ready.detectedInfo?.javaVersion, 25);
  assert.deepEqual(ready.detectedMods, ["versions/hmcl/mods/new.jar"]);
  const inventory = await c.readInventory(saved.filesObjectKey!, saved.filesSha256!);
  assert(!inventory.files.some(file => file.path.startsWith("versions/pcl/")));
  await assert.rejects(client.clientUpload.update({ where: { id: upload.id }, data: { detectedInfo: { minecraftVersion: "tampered" } } }), "prepared runtime is immutable");
  const { draftId } = await work(db => c.submitUpload(db, root, upload.id, { name: identity.name, versionLabel: "1.0", summary: "Auto runtime", description: "" }));
  const manifest = await c.draftManifest(client, root, identity.clientId, draftId);
  assert.deepEqual(manifest.runtime, { minecraft: "26.1", java: 25 });
});

test("damaged metadata is rejected before CAS and unidentified packs require explicit runtime", async () => {
  const bytes = rawZip([{ name: "versions/test/test.json", data: Buffer.from('{"id":"26.1"}') }]);
  const corrupt = Buffer.from(bytes); corrupt[30 + Buffer.byteLength("versions/test/test.json")] ^= 0xff;
  const upload = await prepare(corrupt, root, "OTH"); assert.equal(upload.status, "FAILED");
  const missing = await prepare(rawZip([{ name: "config/game.json", data: Buffer.from("{}") }]), root, "OTH");
  assert.equal(missing.detectedInfo?.minecraftVersion, null); assert.equal(missing.detectedInfo?.javaVersion, null);
  await assert.rejects(work(db => c.submitUpload(db, root, missing.id, { name: fields.name, versionLabel: "manual-runtime", summary: "Manual", description: "" })), denied(400));
});

test("Worker persists the detected runtime for polling while CAS is still processing", async () => {
  const org = (await client.server.findUniqueOrThrow({ where: { serverId: "OTH" } })).organizationId;
  const identity = await work(db => c.createClient(db, root, { organizationId: org, name: "Early runtime" }));
  const bytes = rawZip([{ name: "versions/pcl/pcl.json", data: Buffer.from('{"id":"pcl","clientVersion":"1.21.1","javaVersion":{"majorVersion":21}}') },
    ...Array.from({ length: 64 }, (_, i) => ({ name: `versions/pcl/mods/${i}.jar`, data: randomBytes(1024) }))]);
  const upload = await prepare(bytes, root, identity.clientId, false);
  let finished = false; let observed = false;
  const worker = runUploadWorker(client).finally(() => { finished = true; });
  try {
    while (!finished) {
      const view = c.uploadView(await c.findUpload(client, root, upload.id));
      if (view.status === "PROCESSING" && view.processingPhase === "CAS") {
        observed = true; assert.equal(view.detectedInfo?.minecraftVersion, "1.21.1"); assert.equal(view.detectedInfo?.javaVersion, 21);
        assert.equal(view.detectedMods.length, 64); assert.equal(view.statistics, null);
        await assert.rejects(work(db => c.submitUpload(db, root, upload.id, { ...fields, name: identity.name })), denied(409));
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  } finally { await worker; }
  assert(observed, "Polling must receive runtime information before the task is READY");
  assert.equal((await client.clientUpload.findUniqueOrThrow({ where: { id: upload.id } })).status, "READY");
});

async function objectExists(bucket: string, key: string) {
  try { await storageClient().send(new HeadObjectCommand({ Bucket: bucket, Key: key })); return true; }
  catch (error) { if (missingObject(error)) return false; throw error; }
}
async function indexedMaintenance(now = new Date()) {
  for (let attempt = 0; attempt < 100; attempt++) if (await indexClientStorage(client)) { await maintainRecycleBin(client, now); return; }
  assert.fail("storage index did not converge");
}
async function newRecycleClient(name: string) {
  const org = (await client.server.findUniqueOrThrow({ where: { serverId: "NPA" } })).organizationId;
  return work(db => c.createClient(db, admin, { organizationId: org, name }));
}
async function removeClient(id: string) { await work(db => c.archiveClient(db, admin, id, { archived: true })); await work(db => c.deleteClient(db, admin, id)); }

test("deletion requires archive, no binding or release, real scoped permission, and cancels pending jobs", async () => {
  const identity = await newRecycleClient("Delete authorization");
  await assert.rejects(work(db => c.deleteClient(db, admin, identity.clientId)), denied(409));
  await work(db => c.archiveClient(db, admin, identity.clientId, { archived: true }));
  await assert.rejects(work(db => c.deleteClient(db, reader, identity.clientId)), denied(403));
  await assert.rejects(work(db => c.deleteClient(db, { ...root, isSuperAdmin: false }, identity.clientId)), denied(404));
  await assert.rejects(client.client.update({ where: { id: "NPA" }, data: { deletedAt: new Date() } }), "database rejects published clients");
  await assert.rejects(work(db => c.deleteClient(db, admin, "NPA")), denied(409));
  await work(db => c.archiveClient(db, admin, "NPA", { archived: true }));
  assert.equal((await client.serverPublication.findUniqueOrThrow({ where: { serverId: "NPA" } })).clientId, null);
  await assert.rejects(work(db => c.deleteClient(db, admin, "NPA")), denied(409), "archived and unbound published history still prevents deletion");
  await assert.rejects(client.client.update({ where: { id: "NPA" }, data: { deletedAt: new Date() } }));
  await work(db => c.archiveClient(db, admin, "NPA", { archived: false }));
  await work(db => c.deleteClient(db, admin, identity.clientId));
  await assert.rejects(c.clientDetails(client, admin, identity.clientId), denied(404));
  assert(!(await c.clientList(client, admin)).some(row => row.clientId === identity.clientId));
  assert.equal(await client.auditEvent.count({ where: { action: "CLIENT_DELETE", targetId: identity.clientId } }), 1);
  await assert.rejects(work(db => c.archiveClient(db, admin, identity.clientId, { archived: false })), denied(404));
  await assert.rejects(client.client.update({ where: { id: identity.clientId }, data: { deletedAt: null } }), "deleted tombstones are immutable");
  const replacement = await newRecycleClient("delete authorization"); assert.notEqual(replacement.clientId, identity.clientId);

  const queued = await newRecycleClient("Delete queued"); const upload = await prepare(v1, admin, queued.clientId, false);
  await work(db => c.archiveClient(db, admin, queued.clientId, { archived: true }));
  await client.clientUpload.update({ where: { id: upload.id }, data: { status: "PROCESSING" } });
  await assert.rejects(work(db => c.deleteClient(db, admin, queued.clientId)), denied(409));
  await client.clientUpload.update({ where: { id: upload.id }, data: { status: "QUEUED" } });
  await work(db => c.deleteClient(db, admin, queued.clientId));
  assert.equal((await client.clientUpload.findUniqueOrThrow({ where: { id: upload.id } })).status, "CANCELLED");
  await assert.rejects(client.clientUpload.update({ where: { id: upload.id }, data: { status: "QUEUED" } }));
});

test("deleted ZIPs and exclusive CAS enter private recycle storage and matching uploads reuse verified bytes", async () => {
  const identity = await newRecycleClient("Recycle original"); const bytes = randomBytes(512); const sha = digest(bytes);
  const zip = rawZip([{ name: "mods/recycle.jar", data: bytes }]);
  const upload = await prepare(zip, admin, identity.clientId); assert.equal(upload.status, "READY");
  const source = (await client.clientUpload.findUniqueOrThrow({ where: { id: upload.id } })).sourceObjectKey;
  await removeClient(identity.clientId); const now = new Date(); await indexedMaintenance(now);
  const trash = "recycle/cas/" + casKey(sha);
  assert.equal(await objectExists(casBucket(), casKey(sha)), false); assert.equal(await objectExists(casBucket(), trash), true);
  assert.equal(await objectExists(packagesBucket(), source), false);
  assert.deepEqual(await readObject(`recycle/clients/${identity.clientId}/${source}`), zip);
  const anonymous = await fetch(process.env.S3_ENDPOINT + "/" + casBucket() + "/" + trash); assert.equal(anonymous.status, 403);
  const next = await newRecycleClient("Recycle replacement");
  const restored = await prepare(zip, admin, next.clientId); assert.equal(restored.status, "READY");
  assert.equal(restored.statistics?.newDataSize, 0); assert.equal(restored.statistics?.casReusePercent, 100);
  assert.equal(await objectExists(casBucket(), trash), false); assert.equal(await objectExists(casBucket(), casKey(sha)), true);
  const row = await client.casObject.findUniqueOrThrow({ where: { sha256: sha } }); assert.equal(row.trashedAt, null);
  await indexedMaintenance(new Date(now.getTime() + 8 * 86400000));
  assert.equal(await objectExists(casBucket(), casKey(sha)), true, "cleanup cannot purge restored active files");
  assert.equal(await objectExists(packagesBucket(), `recycle/clients/${identity.clientId}/${source}`), false);
});

test("shared and archived published CAS stays live; last-reference removal starts seven-day retention", async () => {
  const a = await newRecycleClient("Shared recycle A"), b = await newRecycleClient("Shared recycle B");
  const bytes = randomBytes(1024), sha = digest(bytes); const zip = rawZip([{ name: "mods/reuse.jar", data: bytes }, { name: "mods/shared.jar", data: shared }]);
  await prepare(zip, admin, a.clientId); await prepare(zip, admin, b.clientId);
  await removeClient(a.clientId); await indexedMaintenance();
  assert.equal(await objectExists(casBucket(), casKey(sha)), true);
  await removeClient(b.clientId); const now = new Date(); await indexedMaintenance(now);
  assert.equal(await objectExists(casBucket(), casKey(sha)), false);
  assert.equal(await objectExists(casBucket(), casKey(digest(shared))), true, "published history retains shared CAS even when archived");
  await indexedMaintenance(new Date(now.getTime() + 6 * 86400000)); assert.equal(await objectExists(casBucket(), "recycle/cas/" + casKey(sha)), true);
  await indexedMaintenance(new Date(now.getTime() + 8 * 86400000)); assert.equal(await objectExists(casBucket(), "recycle/cas/" + casKey(sha)), false);
  assert((await client.casObject.findUniqueOrThrow({ where: { sha256: sha } })).purgedAt);
  const afterPurge = await newRecycleClient("After recycle expiry"); const rebuilt = await prepare(rawZip([{ name: "mods/reuse.jar", data: bytes }]), admin, afterPurge.clientId);
  assert.equal(rebuilt.status, "READY"); assert.equal(rebuilt.statistics?.newDataSize, bytes.length);
});

test("corrupted recycled CAS is rejected; settings require MUA superadmin and drive retention", async () => {
  assert.deepEqual(await recycleSettings(client, root), { recycleRetentionDays: 7 });
  await assert.rejects(recycleSettings(client, admin), denied(403));
  await assert.rejects(work(db => updateRecycleSettings(db, admin, { recycleRetentionDays: 1 })), denied(403));
  await assert.rejects(work(db => updateRecycleSettings(db, root, { recycleRetentionDays: 0 })), denied(400));
  await assert.rejects(work(db => updateRecycleSettings(db, { ...root, apiScope: { serverIds: ["NPA"], permissions: ["SERVER_READ"] } }, { recycleRetentionDays: 1 })), denied(403));
  const a = await newRecycleClient("Corrupt recycled file"); const bytes = randomBytes(128), sha = digest(bytes);
  const zip = rawZip([{ name: "mods/corrupt.jar", data: bytes }]); await prepare(zip, admin, a.clientId);
  await removeClient(a.clientId); const now = new Date(); await indexedMaintenance(now);
  const trash = "recycle/cas/" + casKey(sha);
  await storageClient().send(new PutObjectCommand({ Bucket: casBucket(), Key: trash, Body: Buffer.alloc(bytes.length), Metadata: { sha256: sha } }));
  const b = await newRecycleClient("Corrupt restoration"); const failed = await prepare(zip, admin, b.clientId);
  assert.equal(failed.status, "FAILED"); assert(failed.error?.includes("SHA-256")); assert.equal(await objectExists(casBucket(), casKey(sha)), false);
  await work(db => updateRecycleSettings(db, root, { recycleRetentionDays: 1 }));
  await indexedMaintenance(new Date(now.getTime() + 2 * 86400000)); assert.equal(await objectExists(casBucket(), trash), false);
  await work(db => updateRecycleSettings(db, root, { recycleRetentionDays: 7 }));
});

test("concurrent upload restoration and expiry serialize by hash without deleting active CAS", async () => {
  const original = await newRecycleClient("Concurrent original"), bytes = randomBytes(8192), sha = digest(bytes);
  const zip = rawZip([{ name: "mods/concurrent.jar", data: bytes }]);
  await prepare(zip, admin, original.clientId); await removeClient(original.clientId); const now = new Date(); await indexedMaintenance(now);
  const a = await newRecycleClient("Concurrent A"), b = await newRecycleClient("Concurrent B");
  const first = await prepare(zip, admin, a.clientId, false), second = await prepare(zip, admin, b.clientId, false);
  while (!await indexClientStorage(client)) { /* Complete the safety barrier before racing. */ }
  await Promise.all([runUploadWorker(client), runUploadWorker(client), maintainRecycleBin(client, new Date(now.getTime() + 8 * 86400000))]);
  const views = await Promise.all([first.id, second.id].map(id => c.findUpload(client, admin, id).then(c.uploadView)));
  assert(views.every(view => view.status === "READY"));
  const added = views.reduce((total, view) => total + view.statistics!.newDataSize, 0); assert(added === 0 || added === bytes.length);
  assert.deepEqual(await readObject(casKey(sha), casBucket()), bytes);
  assert.equal((await client.casObject.findUniqueOrThrow({ where: { sha256: sha } })).trashedAt, null);
  assert.equal(await client.casReference.count({ where: { sha256: sha, clientId: { in: [a.clientId, b.clientId] } } }), 2);
});

test("invalid legacy inventories stop recycling; reconciliation catches late completed source ZIPs", async () => {
  const legacy = await newRecycleClient("Legacy inventory guard"), bytes = randomBytes(256), sha = digest(bytes);
  const zip = rawZip([{ name: "mods/legacy.jar", data: bytes }]); const upload = await prepare(zip, admin, legacy.clientId);
  const saved = await client.clientUpload.findUniqueOrThrow({ where: { id: upload.id } }); const originalIndex = await readObject(saved.filesObjectKey!);
  await removeClient(legacy.clientId);
  await storageClient().send(new PutObjectCommand({ Bucket: packagesBucket(), Key: saved.filesObjectKey!, Body: Buffer.from("{}") }));
  await assert.rejects(indexedMaintenance(), denied(422)); assert.equal(await objectExists(casBucket(), casKey(sha)), true);
  await storageClient().send(new PutObjectCommand({ Bucket: packagesBucket(), Key: saved.filesObjectKey!, Body: originalIndex }));
  await indexedMaintenance(); assert.equal(await objectExists(casBucket(), "recycle/cas/" + casKey(sha)), true);
  // Simulate an S3 completion finishing just after the deletion was first reconciled.
  await storageClient().send(new PutObjectCommand({ Bucket: packagesBucket(), Key: saved.sourceObjectKey, Body: zip }));
  for (let i = 0; i < 10 && await objectExists(packagesBucket(), saved.sourceObjectKey); i++) await maintainRecycleBin(client);
  assert.equal(await objectExists(packagesBucket(), saved.sourceObjectKey), false);
  assert.deepEqual(await readObject(`recycle/clients/${legacy.clientId}/${saved.sourceObjectKey}`), zip);
});
