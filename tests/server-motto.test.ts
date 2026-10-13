import "dotenv/config";
import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer as netServer } from "node:net";
import pg from "pg";
import sharp from "sharp";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { CreateBucketCommand, ListObjectsV2Command, DeleteObjectsCommand, DeleteBucketCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { AppError } from "../src/lib/errors";
import { locked, tokenDigest, COOKIE_NAME, type Actor } from "../src/lib/auth";
import { prisma } from "../src/lib/prisma";
import * as m from "../src/lib/management";
import { storageClient, packagesBucket, readObject } from "../src/lib/storage";
import { mottoCrop, validMottoCrop, MAX_MOTTO_UPLOAD_BYTES, SERVER_MOTTO_RATIO } from "../src/lib/server-motto-contract";
import { prepareMottoImage, readServerMotto, saveServerMotto, storeMottoImage } from "../src/lib/server-motto";
import { assertApiRequest, assertApiResponse, contractOperation } from "./openapi-validation";

const suffix = randomBytes(8).toString("hex"), schema = `mua_motto_test_${suffix}`, bucket = `mua-motto-test-${suffix}`;
process.env.DATABASE_SCHEMA = schema;
const migrationUrl = new URL(process.env.DATABASE_MIGRATION_URL!); migrationUrl.searchParams.delete("options");
process.env.DATABASE_MIGRATION_URL = migrationUrl.toString();
process.env.S3_PACKAGES_BUCKET = bucket;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_MIGRATION_URL, options: `-c role=mua_owner -c search_path=${schema},pg_catalog`, pipeline: true });
const client = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) });
let created = false, bucketCreated = false;
let root: Actor, editor: Actor, reader: Actor, other: Actor, organizationId: string, bytes: Buffer;
const denied = (status: number) => (error: unknown) => error instanceof AppError && error.status === status;

before(async () => {
  await pool.query(`CREATE SCHEMA "${schema}"`); created = true;
  for (const migration of (await readdir("prisma/migrations")).filter(name => /^\d{12}_/.test(name)).sort()) {
    const sql = (await readFile(`prisma/migrations/${migration}/migration.sql`, "utf8")).replace('CREATE SCHEMA IF NOT EXISTS "public";', "");
    await pool.query(sql);
  }
  await storageClient().send(new CreateBucketCommand({ Bucket: bucket })); bucketCreated = true;
  root = await client.account.create({ data: { displayName: "root", isSuperAdmin: true } });
  editor = await client.account.create({ data: { displayName: "editor" } });
  reader = await client.account.create({ data: { displayName: "reader" } });
  other = await client.account.create({ data: { displayName: "other organization editor" } });
  await locked(async db => {
    const org = await m.createOrganization(db, root, { displayName: "Motto test" }); organizationId = org.id;
    const foreign = await m.createOrganization(db, root, { displayName: "Foreign test" });
    await m.createServer(db, root, { organizationId, serverId: "NPA", displayName: "Alpha" });
    await m.createServer(db, root, { organizationId, serverId: "NPB", displayName: "Beta" });
    await m.createServer(db, root, { organizationId: foreign.id, serverId: "OTH", displayName: "Foreign" });
    await m.setMember(db, root, organizationId, editor.id, { roles: [], status: "ACTIVE" });
    await m.setGrant(db, root, organizationId, editor.id, "NPA", { roles: ["SERVER_EDITOR"] });
    await m.setMember(db, root, organizationId, reader.id, { roles: ["READ_ONLY"], status: "ACTIVE" });
    await m.setMember(db, root, foreign.id, other.id, { roles: ["ORG_ADMIN"], status: "ACTIVE" });
  }, client);
  bytes = await sharp({ create: { width: 610, height: 400, channels: 4, background: { r: 50, g: 150, b: 210, alpha: 1 } } }).png().toBuffer();
});
after(async () => {
  await client.$disconnect();
  if (created) { assert.match(schema, /^mua_motto_test_[a-f0-9]{16}$/); const cleanup = new pg.Pool({ connectionString: process.env.DATABASE_MIGRATION_URL, options: "-c role=mua_owner" }); await cleanup.query(`DROP SCHEMA "${schema}" CASCADE`); await cleanup.query(`DROP SCHEMA IF EXISTS "${schema}_authz" CASCADE`); await cleanup.end(); }
  await pool.end(); await prisma.$disconnect();
  if (bucketCreated) {
    assert.match(bucket, /^mua-motto-test-[a-f0-9]{16}$/);
    const objects = await storageClient().send(new ListObjectsV2Command({ Bucket: bucket }));
    assert(!objects.IsTruncated);
    if (objects.Contents?.length) await storageClient().send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objects.Contents.map(object => ({ Key: object.Key! })) } }));
    await storageClient().send(new DeleteBucketCommand({ Bucket: bucket }));
  }
});

