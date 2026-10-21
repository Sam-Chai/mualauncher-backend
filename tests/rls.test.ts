import { fixtureClientId } from "./fixtures/identity";
import "dotenv/config";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import type { Actor, Db } from "../src/lib/auth";
import { actorFromToken, tokenDigest, login } from "../src/lib/auth";
import { setDatabaseActor, securityFunction } from "../src/lib/database-security";
import { rolePermissions } from "../src/lib/roles";
import { hashPassword } from "../src/lib/password";
import * as m from "../src/lib/management";
import * as c from "../src/lib/client-service";
import { validateDatabase, disconnectDatabases } from "../src/lib/prisma";
import { performance } from "node:perf_hooks";
import { storageTelemetry, collectStorageTelemetry } from "../src/lib/storage-telemetry";
import { telemetryConfiguration } from "../src/lib/object-storage/telemetry";

const schema = `mua_rls_${randomBytes(8).toString("hex")}`;
process.env.DATABASE_SCHEMA = schema;
const url = new URL(process.env.DATABASE_MIGRATION_URL!); url.searchParams.delete("options");
const ownerPool = new pg.Pool({ connectionString: url.toString(), options: `-c role=mua_owner -c search_path=${schema},pg_catalog` });
const owner = new PrismaClient({ adapter: new PrismaPg(ownerPool, { schema }) });
function runtime(key: string) { return new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env[key], options: `-c search_path=${schema},pg_catalog`, max: 1, pipeline: true }, { schema }) }); }
const web = runtime("DATABASE_URL"), auth = runtime("DATABASE_AUTH_URL"), worker = runtime("DATABASE_WORKER_URL"), pub = runtime("DATABASE_PUBLIC_URL");
let f: Awaited<ReturnType<typeof fixture>>;
let created = false;
async function fixture() {
  return owner.$transaction(async db => {
    const root = await db.account.create({ data: { displayName: "root", isSuperAdmin: true } });
    const admin = await db.account.create({ data: { displayName: "org admin" } });
    const single = await db.account.create({ data: { displayName: "single server admin" } });
    const reader = await db.account.create({ data: { displayName: "reader" } });
    const reviewer = await db.account.create({ data: { displayName: "reviewer" } });
    const publisher = await db.account.create({ data: { displayName: "publisher" } });
    const operator = await db.account.create({ data: { displayName: "operator" } });
    const org = await m.createOrganization(db, root, { displayName: "Alpha" });
    const other = await m.createOrganization(db, root, { displayName: "Beta" });
    for (const [serverId, organizationId] of [["AAA", org.id], ["AAB", org.id], ["BBB", other.id]]) {
      await m.createServer(db, root, { serverId, organizationId, displayName: serverId });
      await db.client.create({ data: { id: fixtureClientId(serverId), organizationId, name: serverId, nameKey: serverId.toLowerCase(), scopeServerId: serverId } });
      await db.serverPublication.update({ where: { serverId }, data: { clientId: fixtureClientId(serverId) } });
      await db.clientDraft.create({ data: { clientId: fixtureClientId(serverId), createdById: root.id } });
    }
    await db.client.create({ data: { id: fixtureClientId("pending"), organizationId: org.id, name: "pending", nameKey: "pending", scopeServerId: "AAB", requestedServerId: "AAA", requestedRevision: 0, expectedClientId: fixtureClientId("AAA") } });
    for (const [account, roles] of [[admin, ["ORG_ADMIN"]], [single, []], [reader, ["READ_ONLY"]], [reviewer, ["REVIEWER"]], [publisher, ["PUBLISHER"]], [operator, ["RELEASE_OPERATOR"]]] as const)
      await m.setMember(db, root, org.id, account.id, { roles, status: "ACTIVE" });
    await m.setGrant(db, root, org.id, single.id, "AAA", { roles: ["SERVER_ADMIN"] });
    const password = "rls-fixture-password";
    await db.localCredential.create({ data: { accountId: admin.id, username: "rls-admin", passwordHash: await hashPassword(password) } });
    const cookie = randomBytes(32).toString("hex");
    await db.session.create({ data: { tokenHash: tokenDigest(cookie), accountId: admin.id, expiresAt: new Date(Date.now() + 60_000) } });
    const token = await db.apiToken.create({ data: { accountId: root.id, name: "restricted root", tokenHash: tokenDigest("mua_rls_test"), permissions: ["SERVER_READ", "DRAFT_READ"], serverIds: ["AAA"], expiresAt: new Date(Date.now() + 60_000) } });
    return { root, admin, single, reader, reviewer, publisher, operator, org, other, password, cookie, token };
  }, { timeout: 15000 });
}
before(async () => {
  await ownerPool.query(`CREATE SCHEMA "${schema}"`); created = true;
  for (const dir of (await readdir("prisma/migrations")).filter(name => /^\d/.test(name)).sort())
    await ownerPool.query((await readFile(`prisma/migrations/${dir}/migration.sql`, "utf8")).replace('CREATE SCHEMA IF NOT EXISTS "public";', ""));
  f = await fixture();
});
after(async () => {
  await Promise.all([owner, web, auth, worker, pub].map(db => db.$disconnect())); await disconnectDatabases();
  if (created) { assert.match(schema, /^mua_rls_[0-9a-f]{16}$/); await ownerPool.query(`DROP SCHEMA "${schema}" CASCADE`); await ownerPool.query(`DROP SCHEMA "${schema}_authz" CASCADE`); }
  await ownerPool.end();
});
async function as<T>(actor: Actor, work: (db: Db) => Promise<T>) { return web.$transaction(async db => { await setDatabaseActor(db, actor); return work(db); }, { timeout: 15000 }); }
async function rejected(db: Db, work: () => Promise<unknown>) {
  await db.$executeRawUnsafe("SAVEPOINT rejection");
  await assert.rejects(work());
  await db.$executeRawUnsafe("ROLLBACK TO SAVEPOINT rejection");
  await db.$executeRawUnsafe("RELEASE SAVEPOINT rejection");
}
test("all runtime roles are restricted and every business table forces RLS", async () => {
  for (const purpose of ["web", "auth", "worker", "public"] as const) await validateDatabase(purpose);
  const mapping = await owner.$queryRawUnsafe<{ role: keyof typeof rolePermissions; permission: string }[]>(`SELECT * FROM "${schema}_authz".role_permission ORDER BY role,permission`);
  assert.deepEqual(mapping.map(row => `${row.role}:${row.permission}`), Object.entries(rolePermissions).flatMap(([role, permissions]) => permissions.map(p => `${role}:${p}`)).sort());
  for (const db of [web, auth, worker, pub]) await assert.rejects(db.$executeRawUnsafe("SET ROLE mua_owner"));
});

