import "dotenv/config";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { actorFromToken, locked, login, tokenDigest, type Actor, type Db } from "../src/lib/auth";
import { prisma } from "../src/lib/prisma";
import { AppError } from "../src/lib/errors";
import { hashPassword, verifyPassword } from "../src/lib/password";
import { requireServer, expandRoles } from "../src/lib/rbac";
import { sameOrigin } from "../src/lib/http";
import { publishedServers } from "../src/lib/catalog";
import * as m from "../src/lib/management";
import * as c from "../src/lib/client-service";
import { requireClient } from "../src/lib/rbac";
import { roleLabel } from "../src/components/admin/role-label";
import { visibleNavigation, visiblePaths } from "../src/components/admin/navigation-access";

const schema = `mua_test_${randomBytes(8).toString("hex")}`;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema},pg_catalog`, pipeline: true });
const client = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) });
let created = false;
let passwordHash: string;
const rollback = new Error("test rollback");

test("pipelined Prisma transactions preserve dependency order, abort and rollback after query failure", async () => {
  const id = randomUUID();
  await assert.rejects(client.$transaction(async db => {
    await db.account.create({ data: { id, displayName: "pipeline rollback test" } });
    const account = await db.account.findUniqueOrThrow({ where: { id } });
    assert.equal(account.displayName, "pipeline rollback test");
    const results = await Promise.allSettled([
      db.$queryRaw`SELECT 1 AS value`,
      db.$queryRaw`SELECT 1 / 0 AS value`,
      db.$queryRaw`SELECT 2 AS value`,
    ]);
    assert.equal(results[0].status, "fulfilled");
    assert.equal(results[1].status, "rejected");
    // Prisma may dispatch independent reads in a different order than the array.
    // After the failure is observed, a dependent query must see the aborted transaction.
    await assert.rejects(db.$queryRaw`SELECT 3 AS value`);
    throw rollback;
  }), error => error === rollback);
  assert.equal(await client.account.findUnique({ where: { id } }), null);
  assert.deepEqual(await client.$queryRaw`SELECT 2 AS value`, [{ value: 2 }]);
});

before(async () => {
  assert.match(schema, /^mua_test_[0-9a-f]{16}$/);
  await pool.query(`CREATE SCHEMA "${schema}"`); created = true;
  for (const migration of ["202610080001_initial", "202610080002_invariants", "202610080003_client_uploads", "202610080004_upload_integrity", "202610090001_independent_clients", "202610090002_client_inspection", "202610090003_client_recycle", "202610090004_muapack_builds", "202610090005_modrinth_import", "202610090006_environment_mirrors", "202610100001_draft_lifecycle", "202610100002_archived_client_deletion", "202610100003_package_format_choice", "202610100004_v2_recipe_import", "202610100005_v2_recipe_packages", "202610110001_package_format_settings", "202610120001_upload_size_settings"]) {
    const sql = (await readFile(`prisma/migrations/${migration}/migration.sql`, "utf8")).replace('CREATE SCHEMA IF NOT EXISTS "public";', "");
    await pool.query(sql);
  }
  passwordHash = await hashPassword("testing-password-2026");
});
after(async () => {
  await client.$disconnect();
  if (created) {
    // Only the random schema created by this test run is removed.
    assert.match(schema, /^mua_test_[0-9a-f]{16}$/);
    const cleanup = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    await cleanup.query(`DROP SCHEMA "${schema}" CASCADE`); await cleanup.end();
  }
  await pool.end(); await prisma.$disconnect();
});

async function isolated(work: (db: Db) => Promise<void>) {
  await assert.rejects(client.$transaction(async db => { await work(db); throw rollback; }, { timeout: 15000 }), error => error === rollback);
}
const denied = (status: number) => (error: unknown) => error instanceof AppError && error.status === status;
async function sqlDenied(db: Db, work: () => Promise<unknown>) {
  await db.$executeRawUnsafe("SAVEPOINT expected_failure");
  let failure = false;
  try { await work(); } catch { failure = true; }
  await db.$executeRawUnsafe("ROLLBACK TO SAVEPOINT expected_failure");
  await db.$executeRawUnsafe("RELEASE SAVEPOINT expected_failure");
  assert.equal(failure, true, "database must reject this mutation");
}

async function fixture(db: Db) {
  const root = await db.account.create({ data: { displayName: "root", isSuperAdmin: true } });
  const admin = await db.account.create({ data: { displayName: "NPU admin" } });
  const beta = await db.account.create({ data: { displayName: "Beta maintainer" } });
  const reviewer = await db.account.create({ data: { displayName: "reviewer" } });
  const ordinary = await db.account.create({ data: { displayName: "new member" } });
  const org = await m.createOrganization(db, root, { displayName: "NPU" });
  const other = await m.createOrganization(db, root, { displayName: "Other university" });
  await m.createServer(db, root, { organizationId: org.id, serverId: "NPR", displayName: "NPU RELEASE" });
  await m.createServer(db, root, { organizationId: org.id, serverId: "NPB", displayName: "NPU BETA" });
  await m.createServer(db, root, { organizationId: other.id, serverId: "OTH", displayName: "Other server" });
  for (const server of await db.server.findMany()) {
    await db.client.create({ data: { id: server.serverId, organizationId: server.organizationId, name: server.displayName, nameKey: server.displayName.trim().normalize("NFKC").toLowerCase(), scopeServerId: server.serverId } });
    await db.serverPublication.update({ where: { serverId: server.serverId }, data: { clientId: server.serverId } });
  }
  await m.setMember(db, root, org.id, admin.id, { roles: ["ORG_ADMIN"], status: "ACTIVE" });
  await m.setMember(db, root, org.id, beta.id, { roles: [], status: "ACTIVE" });
  await m.setGrant(db, root, org.id, beta.id, "NPB", { roles: ["SERVER_ADMIN"] });
  await m.setMember(db, root, org.id, reviewer.id, { roles: ["REVIEWER"], status: "ACTIVE" });
  return { root, admin, beta, reviewer, ordinary, org, other };
}

test("passwords are salted, verifiable, and wrong credentials fail", async () => {
  assert.equal(await verifyPassword("testing-password-2026", passwordHash), true);
  assert.equal(await verifyPassword("wrong-password", passwordHash), false);
  assert.notEqual(await hashPassword("testing-password-2026"), passwordHash);
  assert(!passwordHash.includes("testing-password"));
});

test("RBAC isolates organizations and single servers; new servers inherit organization roles", () => isolated(async db => {
  const f = await fixture(db);
  await requireServer(db, f.admin, "NPR", "SERVER_EDIT");
  await requireServer(db, f.admin, "NPB", "DRAFT_CREATE");
  await assert.rejects(requireServer(db, f.admin, "OTH", "SERVER_EDIT"), denied(404));
  await requireServer(db, f.beta, "NPB", "DRAFT_EDIT");
  await assert.rejects(requireServer(db, f.beta, "NPR", "SERVER_READ"), denied(404));
  await m.createServer(db, f.root, { organizationId: f.org.id, serverId: "NPN", displayName: "Future server" });
  await requireServer(db, f.admin, "NPN", "SERVER_EDIT");
  const state = await m.getState(db, f.beta);
  assert.equal(state.organizations.length, 1);
  assert.deepEqual(state.organizations[0].servers.map(server => server.serverId), ["NPB"]);
  assert.equal(state.accounts.length, 0); assert.equal(state.events.length, 0); assert.equal(state.organizations[0].members.length, 0);
  assert.deepEqual(state.auditActivity, []);
  await db.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");
}));

test("sidebar reflects organization, server and platform permissions after grants change", () => isolated(async db => {
  const f = await fixture(db);
  const links = async (actor: Actor) => [...visiblePaths(await m.getState(db, actor))];
  const root = await links(f.root);
  assert.equal(root.length, 17);
  assert(!root.includes("/admin/listings"));
  assert(!root.includes("/admin/servers/status"));
  const admin = await links(f.admin);
  assert(admin.includes("/admin/organizations"));
  assert(admin.includes("/admin/members"));
  assert(admin.includes("/admin/servers"));
  assert(admin.includes("/admin/clients"));
  assert(!admin.includes("/admin/listings"));
  assert(!admin.includes("/admin/releases/review"));
  assert(!admin.includes("/admin/system/audit"));
  const beta = await links(f.beta);
  assert(beta.includes("/admin/servers"));
  assert(beta.includes("/admin/clients"));
  assert(!beta.includes("/admin/organizations"));
  assert(!beta.includes("/admin/members"));
  assert(!beta.includes("/admin/news"));
  const reviewer = await links(f.reviewer);
  assert(reviewer.includes("/admin/releases/review"));
  assert(!reviewer.includes("/admin/clients/artifacts"));
  assert(!reviewer.includes("/admin/clients/runtime"));
  assert.deepEqual(await links(f.ordinary), ["/admin", "/admin/system/settings"]);
  await m.setGrant(db, f.root, f.org.id, f.beta.id, "NPB", { roles: [] });
  const revokedState = await m.getState(db, f.beta);
  assert.deepEqual([...visiblePaths(revokedState)], ["/admin", "/admin/system/settings"]);
  assert.deepEqual(visibleNavigation([
    { title: "服务器", items: [{ href: "/admin/servers" }] },
    { title: "系统", items: [{ href: "/admin/system/audit" }, { href: "/admin/system/settings" }] },
  ], revokedState).map(group => ({ title: group.title, paths: group.items.map(item => item.href) })),
  [{ title: "系统", paths: ["/admin/system/settings"] }]);
}));

test("dashboard audit statistics cover the full window, zero-fill days and stay super-admin only", () => isolated(async db => {
  const f = await fixture(db);
  const today = (await db.$queryRaw<{ today: string }[]>`SELECT to_char(now() AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD') AS today`)[0].today;
  const baseline = await db.auditEvent.count();
  await db.auditEvent.createMany({ data: Array.from({ length: 60 }, (_, index) => ({
    actorId: f.root.id, action: "TEST_EVENT", targetType: "Test", targetId: String(index), details: {},
  })) });
  await db.auditEvent.create({ data: { actorId: f.root.id, action: "OUTSIDE_WINDOW", targetType: "Test", targetId: "old", details: {}, createdAt: new Date(Date.now() - 20 * 86400000) } });
  const state = await m.getState(db, f.root);
  assert.equal(state.events.length, 50);
  assert.equal(state.auditActivity.length, 14);
  assert.equal(state.auditActivity.at(-1)?.date, today);
  assert.equal(state.auditActivity.reduce((sum, point) => sum + point.count, 0), baseline + 60);
  assert.equal(state.auditActivity.slice(0, -1).every(point => point.count === 0), true);
  assert.deepEqual((await m.getState(db, f.admin)).auditActivity, []);
}));

