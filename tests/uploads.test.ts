import { fixtureClientId } from "./fixtures/identity";
import { configureLocalTestStorage } from "./fixtures/local-storage";
import "dotenv/config";
import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { randomBytes, generateKeyPairSync, createPublicKey, verify, createHash } from "node:crypto";
import { readFile, readdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import pg from "pg";
import crc32 from "crc-32";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

import { prisma } from "../src/lib/prisma";
import { locked, tokenDigest, COOKIE_NAME, type Actor, type Db } from "../src/lib/auth";
import { AppError } from "../src/lib/errors";
import * as m from "../src/lib/management";
import * as c from "../src/lib/client-service";
import { runUploadWorker, claimUpload } from "../src/lib/client-worker";
import { runPackageWorker } from "../src/lib/package-worker";
import { fixtureEnvironment } from "./fixtures/environment";
import { configurePackages, retryPackages, managementFullPackage } from "../src/lib/package-build-service";
import { packageArtifactsSchema } from "../src/lib/package-contract";
import { MUA_PLATFORMS } from "../src/lib/muapack-contract";
import { validateMuaPackArchive } from "../src/lib/muapack-archive";
import { publicPackage } from "../src/lib/client-download";
import { publishedServers } from "../src/lib/catalog";
import { ZipFile as YazlZipFile } from "yazl";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { storageClient, initializeStorage, digest, casKey, casBucket, packagesBucket, environmentsBucket, missingObject, readObject } from "../src/lib/storage";
import { indexClientStorage, maintainRecycleBin, recycleSettings, updateRecycleSettings } from "../src/lib/recycle-storage";
import { parseClientPack, filePolicy } from "../src/lib/pack-parser";
import { publicManifest } from "../src/lib/client-download";
import { apiActor, createApiToken, revokeApiToken } from "../src/lib/api-auth";
import { signingIdentity } from "../src/lib/signing";
import type { ClientMetadata, ReleaseManifest, UploadView } from "../src/lib/client-contract";
import { detectPackFormat, inspectPackLayout, inspectPackMods } from "../src/lib/pack-inspection";
import { downloadSettings, updateDownloadSettings } from "../src/lib/download-settings";
import { parseRecipeInventory } from "../src/lib/recipe-inventory";
import { readMuaPlatformManifest } from "../src/lib/muapack-protocol";
import { validateRecipePackArchive } from "../src/lib/muapack-v2-archive";
import { readRecipeManifest, createRecipePackMetadata } from "../src/lib/muapack-v2-protocol";
import { packageFormatSettings, updatePackageFormatSettings } from "../src/lib/package-format-settings";
import { maxUploadSizeMb, uploadSizeSettings, updateUploadSizeSettings } from "../src/lib/upload-size-settings";
import { UPLOAD_MB, MAX_UPLOAD_SIZE_MB } from "../src/lib/upload-size-policy";
import { assertApiRequest, assertApiResponse } from "./openapi-validation";
import { recipeDistributionStats } from "../src/lib/recipe-distribution";

const suffix = randomBytes(8).toString("hex"); const schema = "mua_upload_test_" + suffix;
process.env.DATABASE_SCHEMA = schema;
const migrationUrl = new URL(process.env.DATABASE_MIGRATION_URL!); migrationUrl.searchParams.delete("options");
process.env.DATABASE_MIGRATION_URL = migrationUrl.toString();
process.env.S3_PACKAGES_BUCKET = "mua-upload-test-" + suffix + "-packages"; process.env.S3_CAS_BUCKET = "mua-upload-test-" + suffix + "-cas";
process.env.S3_ENVIRONMENTS_BUCKET = "mua-upload-test-" + suffix + "-environments";
configureLocalTestStorage();
const pool = new pg.Pool({ connectionString: process.env.DATABASE_MIGRATION_URL, options: "-c role=mua_owner -c search_path=" + schema + ",pg_catalog", pipeline: true });
const client = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) });
const workerClient = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_WORKER_URL, options: `-c search_path=${schema},pg_catalog`, pipeline: true }, { schema }) });
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
const fields: Omit<ClientMetadata, "mods" | "modDetails"> = { name: "NPUcraft", versionLabel: "1.0.0", minecraftVersion: "1.21.1", javaVersion: 21, summary: "Initial client", description: "# NPU\nComplete client" };
async function prepare(bytes: Buffer, actor = admin, serverId = "NPA", processNow = true, fileName = "client.zip", comparisonDraftId: string | null = null, packageFormatVersion?: 1 | 2) {
  const publication = await client.client.findUniqueOrThrow({ where: { id: fixtureClientId(serverId) } });
  const upload = await work(db => c.createUpload(db, actor, { packageFormatVersion: 1, clientId: fixtureClientId(serverId), fileName, size: bytes.length,
    baseReleaseId: publication.currentReleaseId, basePublicationRevision: publication.revision, comparisonDraftId,
    ...(packageFormatVersion === undefined ? {} : { packageFormatVersion }) }));
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
  if (processNow) assert.equal(await runUploadWorker(workerClient), true);
  return c.uploadView(await c.findUpload(client, actor, upload.id));
}
async function submitted(upload: UploadView, versionLabel: string) { return work(db => c.submitUpload(db, admin, upload.id, { ...fields, versionLabel })); }
async function finishPackages(draftId: string) {
  for (let i = 0; i < 150; i++) {
    const remaining = await client.packageBuild.count({ where: { draftId, required: true, status: { not: "READY" } } }); if (!remaining) return;
    assert.equal(await runPackageWorker(workerClient, fixtureEnvironment), true, "Worker must have eligible package work");
    const failed = await client.packageBuild.findFirst({ where: { draftId, required: true, status: "FAILED" } }); assert.equal(failed, null, failed?.error ?? "build failed");
  }
  assert.fail("Package pipeline did not finish");
}
async function approved(draftId: string) {
  const result = await work(db => c.reviewClient(db, reviewer, fixtureClientId("NPA"), draftId, { packageRevision: 1, decision: "approve", note: "Checked", contentRevision: 1 }));
  await finishPackages(draftId); return result;
}
before(async () => {
  await pool.query('CREATE SCHEMA "' + schema + '"'); created = true;
  for (const migration of (await readdir("prisma/migrations")).filter(name => /^\d{12}_/.test(name)).sort())
    await pool.query((await readFile("prisma/migrations/" + migration + "/migration.sql", "utf8")).replace('CREATE SCHEMA IF NOT EXISTS "public";', ""));
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
      await db.client.create({ data: { id: fixtureClientId(server.serverId), organizationId: server.organizationId, name: fields.name, nameKey: c.normalizeName(fields.name), scopeServerId: server.serverId } });
      await db.serverPublication.update({ where: { serverId: server.serverId }, data: { clientId: fixtureClientId(server.serverId) } });
    }
    for (const [actor, role] of [[admin, "ORG_ADMIN"], [reviewer, "REVIEWER"], [publisher, "PUBLISHER"], [operator, "RELEASE_OPERATOR"], [reader, "READ_ONLY"]] as const) await m.setMember(db, root, org.id, actor.id, { roles: [role], status: "ACTIVE" });
    await m.updateServer(db, root, "NPA", { isListed: true });
  });
});
after(async () => {
  const s3 = storageClient();
  for (const Bucket of [process.env.S3_PACKAGES_BUCKET!, process.env.S3_CAS_BUCKET!, process.env.S3_ENVIRONMENTS_BUCKET!]) {
    assert.match(Bucket, /^mua-upload-test-[0-9a-f]{16}-(packages|cas|environments)$/);
    const incomplete = await s3.listMultipartUploads({ Bucket });
    for (const upload of incomplete.Uploads ?? []) await s3.abortMultipartUpload({ Bucket, Key: upload.Key, UploadId: upload.UploadId });
    for (;;) { const listed = await s3.listObjects({ Bucket }); if (!listed.Contents?.length) break; await s3.deleteObjects({ Bucket, Delete: { Objects: listed.Contents.map(object => ({ Key: object.Key! })) } }); }
    await s3.deleteBucket({ Bucket });
  }
  await client.$disconnect(); await workerClient.$disconnect(); await pool.end(); await prisma.$disconnect();
  if (created) { assert.match(schema, /^mua_upload_test_[0-9a-f]{16}$/); const cleanup = new pg.Pool({ connectionString: process.env.DATABASE_MIGRATION_URL, options: "-c role=mua_owner" }); await cleanup.query('DROP SCHEMA "' + schema + '" CASCADE'); await cleanup.query(`DROP SCHEMA IF EXISTS "${schema}_authz" CASCADE`); await cleanup.end(); }
  if (temp) { assert(resolve(temp).startsWith(resolve(tmpdir()) + (process.platform === "win32" ? "\\" : "/"))); await rm(temp, { recursive: true, force: true }); }
});

test("upload size settings default to 1024 MB, restrict writes to panel superadmin and audit validated changes", async () => {
  assert.equal(await maxUploadSizeMb(client), 1024);
  assert.deepEqual(await uploadSizeSettings(client, root), { maxUploadSizeMb: 1024 });
  for (const actor of [admin, reviewer, reader, { ...root, apiScope: { permissions: ["DRAFT_CREATE" as const], serverIds: ["NPA"] } }]) {
    await assert.rejects(work(db => updateUploadSizeSettings(db, actor, { maxUploadSizeMb: 2048 })), denied(403));
    await assert.rejects(uploadSizeSettings(client, actor), denied(403));
  }
  const count = await client.auditEvent.count({ where: { action: "UPLOAD_SIZE_SETTINGS_UPDATE" } });
  for (const raw of [{}, { maxUploadSizeMb: 0 }, { maxUploadSizeMb: -1 }, { maxUploadSizeMb: 1.5 }, { maxUploadSizeMb: "1024" }, { maxUploadSizeMb: MAX_UPLOAD_SIZE_MB + 1 }, { maxUploadSizeMb: 1, extra: true }]) {
    await assert.rejects(work(db => updateUploadSizeSettings(db, root, raw)), denied(400));
  }
  assert.equal(await client.auditEvent.count({ where: { action: "UPLOAD_SIZE_SETTINGS_UPDATE" } }), count);
  await work(db => updateUploadSizeSettings(db, root, { maxUploadSizeMb: 2048 }));
  assert.equal((await m.getState(client, admin)).maxUploadSizeMb, 2048);
  const event = await client.auditEvent.findFirstOrThrow({ where: { action: "UPLOAD_SIZE_SETTINGS_UPDATE" }, orderBy: { createdAt: "desc" } });
  assert.equal(event.actorId, root.id); assert.deepEqual(event.details, { previousMaxUploadSizeMb: 1024, maxUploadSizeMb: 2048 });
  for (const value of [0, MAX_UPLOAD_SIZE_MB + 1]) await assert.rejects(client.platformSettings.update({ where: { id: "platform" }, data: { maxUploadSizeMb: value } }));
  await work(db => updateUploadSizeSettings(db, root, { maxUploadSizeMb: 1024 }));
});

test("upload size limit covers both formats and API actors, accepts exact limits and rejects before multipart creation", async () => {
  const org = await work(db => m.createOrganization(db, root, { displayName: "Upload size fixtures" }));
  await work(db => m.createServer(db, root, { organizationId: org.id, serverId: "SIZ", displayName: "Size boundaries" }));
  const identity = await work(db => c.createClient(db, root, { organizationId: org.id, name: "Upload size boundaries", serverId: "SIZ", publicationRevision: 0, expectedClientId: fixtureClientId(null) }));
  const input = { clientId: fixtureClientId(identity.clientId), fileName: "client.zip", baseReleaseId: null, basePublicationRevision: 0 };
  const tokenActor = { ...root, apiScope: { permissions: ["SERVER_READ" as const, "DRAFT_CREATE" as const, "DRAFT_READ" as const], serverIds: ["SIZ"] } };
  try {
    for (const cap of [1024, 2048, MAX_UPLOAD_SIZE_MB]) {
      await work(db => updateUploadSizeSettings(db, root, { maxUploadSizeMb: cap }));
      for (const packageFormatVersion of [1, 2] as const) {
        const actor = packageFormatVersion === 1 ? root : tokenActor;
        const exact = await work(db => c.createUpload(db, actor, { ...input, packageFormatVersion, size: cap * UPLOAD_MB }));
        assert.equal(exact.size, cap * UPLOAD_MB);
        await work(db => c.cancelUpload(db, actor, exact.id));
        const count = await client.clientUpload.count();
        const before = await storageClient().listMultipartUploads({ Bucket: packagesBucket() });
        await assert.rejects(work(db => c.createUpload(db, actor, { ...input, packageFormatVersion, size: cap * UPLOAD_MB + 1 })), denied(cap === MAX_UPLOAD_SIZE_MB ? 400 : 413));
        assert.equal(await client.clientUpload.count(), count);
        const after = await storageClient().listMultipartUploads({ Bucket: packagesBucket() });
        assert.deepEqual(after.Uploads ?? [], before.Uploads ?? []);
      }
    }
  } finally { await work(db => updateUploadSizeSettings(db, root, { maxUploadSizeMb: 1024 })); }
});

test("lowering upload size keeps existing multipart completion and Worker processing available", async () => {
  const org = await work(db => m.createOrganization(db, root, { displayName: "Existing upload fixtures" }));
  const identity = await work(db => c.createClient(db, root, { organizationId: org.id, name: "Existing upload size" }));
  const bytes = rawZip([{ name: ".minecraft/config/large.dat", data: randomBytes(2 * UPLOAD_MB) }]);
  const input = { clientId: fixtureClientId(identity.clientId), fileName: "client.zip", size: bytes.length, baseReleaseId: null, basePublicationRevision: 0 };
  const upload = await work(db => c.createUpload(db, root, { packageFormatVersion: 1, ...input }));
  try {
    await work(db => updateUploadSizeSettings(db, root, { maxUploadSizeMb: 1 }));
    await assert.rejects(work(db => c.createUpload(db, root, { packageFormatVersion: 1, ...input })), denied(413));
    const signed = await work(db => c.uploadPartUrl(db, root, upload.id, { partNumber: 1 }));
    const response = await fetch(signed.url, { method: "PUT", body: new Uint8Array(bytes) }); assert.equal(response.status, 200);
    const parts = [{ partNumber: 1, etag: response.headers.get("etag")! }];
    const completion = await work(db => c.prepareCompletion(db, root, upload.id, { parts }));
    await c.transferCompletion(completion); await work(db => c.queueCompletedUpload(db, root, upload.id));
    assert.equal(await runUploadWorker(workerClient), true);
    const ready = await c.findUpload(client, root, upload.id); assert.equal(ready.status, "READY", ready.error ?? "existing upload should finish");
    await work(db => c.cancelUpload(db, root, upload.id));
  } finally { await work(db => updateUploadSizeSettings(db, root, { maxUploadSizeMb: 1024 })); }
});

test("upload authorization and API Tokens keep real RBAC, account revocation and server scopes", async () => {
  await assert.rejects(work(db => c.createUpload(db, admin, { packageFormatVersion: 1, clientId: fixtureClientId("OTH"), fileName: "x.zip", size: 5, baseReleaseId: null, basePublicationRevision: 0 })), denied(404));
  await assert.rejects(work(db => c.createUpload(db, reader, { packageFormatVersion: 1, clientId: fixtureClientId("NPA"), fileName: "x.zip", size: 5, baseReleaseId: null, basePublicationRevision: 0 })), denied(403));
  const token = await work(db => createApiToken(db, admin, { name: "Actions", serverIds: ["NPA"], permissions: ["SERVER_READ", "DRAFT_READ", "DRAFT_CREATE", "DRAFT_EDIT", "DRAFT_SUBMIT"], expiresInDays: 30 }));
  const record = await client.apiToken.findUniqueOrThrow({ where: { id: token.id } }); assert.equal(record.tokenHash, tokenDigest(token.token)); assert.notEqual(record.tokenHash, token.token);
  const request = new Request("http://localhost/api/v1/clients", { headers: { Authorization: "Bearer " + token.token } });
  const actor = await apiActor(client, request, undefined); assert.equal((await c.clientList(client, actor)).length, 1);
  await assert.rejects(work(db => createApiToken(db, admin, { name: "escalation", serverIds: ["NPA"], permissions: ["SERVER_READ", "RELEASE_PUBLISH"], expiresInDays: 30 })), denied(403));
  const organizationId = (await client.server.findUniqueOrThrow({ where: { serverId: "NPA" } })).organizationId;
  await work(db => m.setMember(db, root, organizationId, admin.id, { roles: ["ORG_ADMIN"], status: "DISABLED" }));
  await assert.rejects(work(db => c.createUpload(db, actor, { packageFormatVersion: 1, clientId: fixtureClientId("NPA"), fileName: "x.zip", size: 5, baseReleaseId: null, basePublicationRevision: 0 })), denied(404));
  await work(db => m.setMember(db, root, organizationId, admin.id, { roles: ["ORG_ADMIN"], status: "ACTIVE" }));
  await work(db => m.updateAccount(db, root, admin.id, { status: "DISABLED" }));
  await assert.rejects(apiActor(client, request, undefined), denied(401));
  await work(db => m.updateAccount(db, root, admin.id, { status: "ACTIVE" }));
  await work(db => revokeApiToken(db, admin, token.id)); await assert.rejects(apiActor(client, request, undefined), denied(401));
});
test("a full ZIP becomes private CAS files and a reviewed, signed immutable current release", async () => {
  const upload = await prepare(v1); assert.equal(upload.status, "READY"); assert.equal(upload.statistics?.fileCount, 4); assert.equal(upload.statistics?.fullSize, 113);
  assert.equal(upload.packageFormatVersion, 1, "old callers default to muapack v1, independently of Manifest schemaVersion");
  assert.deepEqual(upload.detectedMods, ["shared.jar"]); assert(upload.warnings.some(warning => warning.includes("忽略")));
  const anonymous = await fetch(process.env.S3_ENDPOINT + "/" + casBucket() + "/" + casKey(digest(shared))); assert.equal(anonymous.status, 403);
  const { draftId } = await work(db => c.submitUpload(db, admin, upload.id, fields)); assert.equal((await client.serverPublication.findUniqueOrThrow({ where: { serverId: "NPA" } })).releaseId, null);
  assert.equal((await work(db => c.submitUpload(db, admin, upload.id, fields))).draftId, draftId, "Submission retry is idempotent");
  await assert.rejects(work(db => c.publishClient(db, root, fixtureClientId("NPA"), draftId, { contentRevision: 1, packageRevision: 1, activate: true })), denied(409));
  await assert.rejects(work(db => c.reviewClient(db, admin, fixtureClientId("NPA"), draftId, { packageRevision: 1, decision: "approve", note: "", contentRevision: 1 })), denied(403));
  await approved(draftId);
  await assert.rejects(work(db => c.publishClient(db, publisher, fixtureClientId("NPA"), draftId, { contentRevision: 1, packageRevision: 1, activate: true })), denied(403));
  const released = await work(db => c.publishClient(db, publisher, fixtureClientId("NPA"), draftId, { contentRevision: 1, packageRevision: 1, activate: false }));
  assert.equal((await client.clientDraft.findUniqueOrThrow({ where: { id: draftId } })).packageFormatVersion, 1);
  assert.equal((await client.clientRelease.findUniqueOrThrow({ where: { id: released.releaseId } })).packageFormatVersion, 1);
  assert.equal((await client.serverPublication.findUniqueOrThrow({ where: { serverId: "NPA" } })).releaseId, null);
  await work(db => c.activateClient(db, operator, fixtureClientId("NPA"), released.releaseId, { publicationRevision: 0 }));
  const published = await publicManifest(client, "NPA", "1"); const manifest = JSON.parse(published.bytes.toString()) as ReleaseManifest;
  assert.equal(manifest.version, "1.0.0"); assert(!manifest.files.some(file => file.path.includes("launcher_accounts")));
  assert(manifest.format === "mua-client-manifest"); assert.deepEqual(manifest.mods, ["shared.jar"], "submitted mod names cannot replace Worker detection");
  assert.deepEqual((await client.clientDraft.findUniqueOrThrow({ where: { id: draftId } })).candidateMetadata, { ...fields, mods: ["shared.jar"] });
  assert.equal(manifest.files.find(file => file.path === "options.txt")?.policy, "preserve");
  const identity = await signingIdentity(); const key = createPublicKey({ key: Buffer.from(identity.publicKey, "base64"), type: "spki", format: "der" });
  assert(verify(null, published.bytes, key, Buffer.from(published.release.signature, "base64")));
  assert(!verify(null, Buffer.from("tampered"), key, Buffer.from(published.release.signature, "base64")));
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
  await work(db => c.publishClient(db, root, fixtureClientId("NPA"), draftId, { contentRevision: 1, packageRevision: 1, activate: true }));
  assert.equal(JSON.parse((await publicManifest(client, "NPA", "1")).bytes.toString()).version, "1.1.0");
  assert.deepEqual(JSON.parse((await publicManifest(client, "NPA", "1")).bytes.toString()).mods, ["new.jar", "shared.jar"], "updates replace the entire detected mod list");
  assert.equal(await client.clientRelease.count({ where: { clientId: fixtureClientId("NPA") } }), 2);
});