test("storage telemetry is Worker-written, superadmin-session-only and excludes cross-midnight traffic", async () => {
  const config = telemetryConfiguration();
  const now = new Date("2026-10-18T02:00:00Z");
  await worker.storageTelemetrySource.create({ data: { id: config.id, provider: config.storage.provider, sampledAt: now,
    snapshot: config.buckets.map(row => ({ ...row, bytes: "1024", objects: "1", observedAt: now.toISOString(), method: "OBJECT_LIST", status: "READY" })) } });
  await worker.storageTelemetrySample.createMany({ data: [
    { id: "00000000-0000-4000-8000-000000000001", sourceId: config.id, startsAt: new Date("2026-10-17T15:59:00Z"), endsAt: new Date("2026-10-17T16:01:00Z"), sentBytes: 999, buckets: [] },
    { id: "00000000-0000-4000-8000-000000000002", sourceId: config.id, startsAt: new Date("2026-10-18T01:00:00Z"), endsAt: new Date("2026-10-18T01:01:00Z"), sentBytes: 2048, buckets: [] },
  ] });
  assert.equal(await web.storageTelemetrySource.count(), 0);
  assert.equal(await as(f.admin, db => db.storageTelemetrySource.count()), 0);
  assert.equal(await as(f.root, db => db.storageTelemetrySource.count()), 1);
  const result = await as(f.root, db => storageTelemetry(db, f.root, now));
  assert.equal(result.traffic.sentBytes, "2048"); assert.equal(result.traffic.receivedBytes, null); assert.equal(result.traffic.hasGaps, true);
  assert.equal(result.capacityBytes, String(config.buckets.length * 1024)); assert.equal(result.cdn, "NOT_CONNECTED");
  await assert.rejects(as(f.admin, db => storageTelemetry(db, f.admin, now)));
  await assert.rejects(as({ ...f.root, apiScope: { permissions: [], serverIds: [] } }, db => storageTelemetry(db, { ...f.root, apiScope: { permissions: [], serverIds: [] } }, now)));
  await assert.rejects(auth.storageTelemetrySource.count()); await assert.rejects(pub.storageTelemetrySource.count());
  await assert.rejects(as(f.root, db => db.storageTelemetrySource.update({ where: { id: config.id }, data: { error: "forbidden" } })));
  const stale = await as(f.root, db => storageTelemetry(db, f.root, new Date(now.getTime() + 86400_000)));
  assert.equal(stale.status, "STALE"); assert.equal(stale.traffic.sentBytes, null); assert.equal(stale.capacityBytes, result.capacityBytes);
});