test("review, publishing and activation are independent; field and grant escalation is rejected", () => isolated(async db => {
  const f = await fixture(db);
  assert(expandRoles(["REVIEWER"]).includes("DRAFT_REVIEW"));
  assert(!expandRoles(["REVIEWER"]).includes("RELEASE_PUBLISH"));
  assert(!expandRoles(["ORG_ADMIN"]).includes("RELEASE_ACTIVATE"));
  await assert.rejects(requireServer(db, f.reviewer, "NPB", "DRAFT_EDIT"), denied(403));
  await assert.rejects(m.updateServer(db, f.admin, "NPB", { displayName: "okay", sortOrder: 0 }), denied(403));
  await assert.rejects(m.updateServer(db, f.beta, "NPB", { displayName: "okay", themeColor: "#123456" }), denied(403));
  await assert.rejects(m.updateServer(db, f.admin, "NPB", { displayName: "okay", isListed: true }), denied(403));
  await assert.rejects(m.updateServer(db, f.reviewer, "NPB", { displayName: "okay" }), denied(403));
  await assert.rejects(m.updateServer(db, f.beta, "NPR", { displayName: "okay" }), denied(404));
  await m.updateServer(db, f.root, "NPB", { displayName: "Updated beta", gameAddress: "beta.example.edu:25565", sortOrder: -5, themeColor: "#123456", isListed: true });
  const updated = await db.server.findUniqueOrThrow({ where: { serverId: "NPB" } });
  assert.equal(updated.displayName, "Updated beta"); assert.equal(updated.gameAddress, "beta.example.edu:25565");
  assert.equal(updated.sortOrder, -5); assert.equal(updated.themeColor, "#123456"); assert.equal(updated.isListed, true);
  await assert.rejects(m.updateOrganization(db, f.admin, f.org.id, { isSuperAdmin: true }), denied(400));
  await assert.rejects(m.setMember(db, f.admin, f.org.id, f.ordinary.id, { roles: ["PUBLISHER"], status: "ACTIVE" }), denied(403));
  await assert.rejects(m.setMember(db, f.admin, f.org.id, f.reviewer.id, { roles: [], status: "DISABLED" }), denied(403));
  await assert.rejects(m.setGrant(db, f.root, f.org.id, f.beta.id, "NPB", { roles: ["ORG_ADMIN"] }), denied(400));
  await assert.rejects(m.setGrant(db, f.root, f.org.id, f.beta.id, "OTH", { roles: ["READ_ONLY"] }), denied(404));
  await m.setMember(db, f.admin, f.org.id, f.ordinary.id, { roles: ["READ_ONLY"], status: "ACTIVE" });
  await requireServer(db, f.ordinary, "NPR", "SERVER_READ");
}));