test("all default signed packages download and verify; update packages bind the exact previous release", async () => {
  const current = await client.client.findUniqueOrThrow({ where: { id: fixtureClientId("NPA") } });
  const builds = await client.packageBuild.findMany({ where: { draftId: current.currentReleaseId! } }); assert.equal(builds.length, 5);
  assert(!builds.some(build => build.platform === "linux-aarch64"));
  for (const build of builds) {
    assert.equal(build.status, "READY"); const artifacts = packageArtifactsSchema.parse(build.artifacts); assert(artifacts.update);
    const full = await publicPackage(client, "NPA", build.platform, null, "1");
    assert.equal(full.packageType, "full"); assert.equal(full.releaseId, current.currentReleaseId);
    const response = await fetch(full.url); assert.equal(response.status, 200); const bytes = Buffer.from(await response.arrayBuffer()); assert.equal(digest(bytes), full.sha256);
    const path = join(temp, `download-${build.platform}.muapack`); await writeFile(path, bytes);
    const validated = await validateMuaPackArchive(path, createPublicKey((await signingIdentity()).privateKey));
    assert.equal(validated.target.platform, build.platform); assert.equal(validated.target.release.releaseId, full.releaseId);
    const update = await publicPackage(client, "NPA", build.platform, artifacts.update.baseReleaseId, "1"); assert.equal(update.packageType, "update");
    assert(artifacts.update.baseManifestSha256); assert.equal(update.baseManifestSha256, artifacts.update.baseManifestSha256);
    assert.equal((await publicPackage(client, "NPA", build.platform, artifacts.update.baseReleaseId, "1", "0".repeat(64))).packageType, "full");
    const pinned = await publicPackage(client, "NPA", build.platform, artifacts.update.baseReleaseId, "1", update.baseManifestSha256, update.releaseId, update.sha256);
    assert.equal(pinned.sha256, update.sha256); assert(pinned.etag);
    const ranged = await fetch(pinned.url, { headers: { Range: "bytes=0-19", "If-Match": pinned.etag! } });
    assert.equal(ranged.status, 206); assert.equal((await ranged.arrayBuffer()).byteLength, 20);
    const updateBytes = Buffer.from(await (await fetch(update.url)).arrayBuffer()); assert.equal(digest(updateBytes), update.sha256); await writeFile(path, updateBytes);
    const delta = await validateMuaPackArchive(path, createPublicKey((await signingIdentity()).privateKey));
    assert.equal(delta.metadata.base!.releaseId, artifacts.update.baseReleaseId); assert.equal(delta.metadata.packageType, "update"); assert.equal(delta.metadata.removalPolicy, "retain");
    assert(delta.metadata.changes.removed.some(file => file.path === "config/remove.txt"));
    assert(delta.metadata.changes.modified.some(pair => pair.after.path === "config/game.txt"));
    const fallback = await publicPackage(client, "NPA", build.platform, "11111111-1111-4111-8111-111111111111", "1"); assert.equal(fallback.packageType, "full");
  }
  await assert.rejects(publicPackage(client, "NPA", "windows-x86", null, "1"), denied(400));
});