test("organization skin-site addresses are projected only within the live organization scope", async () => {
  await owner.unionSkinSite.createMany({data:[
    {code:"ALPHA",organizationId:f.org.id,bsRoot:"https://alpha.example"},
    {code:"BETA",organizationId:f.other.id,bsRoot:"https://beta.example"},
    {code:"OFF",organizationId:f.org.id,bsRoot:"https://disabled.example",enabled:false},
  ]});
  assert.equal(await web.unionSkinSite.count(),0);
  for(const actor of [f.admin,f.single,f.reader]) await as(actor,async db=>{
    const state=await m.getState(db,actor);const org=state.organizations.find(org=>org.id===f.org.id);assert(org);
    assert.deepEqual(org.skinSites,[{code:"ALPHA",url:"https://alpha.example"}]);
    const sites=await db.unionSkinSite.findMany();assert(sites.length);assert(sites.every(site=>site.organizationId===f.org.id));
    assert(!state.organizations.some(org=>org.id===f.other.id));
  });
  const all=await as(f.root,db=>m.getState(db,f.root));assert.deepEqual(all.organizations.find(org=>org.id===f.other.id)?.skinSites,[{code:"BETA",url:"https://beta.example"}]);
});

test("concurrent storage collectors share a lease and publish an actual capacity snapshot", async () => {
  const config = telemetryConfiguration();
  await worker.storageTelemetrySource.update({ where: { id: config.id }, data: { nextCollectAt: new Date(0) } });
  const attempts = await Promise.all([collectStorageTelemetry(worker), collectStorageTelemetry(worker)]);
  assert.equal(attempts.filter(Boolean).length, 1);
  const source = await worker.storageTelemetrySource.findUniqueOrThrow({ where: { id: config.id } });
  assert.equal(source.leaseToken, null); assert(source.sampledAt);
  const data = await as(f.root, db => storageTelemetry(db, f.root));
  assert.equal(data.status, "READY"); assert(data.capacityBytes !== null); assert(BigInt(data.capacityBytes) >= BigInt(0));
});