test("membership revocation and account disabling invalidate existing access", () => isolated(async db => {
  const f = await fixture(db);
  const token = "a".repeat(64);
  await db.session.create({ data: { tokenHash: tokenDigest(token), accountId: f.beta.id, expiresAt: new Date(Date.now() + 60000) } });
  await actorFromToken(db, token);
  await m.setMember(db, f.root, f.org.id, f.beta.id, { roles: [], status: "DISABLED" });
  await assert.rejects(requireServer(db, f.beta, "NPB", "SERVER_READ"), denied(404));
  await m.updateAccount(db, f.root, f.beta.id, { status: "DISABLED" });
  assert.equal(await db.session.count({ where: { accountId: f.beta.id } }), 0);
  await assert.rejects(actorFromToken(db, token), denied(401));
  await assert.rejects(m.updateAccount(db, f.root, f.root.id, { isSuperAdmin: false }), denied(409));
}));

test("archive stops distribution, preserves history and does not re-list on restoration", () => isolated(async db => {
  const f = await fixture(db);
  await m.updateServer(db, f.root, "NPR", { isListed: true });
  await m.updateServer(db, f.root, "NPB", { isListed: true });
  await m.archiveResource(db, f.root, "servers", "NPB", { archived: true });
  assert.equal((await db.server.findUniqueOrThrow({ where: { serverId: "NPR" } })).isListed, true);
  assert.equal((await db.server.findUniqueOrThrow({ where: { serverId: "NPB" } })).isListed, false);
  await assert.rejects(m.updateServer(db, f.admin, "NPB", { displayName: "edited" }), denied(409));
  await m.archiveResource(db, f.root, "servers", "NPB", { archived: false });
  assert.equal((await db.server.findUniqueOrThrow({ where: { serverId: "NPB" } })).isListed, false);
  await m.archiveResource(db, f.root, "organizations", f.org.id, { archived: true });
  assert.equal(await db.server.count({ where: { organizationId: f.org.id, isListed: true } }), 0);
  await m.archiveResource(db, f.root, "organizations", f.org.id, { archived: false });
  assert.equal(await db.server.count({ where: { organizationId: f.org.id, isListed: true } }), 0);
  assert.equal(await db.client.count({ where: { organizationId: f.org.id } }), 2);
  assert(await db.auditEvent.count({ where: { action: "ORGANIZATION_ARCHIVE" } }));
}));

test("metadata drafts enforce scope, optimistic revisions and archive locks", () => isolated(async db => {
  const f = await fixture(db);
  const content = { versionLabel: "v1.0", name: "NPU client", description: "intro", changelog: "initial" };
  const draft = await m.saveDraft(db, f.beta, "NPB", content);
  await assert.rejects(m.saveDraft(db, f.beta, "NPR", content), denied(404));
  await assert.rejects(m.saveDraft(db, f.reviewer, "NPB", content, draft.id), denied(403));
  await m.saveDraft(db, f.beta, "NPB", { ...content, name: "updated", contentRevision: 1 }, draft.id);
  await assert.rejects(m.saveDraft(db, f.beta, "NPB", { ...content, contentRevision: 1 }, draft.id), denied(409));
  await assert.rejects(m.saveDraft(db, f.admin, "NPR", { ...content, contentRevision: 2 }, draft.id), denied(404));
  await m.archiveDraft(db, f.beta, "NPB", draft.id, { archived: true });
  await assert.rejects(m.saveDraft(db, f.beta, "NPB", { ...content, contentRevision: 2 }, draft.id), denied(409));
  await m.archiveDraft(db, f.beta, "NPB", draft.id, { archived: false });
  assert.equal((await m.getClients(db, f.beta, "NPB")).drafts.length, 1);
}));