test("persistent package jobs require review, retry expired leases, invalidate changed platform approval and gate publishing", async () => {
  const org = (await client.server.findUniqueOrThrow({ where: { serverId: "NPA" } })).organizationId;
  const identity = await work(db => c.createClient(db, admin, { organizationId: org, name: "Package gates" }));
  const upload = await prepare(v1, admin, identity.clientId);
  const result = await work(db => c.submitUpload(db, admin, upload.id, { ...fields, name: "Package gates", ...(upload.packageFormatVersion === 1 ? { platforms: ["linux-amd64"] } : {}) }));
  const draftId = result.draftId;
  await assert.rejects(work(db => configurePackages(db, reader, identity.clientId, draftId, { platforms: ["windows-amd64"] })), denied(403));
  await assert.rejects(work(db => configurePackages(db, admin, identity.clientId, draftId, { platforms: [] })), denied(400));
  const build = await client.packageBuild.findFirstOrThrow({ where: { draftId } });
  await client.packageBuild.update({ where: { id: build.id }, data: { status: "PROCESSING", attempts: 1, leaseToken: "11111111-1111-4111-8111-111111111111", leaseUntil: new Date(Date.now() + 60000) } });
  await work(db => configurePackages(db, admin, identity.clientId, draftId, { platforms: ["windows-amd64"] }));
  const cancelled = await client.packageBuild.findUniqueOrThrow({ where: { id: build.id } }); assert.equal(cancelled.status, "FAILED"); assert.equal(cancelled.leaseToken, null, "cancelling an active platform invalidates its old Worker lease");
  await work(db => configurePackages(db, admin, identity.clientId, draftId, { platforms: ["linux-amd64"] }));
  assert.equal((await client.packageBuild.findUniqueOrThrow({ where: { id: build.id } })).status, "QUEUED");
  // A process exit leaves the durable row reclaimable after its lease expires.
  await client.packageBuild.update({ where: { id: build.id }, data: { status: "PROCESSING", attempts: 1, leaseToken: randomBytes(16).toString("hex").replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5"), leaseUntil: new Date(0) } });
  for (let i = 0; i < 100; i++) {
    if ((await client.packageBuild.findUniqueOrThrow({ where: { id: build.id } })).status === "PREPARED") break;
    assert(await runPackageWorker(workerClient, fixtureEnvironment));
  }
  const prepared = await client.packageBuild.findUniqueOrThrow({ where: { id: build.id } }); assert.equal(prepared.status, "PREPARED"); assert.equal(prepared.artifacts, null, "unreviewed content has no signed package");
  await assert.rejects(work(db => managementFullPackage(db, admin, identity.clientId, "drafts", draftId, "linux-amd64")), denied(409));
  await assert.rejects(work(db => managementFullPackage(db, operator, identity.clientId, "drafts", draftId, "linux-amd64")), denied(403));
  await assert.rejects(work(db => managementFullPackage(db, admin, fixtureClientId("OTH"), "drafts", draftId, "linux-amd64")), denied(404));
  await assert.rejects(work(db => managementFullPackage(db, root, fixtureClientId("OTH"), "drafts", draftId, "linux-amd64")), denied(404), "foreign draft cannot be downloaded through an authorized client");
  await assert.rejects(work(db => managementFullPackage(db, admin, identity.clientId, "drafts", draftId, "invalid")), denied(400));
  await assert.rejects(work(db => managementFullPackage(db, admin, identity.clientId, "drafts", draftId, "windows-amd64")), denied(404), "cancelled platforms cannot be downloaded");
  await work(async db => c.reviewClient(db, reviewer, identity.clientId, draftId, { decision: "approve", note: "", contentRevision: 1, packageRevision: (await db.clientDraft.findUniqueOrThrow({ where: { id: draftId } })).packageRevision }));
  await assert.rejects(work(db => c.publishClient(db, root, identity.clientId, draftId, { contentRevision: 1, packageRevision: 1, activate: false })), denied(409));
  const candidate = await client.clientDraft.findUniqueOrThrow({ where: { id: draftId } });
  await assert.rejects(client.clientRelease.create({ data: { id: draftId, clientId: fixtureClientId(identity.clientId), sourceDraftId: draftId, versionLabel: candidate.versionLabel!, name: candidate.name!,
    description: candidate.description, changelog: candidate.changelog, summary: candidate.summary, environmentSnapshot: candidate.candidateMetadata!,
    manifestObjectKey: candidate.candidateManifestKey!, manifestSha256: candidate.candidateManifestSha256!, signingKeyId: "test", signature: "test", approvedById: reviewer.id, publishedById: root.id } }), "direct database inserts also require ready packages");
  await finishPackages(draftId);
  const artifacts = packageArtifactsSchema.parse((await client.packageBuild.findUniqueOrThrow({ where: { id: build.id } })).artifacts);
  const completeDownload = await work(db => managementFullPackage(db, reader, identity.clientId, "drafts", draftId, "linux-amd64"));
  assert.equal(completeDownload.packageType, "full"); assert.equal(completeDownload.sha256, artifacts.full.sha256);
  const completeResponse = await fetch(completeDownload.url); assert.equal(completeResponse.status, 200);
  assert(completeResponse.headers.get("content-disposition")?.includes("filename*=UTF-8''")); assert(completeDownload.fileName.endsWith(".muapack"));
  assert.equal(digest(Buffer.from(await completeResponse.arrayBuffer())), artifacts.full.sha256);
  const saved = await readObject(artifacts.full.key); await storageClient().deleteObjects({ Bucket: packagesBucket(), Delete: { Objects: [{ Key: artifacts.full.key }] } });
  await assert.rejects(work(db => managementFullPackage(db, admin, identity.clientId, "drafts", draftId, "linux-amd64")), denied(422));
  await assert.rejects(work(db => c.publishClient(db, root, identity.clientId, draftId, { contentRevision: 1, packageRevision: candidate.packageRevision, activate: false })), denied(422), "missing OSS artifact cannot be published");
  await storageClient().putObject({ Bucket: packagesBucket(), Key: artifacts.full.key, Body: saved, Metadata: { sha256: artifacts.full.sha256 } });
  await assert.rejects(client.packageBuild.update({ where: { id: build.id }, data: { targetSha256: "0".repeat(64) } }), "completed build is immutable in the database");
  await work(db => configurePackages(db, admin, identity.clientId, draftId, { platforms: ["linux-amd64", "windows-amd64"] }));
  assert.equal((await client.clientDraft.findUniqueOrThrow({ where: { id: draftId } })).status, "SUBMITTED");
  await assert.rejects(work(db => c.reviewClient(db, reviewer, identity.clientId, draftId, { decision: "approve", note: "", contentRevision: 1, packageRevision: 1 })), denied(409), "stale review cannot approve a changed platform selection");
  await assert.rejects(work(db => c.publishClient(db, root, identity.clientId, draftId, { contentRevision: 1, packageRevision: 1, activate: false })), denied(409));
  const windows = await client.packageBuild.findUniqueOrThrow({ where: { draftId_platform_revision: { draftId, platform: "windows-amd64", revision: 1 } } });
  await client.packageBuild.update({ where: { id: windows.id }, data: { status: "FAILED", error: "network failed" } });
  await assert.rejects(work(db => retryPackages(db, reader, identity.clientId, draftId)), denied(403));
  await work(db => retryPackages(db, admin, identity.clientId, draftId)); assert.equal((await client.packageBuild.findUniqueOrThrow({ where: { id: windows.id } })).status, "QUEUED");
  await work(async db => c.reviewClient(db, reviewer, identity.clientId, draftId, { decision: "approve", note: "", contentRevision: 1, packageRevision: (await db.clientDraft.findUniqueOrThrow({ where: { id: draftId } })).packageRevision }));
  await finishPackages(draftId); const released = await work(async db => c.publishClient(db, root, identity.clientId, draftId, { contentRevision: 1, packageRevision: (await db.clientDraft.findUniqueOrThrow({ where: { id: draftId } })).packageRevision, activate: false })); assert.equal(released.releaseId, draftId);
  await assert.rejects(work(db => configurePackages(db, admin, identity.clientId, draftId, { platforms: ["linux-amd64"] })), denied(409));
});
test("ZIP traversal, case collisions, symlinks, unsupported formats and bad CRC never become releases", async () => {
  const bad = [rawZip([{ name: "../config/escape.txt", data: Buffer.from("escape") }]),
    rawZip([{ name: "mods/a.jar", data: Buffer.from("a") }, { name: "mods/A.jar", data: Buffer.from("b") }]),
    rawZip([{ name: "mods/link.jar", data: Buffer.from("../secret"), attributes: 0xa1ff0000 }]),
    rawZip([{ name: "modrinth.index.json", data: Buffer.from("{}") }])];
  const corrupt = Buffer.from(v2); corrupt[30 + Buffer.byteLength("mods/shared.jar")] ^= 0xff; bad.push(corrupt);
  for (const bytes of bad) { const upload = await prepare(bytes); assert.equal(upload.status, "FAILED"); assert.equal(upload.draftId, null); await assert.rejects(submitted(upload, "invalid"), denied(409)); }
  assert.equal(await client.clientRelease.count({ where: { clientId: fixtureClientId("NPA") } }), 2);
});
test("competing updates cannot silently replace a newly published baseline; archive stops public distribution", async () => {
  const first = await prepare(v2); const second = await prepare(v2); assert.equal(first.statistics?.newDataSize, 0); assert.equal(first.statistics?.casReusePercent, 100);
  const a = await submitted(first, "1.2.0"); const b = await submitted(second, "1.3.0"); await approved(a.draftId); await approved(b.draftId);
  await work(db => c.publishClient(db, root, fixtureClientId("NPA"), a.draftId, { contentRevision: 1, packageRevision: 1, activate: true }));
  await assert.rejects(work(db => c.publishClient(db, root, fixtureClientId("NPA"), b.draftId, { contentRevision: 1, packageRevision: 1, activate: true })), denied(409));
  await work(db => c.archiveClient(db, admin, fixtureClientId("NPA"), { archived: true })); await assert.rejects(publicManifest(client, "NPA", "1"), denied(404));
  assert.equal(await client.clientRelease.count({ where: { clientId: fixtureClientId("NPA") } }), 3); assert.equal(await client.clientDraft.count({ where: { clientId: fixtureClientId("NPA") } }), 4);
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
  assert.equal(await runUploadWorker(workerClient), true);
  const complete = await client.clientUpload.findUniqueOrThrow({ where: { id: upload.id } }); assert.equal(complete.status, "READY"); assert.equal(complete.attempts, 2);
  const inventory = await c.readInventory(complete.filesObjectKey!, complete.filesSha256!);
  assert(inventory.files.some(file => file.path === "config/中文.json"));
  await assert.rejects(client.clientUpload.update({ where: { id: upload.id }, data: { status: "QUEUED" } }));
  await assert.rejects(client.clientUpload.update({ where: { id: upload.id }, data: { sourceObjectKey: "other.zip" } }));
});
test("the standard HTTP API and Actions upload script share the reviewed release pipeline", { skip: !process.env.MUA_HTTP_TEST_DIST, timeout: 90000 }, async () => {
  // This integration test must also run independently of preceding release tests.
  if (!await client.clientRelease.findFirst({ where: { clientId: fixtureClientId("NPA") } })) {
    const initial = await submitted(await prepare(v1), "1.0.0"); await approved(initial.draftId);
    await work(db => c.publishClient(db, root, fixtureClientId("NPA"), initial.draftId, { contentRevision: 1, packageRevision: 1, activate: true }));
  }
  const probe = createServer(); await new Promise<void>(resolve => probe.listen(0, "127.0.0.1", resolve));
  const port = (probe.address() as { port: number }).port; await new Promise<void>(resolve => probe.close(() => resolve()));
  const origin = "http://127.0.0.1:" + port;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const response = await globalThis.fetch(input, init);
    const url = String(input), method = init?.method ?? "GET";
    if (url.startsWith(origin + "/api/")) {
      if (response.headers.get("content-type")?.includes("application/json")) assertApiResponse(method, url, response.status, await response.clone().json());
      if (response.ok && typeof init?.body === "string") assertApiRequest(method, url, JSON.parse(init.body));
    }
    return response;
  };
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
    {
    const httpSession = async (actor: Actor) => {
      const secret = randomBytes(32).toString("hex");
      await client.session.create({ data: { tokenHash: tokenDigest(secret), accountId: actor.id, expiresAt: new Date(Date.now() + 60000) } });
      return { Cookie: COOKIE_NAME + "=" + secret, Origin: origin, "Content-Type": "application/json" };
    };
    const rootHeaders = await httpSession(root), adminHeaders = await httpSession(admin);
    assert.equal((await fetch(origin + "/api/admin/state", { headers: rootHeaders })).status, 200);
    assert.equal((await fetch(origin + "/api/admin/pipeline", { headers: rootHeaders })).status, 200);
    const cookieClients = await fetch(origin + "/api/v1/clients", { headers: adminHeaders }); assert.equal(cookieClients.status, 200);
    assert.equal((await fetch(origin + "/api/v1/clients", { headers: { ...adminHeaders, Authorization: "Bearer invalid" } })).status, 401);
    assert.equal((await fetch(origin + "/api/admin/download-settings", { headers: adminHeaders })).status, 403);
    const settingsResponse = await fetch(origin + "/api/admin/download-settings", { headers: rootHeaders }); assert.equal(settingsResponse.status, 200);
    const initialSettings = await settingsResponse.json(); assert.equal(initialSettings.javaImageType, "jre"); assert.equal(initialSettings.mirrorProxyEnabled, false);
    const saveSettings = await fetch(origin + "/api/admin/download-settings", { method: "PATCH", headers: rootHeaders,
      body: JSON.stringify({ ...initialSettings, minecraftDownloadSources: ["ustc", "nju"], mirrorProxyEnabled: true }) });
    assert.equal(saveSettings.status, 200); assert.deepEqual((await saveSettings.json()).minecraftDownloadSources, ["ustc", "nju"]);
    assert.equal((await fetch(origin + "/api/admin/download-settings", { method: "PATCH", headers: { ...rootHeaders, Origin: "https://evil.test" }, body: JSON.stringify(initialSettings) })).status, 403);
    assert.equal((await fetch(origin + "/api/admin/download-settings", { method: "PATCH", headers: rootHeaders, body: JSON.stringify(initialSettings) })).status, 200);
    const org = (await client.client.findUniqueOrThrow({ where: { id: fixtureClientId("NPA") } })).organizationId;
    const formatIdentity = await work(db => c.createClient(db, admin, { organizationId: org, name: "HTTP format choice" }));
    const formatInput = { clientId: fixtureClientId(formatIdentity.clientId), fileName: "recipe.mrpack", size: 100, baseReleaseId: null, basePublicationRevision: 0, packageFormatVersion: 2 };
    const chooseFormat = (headers: Record<string, string>, body: unknown = formatInput) => fetch(origin + "/api/v1/clients/uploads", { method: "POST", headers, body: JSON.stringify(body) });
    const policyPath = origin + "/api/admin/package-format-settings";
    const savePolicy = (headers: Record<string, string>, enabledPackageFormats: number[]) => fetch(policyPath, { method: "PATCH", headers, body: JSON.stringify({ enabledPackageFormats }) });
    assert.equal((await fetch(policyPath, { headers: adminHeaders })).status, 403);
    assert.equal((await savePolicy(adminHeaders, [2])).status, 403);
    assert.equal((await savePolicy({ ...rootHeaders, Origin: "https://evil.test" }, [2])).status, 403);
    assert.equal((await savePolicy(rootHeaders, [])).status, 400);
    assert.deepEqual((await (await fetch(policyPath, { headers: rootHeaders })).json()).enabledPackageFormats, [1, 2]);
    try {
      assert.equal((await savePolicy(rootHeaders, [1])).status, 200);
      assert.equal((await chooseFormat(adminHeaders)).status, 409);
      const stateResponse = await fetch(origin + "/api/admin/state", { headers: adminHeaders });
      assert.deepEqual((await stateResponse.json()).enabledPackageFormats, [1]);
      assert.equal((await savePolicy(rootHeaders, [2])).status, 200);
      assert.equal((await chooseFormat(adminHeaders, { ...formatInput, packageFormatVersion: 1 })).status, 409);
    } finally { assert.equal((await savePolicy(rootHeaders, [1, 2])).status, 200); }
    assert.equal((await chooseFormat({ ...adminHeaders, Origin: "https://evil.test" })).status, 403);
    assert.equal((await chooseFormat(await httpSession(reader))).status, 403);
    assert.equal((await chooseFormat(adminHeaders, { ...formatInput, packageFormatVersion: "2" })).status, 400);
    const chosenFormat = await chooseFormat(adminHeaders); assert.equal(chosenFormat.status, 201); const chosenUpload = await chosenFormat.json();
    assert.equal(chosenUpload.packageFormatVersion, 2);
    const chosenRead = await fetch(origin + `/api/v1/clients/uploads/${chosenUpload.id}`, { headers: adminHeaders }); assert.equal(chosenRead.status, 200);
    assert.equal((await chosenRead.json()).packageFormatVersion, 2);
    assert.equal((await fetch(origin + `/api/v1/clients/uploads/${chosenUpload.id}/cancel`, { method: "POST", headers: adminHeaders, body: "{}" })).status, 200);
    const archivedIdentity = await work(db => c.createClient(db, admin, { organizationId: org, name: "HTTP draft archive" }));
    const archivedUpload = await prepare(v1, admin, archivedIdentity.clientId);
    const archivedDraft = await work(db => c.submitUpload(db, admin, archivedUpload.id, { ...fields, name: archivedIdentity.name, ...(archivedUpload.packageFormatVersion === 1 ? { platforms: ["windows-amd64"] } : {}) }));
    const archiveUrl = origin + `/api/v1/clients/${archivedIdentity.clientId}/drafts/${archivedDraft.draftId}/archive`;
    const archiveBody = JSON.stringify({ contentRevision: 1, packageRevision: 1 });
    assert.equal((await fetch(archiveUrl, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: archiveBody })).status, 401);
    assert.equal((await fetch(archiveUrl, { method: "POST", headers: { ...adminHeaders, Origin: "https://evil.test" }, body: archiveBody })).status, 403);
    assert.equal((await fetch(archiveUrl, { method: "POST", headers: await httpSession(reader), body: archiveBody })).status, 403);
    assert.equal((await fetch(archiveUrl, { method: "POST", headers: adminHeaders, body: JSON.stringify({ contentRevision: 1, packageRevision: 2 }) })).status, 409);
    assert.equal((await fetch(archiveUrl, { method: "POST", headers: adminHeaders, body: archiveBody })).status, 200);
    const archivedRow = await fetch(origin + `/api/v1/clients/${archivedIdentity.clientId}`, { headers: adminHeaders }); assert.equal(archivedRow.status, 200);
    assert.equal((await archivedRow.json()).drafts[0].archiveReason, "MANUAL");
    const publishedIdentity = await work(db => c.createClient(db, admin, { organizationId: org, name: "HTTP archived published deletion" }));
    const publishedUpload = await prepare(v1, admin, publishedIdentity.clientId);
    const publishedDraft = await work(db => c.submitUpload(db, admin, publishedUpload.id, { ...fields, name: publishedIdentity.name, ...(publishedUpload.packageFormatVersion === 1 ? { platforms: ["windows-amd64"] } : {}) }));
    await work(db => c.reviewClient(db, reviewer, publishedIdentity.clientId, publishedDraft.draftId, { packageRevision: 1, decision: "approve", note: "checked", contentRevision: 1 }));
    await finishPackages(publishedDraft.draftId);
    await work(db => c.publishClient(db, root, publishedIdentity.clientId, publishedDraft.draftId, { contentRevision: 1, packageRevision: 1, activate: true }));
    const publishedUrl = origin + `/api/v1/clients/${publishedIdentity.clientId}`;
    const remove = (headers: Record<string, string>) => fetch(publishedUrl + "/delete", { method: "POST", headers, body: "{}" });
    assert.equal((await remove(adminHeaders)).status, 409);
    assert.equal((await fetch(publishedUrl + "/archive", { method: "POST", headers: adminHeaders, body: JSON.stringify({ archived: true }) })).status, 200);
    const archivedPublished = await (await fetch(publishedUrl, { headers: adminHeaders })).json();
    assert.equal(archivedPublished.lifecycleStatus, "ARCHIVED"); assert.equal(archivedPublished.canDelete, true);
    assert.equal(archivedPublished.releases.length, 1);
    assert.equal((await remove({ ...adminHeaders, Origin: "https://evil.test" })).status, 403);
    assert.equal((await remove(await httpSession(reader))).status, 403);
    assert.equal((await remove(adminHeaders)).status, 200);
    assert.equal((await fetch(publishedUrl, { headers: adminHeaders })).status, 404);
    assert.equal((await fetch(publishedUrl + `/releases/${publishedDraft.draftId}/package?platform=windows-amd64`, { headers: rootHeaders })).status, 404);
    assert.equal(await client.clientRelease.count({ where: { clientId: fixtureClientId(publishedIdentity.clientId) } }), 1);
    }
    const token = await work(db => createApiToken(db, root, { name: "HTTP pipeline", serverIds: ["OTH"], expiresInDays: 1,
      permissions: ["SERVER_READ", "DRAFT_READ", "DRAFT_CREATE", "DRAFT_EDIT", "DRAFT_SUBMIT", "DRAFT_REVIEW", "RELEASE_READ", "RELEASE_PUBLISH", "RELEASE_ACTIVATE", "CLIENT_BIND", "CLIENT_ARCHIVE", "CLIENT_DELETE"] }));
    const authorization = { Authorization: "Bearer " + token.token };
    assert.equal((await fetch(origin + `/api/v1/clients/${fixtureClientId("NPA")}`, { headers: authorization })).status, 404);
    const sourcePath = join(temp, "complete.zip"); const metadataPath = join(temp, "metadata.json");
    const automaticMetadata = fields;
    await writeFile(sourcePath, v2); await writeFile(metadataPath, JSON.stringify({ ...automaticMetadata, versionLabel: "1.0.0", packageFormatVersion: 1 }));
    const cli = spawn(process.execPath, ["--import", "tsx", "scripts/upload-client.ts", sourcePath, metadataPath, fixtureClientId("OTH")], {
      windowsHide: true, env: { ...process.env, MUA_API_URL: origin, MUA_API_TOKEN: token.token }, stdio: ["ignore", "pipe", "pipe"],
    });
    let cliOutput = ""; let cliErrors = ""; let done = false;
    cli.stdout.on("data", chunk => { cliOutput += chunk.toString(); }); cli.stderr.on("data", chunk => { cliErrors += chunk.toString(); });
    const cliFinished = new Promise<number | null>(resolve => cli.once("exit", code => { done = true; resolve(code); }));
    const deadline = Date.now() + 20000;
    while (!done && Date.now() < deadline) { await runUploadWorker(workerClient); await new Promise(resolve => setTimeout(resolve, 250)); }
    if (!done) cli.kill(); assert.equal(await cliFinished, 0, cliErrors);
    const result = JSON.parse(cliOutput.split("\n").find(line => line.startsWith("{"))!);
    assert.equal(result.status, "SUBMITTED");
    assert.equal((await fetch(origin + `/api/v1/clients/${fixtureClientId("OTH")}`, { headers: authorization })).status, 200);
    assert.equal((await fetch(origin + "/api/v1/clients", { headers: authorization })).status, 200);
    const post = async (path: string, body: unknown) => {
      const response = await fetch(origin + path, { method: "POST", headers: { ...authorization, "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await response.json(); assert.equal(response.status, 200, JSON.stringify(json)); return json;
    };
    assert.equal(await client.packageBuild.count({ where: { draftId: result.draftId, required: true } }), 5);
    await post(`/api/v1/clients/${fixtureClientId("OTH")}/drafts/${result.draftId}/platforms`, { platforms: ["windows-amd64", "linux-amd64"] });
    assert.equal((await fetch(origin + "/api/v1/servers/OTH/packages?platform=windows-amd64&acceptedFormatVersions=1")).status, 404);
    await post(`/api/v1/clients/${fixtureClientId("OTH")}/drafts/` + result.draftId + "/review", { decision: "approve", note: "HTTP verified", contentRevision: 1, packageRevision: 2 });
    const premature = await fetch(origin + `/api/v1/clients/${fixtureClientId("OTH")}/drafts/${result.draftId}/publish`, { method: "POST", headers: { ...authorization, "Content-Type": "application/json" }, body: JSON.stringify({ activate: true, contentRevision: 1, packageRevision: 2 }) }); assert.equal(premature.status, 409);
    await finishPackages(result.draftId);
    const privateDownloadPath = `/api/v1/clients/${fixtureClientId("OTH")}/drafts/${result.draftId}/package?platform=windows-amd64`;
    assert.equal((await fetch(origin + privateDownloadPath)).status, 401);
    assert.equal((await fetch(origin + privateDownloadPath.replace(`/${fixtureClientId("OTH")}/`, `/${fixtureClientId("NPA")}/`), { headers: authorization })).status, 404);
    const privateDownload = await fetch(origin + privateDownloadPath, { headers: authorization }); assert.equal(privateDownload.status, 200);
    const privatePackage = await privateDownload.json(); assert.equal(privatePackage.packageType, "full");
    const privateBytes = await fetch(privatePackage.url); assert.equal(privateBytes.status, 200);
    assert.equal(digest(Buffer.from(await privateBytes.arrayBuffer())), privatePackage.sha256);
    const preview = await fetch(origin + `/api/v1/clients/${fixtureClientId("OTH")}/drafts/${result.draftId}/platform-manifest?platform=windows-amd64`, { headers: authorization }); assert.equal(preview.status, 200); assert.equal((await preview.json()).release.releaseId, result.draftId);
    await post(`/api/v1/clients/${fixtureClientId("OTH")}/drafts/` + result.draftId + "/publish", { contentRevision: 1, packageRevision: 2, activate: true });
    const releasedPackage = await fetch(origin + `/api/v1/clients/${fixtureClientId("OTH")}/releases/${result.draftId}/package?platform=windows-amd64`, { headers: authorization }); assert.equal(releasedPackage.status, 200);
    assert.equal((await releasedPackage.json()).sha256, privatePackage.sha256);
    const downloadList = await c.clientList(client, root);
    assert(downloadList.find(row => row.clientId === fixtureClientId("OTH"))?.releases[0].packageBuilds.some(build => build.status === "READY"));
    assert.equal((await fetch(origin + "/api/v1/servers/OTH/packages?platform=windows-amd64&acceptedFormatVersions=1")).status, 404, "unlisted servers cannot distribute completed packages");
    await work(db => m.updateServer(db, root, "OTH", { isListed: true }));
    const packageResponse = await fetch(origin + "/api/v1/servers/OTH/packages?platform=windows-amd64&acceptedFormatVersions=1"); assert.equal(packageResponse.status, 200); const packageData = await packageResponse.json(); assert.equal(packageData.packageType, "full");
    const refreshedV1 = await fetch(origin + packageData.refreshUrl); assert.equal(refreshedV1.status, 200);
    const fixedV1 = await refreshedV1.json(); assert.equal(fixedV1.sha256, packageData.sha256); assert.equal(fixedV1.releaseId, packageData.releaseId); assert(fixedV1.etag);
    assert.equal((await fetch(origin + packageData.refreshUrl.replace(packageData.sha256, "0".repeat(64)))).status, 409);
    const foreignRelease = await client.clientRelease.findFirstOrThrow({ where: { clientId: fixtureClientId("NPA") } });
    const operatorToken = randomBytes(32).toString("hex");
    await client.session.create({ data: { accountId: operator.id, tokenHash: tokenDigest(operatorToken), expiresAt: new Date(Date.now() + 60000) } });
    const operatorHeaders = { Cookie: `${COOKIE_NAME}=${operatorToken}` };
    const operatorDetails = await fetch(origin + `/api/v1/clients/${fixtureClientId("NPA")}`, { headers: operatorHeaders }); assert.equal(operatorDetails.status, 200);
    const operatorRow = await operatorDetails.json(); assert.equal(operatorRow.drafts.length, 0); assert(operatorRow.releases[0].sourceDraft.packageBuilds.length > 0);
    assert.equal((await fetch(origin + `/api/v1/clients/${fixtureClientId("NPA")}/releases/${foreignRelease.id}/package?platform=windows-amd64`, { headers: operatorHeaders })).status, 200);
    assert.equal((await fetch(origin + `/api/v1/servers/OTH/releases/${foreignRelease.id}/packages?platform=windows-amd64&acceptedFormatVersions=1`)).status, 404);
    assert.equal((await fetch(origin + "/api/v1/servers/OTH/packages?platform=linux-aarch64&acceptedFormatVersions=1")).status, 404);
    const manifestResponse = await fetch(origin + "/api/v1/servers/OTH/manifest?acceptedFormatVersions=1"); assert.equal(manifestResponse.status, 200);
    const bytes = Buffer.from(await manifestResponse.arrayBuffer()); assert.equal(digest(bytes), manifestResponse.headers.get("x-mua-manifest-sha256"));
    const identity = await signingIdentity();
    assert(verify(null, bytes, createPublicKey(identity.privateKey), Buffer.from(manifestResponse.headers.get("x-mua-signature")!, "base64")));
    const fileResponse = await globalThis.fetch(origin + "/api/v1/servers/OTH/files/" + digest(shared)); assert.equal(fileResponse.status, 404);
    // The same standard HTTP endpoint handles instance selection and early runtime metadata.
    const multi = rawZip([{ name: "versions/pcl/pcl.json", data: Buffer.from('{"id":"pcl","clientVersion":"1.21.1"}') },
      { name: "versions/hmcl/hmcl.json", data: Buffer.from('{"id":"hmcl","patches":[{"id":"game","version":"26.1"}]}') },
      { name: "versions/hmcl/mods/api.jar", data: randomBytes(39) }]);
    const currentClient = await client.client.findUniqueOrThrow({ where: { id: fixtureClientId("OTH") } });
    const createdUpload = await fetch(origin + "/api/v1/clients/uploads", { method: "POST", headers: { ...authorization, "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: fixtureClientId("OTH"), fileName: "multi.zip", size: multi.length, packageFormatVersion: 1, baseReleaseId: currentClient.currentReleaseId, basePublicationRevision: currentClient.revision }) });
    assert.equal(createdUpload.status, 201); const multiUpload = await createdUpload.json();
    const signed = await post(`/api/v1/clients/uploads/${multiUpload.id}/parts`, { partNumber: 1 });
    const put = await fetch(signed.url, { method: "PUT", body: new Uint8Array(multi) }); assert.equal(put.status, 200);
    await post(`/api/v1/clients/uploads/${multiUpload.id}/complete`, { parts: [{ partNumber: 1, etag: put.headers.get("etag") }] });
    await runUploadWorker(workerClient);
    const paused = await (await fetch(origin + `/api/v1/clients/uploads/${multiUpload.id}`, { headers: authorization })).json();
    assert.equal(paused.processingPhase, "SELECT_INSTANCE"); assert.equal(paused.detectedInfo.candidates.length, 2);
    await post(`/api/v1/clients/uploads/${multiUpload.id}/select-instance`, { instanceId: "hmcl" });
    await runUploadWorker(workerClient);
    const detected = await (await fetch(origin + `/api/v1/clients/uploads/${multiUpload.id}`, { headers: authorization })).json();
    assert.equal(detected.status, "READY"); assert.equal(detected.detectedInfo.minecraftVersion, "26.1"); assert.equal(detected.detectedInfo.javaVersion, 25);
    await post(`/api/v1/clients/uploads/${multiUpload.id}/cancel`, {});
    const v2Source = join(temp, "recipe.mrpack"), v2Metadata = join(temp, "v2-metadata.json");
    await writeFile(v2Source, await readFile("docs/examples/muapack-v2/inputs/target.mrpack"));
    await writeFile(v2Metadata, JSON.stringify({ ...automaticMetadata, versionLabel: "1.1.0", packageFormatVersion: 2 }));
    const v2Cli = spawn(process.execPath, ["--import", "tsx", "scripts/upload-client.ts", v2Source, v2Metadata, fixtureClientId("OTH")], {
      windowsHide: true, env: { ...process.env, MUA_API_URL: origin, MUA_API_TOKEN: token.token }, stdio: ["ignore", "pipe", "pipe"],
    });
    let v2Output = "", v2Errors = "";
    v2Cli.stdout.on("data", chunk => { v2Output += chunk.toString(); }); v2Cli.stderr.on("data", chunk => { v2Errors += chunk.toString(); });
    const v2Worker = setInterval(() => void runUploadWorker(workerClient), 300);
    const v2Timeout = setTimeout(() => v2Cli.kill(), 15000);
    try { assert.equal(await new Promise<number | null>(resolve => v2Cli.once("exit", resolve)), 0, v2Errors); } finally { clearTimeout(v2Timeout); clearInterval(v2Worker); }
    const v2Result = JSON.parse(v2Output.split("\n").find(line => line.startsWith("{"))!);
    assert.equal(v2Result.packageFormatVersion, 2); assert.equal(v2Result.status, "SUBMITTED"); assert(v2Result.draftId);
    const waitingResponse = await fetch(origin + `/api/v1/clients/uploads/${v2Result.uploadId}`, { headers: authorization }); assert.equal(waitingResponse.status, 200);
    const waiting = await waitingResponse.json(); assert.equal(waiting.status, "SUBMITTED"); assert.equal(waiting.attempts, undefined); assert.equal(waiting.recipeStatistics.remoteFiles, 4); assert.equal(waiting.statistics, null);
    const uploadStatsPath = `/api/v1/clients/uploads/${v2Result.uploadId}/distribution-statistics`;
    assert.equal((await fetch(origin + uploadStatsPath)).status, 401);
    const uploadStatsResponse = await fetch(origin + uploadStatsPath, { headers: authorization }); assert.equal(uploadStatsResponse.status, 200);
    const uploadStats = await uploadStatsResponse.json(); assert.equal(uploadStats.base, null, "v1 baseline cannot be used for v2 delta statistics"); assert.equal(uploadStats.knownNetworkBytes, null);
    const draftStatsPath = `/api/v1/clients/${fixtureClientId("OTH")}/drafts/${v2Result.draftId}/distribution-statistics`;
    assert.equal((await fetch(origin + draftStatsPath.replace(`/${fixtureClientId("OTH")}/`, `/${fixtureClientId("NPA")}/`), { headers: authorization })).status, 404);
    assert.equal((await fetch(origin + `/api/v1/clients/${fixtureClientId("OTH")}/releases/${result.draftId}/distribution-statistics`, { headers: authorization })).status, 409);
    const recipe = await fetch(origin + `/api/v1/clients/${fixtureClientId("OTH")}/drafts/${v2Result.draftId}/manifest`, { headers: authorization }); assert.equal(recipe.status, 200); assert.equal((await recipe.json()).format, "mua-recipe-manifest");
    await runPackageWorker(workerClient, async () => { assert.fail("HTTP v2 must not resolve an environment"); });
    await post(`/api/v1/clients/${fixtureClientId("OTH")}/drafts/${v2Result.draftId}/review`, { packageRevision: 1, decision: "approve", note: "HTTP v2 verified", contentRevision: 1 });
    const pendingV2 = await fetch(origin + `/api/v1/clients/${fixtureClientId("OTH")}/drafts/${v2Result.draftId}/publish`, { method: "POST", headers: { ...authorization, "Content-Type": "application/json" }, body: JSON.stringify({ activate: false, contentRevision: 1, packageRevision: 1 }) }); assert.equal(pendingV2.status, 409);
    await runPackageWorker(workerClient, async () => { assert.fail("HTTP v2 must not resolve an environment"); });
    const v2Full = await fetch(origin + `/api/v1/clients/${fixtureClientId("OTH")}/drafts/${v2Result.draftId}/package?platform=universal`, { headers: authorization }); assert.equal(v2Full.status, 200);
    const v2Artifact = await v2Full.json(); assert.equal(v2Artifact.packageFormatVersion, 2); assert.equal(v2Artifact.packageType, "full");
    const v2Bytes = Buffer.from(await (await fetch(v2Artifact.url)).arrayBuffer()); assert.equal(digest(v2Bytes), v2Artifact.sha256);
    const v2Path = join(temp, "http-v2.muapack"); await writeFile(v2Path, v2Bytes); await validateRecipePackArchive(v2Path, createPublicKey((await signingIdentity()).privateKey));
    const v2Published = await post(`/api/v1/clients/${fixtureClientId("OTH")}/drafts/${v2Result.draftId}/publish`, { contentRevision: 1, packageRevision: 1, activate: false });
    const readyStatsResponse = await fetch(origin + draftStatsPath, { headers: authorization }); assert.equal(readyStatsResponse.status, 200);
    const readyStats = await readyStatsResponse.json(); assert.equal(readyStats.fullPackageBytes, v2Artifact.size); assert.equal(readyStats.knownNetworkBytes, readyStats.fullPackageBytes + readyStats.remoteDownloadBytes);
    const releaseStatsPath = `/api/v1/clients/${fixtureClientId("OTH")}/releases/${v2Published.releaseId}/distribution-statistics`;
    assert.equal((await fetch(origin + releaseStatsPath, { headers: authorization })).status, 200);
    assert.equal((await fetch(origin + releaseStatsPath, { headers: operatorHeaders })).status, 404, "other-organization access is denied");
    const otherOrg = (await client.client.findUniqueOrThrow({ where: { id: fixtureClientId("OTH") } })).organizationId;
    await work(db => m.setMember(db, root, otherOrg, operator.id, { roles: ["RELEASE_OPERATOR"], status: "ACTIVE" }));
    const cookieStats = await fetch(origin + releaseStatsPath, { headers: operatorHeaders }); assert.equal(cookieStats.status, 200, "release-only readers do not require draft access");
    assert.equal((await fetch(origin + draftStatsPath, { headers: operatorHeaders })).status, 403);
    assert.deepEqual(await cookieStats.json(), readyStats);
    assert.equal((await client.clientRelease.findUniqueOrThrow({ where: { id: v2Published.releaseId } })).packageFormatVersion, 2);
    assert.equal((await client.client.findUniqueOrThrow({ where: { id: fixtureClientId("OTH") } })).currentReleaseId, result.draftId, "publishing without activation keeps the previous version online");
    await work(db => c.activateClient(db, root, fixtureClientId("OTH"), v2Published.releaseId, { publicationRevision: currentClient.revision }));
    const deltaUpload = await prepare(await readFile("docs/examples/muapack-v2/inputs/target.mrpack"), root, "OTH", true, "delta.mrpack", null, 2);
    const deltaDraft = await post(`/api/v1/clients/uploads/${deltaUpload.id}/submit`, { ...automaticMetadata, versionLabel: "1.2.0" });
    await post(`/api/v1/clients/${fixtureClientId("OTH")}/drafts/${deltaDraft.draftId}/review`, { packageRevision: 1, decision: "approve", note: "HTTP delta verified", contentRevision: 1 });
    await runPackageWorker(workerClient, async () => { assert.fail("HTTP delta must not resolve environments"); });
    await post(`/api/v1/clients/${fixtureClientId("OTH")}/drafts/${deltaDraft.draftId}/publish`, { contentRevision: 1, packageRevision: 1, activate: true });
    const deltaBase = await client.clientRelease.findUniqueOrThrow({ where: { id: v2Published.releaseId } });
    const query = `/api/v1/servers/OTH/packages?platform=windows-amd64&acceptedFormatVersions=2&baseReleaseId=${deltaBase.id}`;
    assert.equal((await fetch(origin + "/api/v1/servers/OTH/packages?platform=windows-amd64&acceptedFormatVersions=1")).status, 415);
    const deltaResponse = await fetch(origin + query + `&baseManifestSha256=${deltaBase.manifestSha256}`); assert.equal(deltaResponse.status, 200);
    const delta = await deltaResponse.json(); assert.equal(delta.packageType, "update"); assert.equal(delta.baseReleaseId, deltaBase.id); assert.equal(delta.baseManifestSha256, deltaBase.manifestSha256);
    const refreshedV2 = await fetch(origin + delta.refreshUrl); assert.equal(refreshedV2.status, 200);
    assert.equal((await refreshedV2.json()).sha256, delta.sha256);
    const noPlatform = await fetch(origin + `/api/v1/servers/OTH/packages?acceptedFormatVersions=2&baseReleaseId=${deltaBase.id}&baseManifestSha256=${deltaBase.manifestSha256}`);
    assert.equal(noPlatform.status, 200); const universalDelta = await noPlatform.json(); assert.equal("platform" in universalDelta, false); assert.equal(universalDelta.sha256, delta.sha256);
    const deltaBytes = Buffer.from(await (await fetch(delta.url)).arrayBuffer()); assert.equal(digest(deltaBytes), delta.sha256);
    await writeFile(v2Path, deltaBytes); assert.equal((await validateRecipePackArchive(v2Path, createPublicKey((await signingIdentity()).privateKey))).objectCount, 0);
    const fallback = await (await fetch(origin + query + `&baseManifestSha256=${"0".repeat(64)}`)).json(); assert.equal(fallback.packageType, "full"); assert.equal(fallback.sha256, delta.full.sha256);
    const last = await client.client.findUniqueOrThrow({ where: { id: fixtureClientId("OTH") } });
    await work(db => c.activateClient(db, root, fixtureClientId("OTH"), result.draftId, { publicationRevision: last.revision }));
    const stillFixed = await fetch(origin + delta.refreshUrl); assert.equal(stillFixed.status, 200); assert.equal((await stillFixed.json()).sha256, delta.sha256);
    const org = (await client.server.findUniqueOrThrow({ where: { serverId: "OTH" } })).organizationId;
    const binding = await client.serverPublication.findUniqueOrThrow({ where: { serverId: "OTH" } });
    const create = (body: unknown) => fetch(origin + "/api/v1/clients", { method: "POST", headers: { ...authorization, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const target = { organizationId: org, serverId: "OTH", publicationRevision: binding.revision, expectedClientId: fixtureClientId("OTH"), replaceConfirmed: true };
    const duplicate = await create({ ...target, name: "npucraft" }); assert.equal(duplicate.status, 409); assert((await duplicate.json()).error.includes("更新"));
    assert.equal((await create({ organizationId: org, name: "Unbound token" })).status, 403);
    assert.equal((await create({ ...target, name: "HTTP alternate", replaceConfirmed: false })).status, 409);
    const alternate = await create({ ...target, name: "HTTP alternate" }); assert.equal(alternate.status, 201);
    const newId = (await alternate.json()).clientId; assert.match(newId, /^[0-9a-f-]{36}$/);
    assert.equal((await fetch(origin + "/api/v1/clients/" + newId, { headers: authorization })).status, 200);
    assert.equal((await client.serverPublication.findUniqueOrThrow({ where: { serverId: "OTH" } })).clientId, fixtureClientId("OTH"));
    await post("/api/v1/clients/" + newId + "/unbind", { serverId: null, publicationRevision: null });
    await post(`/api/v1/clients/${fixtureClientId("OTH")}/unbind`, { serverId: "OTH", publicationRevision: binding.revision });
    await post("/api/v1/clients/" + newId + "/bind", { serverId: "OTH", publicationRevision: binding.revision + 1, expectedClientId: fixtureClientId(null), replaceConfirmed: false });
    assert.equal((await client.serverPublication.findUniqueOrThrow({ where: { serverId: "OTH" } })).clientId, newId);
    assert.equal((await fetch(origin + delta.refreshUrl)).status, 404, "fixed release URL cannot distribute an unbound client's history");
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
    assert.equal((await fetch(origin + "/api/admin/download-settings", { headers: adminHeaders })).status, 403);
    const downloadResponse = await fetch(origin + "/api/admin/download-settings", { headers: rootHeaders }); assert.equal(downloadResponse.status, 200);
    const downloadConfig = await downloadResponse.json(); assert.equal(downloadConfig.remoteSourceWhitelistEnabled, false);
    assert.equal((await fetch(origin + "/api/admin/download-settings", { method: "PATCH", headers: adminHeaders, body: JSON.stringify(downloadConfig) })).status, 403);
    assert.equal((await fetch(origin + "/api/admin/download-settings", { method: "PATCH", headers: rootHeaders, body: JSON.stringify(downloadConfig) })).status, 200);
    assert.equal((await fetch(origin + "/api/admin/download-settings", { method: "PATCH", headers: { ...rootHeaders, Origin: "https://other.example" }, body: JSON.stringify(downloadConfig) })).status, 403);
  } finally {
    server.kill(); await exited;
  }
});

test("multiple clients retain independent history, replacing a server only after approval and publication", async () => {
  const org = (await client.server.findUniqueOrThrow({ where: { serverId: "NPA" } })).organizationId;
  await work(db => m.createServer(db, root, { organizationId: org, serverId: "BND", displayName: "Binding test" }));
  const original = await work(db => c.createClient(db, admin, { organizationId: org, name: "Original", serverId: "BND", publicationRevision: 0, expectedClientId: fixtureClientId(null) }));
  const release = async (id: string, name: string, bytes: Buffer) => {
    const upload = await prepare(bytes, admin, id);
    const draft = await work(db => c.submitUpload(db, admin, upload.id, { ...fields, name }));
    await work(db => c.reviewClient(db, reviewer, id, draft.draftId, { packageRevision: 1, decision: "approve", note: "", contentRevision: 1 }));
    await finishPackages(draft.draftId);
    return { upload, draftId: draft.draftId };
  };
  const initial = await release(original.clientId, "Original", v1);
  const first = await work(db => c.publishClient(db, root, original.clientId, initial.draftId, { contentRevision: 1, packageRevision: 1, activate: true }));
  await work(db => m.updateServer(db, root, "BND", { isListed: true }));
  const snapshot = await publicManifest(client, "BND", "1");
  const target = await client.serverPublication.findUniqueOrThrow({ where: { serverId: "BND" } });
  const request = { organizationId: org, name: "Alternate", serverId: "BND", publicationRevision: target.revision, expectedClientId: fixtureClientId(original.clientId) };
  await assert.rejects(work(db => c.createClient(db, admin, request)), denied(409));
  assert.equal(await client.client.count({ where: { organizationId: org, name: "Alternate" } }), 0, "failed creation must roll back");
  const alternate = await work(db => c.createClient(db, admin, { ...request, replaceConfirmed: true }));
  assert.equal((await publicManifest(client, "BND", "1")).release.id, first.releaseId);
  const next = await release(alternate.clientId, "Alternate", v2);
  assert(next.upload.statistics!.casReusePercent > 0, "independent clients still reuse CAS");
  assert.equal((await publicManifest(client, "BND", "1")).release.id, first.releaseId);
  const second = await work(db => c.publishClient(db, root, alternate.clientId, next.draftId, { contentRevision: 1, packageRevision: 1, activate: true }));
  assert.equal((await publicManifest(client, "BND", "1")).release.id, second.releaseId);
  const saved = await client.clientRelease.findUniqueOrThrow({ where: { id: first.releaseId } });
  assert.equal(saved.manifestSha256, digest(snapshot.bytes));
  assert.equal((await client.client.findUniqueOrThrow({ where: { id: fixtureClientId(original.clientId) } })).currentReleaseId, first.releaseId);
  const bound = await client.serverPublication.findUniqueOrThrow({ where: { serverId: "BND" } });
  await work(db => c.unbindClient(db, admin, alternate.clientId, { serverId: "BND", publicationRevision: bound.revision }));
  await assert.rejects(publicManifest(client, "BND", "1"), denied(404));
  const empty = await client.serverPublication.findUniqueOrThrow({ where: { serverId: "BND" } });
  await work(db => c.bindClient(db, admin, original.clientId, { serverId: "BND", publicationRevision: empty.revision, expectedClientId: fixtureClientId(null), replaceConfirmed: false }));
  assert.equal((await publicManifest(client, "BND", "1")).release.id, first.releaseId);
  assert.equal((await client.client.findUniqueOrThrow({ where: { id: fixtureClientId(alternate.clientId) } })).currentReleaseId, second.releaseId);

  const current = await client.serverPublication.findUniqueOrThrow({ where: { serverId: "BND" } });
  const third = await work(db => c.createClient(db, admin, { ...request, name: "Third", publicationRevision: current.revision, replaceConfirmed: true }));
  const stale = await release(third.clientId, "Third", v2);
  await work(db => c.unbindClient(db, admin, original.clientId, { serverId: "BND", publicationRevision: current.revision }));
  await assert.rejects(work(db => c.publishClient(db, root, third.clientId, stale.draftId, { contentRevision: 1, packageRevision: 1, activate: true })), denied(409));
  assert.equal((await client.clientDraft.findUniqueOrThrow({ where: { id: stale.draftId } })).status, "APPROVED");
  assert.equal((await client.serverPublication.findUniqueOrThrow({ where: { serverId: "BND" } })).clientId, null);
  await work(db => c.unbindClient(db, admin, third.clientId, { serverId: null, publicationRevision: null }));
  await work(db => c.publishClient(db, root, third.clientId, stale.draftId, { contentRevision: 1, packageRevision: 1, activate: true }));
  assert.equal((await client.serverPublication.findUniqueOrThrow({ where: { serverId: "BND" } })).clientId, null);
});

test("format detection and mod discovery use one adapter registry", () => {
  assert.equal(detectPackFormat(["modrinth.index.json", "overrides/config/a"]), "modrinth");
  assert.equal(detectPackFormat(["Pack/manifest.json", "Pack/overrides/a"]), "curseforge");
  assert.equal(detectPackFormat(["Pack/mmc-pack.json", "Pack/.minecraft/mods/a.jar"]), "multimc");
  for (const marker of ["manifest.json", "mmc-pack.json"])
    assert.throws(() => inspectPackLayout([marker, ".minecraft/mods/a.jar"]), denied(422));
  assert.throws(() => inspectPackLayout(["manifest.json", "modrinth.index.json"]), denied(422));
  assert.deepEqual(inspectPackLayout(["modrinth.index.json", "overrides/mods/a.jar"]), { format: "modrinth", rootPrefix: "" });
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
  const details = fields;
  const { draftId } = await work(db => c.submitUpload(db, root, upload.id, { ...details, versionLabel: "auto-mods" }));
  const manifest = await c.draftManifest(client, root, fixtureClientId("OTH"), draftId);
  assert(manifest.format === "mua-client-manifest"); assert.deepEqual(manifest.mods, upload.detectedMods);
  await assert.rejects(work(db => c.submitUpload(db, root, upload.id, { ...details, versionLabel: "auto-mods", mods: ["invented.jar"] })), denied(400));
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
      assert(!(await storageClient().listObjects({ Bucket: casBucket() })).Contents?.some(object => object.Key === casKey(digest(mod))), "CAS must wait for the metadata checkpoint");
    },
  });
  assert.deepEqual(stages, ["INSPECTING", "IDENTIFIED"]); assert(parsed);
  assert.equal(parsed.files.find(file => file.path.endsWith("options.txt"))?.policy, "preserve");
  assert.equal(filePolicy("versions/test/saves/world/level.dat"), "preserve");
  assert(!parsed.files.some(file => file.path.includes(".hmcl")));
  assert((await storageClient().listObjects({ Bucket: casBucket() })).Contents?.some(object => object.Key === casKey(digest(mod))));
});

test("multiple instances pause without CAS, selection enforces ownership and scope, and API submission uses detected runtime", async () => {
  const org = (await client.server.findUniqueOrThrow({ where: { serverId: "OTH" } })).organizationId;
  const identity = await work(db => c.createClient(db, root, { organizationId: org, name: "Runtime selection" }));
  const bytes = rawZip([{ name: "versions/pcl/pcl.json", data: Buffer.from(JSON.stringify({ id: "pcl", clientVersion: "1.21.1", javaVersion: { majorVersion: 21 } })) },
    { name: "versions/hmcl/hmcl.json", data: Buffer.from(JSON.stringify({ id: "hmcl", patches: [{ id: "game", version: "26.1" }] })) },
    { name: "versions/pcl/mods/old.jar", data: randomBytes(81) }, { name: "versions/hmcl/mods/new.jar", data: randomBytes(82) }]);
  const before = (await storageClient().listObjects({ Bucket: casBucket() })).KeyCount;
  const upload = await prepare(bytes, root, identity.clientId);
  assert.equal(upload.status, "QUEUED"); assert.equal(upload.processingPhase, "SELECT_INSTANCE"); assert.equal(upload.detectedInfo?.candidates.length, 2);
  assert.equal(await runUploadWorker(workerClient), false, "paused tasks must not be repeatedly claimed");
  assert.equal((await storageClient().listObjects({ Bucket: casBucket() })).KeyCount, before);
  await assert.rejects(work(db => c.selectUploadInstance(db, admin, upload.id, { instanceId: "hmcl" })), denied(404));
  await assert.rejects(work(db => c.selectUploadInstance(db, root, upload.id, { instanceId: "outside" })), denied(400));
  await work(db => c.selectUploadInstance(db, root, upload.id, { instanceId: "hmcl" }));
  assert.equal(await runUploadWorker(workerClient), true);
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
  const worker = runUploadWorker(workerClient).finally(() => { finished = true; });
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
  try { await storageClient().headObject({ Bucket: bucket, Key: key }); return true; }
  catch (error) { if (missingObject(error)) return false; throw error; }
}
async function indexedMaintenance(now = new Date()) {
  for (let attempt = 0; attempt < 100; attempt++) if (await indexClientStorage(client)) {
    // Maintenance reconciles four deleted owners per tick; HTTP tests add more owners.
    const owners = await client.client.count({ where: { deletedAt: { not: null } } });
    for (let tick = 0; tick < Math.max(1, Math.ceil(owners / 4)); tick++) await maintainRecycleBin(workerClient, now);
    return;
  }
  assert.fail("storage index did not converge");
}
async function newRecycleClient(name: string) {
  const org = (await client.server.findUniqueOrThrow({ where: { serverId: "NPA" } })).organizationId;
  return work(db => c.createClient(db, admin, { organizationId: org, name }));
}
async function removeClient(id: string) { await work(db => c.archiveClient(db, admin, id, { archived: true })); await work(db => c.deleteClient(db, admin, id)); }

test("deletion requires archive, no binding, real scoped permission, and cancels pending jobs", async () => {
  await work(db => c.archiveClient(db, admin, fixtureClientId("NPA"), { archived: false }));
  const identity = await newRecycleClient("Delete authorization");
  await assert.rejects(work(db => c.deleteClient(db, admin, identity.clientId)), denied(409));
  await work(db => c.archiveClient(db, admin, identity.clientId, { archived: true }));
  await assert.rejects(work(db => c.deleteClient(db, reader, identity.clientId)), denied(403));
  await assert.rejects(work(db => c.deleteClient(db, { ...root, isSuperAdmin: false }, identity.clientId)), denied(404));
  await assert.rejects(client.client.update({ where: { id: fixtureClientId("NPA") }, data: { deletedAt: new Date() } }), "database rejects active clients");
  await assert.rejects(work(db => c.deleteClient(db, admin, fixtureClientId("NPA"))), denied(409));
  await work(db => c.archiveClient(db, admin, fixtureClientId("NPA"), { archived: true }));
  assert.equal((await client.serverPublication.findUniqueOrThrow({ where: { serverId: "NPA" } })).clientId, null);
  const archived = await c.clientDetails(client, admin, fixtureClientId("NPA"));
  assert.equal(archived.lifecycleStatus, "ARCHIVED"); assert.equal(archived.canDelete, true);
  assert(archived.releases.length > 0, "published history does not prevent deletion after archive");
  await work(db => c.archiveClient(db, admin, fixtureClientId("NPA"), { archived: false }));
  await work(db => c.deleteClient(db, admin, identity.clientId));
  await assert.rejects(c.clientDetails(client, admin, identity.clientId), denied(404));
  assert(!(await c.clientList(client, admin)).some(row => row.clientId === identity.clientId));
  assert.equal(await client.auditEvent.count({ where: { action: "CLIENT_DELETE", targetId: identity.clientId } }), 1);
  await assert.rejects(work(db => c.archiveClient(db, admin, identity.clientId, { archived: false })), denied(404));
  await assert.rejects(client.client.update({ where: { id: fixtureClientId(identity.clientId) }, data: { deletedAt: null } }), "deleted tombstones are immutable");
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

test("archived published clients can be deleted while immutable history, shared CAS and environment caches stay protected", async () => {
  const org = (await client.client.findUniqueOrThrow({ where: { id: fixtureClientId("NPA") } })).organizationId;
  await work(db => m.createServer(db, root, { organizationId: org, serverId: "DEL", displayName: "Published deletion" }));
  const identity = await work(db => c.createClient(db, admin, { organizationId: org, name: "Published recycle", serverId: "DEL", publicationRevision: 0, expectedClientId: fixtureClientId(null), replaceConfirmed: false }));
  const bytes = randomBytes(237), sha = digest(bytes);
  const zip = rawZip([{ name: "mods/exclusive.jar", data: bytes }, { name: "mods/shared.jar", data: shared }]);
  const builds = [];
  for (const versionLabel of ["1.0.0", "1.1.0"]) {
    const upload = await prepare(zip, admin, identity.clientId);
    const draft = await work(db => c.submitUpload(db, admin, upload.id, { ...fields, name: identity.name, versionLabel, ...(upload.packageFormatVersion === 1 ? { platforms: ["windows-amd64"] } : {}) }));
    await work(db => c.reviewClient(db, reviewer, identity.clientId, draft.draftId, { packageRevision: 1, decision: "approve", note: "checked", contentRevision: 1 }));
    await finishPackages(draft.draftId);
    await work(db => c.publishClient(db, root, identity.clientId, draft.draftId, { contentRevision: 1, packageRevision: 1, activate: true }));
    builds.push(await client.packageBuild.findUniqueOrThrow({ where: { draftId_platform_revision: { draftId: draft.draftId, platform: "windows-amd64", revision: 1 } } }));
  }
  const artifact = packageArtifactsSchema.parse(builds[1].artifacts); assert(artifact.update);
  await work(db => m.updateServer(db, root, "DEL", { isListed: true }));
  assert.equal((await c.clientDetails(client, admin, identity.clientId)).lifecycleStatus, "PUBLISHED");
  assert((await publishedServers(client)).some(server => server.serverId === "DEL"));
  await publicPackage(client, "DEL", "windows-amd64", builds[0].draftId, "1");
  await assert.rejects(work(db => c.deleteClient(db, admin, identity.clientId)), denied(409));
  await assert.rejects(client.client.update({ where: { id: fixtureClientId(identity.clientId) }, data: { deletedAt: new Date() } }));
  const history = await client.clientRelease.findMany({ where: { clientId: fixtureClientId(identity.clientId) }, orderBy: { id: "asc" } });
  const envBefore = await storageClient().listObjects({ Bucket: environmentsBucket() });
  const keys = new Set(history.map(release => release.manifestObjectKey));
  for (const build of builds) {
    keys.add(build.targetObjectKey!); const artifacts = packageArtifactsSchema.parse(build.artifacts);
    keys.add(artifacts.full.key); if (artifacts.update) keys.add(artifacts.update.key);
  }
  const sourceKeys = await client.clientUpload.findMany({ where: { clientId: fixtureClientId(identity.clientId) }, select: { sourceObjectKey: true, filesObjectKey: true } });
  for (const upload of sourceKeys) { keys.add(upload.sourceObjectKey); keys.add(upload.filesObjectKey!); }
  await work(db => c.archiveClient(db, admin, identity.clientId, { archived: true }));
  const archived = await c.clientDetails(client, admin, identity.clientId);
  assert.equal(archived.lifecycleStatus, "ARCHIVED"); assert.equal(archived.canDelete, true);
  assert.equal(archived.releases.length, 2); assert(archived.currentReleaseId);
  await assert.rejects(publicPackage(client, "DEL", "windows-amd64", null, "1"), denied(404));
  assert(!(await publishedServers(client)).some(server => server.serverId === "DEL"));
  await assert.rejects(work(db => c.deleteClient(db, reader, identity.clientId)), denied(403));
  await assert.rejects(work(db => c.deleteClient(db, { ...root, isSuperAdmin: false }, identity.clientId)), denied(404));
  await work(db => c.deleteClient(db, admin, identity.clientId));
  await assert.rejects(c.clientDetails(client, root, identity.clientId), denied(404));
  await assert.rejects(managementFullPackage(client, root, identity.clientId, "releases", history[0].id, "windows-amd64"), denied(404));
  await assert.rejects(work(db => c.archiveClient(db, admin, identity.clientId, { archived: false })), denied(404));
  await assert.rejects(client.client.update({ where: { id: fixtureClientId(identity.clientId) }, data: { deletedAt: null } }));
  await assert.rejects(client.clientRelease.update({ where: { id: history[0].id }, data: { description: "edited" } }));
  assert.deepEqual(await client.clientRelease.findMany({ where: { clientId: fixtureClientId(identity.clientId) }, orderBy: { id: "asc" } }), history);
  assert.equal(await client.auditEvent.count({ where: { action: "CLIENT_DELETE", targetId: identity.clientId } }), 1);
  const now = new Date(); await indexedMaintenance(now);
  for (const key of keys) {
    assert.equal(await objectExists(packagesBucket(), key), false, key);
    assert.equal(await objectExists(packagesBucket(), `recycle/clients/${identity.clientId}/${key}`), true, key);
  }
  assert.equal(await objectExists(casBucket(), casKey(sha)), false);
  assert.equal(await objectExists(casBucket(), "recycle/cas/" + casKey(sha)), true);
  assert.equal(await objectExists(casBucket(), casKey(digest(shared))), true);
  assert.deepEqual((await storageClient().listObjects({ Bucket: environmentsBucket() })).Contents, envBefore.Contents);
  const replacement = await newRecycleClient(identity.name); assert.notEqual(replacement.clientId, identity.clientId);
  const reused = await prepare(zip, admin, replacement.clientId); assert.equal(reused.statistics?.newDataSize, 0);
  await indexedMaintenance(new Date(now.getTime() + 8 * 86400000));
  for (const key of keys) assert.equal(await objectExists(packagesBucket(), `recycle/clients/${identity.clientId}/${key}`), false);
  assert.equal(await objectExists(casBucket(), casKey(sha)), true);
  assert.deepEqual(await client.clientRelease.findMany({ where: { clientId: fixtureClientId(identity.clientId) }, orderBy: { id: "asc" } }), history);
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
  await storageClient().putObject({ Bucket: casBucket(), Key: trash, Body: Buffer.alloc(bytes.length), Metadata: { sha256: sha } });
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
  await Promise.all([runUploadWorker(workerClient), runUploadWorker(workerClient), maintainRecycleBin(workerClient, new Date(now.getTime() + 8 * 86400000))]);
  const views = await Promise.all([first.id, second.id].map(id => c.findUpload(client, admin, id).then(c.uploadView)));
  assert(views.every(view => view.status === "READY"));
  const added = views.reduce((total, view) => total + view.statistics!.newDataSize, 0); assert(added === 0 || added === bytes.length);
  assert.deepEqual(await readObject(casKey(sha), casBucket()), bytes);
  assert.equal((await client.casObject.findUniqueOrThrow({ where: { sha256: sha } })).trashedAt, null);
  assert.equal(await client.casReference.count({ where: { sha256: sha, clientId: fixtureClientId({ in: [a.clientId, b.clientId] }) } }), 2);
});

test("invalid legacy inventories stop recycling; reconciliation catches late completed source ZIPs", async () => {
  const legacy = await newRecycleClient("Legacy inventory guard"), bytes = randomBytes(256), sha = digest(bytes);
  const zip = rawZip([{ name: "mods/legacy.jar", data: bytes }]); const upload = await prepare(zip, admin, legacy.clientId);
  const saved = await client.clientUpload.findUniqueOrThrow({ where: { id: upload.id } }); const originalIndex = await readObject(saved.filesObjectKey!);
  await removeClient(legacy.clientId);
  await storageClient().putObject({ Bucket: packagesBucket(), Key: saved.filesObjectKey!, Body: Buffer.from("{}") });
  await assert.rejects(indexedMaintenance(), denied(422)); assert.equal(await objectExists(casBucket(), casKey(sha)), true);
  await storageClient().putObject({ Bucket: packagesBucket(), Key: saved.filesObjectKey!, Body: originalIndex });
  await indexedMaintenance(); assert.equal(await objectExists(casBucket(), "recycle/cas/" + casKey(sha)), true);
  // Simulate an S3 completion finishing just after the deletion was first reconciled.
  await storageClient().putObject({ Bucket: packagesBucket(), Key: saved.sourceObjectKey, Body: zip });
  for (let i = 0; i < 10 && await objectExists(packagesBucket(), saved.sourceObjectKey); i++) await maintainRecycleBin(workerClient);
  assert.equal(await objectExists(packagesBucket(), saved.sourceObjectKey), false);
  assert.deepEqual(await readObject(`recycle/clients/${legacy.clientId}/${saved.sourceObjectKey}`), zip);
});

test("download settings default to unrestricted public sources and only session superadmins may change them", async () => {
  const initial = await downloadSettings(client, root); assert.equal(initial.remoteSourceWhitelistEnabled, false); assert.equal(initial.downloadProxyEnabled, false);
  assert.deepEqual(initial.minecraftDownloadSources, ["bmclapi", "ustc", "nju"]); assert.deepEqual(initial.javaDownloadSources, ["tuna"]);
  assert.equal(initial.mirrorProxyEnabled, false); assert.equal(initial.javaImageType, "jre");
  await assert.rejects(downloadSettings(client, admin), denied(403));
  await assert.rejects(work(db => updateDownloadSettings(db, admin, initial)), denied(403));
  await assert.rejects(work(db => updateDownloadSettings(db, { ...root, apiScope: { serverIds: ["NPA"], permissions: ["DRAFT_CREATE"] } }, initial)), denied(403));
  await assert.rejects(work(db => updateDownloadSettings(db, root, { ...initial, remoteSourceHosts: ["*.example.com"] })), denied(400));
  const updated = await work(db => updateDownloadSettings(db, root, { ...initial, remoteSourceWhitelistEnabled: true, remoteSourceHosts: ["CDN.MODRINTH.COM", "cdn.modrinth.com"] }));
  assert.deepEqual(updated.remoteSourceHosts, ["cdn.modrinth.com"]);
  const mirrors = await work(db => updateDownloadSettings(db, root, { ...updated, minecraftDownloadSources: ["nju", "ustc"], javaDownloadSources: [], javaImageType: "jdk", mirrorProxyEnabled: true }));
  assert.deepEqual(mirrors.minecraftDownloadSources, ["nju", "ustc"]); assert.equal((await downloadSettings(client, root)).javaImageType, "jdk");
  const legacy = await work(db => updateDownloadSettings(db, root, { remoteSourceWhitelistEnabled: false, remoteSourceHosts: [], downloadProxyEnabled: false, downloadProxyUrl: "" }));
  assert.deepEqual(legacy.minecraftDownloadSources, ["nju", "ustc"]); assert.equal(legacy.javaImageType, "jdk");
  await assert.rejects(work(db => updateDownloadSettings(db, root, { ...mirrors, minecraftDownloadSources: ["evil"] })), denied(400));
  await assert.rejects(work(db => db.platformSettings.update({ where: { id: "platform" }, data: { minecraftDownloadSources: ["nju", "nju"] } })));
  assert.equal((await recycleSettings(client, root)).recycleRetentionDays, 7);
  await work(db => updateDownloadSettings(db, root, initial));
});

test("mrpack upload, name confirmation, optional flags and subsequent updates share signed publication and Launcher API", async () => {
  const org = (await client.client.findUniqueOrThrow({ where: { id: fixtureClientId("NPA") } })).organizationId;
  await work(db => m.createServer(db, root, { organizationId: org, serverId: "MRP", displayName: "Mrpack test" }));
  await work(db => m.updateServer(db, root, "MRP", { isListed: true }));
  const identity = await work(db => c.createClient(db, admin, { organizationId: org, name: "mrpack filename", serverId: "MRP", publicationRevision: 0, expectedClientId: fixtureClientId(null), replaceConfirmed: false }));
  const optionalBytes = Buffer.from("optional jar bytes");
  function pack(versionId: string, optional: boolean) {
    const index = { formatVersion: 1, game: "minecraft", name: "Mrpack test", versionId, dependencies: { minecraft: "26.1", "fabric-loader": "0.19.5" },
      files: [{ path: "mods/optional.jar", hashes: { sha1: createHash("sha1").update(optionalBytes).digest("hex"), sha512: createHash("sha512").update(optionalBytes).digest("hex") },
        fileSize: optionalBytes.length, downloads: ["https://cdn.modrinth.com/optional.jar"], env: { client: optional ? "optional" : "required", server: "unsupported" } }] };
    return rawZip([{ name: "modrinth.index.json", data: Buffer.from(JSON.stringify(index)) }, { name: "overrides/mods/optional.jar", data: optionalBytes },
      { name: "overrides/mods/required.jar", data: Buffer.from("required jar") }]);
  }
  const upload = await prepare(pack("1.0", true), admin, identity.clientId, true, "example.mrpack"); assert.equal(upload.status, "READY");
  assert.equal(upload.detectedInfo?.javaVersion, 25); assert.equal(upload.detectedInfo?.pack?.version, "1.0");
  await assert.rejects(work(db => c.submitUpload(db, admin, upload.id, { ...fields, versionLabel: "1.0", ...(upload.packageFormatVersion === 1 ? { platforms: ["windows-amd64"] } : {}) })), denied(409));
  const metadata = { ...fields, name: "Mrpack test", versionLabel: "1.0", minecraftVersion: "26.1", javaVersion: 25, platforms: ["windows-amd64"] };
  const first = await work(db => c.submitUpload(db, admin, upload.id, metadata));
  const firstManifest = await c.draftManifest(client, admin, identity.clientId, first.draftId);
  assert(firstManifest.format === "mua-client-manifest"); assert.equal(firstManifest.files.find(file => file.path === "mods/optional.jar")?.optional, true); assert.equal(firstManifest.modDetails?.find(mod => mod.path === "mods/optional.jar")?.optional, true);
  assert.equal((await client.client.findUniqueOrThrow({ where: { id: fixtureClientId(identity.clientId) } })).name, "Mrpack test");
  await work(db => c.reviewClient(db, reviewer, identity.clientId, first.draftId, { packageRevision: 1, decision: "approve", note: "checked", contentRevision: 1 }));
  await finishPackages(first.draftId); await work(db => c.publishClient(db, root, identity.clientId, first.draftId, { contentRevision: 1, packageRevision: 1, activate: true }));
  const download = await publicPackage(client, "MRP", "windows-amd64", null, "1");
  assert.equal(download.mods.length, 2); assert.equal(download.mods.find(mod => mod.path === "mods/optional.jar")?.optional, true);
  const path = join(temp, "optional-full.muapack"); await writeFile(path, Buffer.from(await (await fetch(download.url)).arrayBuffer()));
  const validated = await validateMuaPackArchive(path, createPublicKey((await signingIdentity()).privateKey));
  const optionalFile = validated.target.files.find(file => file.path === "mods/optional.jar")!;
  assert.equal(optionalFile.optional, true); assert(validated.metadata.payload.some(object => object.sha256 === optionalFile.sha256));
  const original = (await publicManifest(client, "MRP", "1")).bytes;
  const update = await prepare(pack("1.1", false), admin, identity.clientId, true, "update.mrpack"); assert.equal(update.status, "READY");
  await assert.rejects(work(db => c.submitUpload(db, admin, update.id, { ...metadata, name: "another client", versionLabel: "1.1" })), denied(409));
  const second = await work(db => c.submitUpload(db, admin, update.id, { ...metadata, versionLabel: "1.1" }));
  await work(db => c.reviewClient(db, reviewer, identity.clientId, second.draftId, { packageRevision: 1, decision: "approve", note: "checked", contentRevision: 1 }));
  await finishPackages(second.draftId); assert.deepEqual((await publicManifest(client, "MRP", "1")).bytes, original);
  await work(db => c.publishClient(db, root, identity.clientId, second.draftId, { contentRevision: 1, packageRevision: 1, activate: true }));
  const delta = await publicPackage(client, "MRP", "windows-amd64", first.draftId, "1"); assert.equal(delta.packageType, "update");
  assert.equal(delta.mods.find(mod => mod.path === "mods/optional.jar")?.optional, false);
  const build = await client.packageBuild.findUniqueOrThrow({ where: { draftId_platform_revision: { draftId: second.draftId, platform: "windows-amd64", revision: 1 } } });
  const complete = await work(db => managementFullPackage(db, operator, identity.clientId, "releases", second.draftId, "windows-amd64"));
  assert.equal(complete.packageType, "full", "management always selects the full package even when a delta exists");
  assert.equal(complete.sha256, packageArtifactsSchema.parse(build.artifacts).full.sha256); assert.notEqual(complete.sha256, delta.sha256);
  await assert.rejects(work(db => managementFullPackage(db, operator, identity.clientId, "drafts", second.draftId, "windows-amd64")), denied(403));
  assert.equal(readMuaPlatformManifest(await readObject(build.targetObjectKey!)).mods.find(mod => mod.path === "mods/optional.jar")?.optional ?? false, false);
});

test("unpublished comparisons stay separate from player deltas, and publishing archives only the explicit replacement chain", async () => {
  const org = (await client.client.findUniqueOrThrow({ where: { id: fixtureClientId("NPA") } })).organizationId;
  const identity = await work(db => c.createClient(db, admin, { organizationId: org, name: "Draft lifecycle" }));
  const submit = (upload: UploadView, versionLabel: string) => work(db => c.submitUpload(db, admin, upload.id, { ...fields, name: identity.name, versionLabel, ...(upload.packageFormatVersion === 1 ? { platforms: ["windows-amd64"] } : {}) }));
  const review = (draftId: string) => work(db => c.reviewClient(db, reviewer, identity.clientId, draftId, { decision: "approve", note: "Checked", contentRevision: 1, packageRevision: 1 }));
  const first = await submit(await prepare(v1, admin, identity.clientId), "1.0.0");
  await review(first.draftId); await finishPackages(first.draftId);
  const originalBuild = await client.packageBuild.findFirstOrThrow({ where: { draftId: first.draftId } });
  const unrelated = await submit(await prepare(v1, admin, identity.clientId), "0.5.0");
  const secondUpload = await prepare(v2, admin, identity.clientId, true, "client.zip", first.draftId);
  assert.equal(secondUpload.statistics!.previousVersion, null);
  assert.equal(secondUpload.statistics!.estimatedDownloadSize, 112);
  assert.equal(secondUpload.comparisonStatistics!.previousVersion, "1.0.0");
  assert.equal(secondUpload.comparisonStatistics!.estimatedDownloadSize, 9);
  await assert.rejects(submit(secondUpload, "0.9.0"), denied(409));
  await assert.rejects(client.clientUpload.update({ where: { id: secondUpload.id }, data: { comparisonStatistics: {} } }), "sealed comparisons must be immutable");
  const second = await submit(secondUpload, "1.1.0");
  const thirdUpload = await prepare(v2, admin, identity.clientId, true, "client.zip", second.draftId);
  assert.equal(thirdUpload.comparisonStatistics!.estimatedDownloadSize, 0);
  const third = await submit(thirdUpload, "1.2.0");
  await assert.rejects(work(db => c.publishClient(db, root, identity.clientId, third.draftId, { contentRevision: 1, packageRevision: 1, activate: true })), denied(409));
  assert.equal((await client.clientDraft.findUniqueOrThrow({ where: { id: first.draftId } })).archivedAt, null);
  await review(third.draftId); await finishPackages(third.draftId);
  await assert.rejects(work(db => c.publishClient(db, publisher, identity.clientId, third.draftId, { contentRevision: 1, packageRevision: 1, activate: true })), denied(403));
  assert.equal((await client.clientDraft.findUniqueOrThrow({ where: { id: second.draftId } })).archivedAt, null);
  const published = await work(db => c.publishClient(db, publisher, identity.clientId, third.draftId, { contentRevision: 1, packageRevision: 1, activate: false }));
  assert.deepEqual(new Set(published.archivedDraftIds), new Set([first.draftId, second.draftId]));
  for (const draftId of [first.draftId, second.draftId]) {
    const draft = await client.clientDraft.findUniqueOrThrow({ where: { id: draftId } });
    assert(draft.archivedAt); assert.equal(draft.archiveReason, "SUPERSEDED"); assert.equal(draft.supersededByDraftId, third.draftId);
  }
  assert.equal((await client.clientDraft.findUniqueOrThrow({ where: { id: unrelated.draftId } })).archivedAt, null);
  assert.deepEqual((await client.packageBuild.findUniqueOrThrow({ where: { id: originalBuild.id } })).artifacts, originalBuild.artifacts);
  const oldDownload = await work(db => managementFullPackage(db, admin, identity.clientId, "drafts", first.draftId, "windows-amd64"));
  assert.equal(oldDownload.sha256, packageArtifactsSchema.parse(originalBuild.artifacts).full.sha256);
  const built = await client.packageBuild.findFirstOrThrow({ where: { draftId: third.draftId } }); assert.equal(packageArtifactsSchema.parse(built.artifacts).update, null);
  await assert.rejects(work(db => c.archiveClientDraft(db, admin, identity.clientId, third.draftId, { contentRevision: 1, packageRevision: 1 })), denied(409));
  await assert.rejects(client.clientDraft.update({ where: { id: third.draftId }, data: { archivedAt: new Date(), archiveReason: "MANUAL" } }));
  const baseline = { clientId: fixtureClientId(identity.clientId), fileName: "client.zip", size: v1.length, baseReleaseId: null, basePublicationRevision: 0 };
  await assert.rejects(work(db => c.createUpload(db, admin, { packageFormatVersion: 1, ...baseline, comparisonDraftId: third.draftId })), denied(409));
  const otherClient = await client.client.findUniqueOrThrow({ where: { id: fixtureClientId("OTH") } });
  await assert.rejects(work(db => c.createUpload(db, root, { packageFormatVersion: 1, ...baseline, clientId: fixtureClientId("OTH"), baseReleaseId: otherClient.currentReleaseId, basePublicationRevision: otherClient.revision, comparisonDraftId: unrelated.draftId })), denied(404));
  await assert.rejects(client.clientDraft.update({ where: { id: unrelated.draftId }, data: { replacesDraftId: third.draftId } }));
  const audits = await client.auditEvent.count({ where: { action: "DRAFT_SUPERSEDED", targetId: { in: [first.draftId, second.draftId] } } }); assert.equal(audits, 2);
});

test("manual draft archive enforces RBAC/revisions, cancels leases and permits explicit legacy replacement at publish", async () => {
  const org = (await client.client.findUniqueOrThrow({ where: { id: fixtureClientId("NPA") } })).organizationId;
  const identity = await work(db => c.createClient(db, admin, { organizationId: org, name: "Manual draft archive" }));
  const submit = (upload: UploadView, versionLabel: string) => work(db => c.submitUpload(db, admin, upload.id, { ...fields, name: identity.name, versionLabel, ...(upload.packageFormatVersion === 1 ? { platforms: ["windows-amd64"] } : {}) }));
  const manual = await submit(await prepare(v1, admin, identity.clientId), "1.0.0");
  const lease = await client.packageBuild.findFirstOrThrow({ where: { draftId: manual.draftId } });
  await client.packageBuild.update({ where: { id: lease.id }, data: { status: "PROCESSING", leaseToken: "11111111-1111-4111-8111-111111111111", leaseUntil: new Date(Date.now() + 60000) } });
  const revisions = { contentRevision: 1, packageRevision: 1 };
  await assert.rejects(work(db => c.archiveClientDraft(db, reader, identity.clientId, manual.draftId, revisions)), denied(403));
  await assert.rejects(work(db => c.archiveClientDraft(db, admin, fixtureClientId("OTH"), manual.draftId, revisions)), denied(404));
  await assert.rejects(work(db => c.archiveClientDraft(db, admin, identity.clientId, manual.draftId, { ...revisions, packageRevision: 2 })), denied(409));
  await work(db => c.archiveClientDraft(db, admin, identity.clientId, manual.draftId, revisions));
  const canceled = await client.packageBuild.findUniqueOrThrow({ where: { id: lease.id } });
  assert.equal(canceled.status, "FAILED"); assert.equal(canceled.leaseToken, null); assert.equal(canceled.attempts, 3);
  await assert.rejects(work(db => retryPackages(db, admin, identity.clientId, manual.draftId)), denied(409));
  await assert.rejects(work(db => c.reviewClient(db, reviewer, identity.clientId, manual.draftId, { decision: "approve", note: "", ...revisions })), denied(409));
  const old = await submit(await prepare(v1, admin, identity.clientId), "1.1.0");
  const next = await submit(await prepare(v2, admin, identity.clientId), "1.2.0");
  await assert.rejects(client.clientDraft.update({ where: { id: old.draftId }, data: { archivedAt: new Date(), supersededByDraftId: next.draftId } }), "superseded pointers require a valid archive reason");
  await work(db => c.reviewClient(db, reviewer, identity.clientId, next.draftId, { decision: "approve", note: "", ...revisions })); await finishPackages(next.draftId);
  await assert.rejects(work(db => c.publishClient(db, publisher, identity.clientId, next.draftId, { contentRevision: 1, packageRevision: 1, activate: false, replacesDraftId: old.draftId })), denied(403));
  assert.equal((await client.clientDraft.findUniqueOrThrow({ where: { id: old.draftId } })).archivedAt, null);
  const result = await work(db => c.publishClient(db, root, identity.clientId, next.draftId, { activate: false, replacesDraftId: old.draftId, ...revisions }));
  assert.deepEqual(result.archivedDraftIds, [old.draftId]);
  assert.equal((await client.clientDraft.findUniqueOrThrow({ where: { id: manual.draftId } })).archiveReason, "MANUAL");
});

test("concurrent archival and publication serialize without archiving a published release or losing its prior draft", async () => {
  const org = (await client.client.findUniqueOrThrow({ where: { id: fixtureClientId("NPA") } })).organizationId;
  const identity = await work(db => c.createClient(db, admin, { organizationId: org, name: "Draft archive race" }));
  const submit = (upload: UploadView, versionLabel: string) => work(db => c.submitUpload(db, admin, upload.id, { ...fields, name: identity.name, versionLabel, ...(upload.packageFormatVersion === 1 ? { platforms: ["windows-amd64"] } : {}) }));
  const old = await submit(await prepare(v1, admin, identity.clientId), "1.0.0");
  const next = await submit(await prepare(v2, admin, identity.clientId, true, "client.zip", old.draftId), "1.1.0");
  const revision = { contentRevision: 1, packageRevision: 1 };
  await work(db => c.reviewClient(db, reviewer, identity.clientId, next.draftId, { decision: "approve", note: "", ...revision })); await finishPackages(next.draftId);
  const results = await Promise.allSettled([
    work(db => c.archiveClientDraft(db, admin, identity.clientId, next.draftId, revision)),
    work(db => c.publishClient(db, root, identity.clientId, next.draftId, { activate: true, ...revision })),
  ]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  const latest = await client.clientDraft.findUniqueOrThrow({ where: { id: next.draftId }, include: { release: true } });
  const previous = await client.clientDraft.findUniqueOrThrow({ where: { id: old.draftId } });
  if (latest.release) {
    assert.equal(latest.archivedAt, null); assert.equal(latest.status, "RELEASED"); assert.equal(previous.archiveReason, "SUPERSEDED");
  } else {
    assert.equal(latest.archiveReason, "MANUAL"); assert.equal(previous.archivedAt, null);
    assert.equal((await client.client.findUniqueOrThrow({ where: { id: fixtureClientId(identity.clientId) } })).currentReleaseId, null);
  }
});

test("v2 full packages use local CAS only, immutable review revisions and explicit Launcher negotiation", async () => {
  const org = (await client.client.findUniqueOrThrow({ where: { id: fixtureClientId("NPA") } })).organizationId;
  await work(db => m.createServer(db, root, { organizationId: org, serverId: "VTF", displayName: "v2 integration" }));
  await work(db => m.updateServer(db, root, "VTF", { isListed: true }));
  const identity = await work(db => c.createClient(db, admin, { organizationId: org, name: "v2 full pipeline", serverId: "VTF", publicationRevision: 0, expectedClientId: fixtureClientId(null) }));
  const upload = await prepare(await readFile("docs/examples/muapack-v2/inputs/target.mrpack"), admin, identity.clientId, true, "recipe.mrpack", null, 2);
  assert.equal(upload.status, "READY", upload.error ?? "import failed");
  const environmentsBefore = await storageClient().listObjects({ Bucket: environmentsBucket() });
  const importDistribution = await recipeDistributionStats(client, admin, "uploads", upload.id);
  assert.equal(importDistribution.fullPackageBytes, null); assert.equal(importDistribution.remoteFiles, 4);
  await assert.rejects(recipeDistributionStats(client, admin, "drafts", upload.id, "NPA"), denied(404));
  const { draftId } = await work(db => c.submitUpload(db, admin, upload.id, { ...fields, name: identity.name, ...(upload.packageFormatVersion === 1 ? { platforms: ["windows-amd64", "linux-amd64"] } : {}) }));
  const neverResolve: typeof fixtureEnvironment = async () => { assert.fail("v2 must never download environment binaries"); };
  await assert.rejects(work(db => c.reviewClient(db, reader, identity.clientId, draftId, { packageRevision: 1, decision: "approve", note: "test", contentRevision: 1 })), denied(403));
  assert.equal(await runPackageWorker(workerClient, neverResolve), true);
  let build = await client.packageBuild.findFirstOrThrow({ where: { draftId, required: true } });
  assert.equal(build.platform, "universal"); assert.equal(build.revision, 1); assert.equal(build.status, "PREPARED", build.error ?? "preparation failed");
  const candidate = await c.draftManifest(client, reviewer, identity.clientId, draftId); assert(candidate.format === "mua-recipe-manifest");
  assert("protocolRevision" in candidate); assert.equal(candidate.protocolRevision, 2); assert(!("supportedPlatforms" in candidate));
  assert.equal(candidate.files.filter(file => file.source.type === "remote").length, 4);
  await work(db => c.reviewClient(db, reviewer, identity.clientId, draftId, { decision: "approve", note: "Checked v2", contentRevision: 1, packageRevision: 1 }));
  await assert.rejects(work(db => c.publishClient(db, root, identity.clientId, draftId, { contentRevision: 1, packageRevision: 1, activate: true })), denied(409));
  await runPackageWorker(workerClient, neverResolve);
  build = await client.packageBuild.findUniqueOrThrow({ where: { id: build.id } }); assert.equal(build.status, "READY", build.error ?? "build failed");
  const oldArtifacts = build.artifacts, oldTarget = build.targetSha256;
  const fullDistribution = await recipeDistributionStats(client, admin, "drafts", draftId, identity.clientId);
  assert.equal(fullDistribution.base, null); assert.equal(fullDistribution.fullPackageBytes, packageArtifactsSchema.parse(build.artifacts).full.size);
  assert.equal(fullDistribution.knownNetworkBytes, fullDistribution.fullPackageBytes! + fullDistribution.remoteDownloadBytes);
  assert.equal(fullDistribution.environmentBytes, null);
  const full = await managementFullPackage(client, admin, identity.clientId, "drafts", draftId, "universal");
  const bytes = Buffer.from(await (await fetch(full.url)).arrayBuffer()); assert.equal(digest(bytes), full.sha256);
  const packPath = join(temp, "verified-v2.muapack"); await writeFile(packPath, bytes);
  const parsed = await validateRecipePackArchive(packPath, createPublicKey((await signingIdentity()).privateKey));
  assert.equal(parsed.objectCount, 5); assert.equal(parsed.metadata.packageType, "full"); assert.equal(parsed.base, null);
  assert(parsed.target.files.some(file => file.optional && file.source.type === "local"));
  assert(parsed.target.files.some(file => file.optional && file.source.type === "remote"));
  await assert.rejects(work(db => configurePackages(db, admin, identity.clientId, draftId, { platforms: ["windows-amd64"] })), denied(409));
  const old = await client.packageBuild.findUniqueOrThrow({ where: { id: build.id } });
  assert.equal(old.status, "READY"); assert.equal(old.required, true); assert.deepEqual(old.artifacts, oldArtifacts); assert.equal(old.targetSha256, oldTarget);
  assert.equal((await client.clientDraft.findUniqueOrThrow({ where: { id: draftId } })).packageRevision, 1);
  await assert.rejects(work(db => c.publishClient(db, root, identity.clientId, draftId, { contentRevision: 1, activate: true, packageRevision: 2 })), denied(409));
  const released = await work(db => c.publishClient(db, root, identity.clientId, draftId, { contentRevision: 1, activate: true, packageRevision: 1 }));
  const release = await client.clientRelease.findUniqueOrThrow({ where: { id: released.releaseId } });
  assert.equal(release.packageFormatVersion, 2); assert.equal(release.manifestObjectKey, build.targetObjectKey);
  assert.equal(release.manifestSha256, build.targetSha256);
  assert.deepEqual(await recipeDistributionStats(client, admin, "releases", release.id, identity.clientId), fullDistribution);
  const manifest = readRecipeManifest((await publicManifest(client, "VTF", "1,2")).bytes); assert("protocolRevision" in manifest); assert.equal(manifest.protocolRevision, 2); assert(!("supportedPlatforms" in manifest));
  assert(verify(null, await readObject(release.manifestObjectKey), createPublicKey((await signingIdentity()).privateKey), Buffer.from(release.signature, "base64")));
  await assert.rejects(publicManifest(client, "VTF", "1"), denied(415));
  await assert.rejects(publicPackage(client, "VTF", "windows-amd64", null, "1"), denied(415));
  const universal = await publicPackage(client, "VTF", null, null, "2");
  assert(!("platform" in universal)); assert(!("supportedPlatforms" in universal));
  const download = await publicPackage(client, "VTF", "windows-amd64", null, "2");
  for (const platform of [...MUA_PLATFORMS, "linux-riscv64"]) assert.equal((await publicPackage(client, "VTF", platform, null, "2")).sha256, universal.sha256);
  assert.equal(download.formatVersion, 2); assert.equal(download.packageType, "full"); assert(download.mods.some(mod => mod.optional));
  assert.equal(digest(Buffer.from(await (await fetch(download.url)).arrayBuffer())), download.sha256);
  const pinned = await publicPackage(client, "VTF", null, null, "2", null, released.releaseId, universal.sha256);
  assert.equal(pinned.sha256, universal.sha256); assert(pinned.etag); assert.equal(pinned.expiresIn, 300);
  const ranged = await fetch(pinned.url, { headers: { Range: "bytes=10-29", "If-Match": pinned.etag! } });
  assert.equal(ranged.status, 206); assert.equal(ranged.headers.get("content-range"), `bytes 10-29/${pinned.size}`);
  assert.deepEqual(Buffer.from(await ranged.arrayBuffer()), bytes.subarray(10, 30));
  assert.equal((await fetch(pinned.url, { headers: { "If-Match": '"incorrect-etag"' } })).status, 412);
  await assert.rejects(publicPackage(client, "VTF", null, null, "2", null, released.releaseId, "0".repeat(64)), denied(409));
  const environmentsAfter = await storageClient().listObjects({ Bucket: environmentsBucket() });
  assert.deepEqual(environmentsAfter.Contents, environmentsBefore.Contents, "v2 never creates cached runtime objects");
  await assert.rejects(client.clientRelease.update({ where: { id: released.releaseId }, data: { manifestSha256: "0".repeat(64) } }));
  await work(db => c.archiveClient(db, admin, identity.clientId, { archived: true }));
  await assert.rejects(publicManifest(client, "VTF", "2"), denied(404));
  await assert.rejects(publicPackage(client, "VTF", null, null, "2", null, released.releaseId, universal.sha256), denied(404));
  await work(db => c.deleteClient(db, admin, identity.clientId));
  await indexClientStorage(client);
});

test("v2 automatic deltas bind a published baseline, validate both packages and fall back for another platform or digest", async () => {
  const org = (await client.client.findUniqueOrThrow({ where: { id: fixtureClientId("NPA") } })).organizationId;
  await work(db => m.createServer(db, root, { organizationId: org, serverId: "VTD", displayName: "v2 delta integration" }));
  await work(db => m.updateServer(db, root, "VTD", { isListed: true }));
  const identity = await work(db => c.createClient(db, admin, { organizationId: org, name: "v2 delta pipeline", serverId: "VTD", publicationRevision: 0, expectedClientId: fixtureClientId(null) }));
  const neverResolve: typeof fixtureEnvironment = async () => { assert.fail("v2 delta must not resolve environment binaries"); };
  const source = await readFile("docs/examples/muapack-v2/inputs/target.mrpack");
  async function submit(bytes: Buffer, version: string, platforms: string[]) {
    const upload = await prepare(bytes, admin, identity.clientId, true, "delta.mrpack", null, 2); assert.equal(upload.status, "READY", upload.error ?? "import failed");
    const { draftId } = await work(db => c.submitUpload(db, admin, upload.id, { ...fields, name: identity.name, versionLabel: version, ...(upload.packageFormatVersion === 1 ? { platforms: platforms } : {}) }));
    await work(db => c.reviewClient(db, reviewer, identity.clientId, draftId, { packageRevision: 1, decision: "approve", note: "Delta verified", contentRevision: 1 }));
    return draftId;
  }
  const first = await submit(await readFile("docs/examples/muapack-v2/inputs/base.mrpack"), "1.0.0", ["windows-amd64"]);
  await runPackageWorker(workerClient, neverResolve);
  await work(db => c.publishClient(db, root, identity.clientId, first, { contentRevision: 1, packageRevision: 1, activate: true }));
  const base = await client.clientRelease.findUniqueOrThrow({ where: { id: first } }), baseBytes = await readObject(base.manifestObjectKey);
  const draftId = await submit(source, "1.1.0", ["windows-amd64", "linux-amd64"]);
  // A corrupted published baseline must fail, rather than silently signing an unrelated full/update pair.
  await storageClient().putObject({ Bucket: packagesBucket(), Key: base.manifestObjectKey, Body: Buffer.from("{}") });
  await runPackageWorker(workerClient, neverResolve);
  let build = await client.packageBuild.findFirstOrThrow({ where: { draftId, required: true } }); assert.equal(build.status, "FAILED"); assert.match(build.error!, /基准.*摘要/);
  await storageClient().putObject({ Bucket: packagesBucket(), Key: base.manifestObjectKey, Body: baseBytes, Metadata: { sha256: base.manifestSha256 } });
  await work(db => retryPackages(db, admin, identity.clientId, draftId)); await runPackageWorker(workerClient, neverResolve);
  build = await client.packageBuild.findUniqueOrThrow({ where: { id: build.id } }); assert.equal(build.status, "READY", build.error ?? "delta build failed");
  const artifacts = packageArtifactsSchema.parse(build.artifacts); assert(artifacts.update); assert.equal(artifacts.update.baseReleaseId, base.id); assert.equal(artifacts.update.baseManifestSha256, base.manifestSha256);
  const publicKey = createPublicKey((await signingIdentity()).privateKey);
  const fullPath = join(temp, "delta-full-v2.muapack"), updatePath = join(temp, "delta-update-v2.muapack");
  const fullBytes = await readObject(artifacts.full.key), updateBytes = await readObject(artifacts.update.key);
  assert.equal(digest(fullBytes), artifacts.full.sha256); assert.equal(digest(updateBytes), artifacts.update.sha256);
  await writeFile(fullPath, fullBytes); await writeFile(updatePath, updateBytes);
  const full = await validateRecipePackArchive(fullPath, publicKey), delta = await validateRecipePackArchive(updatePath, publicKey);
  assert.equal(full.metadata.packageType, "full"); assert.equal(delta.metadata.packageType, "update"); assert.equal(delta.objectCount, 3); assert.equal(full.objectCount, 5);
  assert.deepEqual(delta.target, full.target); assert.deepEqual(delta.base, readRecipeManifest(baseBytes));
  assert.deepEqual(delta.metadata, createRecipePackMetadata(await readObject(build.targetObjectKey!), baseBytes));
  assert.equal(delta.metadata.removalPolicy, "retain"); assert(delta.metadata.changes.removed.length > 0); assert(delta.metadata.changes.sourceChanged.length > 0); assert(delta.metadata.changes.policyChanged.length > 0);
  const distribution = await recipeDistributionStats(client, admin, "drafts", draftId, identity.clientId);
  assert.equal(distribution.base?.releaseId, base.id); assert.equal(distribution.updatePackageBytes, artifacts.update.size);
  assert.equal(distribution.localPayloadBytes, delta.metadata.payload.reduce((sum, file) => sum + file.size, 0));
  assert.equal(distribution.changes.filter(file => file.kinds.includes("modified")).length, delta.metadata.changes.modified.length);
  assert.equal(distribution.knownNetworkBytes, artifacts.update.size + distribution.remoteDownloadBytes);
  const before = await publicPackage(client, "VTD", "windows-amd64", null, "2"); assert.equal(before.releaseId, first, "built candidates remain private until published");
  const removed = artifacts.update.key;
  await storageClient().deleteObjects({ Bucket: packagesBucket(), Delete: { Objects: [{ Key: removed }] } });
  await assert.rejects(work(db => c.publishClient(db, root, identity.clientId, draftId, { contentRevision: 1, packageRevision: 1, activate: true })), denied(422));
  await storageClient().putObject({ Bucket: packagesBucket(), Key: removed, Body: updateBytes, Metadata: { sha256: artifacts.update.sha256 } });
  await work(db => c.publishClient(db, root, identity.clientId, draftId, { contentRevision: 1, packageRevision: 1, activate: true }));
  const chosen = await publicPackage(client, "VTD", "windows-amd64", first, "1,2", base.manifestSha256);
  assert.equal(chosen.packageType, "update"); assert.equal(chosen.baseReleaseId, first); assert.equal(chosen.baseManifestSha256, base.manifestSha256);
  assert.equal(digest(Buffer.from(await (await fetch(chosen.url)).arrayBuffer())), artifacts.update.sha256);
  assert.equal(digest(Buffer.from(await (await fetch(chosen.full.url)).arrayBuffer())), artifacts.full.sha256);
  for (const [platform, id, sha] of [["windows-amd64", null, null], ["windows-amd64", first, "0".repeat(64)], ["windows-amd64", draftId, null]] as const) {
    const response = await publicPackage(client, "VTD", platform, id, "2", sha); assert.equal(response.packageType, "full"); assert.equal(response.baseReleaseId, null);
  }
  await assert.rejects(publicPackage(client, "VTD", "windows-amd64", first, "2", "bad"), denied(400));
  const management = await managementFullPackage(client, reader, identity.clientId, "releases", draftId, "universal"); assert.equal(management.sha256, artifacts.full.sha256);
  const identical = await submit(source, "1.2.0", ["windows-amd64", "linux-amd64"]); await runPackageWorker(workerClient, neverResolve);
  const emptyBuild = await client.packageBuild.findFirstOrThrow({ where: { draftId: identical, required: true } }); assert.equal(emptyBuild.status, "READY", emptyBuild.error ?? "empty delta failed");
  const emptyArtifacts = packageArtifactsSchema.parse(emptyBuild.artifacts); assert(emptyArtifacts.update);
  const emptyPath = join(temp, "empty-delta-v2.muapack"); await writeFile(emptyPath, await readObject(emptyArtifacts.update.key));
  const empty = await validateRecipePackArchive(emptyPath, publicKey); assert.equal(empty.objectCount, 0); assert.equal(empty.payloadSize, 0);
  assert.deepEqual(empty.metadata.changes.added, []); assert.deepEqual(empty.metadata.changes.modified, []); assert.deepEqual(empty.metadata.changes.removed, []);
  await work(db => c.publishClient(db, root, identity.clientId, identical, { contentRevision: 1, packageRevision: 1, activate: true }));
  const stillPinned = await publicPackage(client, "VTD", null, first, "2", base.manifestSha256, draftId, chosen.sha256);
  assert.equal(stillPinned.releaseId, draftId); assert.equal(stillPinned.sha256, chosen.sha256);
  assert.equal((await publicPackage(client, "VTD", null, null, "2")).releaseId, identical);
  assert.deepEqual(await client.clientRelease.findUniqueOrThrow({ where: { id: first } }), base);
  assert.equal(digest(await readObject(base.manifestObjectKey)), base.manifestSha256);
  await indexClientStorage(client); assert(await objectExists(packagesBucket(), artifacts.update.key));
  const differentPlatform = await submit(source, "1.3.0", ["macos-amd64"]); await runPackageWorker(workerClient, neverResolve);
  const platformBuild = await client.packageBuild.findFirstOrThrow({ where: { draftId: differentPlatform, required: true } }); assert.equal(platformBuild.status, "READY", platformBuild.error ?? "new platform failed");
  assert(packageArtifactsSchema.parse(platformBuild.artifacts).update, "legacy platform input cannot restrict new v2 packages or deltas");
  await work(db => c.archiveClientDraft(db, admin, identity.clientId, differentPlatform, { contentRevision: 1, packageRevision: 1 }));
});

test("v2 unpublished draft comparison does not become a player delta baseline", async () => {
  const org = (await client.client.findUniqueOrThrow({ where: { id: fixtureClientId("NPA") } })).organizationId;
  const identity = await work(db => c.createClient(db, admin, { organizationId: org, name: "v2 unpublished delta" }));
  const oldUpload = await prepare(await readFile("docs/examples/muapack-v2/inputs/base.mrpack"), admin, identity.clientId, true, "base.mrpack", null, 2);
  const first = await work(db => c.submitUpload(db, admin, oldUpload.id, { ...fields, name: identity.name, ...(oldUpload.packageFormatVersion === 1 ? { platforms: ["windows-amd64"] } : {}) }));
  const newUpload = await prepare(await readFile("docs/examples/muapack-v2/inputs/target.mrpack"), admin, identity.clientId, true, "target.mrpack", first.draftId, 2);
  const second = await work(db => c.submitUpload(db, admin, newUpload.id, { ...fields, name: identity.name, versionLabel: "1.1.0", ...(newUpload.packageFormatVersion === 1 ? { platforms: ["windows-amd64"] } : {}) }));
  await work(db => c.reviewClient(db, reviewer, identity.clientId, second.draftId, { packageRevision: 1, decision: "approve", note: "replacement", contentRevision: 1 }));
  for (let i = 0; i < 2; i++) await runPackageWorker(workerClient, async () => { assert.fail("v2 does not resolve environment binaries"); });
  const build = await client.packageBuild.findFirstOrThrow({ where: { draftId: second.draftId, required: true } }); assert.equal(build.status, "READY", build.error ?? "replacement failed");
  assert.equal(packageArtifactsSchema.parse(build.artifacts).update, null);
  await work(db => c.publishClient(db, root, identity.clientId, second.draftId, { contentRevision: 1, packageRevision: 1, activate: false }));
  assert((await client.clientDraft.findUniqueOrThrow({ where: { id: first.draftId } })).archivedAt);
});

test("format choice is sealed per upload; v2 imports only local files and does not starve v1", async () => {
  const org = (await client.client.findUniqueOrThrow({ where: { id: fixtureClientId("NPA") } })).organizationId;
  const identity = await work(db => c.createClient(db, admin, { organizationId: org, name: "Format choice" }));
  const bytes = await readFile("docs/examples/muapack-v2/inputs/target.mrpack");
  const casBefore = await client.casObject.findMany({ select: { sha256: true } });
  const upload = await prepare(bytes, admin, identity.clientId, false, "source.mrpack", null, 2);
  assert.equal(upload.packageFormatVersion, 2); assert.equal(upload.status, "QUEUED");
  const saved = await c.findUpload(client, admin, upload.id);
  assert.deepEqual(await readObject(saved.sourceObjectKey), bytes);
  assert.equal(saved.sourceSha256, null); assert.equal(saved.filesObjectKey, null);
  assert.equal(await runUploadWorker(workerClient), true);
  const ready = c.uploadView(await c.findUpload(client, admin, upload.id));
  assert.equal(ready.status, "READY", ready.error ?? "v2 import failed"); assert.equal(ready.statistics, null);
  assert.equal(ready.recipeStatistics?.localFiles, 5); assert.equal(ready.recipeStatistics?.remoteFiles, 4);
  assert.equal(ready.detectedInfo?.minecraftVersion, "1.21.1"); assert.equal(ready.detectedInfo?.javaVersion, 21);
  assert(ready.detectedInfo?.importFiles?.filter(file => file.source === "remote").every(file => file.status === "DECLARED" && file.downloadedBytes === 0));
  const imported = await c.findUpload(client, admin, upload.id);
  const inventory = parseRecipeInventory(JSON.parse((await readObject(imported.filesObjectKey!)).toString("utf8")));
  assert.equal(digest(await readObject(imported.filesObjectKey!)), imported.filesSha256);
  assert.equal(inventory.runtime.loader?.version, "0.16.10"); assert.equal(inventory.files.length, 9);
  for (const file of inventory.files) if (file.source.type === "local") assert.equal(digest(await readObject(casKey(file.hashes.sha256!), casBucket())), file.hashes.sha256);
  const refs = await client.casReference.findMany({ where: { clientId: fixtureClientId(identity.clientId) } }); assert.equal(refs.length, 5);
  const missingHashes = inventory.files.filter(file => file.source.type === "local" && !casBefore.some(old => old.sha256 === file.hashes.sha256));
  assert.equal(await client.casObject.count(), casBefore.length + missingHashes.length);
  await assert.rejects(c.readInventory(imported.filesObjectKey!, imported.filesSha256!));
  await indexClientStorage(client); // Remote declarations, including declared SHA-256, never become CAS references.
  assert.equal(await client.casReference.count({ where: { clientId: fixtureClientId(identity.clientId) } }), 5);
  assert.equal(await client.packageBuild.count({ where: { draft: { clientId: fixtureClientId(identity.clientId) } } }), 0, "v2 upload creates no environment work");
  const view = await c.clientDetails(client, admin, identity.clientId); assert.equal(view.uploads[0].packageFormatVersion, 2);
  const event = await client.auditEvent.findFirstOrThrow({ where: { targetId: upload.id, action: "CLIENT_UPLOAD_CREATE" } });
  assert.equal((event.details as { packageFormatVersion: number }).packageFormatVersion, 2);
  const completion = await work(db => c.prepareCompletion(db, admin, upload.id, { parts: [{ partNumber: 1, etag: "already-completed" }] }));
  assert(completion.alreadyCompleted); await c.transferCompletion(completion);
  assert.equal((await work(db => c.queueCompletedUpload(db, admin, upload.id))).status, "READY");
  for (const status of ["QUEUED", "PROCESSING", "SUBMITTED"] as const) await assert.rejects(client.clientUpload.update({ where: { id: upload.id }, data: { status } }));
  await assert.rejects(client.clientUpload.update({ where: { id: upload.id }, data: { packageFormatVersion: 1 } }));
  await assert.rejects(client.clientUpload.update({ where: { id: upload.id }, data: { packageFormatVersion: 3 } }));
  await assert.rejects(work(db => c.submitUpload(db, reader, upload.id, fields)), denied(403));
  await assert.rejects(work(db => c.retryUpload(db, admin, upload.id)), denied(409));
  await assert.rejects(work(db => c.cancelUpload(db, reader, upload.id)), denied(403));
  const oldCaller = await prepare(v1, admin, identity.clientId); assert.equal(oldCaller.packageFormatVersion, 1); assert.equal(oldCaller.status, "READY");
  await assert.rejects(client.client.update({ where: { id: fixtureClientId(identity.clientId) }, data: { name: "Renamed", nameKey: "renamed" } }), "an imported v2 upload must count against first-submission rename");
  await assert.rejects(work(db => c.submitUpload(db, admin, oldCaller.id, { ...fields, name: "Renamed" })), denied(409));
  await work(db => c.cancelUpload(db, admin, oldCaller.id));
  await work(db => c.cancelUpload(db, admin, upload.id));
  await assert.rejects(client.clientUpload.update({ where: { id: upload.id }, data: { packageFormatVersion: 1 } }));
  const explicitV1 = await prepare(v1, admin, identity.clientId, false, "source.zip", null, 1); assert.equal(explicitV1.packageFormatVersion, 1);
  await work(db => c.cancelUpload(db, admin, explicitV1.id));
});

test("open package formats require a session superadmin, gate new uploads, and preserve existing tasks and downloads", async () => {
  const initial = await packageFormatSettings(client, root);
  assert.deepEqual(initial.enabledPackageFormats, [1, 2]);
  const downloads = await downloadSettings(client, root);
  await assert.rejects(packageFormatSettings(client, admin), denied(403));
  await assert.rejects(work(db => updatePackageFormatSettings(db, admin, initial)), denied(403));
  await assert.rejects(work(db => updatePackageFormatSettings(db, { ...root, apiScope: { serverIds: ["NPA"], permissions: ["DRAFT_CREATE"] } }, initial)), denied(403));
  for (const enabledPackageFormats of [[], [1, 1], [3], ["2"]]) {
    await assert.rejects(work(db => updatePackageFormatSettings(db, root, { enabledPackageFormats })), denied(400));
  }
  const org = (await client.client.findUniqueOrThrow({ where: { id: fixtureClientId("NPA") } })).organizationId;
  const identity = await work(db => c.createClient(db, admin, { organizationId: org, name: "Format policy test" }));
  const input = { clientId: fixtureClientId(identity.clientId), fileName: "policy.mrpack", size: 100, baseReleaseId: null, basePublicationRevision: 0 };
  try {
    await work(db => updatePackageFormatSettings(db, root, { enabledPackageFormats: [2] }));
    assert.deepEqual((await m.getState(client, admin)).enabledPackageFormats, [2]);
    await assert.rejects(work(db => c.createUpload(db, admin, { packageFormatVersion: 1, ...input })), denied(409));
    await assert.rejects(work(db => c.createUpload(db, admin, { ...input, packageFormatVersion: 1 })), denied(409));
    const source = rawZip([{ name: "modrinth.index.json", data: Buffer.from(JSON.stringify({ formatVersion: 1, game: "minecraft", name: identity.name,
      versionId: "1.0.0", dependencies: { minecraft: "1.21.1", "fabric-loader": "0.16.10" }, files: [] })) },
      { name: "overrides/config/policy.txt", data: Buffer.from("policy test") }]);
    const upload = await prepare(source, admin, identity.clientId, true, "policy.mrpack", null, 2);
    await work(db => updatePackageFormatSettings(db, root, { enabledPackageFormats: [1] }));
    await assert.rejects(work(db => c.createUpload(db, admin, { ...input, packageFormatVersion: 2 })), denied(409));
    const submitted = await work(db => c.submitUpload(db, admin, upload.id, { ...fields, name: identity.name }));
    await work(db => c.reviewClient(db, reviewer, identity.clientId, submitted.draftId, { packageRevision: 1, decision: "approve", note: "Existing upload remains valid", contentRevision: 1 }));
    await finishPackages(submitted.draftId);
    await work(db => c.publishClient(db, root, identity.clientId, submitted.draftId, { contentRevision: 1, packageRevision: 1, activate: true }));
    const details = await c.clientDetails(client, admin, identity.clientId);
    assert.equal(details.initialPackageFormatVersion, 2);
    const full = await managementFullPackage(client, admin, identity.clientId, "drafts", submitted.draftId, null);
    assert.equal(full.packageFormatVersion, 2);
    const v1Upload = await prepare(v1, admin, identity.clientId);
    const v1Draft = await work(db => c.submitUpload(db, admin, v1Upload.id, { ...fields, name: identity.name, versionLabel: "1.1.0", ...(v1Upload.packageFormatVersion === 1 ? { platforms: ["windows-amd64"] } : {}) }));
    await work(db => c.reviewClient(db, reviewer, identity.clientId, v1Draft.draftId, { packageRevision: 1, decision: "approve", note: "Switch to the open format", contentRevision: 1 }));
    await finishPackages(v1Draft.draftId);
    await work(db => c.publishClient(db, root, identity.clientId, v1Draft.draftId, { contentRevision: 1, packageRevision: 1, activate: true }));
    assert.equal((await c.clientDetails(client, admin, identity.clientId)).initialPackageFormatVersion, 2, "first v2 remains the default after publishing v1");
    for (const enabledPackageFormats of [[], [1, 1], [3]]) {
      await assert.rejects(work(db => db.platformSettings.update({ where: { id: "platform" }, data: { enabledPackageFormats } })));
    }
    assert.deepEqual(await downloadSettings(client, root), downloads);
    assert(await client.auditEvent.count({ where: { action: "PACKAGE_FORMAT_SETTINGS_UPDATE", actorId: root.id } }));
  } finally { await work(db => updatePackageFormatSettings(db, root, initial)); }
});

test("one client can publish v1, remote-only v2 and v1 again without mixing signatures or delta bases", async () => {
  const org = (await client.client.findUniqueOrThrow({ where: { id: fixtureClientId("NPA") } })).organizationId;
  const identity = await work(db => c.createClient(db, admin, { organizationId: org, name: "Cross format versions" }));
  const noRuntime: typeof fixtureEnvironment = async () => { assert.fail("remote-only v2 must not resolve runtime"); };
  const local = await prepare(v1, admin, identity.clientId);
  const first = await work(db => c.submitUpload(db, admin, local.id, { ...fields, name: identity.name, ...(local.packageFormatVersion === 1 ? { platforms: ["windows-amd64"] } : {}) }));
  await work(db => c.reviewClient(db, reviewer, identity.clientId, first.draftId, { packageRevision: 1, decision: "approve", note: "v1", contentRevision: 1 }));
  await finishPackages(first.draftId);
  const r1 = await work(db => c.publishClient(db, root, identity.clientId, first.draftId, { contentRevision: 1, packageRevision: 1, activate: true }));
  const old = await client.clientRelease.findUniqueOrThrow({ where: { id: r1.releaseId } });
  const source = rawZip([{ name: "modrinth.index.json", data: Buffer.from(JSON.stringify({ formatVersion: 1, game: "minecraft", name: identity.name,
    versionId: "1.1.0", dependencies: { minecraft: "1.21.1", "fabric-loader": "0.16.10" }, files: [{ path: "mods/optional.jar", fileSize: 500,
      hashes: { sha1: "5".repeat(40), sha512: "6".repeat(128) }, downloads: ["https://remote.invalid/optional.jar"], env: { client: "optional" } }] })) }]);
  const remote = await prepare(source, admin, identity.clientId, true, "remote.mrpack", null, 2); assert.equal(remote.status, "READY"); assert.equal(remote.recipeStatistics?.localFiles, 0);
  const second = await work(db => c.submitUpload(db, admin, remote.id, { ...fields, name: identity.name, versionLabel: "1.1.0", ...(remote.packageFormatVersion === 1 ? { platforms: ["windows-amd64"] } : {}) }));
  await work(db => c.reviewClient(db, reviewer, identity.clientId, second.draftId, { packageRevision: 1, decision: "approve", note: "remote only", contentRevision: 1 }));
  await runPackageWorker(workerClient, noRuntime);
  const b2 = await client.packageBuild.findFirstOrThrow({ where: { draftId: second.draftId, required: true } }); assert.equal(b2.status, "READY", b2.error ?? "remote-only package failed");
  const full = packageArtifactsSchema.parse(b2.artifacts); assert.equal(full.update, null);
  const path = join(temp, "remote-only-v2.muapack"); await writeFile(path, await readObject(full.full.key));
  const verified = await validateRecipePackArchive(path, createPublicKey((await signingIdentity()).privateKey)); assert.equal(verified.objectCount, 0); assert.equal(verified.payloadSize, 0);
  await work(db => c.publishClient(db, root, identity.clientId, second.draftId, { contentRevision: 1, packageRevision: 1, activate: true }));
  assert.equal((await c.clientDetails(client, admin, identity.clientId)).initialPackageFormatVersion, 1, "the initial format stays v1 after publishing v2");
  const back = await prepare(v2, admin, identity.clientId); assert.equal(back.status, "READY", back.error ?? "v1 import cannot read v2 base");
  const third = await work(db => c.submitUpload(db, admin, back.id, { ...fields, name: identity.name, versionLabel: "1.2.0", ...(back.packageFormatVersion === 1 ? { platforms: ["windows-amd64"] } : {}) }));
  await work(db => c.reviewClient(db, reviewer, identity.clientId, third.draftId, { packageRevision: 1, decision: "approve", note: "v1 again", contentRevision: 1 }));
  await finishPackages(third.draftId);
  const b3 = await client.packageBuild.findFirstOrThrow({ where: { draftId: third.draftId, required: true } }); assert.equal(packageArtifactsSchema.parse(b3.artifacts).update, null);
  await work(db => c.publishClient(db, root, identity.clientId, third.draftId, { contentRevision: 1, packageRevision: 1, activate: true }));
  assert.deepEqual(await client.clientRelease.findUniqueOrThrow({ where: { id: r1.releaseId } }), old);
  assert.equal(digest(await readObject(old.manifestObjectKey)), old.manifestSha256);
});

test("format validation, draft locks and archived deletion protect staged v2 uploads", async () => {
  const org = (await client.client.findUniqueOrThrow({ where: { id: fixtureClientId("NPA") } })).organizationId;
  const identity = await work(db => c.createClient(db, admin, { organizationId: org, name: "Waiting v2 deletion" }));
  const input = { clientId: fixtureClientId(identity.clientId), fileName: "recipe.mrpack", size: 10, baseReleaseId: null, basePublicationRevision: 0 };
  const count = await client.clientUpload.count();
  for (const packageFormatVersion of [0, 3, "2", null]) await assert.rejects(work(db => c.createUpload(db, admin, { ...input, packageFormatVersion })), denied(400));
  assert.equal(await client.clientUpload.count(), count);
  await assert.rejects(work(db => c.createUpload(db, reader, { ...input, packageFormatVersion: 2 })), denied(403));
  await assert.rejects(work(db => c.createUpload(db, admin, { ...input, clientId: fixtureClientId("OTH"), packageFormatVersion: 2 })), denied(404));
  const draft = await client.clientDraft.create({ data: { clientId: fixtureClientId(identity.clientId), packageFormatVersion: 2, createdById: admin.id } });
  await assert.rejects(client.clientDraft.update({ where: { id: draft.id }, data: { packageFormatVersion: 1 } }));
  await assert.rejects(client.packageBuild.create({ data: { draftId: draft.id, platform: "windows-amd64", revision: 1 } }));
  const upload = await prepare(await readFile("docs/examples/muapack-v2/inputs/base.mrpack"), admin, identity.clientId, false, "recipe.mrpack", null, 2);
  await work(db => c.archiveClient(db, admin, identity.clientId, { archived: true }));
  await assert.rejects(client.client.update({ where: { id: fixtureClientId(identity.clientId) }, data: { deletedAt: new Date() } }), "waiting uploads must be cancelled before deletion");
  await work(db => c.deleteClient(db, admin, identity.clientId));
  const closed = await client.clientUpload.findUniqueOrThrow({ where: { id: upload.id } });
  assert.equal(closed.status, "CANCELLED"); assert.equal(closed.packageFormatVersion, 2);
  await assert.rejects(c.findUpload(client, admin, upload.id), denied(404));
  await assert.rejects(client.client.update({ where: { id: fixtureClientId(identity.clientId) }, data: { deletedAt: null } }));
});

test("v2 leases, failed retries, revoked owners and local CAS recycling preserve the import boundary", async () => {
  const org = (await client.client.findUniqueOrThrow({ where: { id: fixtureClientId("NPA") } })).organizationId;
  const identity = await work(db => c.createClient(db, admin, { organizationId: org, name: "v2 lease recycle" }));
  const local = Buffer.from("unique v2 recycle " + suffix), sha = digest(local);
  const source = rawZip([{ name: "modrinth.index.json", data: Buffer.from(JSON.stringify({ formatVersion: 1, game: "minecraft", name: "Recipe",
    versionId: "1.0.0", dependencies: { minecraft: "1.21.1" }, files: [{ path: "mods/remote.jar", fileSize: 999,
      hashes: { sha1: "2".repeat(40), sha512: "3".repeat(128), sha256: "4".repeat(64) }, downloads: ["https://remote.invalid/mod.jar"], env: { client: "optional" } }] })) },
    { name: "overrides/mods/local.jar", data: local }]);
  const upload = await prepare(source, admin, identity.clientId, false, "recipe.mrpack", null, 2);
  const lease = await claimUpload(client); assert.equal(lease?.id, upload.id);
  await client.clientUpload.update({ where: { id: upload.id }, data: { leaseUntil: new Date(0) } });
  await runUploadWorker(workerClient); const ready = c.uploadView(await c.findUpload(client, admin, upload.id));
  assert.equal(ready.status, "READY", ready.error ?? "lease recovery failed");
  assert.equal((await c.findUpload(client, admin, upload.id)).attempts, 2);
  assert.equal(await client.casReference.count({ where: { clientId: fixtureClientId(identity.clientId) } }), 1);
  assert.equal(await client.casObject.count({ where: { sha256: "4".repeat(64) } }), 0);
  await work(db => c.archiveClient(db, admin, identity.clientId, { archived: true }));
  await work(db => c.deleteClient(db, admin, identity.clientId)); await indexedMaintenance();
  assert.equal(await objectExists(casBucket(), "recycle/cas/" + casKey(sha)), true);
  const next = await work(db => c.createClient(db, admin, { organizationId: org, name: "v2 lease recycle" }));
  const reused = await prepare(source, admin, next.clientId, true, "recipe.mrpack", null, 2);
  assert.equal(reused.status, "READY"); assert.equal(reused.recipeStatistics?.newLocalDataSize, 0);
  assert.equal(await objectExists(casBucket(), "recycle/cas/" + casKey(sha)), false);
  await work(db => c.cancelUpload(db, admin, reused.id));
  const invalid = await prepare(v1, admin, next.clientId, true, "minecraft.zip", null, 2);
  assert.equal(invalid.status, "FAILED"); assert.match(invalid.error!, /v2/);
  assert.equal((await work(db => c.retryUpload(db, admin, invalid.id))).status, "QUEUED");
  await client.account.update({ where: { id: admin.id }, data: { status: "DISABLED" } });
  try { await runUploadWorker(workerClient); assert.equal((await c.findUpload(client, root, invalid.id)).status, "FAILED"); }
  finally { await client.account.update({ where: { id: admin.id }, data: { status: "ACTIVE" } }); }
  await work(db => c.cancelUpload(db, admin, invalid.id));
});

test("real PCL v2 imports exported launcher settings safely and produces a reviewed signed full recipe", { skip: !process.env.MUA_REAL_V2_PACK, timeout: 120000 }, async () => {
  const source = await readFile(process.env.MUA_REAL_V2_PACK!);
  const org = (await client.client.findUniqueOrThrow({ where: { id: fixtureClientId("NPA") } })).organizationId;
  const identity = await work(db => c.createClient(db, admin, { organizationId: org, name: "Real PCL v2" }));
  const upload = await prepare(source, admin, identity.clientId, true, "test_pclFormat 1.0.0.zip", null, 2);
  assert.equal(upload.status, "READY", upload.error ?? "PCL import failed");
  assert.equal(upload.detectedInfo?.minecraftVersion, "1.21.1"); assert.equal(upload.detectedInfo?.javaVersion, 21);
  assert.equal(upload.detectedInfo?.loaderVersion, "21.1.256");
  const declared = upload.detectedInfo?.importFiles?.filter(file => file.source === "remote") ?? [];
  assert(declared.length > 0); assert(declared.every(file => file.status === "DECLARED" && file.downloadedBytes === 0));
  const { draftId } = await work(db => c.submitUpload(db, admin, upload.id, { ...fields, name: identity.name, ...(upload.packageFormatVersion === 1 ? { platforms: ["windows-amd64"] } : {}) }));
  const neverResolve: typeof fixtureEnvironment = async () => { assert.fail("v2 must not resolve NeoForge or Java binaries"); };
  await runPackageWorker(workerClient, neverResolve);
  await work(db => c.reviewClient(db, reviewer, identity.clientId, draftId, { packageRevision: 1, decision: "approve", note: "Real PCL import", contentRevision: 1 }));
  await runPackageWorker(workerClient, neverResolve);
  const build = await client.packageBuild.findFirstOrThrow({ where: { draftId, required: true } }); assert.equal(build.status, "READY", build.error ?? "PCL v2 build failed");
  const full = await managementFullPackage(client, admin, identity.clientId, "drafts", draftId, "universal");
  const bytes = Buffer.from(await (await fetch(full.url)).arrayBuffer()); assert.equal(digest(bytes), full.sha256);
  const pack = join(temp, "real-pcl-v2.muapack"); await writeFile(pack, bytes);
  const parsed = await validateRecipePackArchive(pack, createPublicKey((await signingIdentity()).privateKey));
  assert(!parsed.target.files.some(file => /^PCL\//i.test(file.path))); assert(parsed.target.files.some(file => file.source.type === "remote"));
  assert.equal(parsed.target.runtime.loader?.type, "neoforge");
  const published = await work(db => c.publishClient(db, root, identity.clientId, draftId, { contentRevision: 1, packageRevision: 1, activate: false }));
  assert.equal((await client.clientRelease.findUniqueOrThrow({ where: { id: published.releaseId } })).packageFormatVersion, 2);
  const report = { sample: "PCL v2", sourceSize: source.length, minecraft: parsed.target.runtime.minecraft, java: parsed.target.runtime.java.major,
    loader: parsed.target.runtime.loader, files: parsed.target.files.length, localPayloads: parsed.objectCount, remoteFiles: declared.length,
    fullSize: full.size, fullSha256: full.sha256, remoteDownloadedBytes: 0, environmentDownloadedBytes: 0 };
  console.log(JSON.stringify(report)); await writeFile(".local/real-pcl-v2-report.json", JSON.stringify(report, null, 2));
  await work(db => c.activateClient(db, root, identity.clientId, published.releaseId, { publicationRevision: 0 }));
  const nextUpload = await prepare(source, admin, identity.clientId, true, "test_pclFormat 1.0.0.zip", null, 2); assert.equal(nextUpload.status, "READY");
  assert.equal(nextUpload.recipeStatistics?.newLocalDataSize, 0);
  const next = await work(db => c.submitUpload(db, admin, nextUpload.id, { ...fields, name: identity.name, versionLabel: "1.1.0", ...(nextUpload.packageFormatVersion === 1 ? { platforms: ["windows-amd64"] } : {}) }));
  await work(db => c.reviewClient(db, reviewer, identity.clientId, next.draftId, { packageRevision: 1, decision: "approve", note: "Real PCL delta", contentRevision: 1 }));
  await runPackageWorker(workerClient, neverResolve);
  const nextBuild = await client.packageBuild.findFirstOrThrow({ where: { draftId: next.draftId, required: true } }); assert.equal(nextBuild.status, "READY", nextBuild.error ?? "real PCL delta failed");
  const nextArtifacts = packageArtifactsSchema.parse(nextBuild.artifacts); assert(nextArtifacts.update); assert.equal(nextArtifacts.update.baseReleaseId, published.releaseId);
  const updateBytes = await readObject(nextArtifacts.update.key); assert.equal(digest(updateBytes), nextArtifacts.update.sha256);
  const updatePath = join(temp, "real-pcl-delta-v2.muapack"); await writeFile(updatePath, updateBytes);
  const delta = await validateRecipePackArchive(updatePath, createPublicKey((await signingIdentity()).privateKey)); assert.equal(delta.objectCount, 0); assert.equal(delta.payloadSize, 0);
  await work(db => c.publishClient(db, root, identity.clientId, next.draftId, { contentRevision: 1, packageRevision: 1, activate: false }));
  const deltaReport = { ...report, updateSize: nextArtifacts.update.size, updateSha256: nextArtifacts.update.sha256, updatePayloads: delta.objectCount,
    baseVersion: delta.metadata.base?.version, targetVersion: delta.metadata.target.version };
  console.log(JSON.stringify(deltaReport)); await writeFile(".local/real-pcl-v2-delta-report.json", JSON.stringify(deltaReport, null, 2));
});

test("real HMCL mrpack downloads and verifies declared mods in an isolated Worker and MinIO pipeline", { skip: !process.env.MUA_REAL_MRPACK, timeout: 120000 }, async () => {
  const source = await readFile(process.env.MUA_REAL_MRPACK!); const org = (await client.client.findUniqueOrThrow({ where: { id: fixtureClientId("NPA") } })).organizationId;
  const identity = await work(db => c.createClient(db, admin, { organizationId: org, name: "Real HMCL import" }));
  const upload = await prepare(source, admin, identity.clientId, true, "test_modrinthFormat.mrpack");
  assert.equal(upload.status, "READY", upload.error ?? "upload failed"); assert.equal(upload.detectedInfo?.minecraftVersion, "26.1");
  assert.equal(upload.detectedInfo?.javaVersion, 25); assert.equal(upload.detectedInfo?.loaderVersion, "0.19.5");
  const remote = upload.detectedInfo?.importFiles?.filter(file => file.source === "remote"); assert.equal(remote?.length, 1);
  assert.equal(remote![0].status, "VERIFIED"); assert.equal(remote![0].downloadedBytes, 2521340);
  const saved = await client.clientUpload.findUniqueOrThrow({ where: { id: upload.id } }); const inventory = await c.readInventory(saved.filesObjectKey!, saved.filesSha256!);
  const mod = inventory.files.find(file => file.path === remote![0].path)!; assert.equal(mod.size, 2521340);
  assert.equal(digest(await readObject(casKey(mod.sha256), casBucket())), mod.sha256);
  console.log(JSON.stringify({ sample: "HMCL mrpack", minecraft: upload.detectedInfo?.minecraftVersion, java: upload.detectedInfo?.javaVersion,
    mods: upload.detectedMods.length, files: inventory.files.length, remoteBytes: remote![0].downloadedBytes, casSha256: mod.sha256 }));
});