test("scoped SERVER_EDIT changes color and schedules in application and RLS writes; readers and other scopes are denied", async () => {
  const schedule = { displayMode: "RANGE", displayStartsAt: "2026-01-01T00:00:00Z", displayEndsAt: "2026-01-02T00:00:00Z" };
  const editor = await owner.$transaction(async db => {
    const actor = await db.account.create({ data: { displayName: "server editor" } });
    await m.setMember(db, f.root, f.org.id, actor.id, { roles: [], status: "ACTIVE" });
    await m.setGrant(db, f.root, f.org.id, actor.id, "AAA", { roles: ["SERVER_EDITOR"] });
    return actor;
  });
  for (const actor of [f.admin, f.single, editor]) await as(actor, async db => {
    await m.updateServer(db, actor, "AAA", { displayMode: "PERMANENT", themeColor: "#123456" });
    await m.updateServer(db, actor, "AAA", schedule);
    await db.server.update({ where: { serverId: "AAA" }, data: { displayMode: "PERMANENT", displayStartsAt: null, displayEndsAt: null } });
    await db.server.update({ where: { serverId: "AAA" }, data: schedule });
    await assert.rejects(m.updateServer(db, actor, "AAA", { sortOrder: 1 }));
    await assert.rejects(m.updateServer(db, actor, "AAA", { isListed: true }));
    await assert.rejects(m.updateServer(db, actor, "BBB", schedule));
    assert.equal((await db.server.updateMany({ where: { serverId: "BBB" }, data: { themeColor: "#654321" } })).count, 0);
  });
  await as(editor, async db => {
    await assert.rejects(m.updateServer(db, editor, "AAB", schedule));
    assert.equal((await db.server.updateMany({ where: { serverId: "AAB" }, data: { themeColor: "#654321" } })).count, 0);
  });
  await as(f.reader, async db => {
    await assert.rejects(m.updateServer(db, f.reader, "AAA", schedule));
    await rejected(db, () => db.server.update({ where: { serverId: "AAA" }, data: { displayMode: "PERMANENT", displayStartsAt: null, displayEndsAt: null } }));
    await rejected(db, () => db.server.update({ where: { serverId: "AAA" }, data: { themeColor: "#654321" } }));
  });
  assert.equal((await as(f.reader, db => m.getState(db, f.reader))).organizations[0].servers.find(server => server.serverId === "AAA")?.displayMode, "RANGE");
  await as(f.root, db => m.updateServer(db, f.root, "AAA", { displayMode: "PERMANENT" }));
});
test("missing context denies reads and writes; restricted pools reset identity on commit and rollback", async () => {
  assert.equal(await web.server.count(), 0); assert.equal(await web.client.count(), 0);
  await assert.rejects(web.server.create({ data: { serverId: "CCC", organizationId: f.org.id, displayName: "deny" } }));
  assert.equal(await as(f.admin, db => db.server.count()), 2);
  assert.equal(await web.server.count(), 0);
  await assert.rejects(as(f.root, async db => { assert.equal(await db.server.count(), 3); throw new Error("rollback"); }));
  assert.equal(await web.server.count(), 0);
  const counts = await Promise.all([as(f.single, db => db.server.count()), as(f.root, db => db.server.count()), as(f.reader, db => db.server.count())]);
  assert.deepEqual(counts, [1, 3, 2]);
});
test("unfiltered queries isolate organizations, current bindings, fallback scope and pending requests", async () => {
  await as(f.admin, async db => {
    assert.deepEqual((await db.server.findMany()).map(s => s.serverId).sort(), ["AAA", "AAB"]);
    assert.equal(await db.clientDraft.count(), 2);
    assert.equal(await db.server.updateMany({ where: { serverId: "BBB" }, data: { displayName: "forbidden" } }).then(r => r.count), 0);
    await rejected(db, () => db.client.create({ data: { id: fixtureClientId("cross-org"), organizationId: f.other.id, name: "cross", nameKey: "cross" } }));
    const state = await m.getState(db, f.admin); assert.equal(state.organizations.length, 1); assert.equal(state.organizations[0].members.length, 7); // Includes the scoped editor created by the permission regression.
  });
  await as(f.single, async db => { assert.deepEqual((await db.client.findMany()).map(c => c.id), [fixtureClientId("AAA")]); assert.equal(await db.client.findUnique({ where: { id: fixtureClientId("pending") } }), null); });
  await owner.serverPublication.update({ where: { serverId: "AAA" }, data: { clientId: fixtureClientId(null) } });
  assert.equal(await as(f.single, db => db.client.count()), 1);
  await owner.serverPublication.update({ where: { serverId: "AAA" }, data: { clientId: fixtureClientId("AAA") } });
});
test("readers cannot write; reviewers, publishers and operators keep distinct capabilities", async () => {
  for (const actor of [f.reader, f.reviewer, f.publisher, f.operator]) await as(actor, async db => {
    assert.equal(await db.server.count(), 2);
    assert.equal(await db.server.updateMany({ where: { serverId: "AAA" }, data: { description: "deny" } }).then(r => r.count), 0);
    await rejected(db, () => db.client.create({ data: { id: fixtureClientId("deny"), organizationId: f.org.id, name: "deny", nameKey: "deny" } }));
    assert.equal(await db.clientDraft.count(), actor.id === f.operator.id ? 0 : 2);
  });
  await as(f.admin, async db => {
    const added = await c.createClient(db, f.admin, { organizationId: f.org.id, name: "Created via restricted connection" });
    assert(added.clientId);
    await m.updateServer(db, f.admin, "AAA", { description: "allowed" });
  });
});
test("superadmin tokens still intersect live token scope and revoked grants take effect", async () => {
  const actor: Actor = { ...f.root, apiScope: { tokenId: f.token.id, permissions: ["SERVER_READ", "DRAFT_READ"], serverIds: ["AAA"] } };
  await as(actor, async db => {
    assert.equal(await db.server.count(), 1); assert.equal(await db.clientDraft.count(), 1);
    assert.equal(await db.auditEvent.count(), 0);
    assert.equal(await db.platformSettings.count(), 0);
    assert.equal(await db.server.updateMany({ data: { description: "deny" } }).then(r => r.count), 0);
    await rejected(db, () => db.platformSettings.upsert({ where: { id: "platform" }, create: { id: "platform" }, update: { maxUploadSizeMb: 1 } }));
  });
  await owner.apiToken.update({ where: { id: f.token.id }, data: { revokedAt: new Date() } });
  assert.equal(await as(actor, db => db.server.count()), 0);
  await owner.organizationMember.update({ where: { organizationId_accountId: { organizationId: f.org.id, accountId: f.single.id } }, data: { status: "DISABLED" } });
  assert.equal(await as(f.single, db => db.server.count()), 0);
});
test("auth is separate, credentials never readable by web, and password/session operations remain available", async () => {
  await assert.rejects(web.localCredential.count()); await assert.rejects(worker.localCredential.count());
  const authenticated = await web.$transaction(db => actorFromToken(db, f.cookie)); assert.equal(authenticated.id, f.admin.id);
  const result = await login("rls-admin", f.password, undefined, auth); assert(result.token);
  await as(f.root, async db => {
    const account = await m.createAccount(db, f.root, { displayName: "new", username: "new-user", password: "new-password-for-test" }); assert(account.id);
  });
});
test("public can only call projections; worker can process data but cannot publish, edit membership or delete clients", async () => {
  await assert.rejects(pub.server.count()); await assert.rejects(pub.clientDraft.count()); await assert.rejects(pub.localCredential.count());
  await assert.rejects(pub.$queryRaw`SELECT ${securityFunction("distribution_servers")}()`);
  await assert.rejects(pub.$queryRaw`SELECT ${securityFunction("distribution_snapshot")}(\'AAA\',NULL::uuid)`);
  assert.equal(await worker.server.count(), 3);
  await worker.workerHeartbeat.upsert({ where: { id: "rls-worker" }, create: { id: "rls-worker", lastSeen: new Date() }, update: { lastSeen: new Date() } });
  await assert.rejects(worker.organizationMember.updateMany({ data: { status: "DISABLED" } }));
  await assert.rejects(worker.$executeRawUnsafe(`INSERT INTO "${schema}"."ClientRelease"("id") VALUES (gen_random_uuid())`));
  await assert.rejects(worker.client.delete({ where: { id: fixtureClientId("AAA") } }));
  await assert.rejects(worker.client.updateMany({ data: { currentReleaseId: null } }));
});
test("management state RLS performance is measured against the same owner baseline", async () => {
  const times = { baseline: [] as number[], restricted: [] as number[] };
  for (let i = 0; i < 110; i++) {
    for (const key of (i % 2 ? ["restricted", "baseline"] : ["baseline", "restricted"]) as (keyof typeof times)[]) {
      const start = performance.now();
      const db = key === "baseline" ? owner : web;
      const state = await db.$transaction(async tx => { await setDatabaseActor(tx, f.admin); return m.getState(tx, f.admin); });
      assert.equal(state.organizations.length, 1);
      if (i >= 10) times[key].push(performance.now() - start);
    }
  }
  const p95 = (values: number[]) => values.sort((a, b) => a - b)[Math.ceil(values.length * .95) - 1];
  const baseline = p95(times.baseline), restricted = p95(times.restricted);
  console.log(`RLS management state p95: owner=${baseline.toFixed(2)}ms restricted=${restricted.toFixed(2)}ms overhead=${((restricted / baseline - 1) * 100).toFixed(1)}% (100 measured samples)`);
  if (process.env.MUA_RLS_PERF_GATE === "1") assert(restricted <= baseline * 1.2, "RLS p95 overhead must remain within 20%; measure on an idle representative environment");
});
test("restricted archival preserves history and deletion hides the client; self-disable can still audit and revoke sessions", async () => {
  const name = "restricted lifecycle";
  const made = await as(f.admin, db => c.createClient(db, f.admin, { organizationId: f.org.id, name }));
  await as(f.admin, db => c.archiveClient(db, f.admin, made.clientId, { archived: true }));
  await as(f.admin, db => c.deleteClient(db, f.admin, made.clientId));
  assert.equal(await as(f.admin, db => db.client.findUnique({ where: { id: fixtureClientId(made.clientId) } })), null);
  assert((await owner.client.findUniqueOrThrow({ where: { id: fixtureClientId(made.clientId) } })).deletedAt);
  const rollback = new Error("rollback");
  await assert.rejects(as(f.root, async db => {
    await m.createAccount(db, f.root, { displayName: "second root", username: "second-root", password: "testing-second-root-password", isSuperAdmin: true });
    await m.updateAccount(db, f.root, f.root.id, { status: "DISABLED" });
    throw rollback;
  }), error => error === rollback);
  assert.equal((await owner.account.findUniqueOrThrow({ where: { id: f.root.id } })).status, "ACTIVE");
});