test("database rejects invalid IDs, cross-scope grants, missing clients and hard deletion", () => isolated(async db => {
  const f = await fixture(db);
  await sqlDenied(db, () => db.server.create({ data: { serverId: "BAD1", organizationId: f.org.id, displayName: "invalid" } }));
  await sqlDenied(db, () => db.server.create({ data: { serverId: "npr", organizationId: f.org.id, displayName: "duplicate" } }));
  await sqlDenied(db, () => db.serverGrant.create({ data: { accountId: f.beta.id, serverId: "OTH", organizationId: f.org.id, roles: ["READ_ONLY"], grantedById: f.root.id } }));
  await sqlDenied(db, () => db.serverGrant.update({ where: { accountId_serverId: { accountId: f.beta.id, serverId: "NPB" } }, data: { roles: ["ORG_ADMIN"] } }));
  await sqlDenied(db, () => db.server.update({ where: { serverId: "NPR" }, data: { organizationId: f.other.id } }));
  await sqlDenied(db, () => db.organization.delete({ where: { id: f.other.id } }));
  const event = await db.auditEvent.findFirstOrThrow();
  await sqlDenied(db, () => db.auditEvent.update({ where: { id: event.id }, data: { action: "tampered" } }));
  await sqlDenied(db, async () => { await db.server.create({ data: { serverId: "NEW", organizationId: f.org.id, displayName: "incomplete" } }); await db.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE"); });
}));

async function releaseFixture(db: Db, actor: Actor) {
  const draft = await db.clientDraft.create({ data: { clientId: "NPR", createdById: actor.id, versionLabel: "v1", name: "approved", description: "", changelog: "",
    status: "APPROVED", reviewedById: actor.id, reviewedRevision: 1, reviewedAt: new Date(), candidateManifestKey: "test/manifest", candidateManifestSha256: "a".repeat(64) } });
  const release = await db.clientRelease.create({ data: { clientId: "NPR", sourceDraftId: draft.id, versionLabel: "v1", name: "approved", description: "", changelog: "",
    environmentSnapshot: {}, manifestObjectKey: "test/manifest", manifestSha256: "a".repeat(64), signingKeyId: "test-only", signature: "test-only-not-real",
    approvedById: actor.id, publishedById: actor.id } });
  await db.clientDraft.update({ where: { id: draft.id }, data: { status: "RELEASED" } });
  await db.client.update({ where: { id: "NPR" }, data: { currentReleaseId: release.id } });
  return { draft, release };
}

test("published snapshots are immutable; same-organization servers cannot share a release", () => isolated(async db => {
  const f = await fixture(db); const { draft, release } = await releaseFixture(db, f.root);
  await db.serverPublication.update({ where: { serverId: "NPR" }, data: { releaseId: release.id, revision: { increment: 1 } } });
  await sqlDenied(db, () => db.clientRelease.update({ where: { id: release.id }, data: { name: "tampered" } }));
  await sqlDenied(db, () => db.clientDraft.update({ where: { id: draft.id }, data: { name: "tampered" } }));
  await sqlDenied(db, () => db.serverPublication.update({ where: { serverId: "NPB" }, data: { releaseId: release.id } }));
  await m.archiveResource(db, f.root, "clients", "NPR", { archived: true });
  assert.equal((await db.serverPublication.findUniqueOrThrow({ where: { serverId: "NPR" } })).releaseId, null);
  await sqlDenied(db, () => db.serverPublication.update({ where: { serverId: "NPR" }, data: { releaseId: release.id } }));
  await m.archiveResource(db, f.root, "clients", "NPR", { archived: false });
  assert.equal((await db.serverPublication.findUniqueOrThrow({ where: { serverId: "NPR" } })).releaseId, null);
  assert.equal(await db.clientRelease.count(), 1);
}));

test("public directory exposes only listed, active servers with an active current release", () => isolated(async db => {
  const f = await fixture(db); const { release } = await releaseFixture(db, f.root);
  await m.updateServer(db, f.root, "NPR", { isListed: true, themeColor: "#123456", sortOrder: -10 });
  await m.updateServer(db, f.root, "NPB", { isListed: true });
  assert.deepEqual(await publishedServers(db), []);
  await db.serverPublication.update({ where: { serverId: "NPR" }, data: { releaseId: release.id, revision: { increment: 1 } } });
  const list = await publishedServers(db);
  assert.deepEqual(list.map(server => server.serverId), ["NPR"]);
  assert.equal(list[0].themeColor, "#123456"); assert.equal(list[0].currentRelease?.versionLabel, "v1");
  assert.equal((await m.getState(db, f.root)).organizations.flatMap(org => org.servers).find(server => server.serverId === "NPR")?.currentReleaseActive, true);
  assert(!JSON.stringify(list).includes(f.root.id)); assert(!JSON.stringify(list).includes("signingKeyId"));
  await db.clientRelease.update({ where: { id: release.id }, data: { archivedAt: new Date() } });
  assert.deepEqual(await publishedServers(db), []);
  assert.equal((await m.getState(db, f.root)).organizations.flatMap(org => org.servers).find(server => server.serverId === "NPR")?.currentReleaseActive, false);
  await db.clientRelease.update({ where: { id: release.id }, data: { archivedAt: null } });
  await m.archiveResource(db, f.root, "organizations", f.org.id, { archived: true });
  assert.deepEqual(await publishedServers(db), []);
}));

test("opaque login sessions rotate, store only digests, reject disabled accounts and expire", async () => {
  const account = await client.account.create({ data: { displayName: "login test", credential: { create: { username: "login-test", passwordHash } } } });
  await assert.rejects(login("login-test", "wrong-password", undefined, client), denied(401));
  const first = await login("login-test", "testing-password-2026", undefined, client);
  assert.equal((await actorFromToken(client, first.token)).id, account.id);
  assert.equal((await actorFromToken(client, first.token)).username, "login-test");
  assert.equal(await client.session.count({ where: { tokenHash: first.token } }), 0);
  const second = await login("login-test", "testing-password-2026", first.token, client);
  await assert.rejects(actorFromToken(client, first.token), denied(401));
  await client.session.update({ where: { tokenHash: tokenDigest(second.token) }, data: { expiresAt: new Date(0) } });
  await assert.rejects(actorFromToken(client, second.token), denied(401));
  await client.account.update({ where: { id: account.id }, data: { status: "DISABLED" } });
  await assert.rejects(login("login-test", "testing-password-2026", undefined, client), denied(401));
  await assert.rejects(login("not-in-whitelist", "testing-password-2026", undefined, client), denied(401));
});

test("switching from a MUA superuser to an organization admin changes the authenticated identity", () => isolated(async db => {
  const f = await fixture(db);
  await db.account.update({ where: { id: f.root.id }, data: { displayName: "MUA 管理员" } });
  await db.account.update({ where: { id: f.admin.id }, data: { displayName: "NPU 管理员" } });
  await db.localCredential.createMany({ data: [
    { accountId: f.root.id, username: "test-mua-admin", passwordHash },
    { accountId: f.admin.id, username: "test-npu-admin", passwordHash },
  ] });
  const superSession = "e".repeat(64);
  const npuSession = "f".repeat(64);
  await db.session.createMany({ data: [
    { accountId: f.root.id, tokenHash: tokenDigest(superSession), expiresAt: new Date(Date.now() + 60000) },
    { accountId: f.admin.id, tokenHash: tokenDigest(npuSession), expiresAt: new Date(Date.now() + 60000) },
  ] });
  assert.equal((await actorFromToken(db, superSession)).isSuperAdmin, true);
  await db.session.delete({ where: { tokenHash: tokenDigest(superSession) } });
  await assert.rejects(actorFromToken(db, superSession), denied(401));
  const actor = await actorFromToken(db, npuSession);
  assert.deepEqual({ id: actor.id, displayName: actor.displayName, username: actor.username, isSuperAdmin: actor.isSuperAdmin },
    { id: f.admin.id, displayName: "NPU 管理员", username: "test-npu-admin", isSuperAdmin: false });
  const state = await m.getState(db, actor);
  assert.equal(state.organizations.length, 1);
  assert.equal(state.organizations[0].displayName, "NPU");
  assert.equal(roleLabel(state), "NPU · 组织管理员");
  assert(state.organizations[0].permissions.includes("ORG_EDIT"));
  assert.equal(state.organizations[0].servers.length, 2);
  assert.equal(state.accounts.length, 0);
  assert.equal(state.events.length, 0);
}));

test("login throttling is shared and writes require the configured origin", async () => {
  await client.loginThrottle.upsert({ where: { key: tokenDigest("login:user:blocked") }, create: { key: tokenDigest("login:user:blocked"), attempts: 10, resetAt: new Date(Date.now() + 60000) }, update: {} });
  await assert.rejects(login("blocked", "testing-password-2026", undefined, client), denied(429));
  const prior = process.env.APP_ORIGIN; process.env.APP_ORIGIN = "http://localhost:3000";
  try {
    assert.throws(() => sameOrigin(new Request("http://localhost:3000/api/admin/state", { method: "POST", headers: { origin: "https://untrusted.example" } })), denied(403));
    assert.throws(() => sameOrigin(new Request("http://localhost:3000/api/admin/state", { method: "POST" })), denied(403));
    sameOrigin(new Request("http://localhost:3000/api/admin/state", { method: "POST", headers: { origin: "http://localhost:3000" } }));
  } finally { if (prior === undefined) delete process.env.APP_ORIGIN; else process.env.APP_ORIGIN = prior; }
});

test("concurrent administrator downgrades leave one active administrator", async () => {
  const accounts = await Promise.all(["concurrent-a", "concurrent-b"].map(displayName => client.account.create({ data: { displayName, isSuperAdmin: true } })));
  const tokens = ["c".repeat(64), "d".repeat(64)];
  await client.session.createMany({ data: accounts.map((account, index) => ({ accountId: account.id, tokenHash: tokenDigest(tokens[index]), expiresAt: new Date(Date.now() + 60000) })) });
  const results = await Promise.allSettled(accounts.map((account, index) => locked(async db =>
    m.updateAccount(db, await actorFromToken(db, tokens[index]), account.id, { isSuperAdmin: false }), client)));
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  const rejected = results.find(result => result.status === "rejected") as PromiseRejectedResult;
  assert(denied(409)(rejected.reason));
  assert.equal(await client.account.count({ where: { isSuperAdmin: true, status: "ACTIVE" } }), 1);
});

test("local origins accept same-port loopback aliases but preserve cross-site and production restrictions", () => {
  const prior = process.env.APP_ORIGIN;
  const request = (target: string, origin?: string, site?: string) => new Request(target, { method: "POST", headers: {
    ...(origin ? { origin } : {}), ...(site ? { "sec-fetch-site": site } : {}),
  } });
  try {
    process.env.APP_ORIGIN = "http://localhost:3001";
    sameOrigin(request("http://127.0.0.1:3001/api/auth/login", "http://127.0.0.1:3001", "same-origin"));
    sameOrigin(request("http://localhost:3001/api/auth/login", "http://localhost:3001", "same-origin"));
    sameOrigin(request("http://[::1]:3001/api/auth/login", "http://[::1]:3001", "same-origin"));
    for (const origin of ["http://127.0.0.1:3000", "https://127.0.0.1:3001", "http://evil.example:3001", "null", "http://127.0.0.1:3001/path", undefined]) {
      assert.throws(() => sameOrigin(request("http://127.0.0.1:3001/api/auth/login", origin)), denied(403));
    }
    assert.throws(() => sameOrigin(request("http://127.0.0.1:3000/api/auth/login", "http://127.0.0.1:3001")), denied(403));
    assert.throws(() => sameOrigin(request("http://untrusted.example:3001/api/auth/login", "http://127.0.0.1:3001")), denied(403));
    assert.throws(() => sameOrigin(request("http://127.0.0.1:3001/api/auth/login", "http://127.0.0.1:3001", "cross-site")), denied(403));
    assert.throws(() => sameOrigin(request("http://127.0.0.1:3001/api/auth/login", "http://127.0.0.1:3001", "same-site")), denied(403));
    process.env.APP_ORIGIN = "https://prism.example.edu";
    sameOrigin(request("http://127.0.0.1:3001/api/auth/login", "https://prism.example.edu", "same-origin"));
    assert.throws(() => sameOrigin(request("http://127.0.0.1:3001/api/auth/login", "http://127.0.0.1:3001", "same-origin")), denied(403));
  } finally { if (prior === undefined) delete process.env.APP_ORIGIN; else process.env.APP_ORIGIN = prior; }
});

test("a queued write rechecks permissions after a committed revocation", async () => {
  const root = await client.account.findFirstOrThrow({ where: { isSuperAdmin: true, status: "ACTIVE" } });
  const member = await client.account.create({ data: { displayName: "queued writer" } });
  const org = await locked(db => m.createOrganization(db, root, { displayName: "Concurrency organization" }), client);
  await locked(async db => {
    await m.createServer(db, root, { organizationId: org.id, serverId: "RCE", displayName: "unchanged" });
    await m.setMember(db, root, org.id, member.id, { roles: ["SERVER_EDITOR"], status: "ACTIVE" });
  }, client);
  const token = "e".repeat(64);
  await client.session.create({ data: { accountId: member.id, tokenHash: tokenDigest(token), expiresAt: new Date(Date.now() + 60000) } });
  let acquired!: () => void; let release!: () => void;
  const ready = new Promise<void>(resolve => { acquired = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const revoke = locked(async db => {
    await m.setMember(db, root, org.id, member.id, { roles: [], status: "DISABLED" }); acquired(); await gate;
  }, client);
  await ready;
  const write = locked(async db => m.updateServer(db, await actorFromToken(db, token), "RCE", { displayName: "unauthorized" }), client);
  const check = assert.rejects(write, denied(404));
  release(); await revoke; await check;
  assert.equal((await client.server.findUniqueOrThrow({ where: { serverId: "RCE" } })).displayName, "unchanged");
});

test("independent clients enforce organization names, client scope and confirmed binding changes", () => isolated(async db => {
  const f = await fixture(db);
  const one = await c.createClient(db, f.admin, { organizationId: f.org.id, name: "  NPUcraft  " });
  const two = await c.createClient(db, f.admin, { organizationId: f.org.id, name: "NPU Vanilla" });
  assert.notEqual(one.clientId, two.clientId);
  assert.equal((await db.client.findUniqueOrThrow({ where: { id: one.clientId } })).currentReleaseId, null);
  await assert.rejects(c.createClient(db, f.admin, { organizationId: f.org.id, name: "ＮＰＵＣＲＡＦＴ" }), denied(409));
  await m.archiveResource(db, f.admin, "clients", one.clientId, { archived: true });
  await assert.rejects(c.createClient(db, f.admin, { organizationId: f.org.id, name: "npucraft" }), denied(409));
  await c.createClient(db, f.root, { organizationId: f.other.id, name: "NPUcraft" });
  await assert.rejects(requireClient(db, f.beta, two.clientId, "DRAFT_READ"), denied(404));
  await assert.rejects(c.createClient(db, f.beta, { organizationId: f.org.id, name: "No server scope" }), denied(403));
  await assert.rejects(c.bindClient(db, f.reviewer, two.clientId, { serverId: "NPR", publicationRevision: 0, expectedClientId: "NPR", replaceConfirmed: true }), denied(403));
  await assert.rejects(c.bindClient(db, f.admin, two.clientId, { serverId: "NPR", publicationRevision: 0, expectedClientId: "NPR", replaceConfirmed: false }), denied(409));
  const pending = await c.bindClient(db, f.admin, two.clientId, { serverId: "NPR", publicationRevision: 0, expectedClientId: "NPR", replaceConfirmed: true });
  assert(pending.pending);
  assert.equal((await db.serverPublication.findUniqueOrThrow({ where: { serverId: "NPR" } })).clientId, "NPR");
  await c.unbindClient(db, f.admin, two.clientId, { serverId: null, publicationRevision: null });
  assert.equal((await db.client.findUniqueOrThrow({ where: { id: two.clientId } })).requestedServerId, null);
  await assert.rejects(c.bindClient(db, f.beta, two.clientId, { serverId: "NPB", publicationRevision: 0, expectedClientId: "NPB", replaceConfirmed: true }), denied(404));
  await c.unbindClient(db, f.admin, "NPR", { serverId: "NPR", publicationRevision: 0 });
  const oldDraft = await db.clientDraft.create({ data: { clientId: "NPR", name: "Former client", versionLabel: "0.1", createdById: f.root.id } });
  assert.deepEqual(await m.getClients(db, f.admin, "NPR"), { drafts: [], releases: [] });
  await assert.rejects(m.saveDraft(db, f.admin, "NPR", { name: "No binding", versionLabel: "1", description: "", changelog: "" }), denied(409));
  await c.bindClient(db, f.admin, two.clientId, { serverId: "NPR", publicationRevision: 1, expectedClientId: null, replaceConfirmed: false });
  assert(!(await m.getClients(db, f.admin, "NPR")).drafts.some(draft => draft.id === oldDraft.id));
  await assert.rejects(c.bindClient(db, f.admin, two.clientId, { serverId: "NPB", publicationRevision: 0, expectedClientId: "NPB", replaceConfirmed: true }), denied(409));
  await assert.rejects(c.unbindClient(db, f.admin, two.clientId, { serverId: "NPR", publicationRevision: 1 }), denied(409));
  await sqlDenied(db, () => db.serverPublication.update({ where: { serverId: "NPB" }, data: { clientId: two.clientId } }));
  await sqlDenied(db, () => db.serverPublication.update({ where: { serverId: "OTH" }, data: { clientId: two.clientId } }));
  assert.equal((await m.getState(db, f.admin)).organizations[0].clientCount, 3);
  await db.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");
}));

test("the client migration preserves legacy releases, source keys, current selection and duplicate-name histories", async () => {
  const legacySchema = "mua_legacy_test_" + randomBytes(8).toString("hex");
  const legacy = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: "-c search_path=" + legacySchema + ",pg_catalog" });
  const account = randomUUID(), org = randomUUID(), draft = randomUUID(), release = randomUUID(), upload = randomUUID();
  const hash = "b".repeat(64);
  try {
    await legacy.query('CREATE SCHEMA "' + legacySchema + '"');
    for (const migration of ["202610080001_initial", "202610080002_invariants", "202610080003_client_uploads", "202610080004_upload_integrity"])
      await legacy.query((await readFile("prisma/migrations/" + migration + "/migration.sql", "utf8")).replace('CREATE SCHEMA IF NOT EXISTS "public";', ""));
    // Create both legacy one-server-one-client resources in one transaction, as the old API did.
    const connection = await legacy.connect();
    try {
      await connection.query("BEGIN");
      await connection.query('INSERT INTO "Account" ("id","displayName","updatedAt") VALUES ($1,\'root\',now())', [account]);
      await connection.query('INSERT INTO "Organization" ("id","displayName","updatedAt") VALUES ($1,\'Legacy\',now())', [org]);
      for (const id of ["LGA", "LGB"]) {
        await connection.query('INSERT INTO "Server" ("serverId","organizationId","displayName","updatedAt") VALUES ($1,$2,\'Same name\',now())', [id, org]);
        await connection.query('INSERT INTO "Client" ("serverId","organizationId","updatedAt") VALUES ($1,$2,now())', [id, org]);
        await connection.query('INSERT INTO "ServerPublication" ("serverId","changedById","updatedAt") VALUES ($1,$2,now())', [id, account]);
      }
      await connection.query('INSERT INTO "ClientDraft" ("id","serverId","versionLabel","name","status","candidateManifestKey","candidateManifestSha256","createdById","reviewedById","reviewedRevision","reviewedAt","updatedAt") VALUES ($1,\'LGA\',\'1.0\',\'Same name\',\'APPROVED\',\'legacy/manifest.json\',$2,$3,$3,1,now(),now())', [draft, hash, account]);
      await connection.query('INSERT INTO "ClientRelease" ("id","serverId","sourceDraftId","versionLabel","name","description","changelog","environmentSnapshot","manifestObjectKey","manifestSha256","signingKeyId","signature","approvedById","publishedById") VALUES ($1,\'LGA\',$2,\'1.0\',\'Same name\',\'\',\'\',\'{}\',\'legacy/manifest.json\',$3,\'legacy-key\',\'legacy-signature\',$4,$4)', [release, draft, hash, account]);
      await connection.query('UPDATE "ClientDraft" SET "status"=\'RELEASED\' WHERE "id"=$1', [draft]);
      await connection.query('UPDATE "ServerPublication" SET "releaseId"=$1,"revision"=7 WHERE "serverId"=\'LGA\'', [release]);
      await connection.query('INSERT INTO "ClientUpload" ("id","serverId","createdById","fileName","size","partSize","multipartId","sourceObjectKey","baseReleaseId","basePublicationRevision","expiresAt","updatedAt") VALUES ($1,\'LGA\',$2,\'legacy.zip\',10,67108864,\'legacy-multipart\',\'legacy/source.zip\',$3,7,now()+interval \'1 day\',now())', [upload, account, release]);
      await connection.query("COMMIT");
    } catch (error) { await connection.query("ROLLBACK"); throw error; } finally { connection.release(); }
    const before = (await legacy.query('SELECT "id","manifestObjectKey","manifestSha256","signature" FROM "ClientRelease"')).rows;
    await legacy.query(await readFile("prisma/migrations/202610090001_independent_clients/migration.sql", "utf8"));
    assert.deepEqual((await legacy.query('SELECT "id","manifestObjectKey","manifestSha256","signature" FROM "ClientRelease"')).rows, before);
    const migrated = (await legacy.query('SELECT "id","scopeServerId","currentReleaseId","revision","nameKey" FROM "Client" ORDER BY "id"')).rows;
    assert.deepEqual(migrated.map(row => row.id), ["LGA", "LGB"]);
    assert.equal(migrated[0].scopeServerId, "LGA"); assert.equal(migrated[0].currentReleaseId, release); assert.equal(migrated[0].revision, 7);
    assert.notEqual(migrated[0].nameKey, migrated[1].nameKey);
    assert.equal((await legacy.query('SELECT "clientId" FROM "ClientDraft" WHERE "id"=$1', [draft])).rows[0].clientId, "LGA");
    assert.equal((await legacy.query('SELECT "clientId","sourceObjectKey" FROM "ClientUpload" WHERE "id"=$1', [upload])).rows[0].sourceObjectKey, "legacy/source.zip");
    assert.deepEqual((await legacy.query('SELECT "clientId","releaseId" FROM "ServerPublication" WHERE "serverId"=\'LGA\'')).rows[0], { clientId: "LGA", releaseId: release });
    for (const migration of ["202610090002_client_inspection", "202610090003_client_recycle", "202610090004_muapack_builds", "202610090005_modrinth_import", "202610090006_environment_mirrors"])
      await legacy.query(await readFile("prisma/migrations/" + migration + "/migration.sql", "utf8"));
    const deletedDraft = randomUUID();
    await legacy.query('INSERT INTO "ClientDraft" ("id","clientId","createdById","versionLabel","updatedAt") VALUES ($1,\'LGB\',$2,\'0.9.0\',now())', [deletedDraft, account]);
    await legacy.query('UPDATE "ServerPublication" SET "clientId"=NULL WHERE "serverId"=\'LGB\'');
    await legacy.query('UPDATE "Client" SET "archivedAt"=now() WHERE "id"=\'LGB\'');
    await legacy.query('UPDATE "Client" SET "deletedAt"=now() WHERE "id"=\'LGB\'');
    const tombstone = (await legacy.query('SELECT to_jsonb(c) AS snapshot FROM "Client" c WHERE "id"=\'LGB\'')).rows[0].snapshot;
    await legacy.query(await readFile("prisma/migrations/202610100001_draft_lifecycle/migration.sql", "utf8"));
    await legacy.query('UPDATE "ServerPublication" SET "clientId"=NULL,"releaseId"=NULL WHERE "serverId"=\'LGA\'');
    await legacy.query('UPDATE "Server" SET "isListed"=false WHERE "serverId"=\'LGA\'');
    await legacy.query('UPDATE "Client" SET "archivedAt"=now() WHERE "id"=\'LGA\'');
    await legacy.query('UPDATE "ClientUpload" SET "status"=\'CANCELLED\' WHERE "id"=$1', [upload]);
    await assert.rejects(legacy.query('UPDATE "Client" SET "deletedAt"=now() WHERE "id"=\'LGA\''), "old guard rejects archived published clients");
    await legacy.query(await readFile("prisma/migrations/202610100002_archived_client_deletion/migration.sql", "utf8"));
    await legacy.query(await readFile("prisma/migrations/202610100003_package_format_choice/migration.sql", "utf8"));
    await legacy.query(await readFile("prisma/migrations/202610100004_v2_recipe_import/migration.sql", "utf8"));
    await legacy.query(await readFile("prisma/migrations/202610100005_v2_recipe_packages/migration.sql", "utf8"));
    for (const table of ["ClientUpload", "ClientDraft", "ClientRelease"]) {
      assert((await legacy.query('SELECT "packageFormatVersion" FROM "' + table + '"')).rows.every(row => row.packageFormatVersion === 1));
    }
    assert.deepEqual((await legacy.query('SELECT "id","manifestObjectKey","manifestSha256","signature" FROM "ClientRelease"')).rows, before);
    assert.deepEqual((await legacy.query('SELECT to_jsonb(c) AS snapshot FROM "Client" c WHERE "id"=\'LGB\'')).rows[0].snapshot, tombstone);
    assert((await legacy.query('SELECT "versionSequence" FROM "ClientDraft" WHERE "id"=$1', [deletedDraft])).rows[0].versionSequence > 0);
    await assert.rejects(legacy.query('UPDATE "ClientDraft" SET "name"=\'must not edit deleted history\' WHERE "id"=$1', [deletedDraft]));
    await assert.rejects(legacy.query('UPDATE "ClientDraft" SET "name"=\'must not edit published history\' WHERE "id"=$1', [draft]));
    await legacy.query('UPDATE "Client" SET "deletedAt"=now() WHERE "id"=\'LGA\'');
    assert.deepEqual((await legacy.query('SELECT "id","manifestObjectKey","manifestSha256","signature" FROM "ClientRelease"')).rows, before);
    await assert.rejects(legacy.query('UPDATE "Client" SET "deletedAt"=NULL WHERE "id"=\'LGA\''));
  } finally {
    assert.match(legacySchema, /^mua_legacy_test_[0-9a-f]{16}$/);
    await legacy.query('DROP SCHEMA IF EXISTS "' + legacySchema + '" CASCADE'); await legacy.end();
  }
});