test("default and resized selections retain the reference ratio and stay inside varied source shapes", () => {
  for (const [width, height] of [[366, 138], [1000, 1000], [200, 800], [1600, 200]]) {
    for (const scale of [0.1, 0.5, 1]) {
      const crop = mottoCrop(width, height, scale, { x: 0.95, y: 0.05 });
      assert(validMottoCrop(crop, width, height));
      assert(Math.abs(crop.width * width / (crop.height * height) - SERVER_MOTTO_RATIO) < 1e-8);
    }
  }
});

test("server decodes and crops images, strips metadata and rejects invalid content or selections", async () => {
  const prepared = await prepareMottoImage(bytes, mottoCrop(610, 400));
  const output = await sharp(prepared.image).metadata();
  assert.equal(output.width, 1220); assert.equal(output.height, 460); assert.equal(output.format, "webp");
  assert.equal((await sharp(prepared.source).metadata()).exif, undefined);
  const oriented = await sharp(bytes).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const rotated = await prepareMottoImage(oriented, mottoCrop(400, 610));
  assert.equal(rotated.metadata.width, 400); assert.equal(rotated.metadata.height, 610);
  await assert.rejects(prepareMottoImage(Buffer.from("not an image"), mottoCrop(610, 400)), denied(422));
  await assert.rejects(prepareMottoImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="610" height="400"></svg>'), mottoCrop(610, 400)), denied(415));
  await assert.rejects(prepareMottoImage(Buffer.alloc(MAX_MOTTO_UPLOAD_BYTES + 1), mottoCrop(610, 400)), denied(413));
  await assert.rejects(prepareMottoImage(bytes, { left: 0, top: 0, width: 1, height: 1 }), denied(400));
  await assert.rejects(prepareMottoImage(bytes, { ...mottoCrop(610, 400), left: 0.9 }), denied(400));
});

test("private storage retains source and crop; scoped save and re-crop enforce revision and resource guards", async () => {
  const stored = await storeMottoImage(organizationId, "NPA", await prepareMottoImage(bytes, mottoCrop(610, 400)));
  await locked(db => saveServerMotto(db, editor, "NPA", null, stored), client);
  const head = await storageClient().send(new HeadObjectCommand({ Bucket: packagesBucket(), Key: stored.key })); assert.equal(head.ContentType, "image/webp");
  const source = await readServerMotto(stored.key, organizationId, "NPA", "source");
  assert(source.bytes); assert.deepEqual(source.metadata.crop, mottoCrop(610, 400));
  const recropped = await storeMottoImage(organizationId, "NPA", await prepareMottoImage(source.bytes, mottoCrop(610, 400, 0.5), true));
  await assert.rejects(locked(db => saveServerMotto(db, reader, "NPA", stored.key, recropped), client), denied(403));
  await assert.rejects(locked(db => saveServerMotto(db, other, "NPA", stored.key, recropped), client), denied(404));
  await assert.rejects(locked(db => saveServerMotto(db, editor, "NPB", null, recropped), client), denied(404));
  await assert.rejects(locked(db => saveServerMotto(db, root, "NPB", null, recropped), client), denied(400));
  await assert.rejects(locked(db => saveServerMotto(db, editor, "NPA", null, recropped), client), denied(409));
  await locked(db => saveServerMotto(db, editor, "NPA", stored.key, recropped), client);
  await assert.rejects(locked(db => m.updateServer(db, root, "NPB", { iconObjectKey: recropped.key }), client), denied(400));
  await assert.rejects(locked(db => m.updateServer(db, editor, "NPA", { iconObjectKey: null }), client), denied(400));
  const state = await m.getState(client, reader), server = state.organizations[0].servers.find(server => server.serverId === "NPA")!;
  assert(server.mottoImageUrl?.startsWith("/api/admin/servers/NPA/motto-image?version="));
  await locked(db => m.archiveResource(db, root, "servers", "NPA", { archived: true }), client);
  await assert.rejects(locked(db => saveServerMotto(db, editor, "NPA", recropped.key, stored), client), denied(409));
  await locked(db => m.archiveResource(db, root, "servers", "NPA", { archived: false }), client);
  await locked(db => saveServerMotto(db, editor, "NPA", recropped.key, null), client);
  assert.equal((await client.server.findUniqueOrThrow({ where: { serverId: "NPA" } })).iconObjectKey, null);
  assert((await readObject(stored.key)).length > 0, "retired original versions remain intact");
});

test("actual multipart HTTP upload, authenticated image reads, re-crop and removal preserve scope and origin checks", async () => {
  const port = await new Promise<number>(resolve => { const probe = netServer(); probe.listen(0, "127.0.0.1", () => { const address = probe.address(); assert(address && typeof address !== "string"); probe.close(() => resolve(address.port)); }); });
  const origin = `http://127.0.0.1:${port}`;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const response = await globalThis.fetch(input, init), url = String(input), method = init?.method ?? "GET";
    if (url.startsWith(origin + "/api/")) {
      if (response.headers.get("content-type")?.includes("application/json")) assertApiResponse(method, url, response.status, await response.clone().json());
      else if (response.ok) {
        const entry = contractOperation(method, url).operation.responses?.[200];
        assert(entry && "content" in entry && entry.content?.["image/webp"]);
        assert.equal(response.headers.get("content-type"), "image/webp");
        assert((await response.clone().arrayBuffer()).byteLength > 0);
      }
      if (response.ok && typeof init?.body === "string") assertApiRequest(method, url, JSON.parse(init.body));
    }
    return response;
  };
  const instance = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--port", String(port), "--hostname", "127.0.0.1"], {
    windowsHide: true, stdio: "ignore", env: { ...process.env, APP_ORIGIN: origin, DATABASE_SCHEMA: schema, NEXT_DIST_DIR: ".next/server-motto-test", NEXT_TELEMETRY_DISABLED: "1" },
  });
  const cookies = new Map<string, string>();
  for (const actor of [root, editor, reader, other]) { const token = randomBytes(32).toString("hex"); await client.session.create({ data: { accountId: actor.id, tokenHash: tokenDigest(token), expiresAt: new Date(Date.now() + 600000) } }); cookies.set(actor.id, `${COOKIE_NAME}=${token}`); }
  try {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      try { const response = await fetch(origin + "/api/admin/state", { signal: AbortSignal.timeout(2000) }); if (response.status === 401) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert(ready, "isolated Next instance must start");
    const settingsPath = origin + "/api/admin/upload-size-settings";
    const patchSettings = (actor: Actor, value: unknown, requestOrigin = origin) => fetch(settingsPath, {
      method: "PATCH", headers: { Cookie: cookies.get(actor.id)!, Origin: requestOrigin, "Content-Type": "application/json" }, body: JSON.stringify(value),
    });
    assert.equal((await fetch(settingsPath)).status, 401);
    const defaults = await fetch(settingsPath, { headers: { Cookie: cookies.get(root.id)! } }); assert.equal(defaults.status, 200); assert.deepEqual(await defaults.json(), { maxUploadSizeMb: 1024 });
    assert.equal((await fetch(settingsPath, { headers: { Cookie: cookies.get(reader.id)! } })).status, 403);
    assert.equal((await patchSettings(editor, { maxUploadSizeMb: 1 })).status, 403);
    assert.equal((await patchSettings(root, { maxUploadSizeMb: 1 }, "https://outside.invalid")).status, 403);
    assert.equal((await patchSettings(root, { maxUploadSizeMb: 1.5 })).status, 400);
    assert.equal((await patchSettings(root, { maxUploadSizeMb: 1 })).status, 200);
    const state = await fetch(origin + "/api/admin/state", { headers: { Cookie: cookies.get(reader.id)! } }); assert.equal(state.status, 200); assert.equal((await state.json()).maxUploadSizeMb, 1);
    const created = await fetch(origin + "/api/v1/clients", { method: "POST", headers: { Cookie: cookies.get(root.id)!, Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ organizationId, name: "HTTP upload size" }) });
    assert.equal(created.status, 201, await created.clone().text()); const identity = await created.json();
    for (const packageFormatVersion of [1, 2]) {
      const oversized = await fetch(origin + "/api/v1/clients/uploads", { method: "POST", headers: { Cookie: cookies.get(root.id)!, Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: identity.clientId, fileName: "source.zip", size: 1024 * 1024 + 1, baseReleaseId: null, basePublicationRevision: 0, packageFormatVersion }) });
      assert.equal(oversized.status, 413); assert((await oversized.text()).includes("1 MB"));
    }
    assert.equal((await patchSettings(root, { maxUploadSizeMb: 1024 })).status, 200);
    const path = origin + "/api/admin/servers/NPA/motto-image";
    const send = (actor: Actor, expectedKey: string | null, source = true, requestOrigin = origin) => {
      const form = new FormData(); if (source) form.append("source", new File([new Uint8Array(bytes)], "motto.png", { type: "image/png" }));
      form.append("crop", JSON.stringify(mottoCrop(610, 400, source ? 1 : 0.5))); form.append("expectedIconObjectKey", JSON.stringify(expectedKey));
      return fetch(path, { method: "POST", headers: { Cookie: cookies.get(actor.id)!, Origin: requestOrigin }, body: form });
    };
    assert.equal((await fetch(path)).status, 401);
    assert.equal((await send(reader, null)).status, 403);
    assert.equal((await send(other, null)).status, 404);
    assert.equal((await send(editor, null, true, "https://outside.invalid")).status, 403);
    const uploaded = await send(editor, null); assert.equal(uploaded.status, 200, await uploaded.text());
    const firstKey = (await client.server.findUniqueOrThrow({ where: { serverId: "NPA" } })).iconObjectKey!;
    assert.equal((await fetch(path + "?variant=metadata", { headers: { Cookie: cookies.get(reader.id)! } })).status, 200);
    const image = await fetch(path, { headers: { Cookie: cookies.get(reader.id)! } }); assert.equal(image.status, 200); assert.equal(image.headers.get("content-type"), "image/webp");
    const info = await sharp(Buffer.from(await image.arrayBuffer())).metadata(); assert.equal(info.width! / info.height!, SERVER_MOTTO_RATIO);
    assert.equal((await fetch(path, { headers: { Cookie: cookies.get(other.id)! } })).status, 404);
    assert.equal((await send(editor, firstKey, false)).status, 200);
    assert.equal((await send(editor, firstKey, false)).status, 409);
    const currentKey = (await client.server.findUniqueOrThrow({ where: { serverId: "NPA" } })).iconObjectKey;
    assert.equal((await fetch(path, { method: "DELETE", headers: { Cookie: cookies.get(editor.id)!, Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ expectedIconObjectKey: currentKey }) })).status, 200);
    assert.equal((await fetch(path, { headers: { Cookie: cookies.get(reader.id)! } })).status, 404);
    const probePath = origin + "/api/admin/servers/NPA/probe";
    assert.equal((await fetch(probePath)).status, 401);
    assert.equal((await fetch(probePath, { headers: { Cookie: cookies.get(other.id)! } })).status, 404);
    const unset = await fetch(probePath + "?address=8.8.8.8", { headers: { Cookie: cookies.get(reader.id)! } });
    assert.equal(unset.status, 200); assert.equal((await unset.json()).state, "UNKNOWN", "only stored addresses may be probed");
    await client.server.update({ where: { serverId: "NPA" }, data: { gameAddress: "127.0.0.1:25565" } });
    const blocked = await fetch(probePath, { headers: { Cookie: cookies.get(reader.id)! } });
    assert.equal(blocked.status, 200); const blockedData = await blocked.json(); assert.equal(blockedData.state, "OFFLINE"); assert(blockedData.message.includes("公网地址"));
    assert.equal((await fetch(origin + "/api/admin/servers/NPB/probe", { headers: { Cookie: cookies.get(editor.id)! } })).status, 404);
    await locked(db => m.archiveResource(db, root, "servers", "NPA", { archived: true }), client);
    const archived = await fetch(probePath, { headers: { Cookie: cookies.get(reader.id)! } });
    assert.equal(archived.status, 200); const archivedData = await archived.json(); assert.equal(archivedData.state, "UNKNOWN"); assert(archivedData.message.includes("已归档"));
    await locked(db => m.setMember(db, root, organizationId, reader.id, { roles: [], status: "ACTIVE" }), client);
    assert.equal((await fetch(probePath, { headers: { Cookie: cookies.get(reader.id)! } })).status, 404);
    // Exercise administrative and authentication contracts against this disposable schema.
    const panelHeaders = { Cookie: cookies.get(root.id)!, Origin: origin, "Content-Type": "application/json" };
    const adminWrite = async (method: string, path: string, body: unknown, status = 200) => {
      const response = await fetch(origin + path, { method, headers: panelHeaders, body: JSON.stringify(body) });
      assert.equal(response.status, status, await response.clone().text()); return response.json();
    };
    const org = await adminWrite("POST", "/api/admin/organizations", { displayName: "Contract organization" }, 201);
    await adminWrite("PATCH", `/api/admin/organizations/${org.id}`, { description: "Contract description" });
    await adminWrite("POST", "/api/admin/servers", { organizationId: org.id, serverId: "API", displayName: "Contract server" }, 201);
    await adminWrite("PATCH", "/api/admin/servers/API", { gameAddress: "example.invalid:25565", isListed: false, displayMode: "PERMANENT" });
    const password = "contract-original-password", nextPassword = "contract-changed-password", username = "contract-user";
    const account = await adminWrite("POST", "/api/admin/accounts", { displayName: "Contract user", username, password }, 201);
    await adminWrite("PATCH", `/api/admin/accounts/${account.id}`, { displayName: "Contract updated" });
    await adminWrite("PUT", `/api/admin/organizations/${org.id}/members/${account.id}`, { roles: ["READ_ONLY"], status: "ACTIVE" });
    await adminWrite("PUT", `/api/admin/organizations/${org.id}/members/${account.id}/servers/API`, { roles: ["SERVER_EDITOR"] });
    for (const path of [`/api/admin/organizations/${org.id}/account-search?q=contract`, "/api/admin/servers/API/clients", "/api/admin/state", "/api/admin/pipeline"]) {
      assert.equal((await fetch(origin + path, { headers: panelHeaders })).status, 200);
    }
    const token = await adminWrite("POST", "/api/admin/tokens", { name: "Contract token", serverIds: ["API"], permissions: ["SERVER_READ", "DRAFT_READ"], expiresInDays: 1 }, 201);
    assert.equal((await fetch(origin + "/api/admin/tokens", { headers: panelHeaders })).status, 200);
    assert.equal((await fetch(origin + "/api/admin/state", { headers: { Authorization: "Bearer " + token.token } })).status, 401);
    await adminWrite("POST", `/api/admin/tokens/${token.id}/revoke`, {});
    const auth = (action: string, body: unknown, cookie?: string, requestOrigin = origin) => fetch(origin + `/api/auth/${action}`, {
      method: "POST", headers: { Origin: requestOrigin, "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body),
    });
    assert.equal((await auth("login", { username, password }, undefined, "https://outside.invalid")).status, 403);
    const loggedIn = await auth("login", { username, password }); assert.equal(loggedIn.status, 200);
    const session = loggedIn.headers.get("set-cookie")!.split(";")[0];
    assert.match(loggedIn.headers.get("set-cookie")!, /HttpOnly/i); assert.match(loggedIn.headers.get("set-cookie")!, /SameSite=strict/i);
    assert.equal((await fetch(origin + "/api/admin/state", { headers: { Cookie: session } })).status, 200);
    const changedPassword = await auth("password", { currentPassword: password, newPassword: nextPassword }, session);
    assert.equal(changedPassword.status, 200); assert.match(changedPassword.headers.get("set-cookie")!, /Max-Age=0/i);
    assert.equal((await fetch(origin + "/api/admin/state", { headers: { Cookie: session } })).status, 401);
    assert.equal((await auth("login", { username, password })).status, 401);
    const relogin = await auth("login", { username, password: nextPassword }); assert.equal(relogin.status, 200);
    const nextSession = relogin.headers.get("set-cookie")!.split(";")[0];
    assert.equal((await auth("logout", {}, nextSession)).status, 200);
    assert.equal((await fetch(origin + "/api/admin/state", { headers: { Cookie: nextSession } })).status, 401);
  } finally { await stop(instance); }
});

async function stop(instance: ChildProcess) {
  if (!instance.pid) return;
  if (process.platform === "win32") await new Promise<void>(resolve => { const cleanup = spawn("C:\\Windows\\System32\\taskkill.exe", ["/PID", String(instance.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); cleanup.on("exit", () => resolve()); cleanup.on("error", () => resolve()); });
  else instance.kill("SIGTERM");
}
