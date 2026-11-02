import "dotenv/config";
import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { generateKeyPair, SignJWT, jwtVerify } from "jose";
import { startGameLogin, exchangeGameLogin, listGameProviders, saveGameProvider as saveProvider, gameRequestPolicy, gameClientKey } from "../src/lib/launcher-game-auth";
import { GameLoginError, verifyGameIdentity } from "../src/lib/launcher-game-identity";
import { gameTransport, type GameTransport } from "../src/lib/launcher-game-network";
import { actorFromToken, tokenDigest, type Actor, type Db } from "../src/lib/auth";
import { AppError } from "../src/lib/errors";
import { securityFunction, setDatabaseActor } from "../src/lib/database-security";
import { disconnectDatabases, validateDatabase } from "../src/lib/prisma";
import { POST as startRoute } from "../src/app/api/auth/launcher/yggdrasil/start/route";
import { POST as exchangeRoute } from "../src/app/api/auth/launcher/yggdrasil/exchange/route";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { updateOrganization, getState } from "../src/lib/management";
import { updateUnionAuthorization, unionDirectoryStatus, requestUnionSync, syncUnionDirectory } from "../src/lib/union-directory";
import { UNION_DIRECTORY_URL } from "../src/lib/union-directory-contract";
import type { SiteReader } from "../src/lib/union-site-icons";

const schema = `mua_game_${randomBytes(8).toString("hex")}`;
process.env.DATABASE_SCHEMA = schema; process.env.APP_ORIGIN = "https://link.mualliance.cn";
for (const name of ["DATABASE_URL", "DATABASE_AUTH_URL", "DATABASE_PUBLIC_URL", "DATABASE_WORKER_URL", "DATABASE_MIGRATION_URL"]) {
  const url = new URL(process.env[name]!); url.searchParams.delete("options"); process.env[name] = url.toString();
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_MIGRATION_URL, options: `-c role=mua_owner -c search_path=${schema},pg_catalog` });
const owner = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) });
const runtime = (env: string) => new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env[env], options: `-c search_path=${schema},pg_catalog` }, { schema }) });
const auth = runtime("DATABASE_AUTH_URL"), web = runtime("DATABASE_URL"), pub = runtime("DATABASE_PUBLIC_URL");
const worker = runtime("DATABASE_WORKER_URL");
let root: Actor, orgId: string, created = false, legacyMigrationChecked = false;
let provider: Awaited<ReturnType<typeof saveGameProvider>>;
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
const profileA = "a".repeat(32), profileB = "b".repeat(32), other = "c".repeat(32);
const profiles = new Map([[profileA, { id: profileA, name: "Main", uid: "123" }], [profileB, { id: profileB, name: "Test", uid: "123" }], [other, { id: other, name: "Other", uid: "999" }]]);
const discovery: GameTransport = async (url, body) => {
  assert.equal(body, undefined);
  if (url.pathname === "/") return { status: 200, contentType: "text/html", bytes: Buffer.alloc(0), apiLocation: "/custom/auth/" };
  assert.equal(url.pathname, "/custom/auth/");
  return { status: 200, contentType: "application/json", bytes: Buffer.from(JSON.stringify({ meta: { serverName: "Fixture" } })) };
};
const saveGameProvider = (db: Db, actor: Actor, raw: unknown) => saveProvider(db, actor, raw, discovery);
async function as<T>(actor: Actor, work: (db: Db) => Promise<T>) { return web.$transaction(async db => { await db.$executeRaw`SELECT pg_advisory_xact_lock(731402,1)`; await setDatabaseActor(db, actor); return work(db); }); }
const cfg = () => ({ id: provider.id, revision: provider.revision, siteCode: "MUA", bsRoot: "https://skin.mualliance.ltd", displayName: "MUA", adapter: "MUA_YGGC_ONLINE_V1", enabled: true,
  verificationNote: "Fixture only: verified mock UID and credential log isolation", confirmUidMapping: true, confirmCredentialLogRedaction: true });
async function token(uuid = profileA, uid = "123", extra: Record<string, unknown> = {}) {
  return new SignJWT({ sub: uid, selectedProfile: uuid, aud: "passport-client", ...extra }).setProtectedHeader({ alg: "RS256" }).setIssuedAt().setJti(randomUUID()).setExpirationTime("1h").sign(keys.privateKey);
}
const transport: GameTransport = async (url, body) => {
  assert.equal(url.origin, "https://skin.mualliance.ltd");
  if (url.pathname.endsWith("/validate")) {
    assert(body); const input = JSON.parse(body); assert.deepEqual(Object.keys(input), ["accessToken"]);
    try { const { payload } = await jwtVerify(input.accessToken, keys.publicKey, { algorithms: ["RS256"] });
      if (profiles.get(String(payload.selectedProfile))?.uid !== payload.sub) throw new Error("invalid owner");
    } catch { return { status: 403, bytes: Buffer.alloc(0), contentType: "" }; }
    return { status: 204, bytes: Buffer.alloc(0), contentType: "" };
  }
  assert.equal(body, undefined); const p = profiles.get(url.pathname.split("/").at(-1)!); assert(p);
  return { status: 200, bytes: Buffer.from(JSON.stringify({ id: p.id, name: p.name, properties: [{ name: "textures", value: "not-an-ownership-proof" }] })), contentType: "application/json" };
};
async function attempt(uuid = profileA, uid = "123") {
  const verifier = randomBytes(32).toString("base64url");
  const start = await startGameLogin({ providerId: provider.id, codeChallenge: createHash("sha256").update(verifier).digest("base64url"), codeChallengeMethod: "S256" });
  return { attemptId: start.attemptId, nonce: start.nonce, codeVerifier: verifier, gameAccessToken: await token(uuid, uid), gameProfile: { id: uuid } };
}
before(async () => {
  keys = await generateKeyPair("RS256");
  await pool.query(`CREATE SCHEMA "${schema}"`); created = true;
  for (const dir of (await readdir("prisma/migrations")).filter(x => /^\d/.test(x)).sort()) {
    let legacyId: string | undefined, legacyAccount: string | undefined, legacyOrg: string | undefined;
    if (dir === "202611020001_yggdrasil_ali") {
      legacyAccount = (await owner.account.create({ data: { displayName: "legacy approver", isSuperAdmin: true } })).id;
      legacyOrg = randomUUID();
      await pool.query('INSERT INTO "Organization"(id,"displayName","updatedAt") VALUES($1,\'legacy organization\',now())', [legacyOrg]);
      await owner.unionSkinSite.create({ data: { code: "LEGACY", organizationId: legacyOrg, bsRoot: "https://legacy.example" } });
      legacyId = randomUUID();
      await pool.query('INSERT INTO "LauncherAuthProvider"(id,"siteCode","displayName","bsRoot","authApiRoot",enabled,"siteRevision","verifiedById","verificationNote","updatedAt") VALUES($1,\'LEGACY\',\'legacy provider\',\'https://legacy.example\',\'https://legacy.example/api/yggdrasil\',true,1,$2,\'Legacy fixture approval\',now())', [legacyId,legacyAccount]);
      await assert.rejects(pool.query('UPDATE "LauncherAuthProvider" SET "authApiRoot"=\'https://auth.example/custom/\' WHERE id=$1', [legacyId]));
    }
    await pool.query(await readFile(`prisma/migrations/${dir}/migration.sql`, "utf8"));
    if (legacyId) {
      const legacy = (await pool.query('SELECT enabled,revision,"authApiRoot" FROM "LauncherAuthProvider" WHERE id=$1', [legacyId])).rows[0];
      assert.equal(legacy.enabled, false); assert.equal(legacy.revision, 2);
      assert.equal(legacy.authApiRoot, "https://legacy.example/api/yggdrasil", "Migration preserves historical endpoint for review");
      await pool.query('UPDATE "LauncherAuthProvider" SET "authApiRoot"=\'https://auth.example/custom/\' WHERE id=$1', [legacyId]);
      await assert.rejects(pool.query('UPDATE "LauncherAuthProvider" SET "authApiRoot"=\'http://auth.example/custom/\' WHERE id=$1', [legacyId]));
      await pool.query('DELETE FROM "LauncherAuthProvider" WHERE id=$1', [legacyId]);
      await owner.unionSkinSite.delete({ where: { code: "LEGACY" } });
      // Business records forbid hard deletion; the entire fixture schema is dropped in after().
      await pool.query('UPDATE "Organization" SET "archivedAt"=now() WHERE id=$1', [legacyOrg]);
      await owner.account.update({ where: { id: legacyAccount }, data: { status: "DISABLED" } });
      legacyMigrationChecked = true;
    }
  }
  root = await owner.account.create({ data: { displayName: "fixture root", isSuperAdmin: true } });
  orgId = (await owner.organization.create({ data: { displayName: "MUA" } })).id;
  await owner.unionSkinSite.create({ data: { code: "MUA", organizationId: orgId, bsRoot: "https://skin.mualliance.ltd", upstreamPresent: true, managedBySync: true } });
  await owner.organization.update({ where: { id: orgId }, data: { launcherLoginEnabled: true } });
  provider = { id: randomUUID(), revision: 0 } as typeof provider;
  provider = await as(root, db => saveGameProvider(db, root, cfg()));
});
after(async () => {
  await Promise.all([owner, auth, web, pub, worker].map(db => db.$disconnect())); await disconnectDatabases();
  if (created) { assert.match(schema, /^mua_game_[a-f0-9]{16}$/); await pool.query(`DROP SCHEMA "${schema}" CASCADE`); await pool.query(`DROP SCHEMA IF EXISTS "${schema}_authz" CASCADE`); }
  await pool.end();
});

test("ALI migration stops guessed endpoints, invalidates old revisions and allows independent HTTPS API roots", () => {
  assert.equal(legacyMigrationChecked, true);
});

test("new models enforce RLS and only approved safe provider data are public", async () => {
  for (const purpose of ["web", "auth", "public", "worker"] as const) await validateDatabase(purpose);
  const rows = await listGameProviders() as Record<string, unknown>[];
  assert.equal(rows.length, 1); assert.equal(rows[0].id, provider.id); assert.equal(rows[0].directExchange, true);
  assert.equal(rows[0].authApiRoot, "https://skin.mualliance.ltd/custom/auth/");
  assert(!JSON.stringify(rows).includes("verificationNote")); assert(!JSON.stringify(rows).includes(root.id));
  await assert.rejects(pub.launcherAuthProvider.findMany()); await assert.rejects(pub.launcherGameLoginAttempt.findMany());
  await assert.rejects(auth.$queryRaw`SELECT ${securityFunction("union_resolve_identity")}('MUA:123','forged')`);
});
test("exchange creates a PLAYER LAUNCHER session and preserves OAuth identity across two profiles", async () => {
  const first = await exchangeGameLogin(await attempt(), transport);
  assert.match(first.token, /^mul_[a-f0-9]{64}$/); assert(first.expiresIn > 60 && first.expiresIn <= 900);
  const session = await owner.session.findUniqueOrThrow({ where: { tokenHash: tokenDigest(first.token.slice(4)) } });
  assert.equal(session.kind, "LAUNCHER"); assert.equal(session.authMethod, "YGGDRASIL"); assert.equal(session.gameProfileId, profileA);
  const member = await owner.organizationMember.findUniqueOrThrow({ where: { organizationId_accountId: { organizationId: orgId, accountId: first.account.id } } });
  assert.deepEqual(member.roles, ["PLAYER"]);
  assert.equal((await actorFromToken(web, first.token.slice(4))).canManage, false);
  const cookie = randomBytes(32).toString("hex");
  const [oauth] = await auth.$queryRaw<{ id: string }[]>`SELECT ${securityFunction("union_login")}('MUA:123','OAuth display',${tokenDigest(cookie)},${new Date(Date.now()+3600_000)}) AS id`;
  assert.equal(oauth.id, first.account.id);
  const second = await exchangeGameLogin(await attempt(profileB), transport);
  assert.equal(second.account.id, first.account.id); assert.deepEqual(second.gameProfile, { id: profileB, name: "Test" });
  assert.equal(await owner.unionIdentity.count(), 1);
  assert(!JSON.stringify(second).includes("textures"));
});
test("online validation rejects forged tokens and other-account profile ownership", async () => {
  const input = await attempt(); input.gameAccessToken = input.gameAccessToken.slice(0, -8) + "tampered";
  await assert.rejects(exchangeGameLogin(input, transport), (e: unknown) => e instanceof GameLoginError && e.code === "GAME_TOKEN_INVALID");
  const otherOwner = await attempt(other, "123");
  await assert.rejects(exchangeGameLogin(otherOwner, transport), /GAME_TOKEN_INVALID/);
  const mismatch = await attempt(); mismatch.gameProfile.id = other;
  await assert.rejects(exchangeGameLogin(mismatch, transport), /PROFILE_MISMATCH/);
  assert.equal(await owner.unionIdentity.count(), 1);
});
test("claims, public profile and redirects alone never prove identity", async () => {
  const input = await attempt();
  await assert.rejects(verifyGameIdentity(provider, input, async () => ({ status: 302, bytes: Buffer.alloc(0), contentType: "" })), /UPSTREAM_UNAVAILABLE/);
  await assert.rejects(verifyGameIdentity(provider, { ...input, gameAccessToken: "opaque-legacy-token" }, async () => ({ status: 204, bytes: Buffer.alloc(0), contentType: "" })), /IDENTITY_PROOF_UNSUPPORTED/);
  await assert.rejects(verifyGameIdentity(provider, { ...input, gameAccessToken: await token(profileA, "123", { iss: "unapproved-issuer" }) }, transport), /IDENTITY_PROOF_UNSUPPORTED/);
  await assert.rejects(verifyGameIdentity(provider, { ...input, gameAccessToken: await token(profileA, "derived-user-uuid") }, async () => ({ status: 204, bytes: Buffer.alloc(0), contentType: "" })), /IDENTITY_PROOF_UNSUPPORTED/);
  const altered: GameTransport = async (u,b,s) => b ? transport(u,b,s) : { status: 200, bytes: Buffer.from(JSON.stringify({ id: other, name: "Other" })), contentType: "application/json" };
  await assert.rejects(verifyGameIdentity(provider, input, altered), /PROFILE_MISMATCH/);
  await assert.rejects(verifyGameIdentity(provider, { ...input, gameProfile: { ...input.gameProfile, name: "forged name" } }, transport), /PROFILE_CHANGED/);
});
test("an attempt is one-use, a failed proof cannot mint a session, and parallel claims issue once", async () => {
  const input = await attempt(); const before = await owner.session.count();
  const results = await Promise.allSettled([exchangeGameLogin(input, transport), exchangeGameLogin(input, transport)]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1); assert.equal(await owner.session.count(), before + 1);
  await assert.rejects(exchangeGameLogin(input, transport), /LOGIN_ATTEMPT_USED/);
  const bad = await attempt(); await assert.rejects(exchangeGameLogin({ ...bad, nonce: "x".repeat(43) }, transport), /LOGIN_ATTEMPT_INVALID/);
  const row = await owner.loginThrottle.findUniqueOrThrow({ where: { key: tokenDigest(`game-login:attempt:${bad.attemptId}`) } }); assert.equal(row.attempts, 1);
  await exchangeGameLogin(bad, transport);
  const failed = await attempt();
  await assert.rejects(exchangeGameLogin(failed, async () => { throw new Error(`secret:${failed.gameAccessToken}`); }), /UPSTREAM_UNAVAILABLE/);
  assert.equal((await owner.launcherGameLoginAttempt.findUniqueOrThrow({ where: { id: failed.attemptId } })).status, "FAILED");
});
test("credential POST contracts reject URLs, profiles with properties, cookie fallback and unsafe origins", async () => {
  const input = await attempt();
  await assert.rejects(exchangeGameLogin({ ...input, sub: "MUA:999" }, transport), /INVALID_REQUEST/);
  await assert.rejects(exchangeGameLogin({ ...input, gameProfile: { ...input.gameProfile, properties: [] } }, transport), /INVALID_REQUEST/);
  assert.throws(() => gameRequestPolicy(new Request("https://link.mualliance.cn/api/auth/launcher/providers?accessToken=secret")), /INVALID_REQUEST/);
  assert.throws(() => gameRequestPolicy(new Request("https://link.mualliance.cn/api", { headers: { origin: "https://evil.invalid" } })), /INVALID_ORIGIN/);
  process.env.APP_ORIGIN = "http://public.example.invalid";
  assert.throws(() => gameRequestPolicy(new Request("http://public.example.invalid/api")), /HTTPS_REQUIRED/);
  process.env.APP_ORIGIN = "https://link.mualliance.cn";
  const response = await startRoute(new Request("https://link.mualliance.cn/api/auth/launcher/yggdrasil/start", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", cookie: "mua_session=anything" }, body: "password=secret" }));
  assert.equal(response.status, 415); assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.equal(response.headers.get("set-cookie"), null);
  const invalid = await exchangeRoute(new Request("https://link.mualliance.cn/api/auth/launcher/yggdrasil/exchange", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ gameAccessToken: "private-secret" }) }));
  assert.equal(invalid.status, 400); const error = await invalid.json(); assert.equal(error.code, "diagnostics.game.INVALID_REQUEST"); assert(!JSON.stringify(error).includes("private-secret"));
  process.env.LAUNCHER_AUTH_CLIENT_IP_HEADER = "x-client-ip";
  assert.throws(() => gameClientKey(new Request("https://link.mualliance.cn/api")), /INVALID_CLIENT_ADDRESS/);
  assert.match(gameClientKey(new Request("https://link.mualliance.cn/api", { headers: { "x-client-ip": "203.0.113.2" } }))!, /^ip:[a-f0-9]{64}$/);
  delete process.env.LAUNCHER_AUTH_CLIENT_IP_HEADER;
});
test("credential network refuses HTTP and private addresses before sending credentials", async () => {
  for (const url of ["http://example.com/api", "https://127.0.0.1/api", "https://[::1]/api", "https://169.254.169.254/api"]) await assert.rejects(gameTransport(new URL(url), "sensitive", AbortSignal.timeout(1000)));
});
test("short-lived proofs, expired attempts and repeated wrong verifiers cannot issue tokens", async () => {
  const input = await attempt();
  const expiring = await new SignJWT({ sub: "123", selectedProfile: profileA, aud: "passport-client" }).setProtectedHeader({ alg: "RS256" }).setIssuedAt().setJti(randomUUID()).setExpirationTime("40s").sign(keys.privateKey);
  await assert.rejects(verifyGameIdentity(provider, { ...input, gameAccessToken: expiring }, transport), /GAME_TOKEN_EXPIRING/);
  const expiredNow = Date.now();
  await owner.launcherGameLoginAttempt.update({ where: { id: input.attemptId }, data: { createdAt: new Date(expiredNow-300_000), expiresAt: new Date(expiredNow-180_000) } });
  await assert.rejects(exchangeGameLogin(input, transport), /LOGIN_ATTEMPT_INVALID/);
  const limited = await attempt();
  for(let i=0;i<5;i++) await assert.rejects(exchangeGameLogin({ ...limited, codeVerifier:"x".repeat(43) },transport), /LOGIN_ATTEMPT_INVALID/);
  await assert.rejects(exchangeGameLogin(limited,transport), /RATE_LIMITED/);
  assert.equal(await owner.session.count({ where:{gameLoginAttemptId:limited.attemptId} }),0);
});
test("production HTTP and optional browser expose Launcher contracts without granting administration", { skip: !process.env.MUA_HTTP_TEST_DIST }, async () => {
  const probe = createServer(); await new Promise<void>(resolve => probe.listen(0,"127.0.0.1",resolve));
  const port = (probe.address() as {port:number}).port; await new Promise<void>(resolve => probe.close(()=>resolve()));
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath,["node_modules/next/dist/bin/next","start","--hostname","127.0.0.1","--port",String(port)],{
    env:{...process.env,APP_ORIGIN:base,NODE_ENV:"production",NEXT_DIST_DIR:process.env.MUA_HTTP_TEST_DIST},windowsHide:true,stdio:["ignore","ignore","ignore"]});
  try {
    let ready = false;
    for(let i=0;i<120;i++){try{if((await fetch(base+"/openapi.json")).ok){ready=true;break;}}catch{} await new Promise(resolve=>setTimeout(resolve,250));}
    assert(ready,"Production HTTP server did not start");
    const providers = await fetch(base+"/api/auth/launcher/providers"); assert.equal(providers.status,200); assert.equal(providers.headers.get("cache-control"),"private, no-store");
    assert.equal((await providers.json())[0].id,provider.id);
    const spec = await (await fetch(base+"/openapi.json?locale=en-US")).json();
    assert(spec.paths["/api/auth/launcher/yggdrasil/exchange"]); assert(!JSON.stringify(spec).includes("/api/admin/"));
    const session = await exchangeGameLogin(await attempt(),transport);
    const member = await fetch(base+"/api/member",{headers:{Authorization:`Bearer ${session.token}`}});assert.equal(member.status,200);assert.equal((await member.json()).actor.canManage,false);
    assert.equal((await fetch(base+"/api/admin/launcher-providers",{headers:{Authorization:`Bearer ${session.token}`}})).status,401);
    const cookie = randomBytes(32).toString("hex");await owner.session.create({data:{tokenHash:tokenDigest(cookie),accountId:root.id,expiresAt:new Date(Date.now()+3600_000)}});
    assert.equal((await fetch(base+"/api/admin/launcher-providers")).status,401);
    const admin = await fetch(base+"/api/admin/launcher-providers",{headers:{cookie:`mua_session=${cookie}`}});assert.equal(admin.status,200);
    const verifier = randomBytes(32).toString("base64url");
    const start = await fetch(base+"/api/auth/launcher/yggdrasil/start",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({providerId:provider.id,codeChallenge:createHash("sha256").update(verifier).digest("base64url"),codeChallengeMethod:"S256"})});
    assert.equal(start.status,201); assert.equal(start.headers.get("set-cookie"),null);
    const bad = await fetch(base+"/api/auth/launcher/yggdrasil/exchange",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({gameProfile:{id:profileA},sub:"MUA:999"})});assert.equal(bad.status,400);assert.equal((await bad.json()).code,"diagnostics.game.INVALID_REQUEST");
    const blocked = await fetch(base+"/api/auth/launcher/yggdrasil/start",{method:"POST",headers:{Origin:"https://evil.invalid","Content-Type":"application/json"},body:"{}"});assert.equal(blocked.status,403);
    const configHeaders={Origin:base,"Content-Type":"application/json",cookie:`mua_session=${cookie}`};
    const noOrigin=await fetch(base+"/api/admin/launcher-providers",{method:"PUT",headers:{"Content-Type":"application/json",cookie:`mua_session=${cookie}`},body:JSON.stringify(cfg())});assert.equal(noOrigin.status,403);
    // The HTTP contract must stay offline; enable/discovery is covered with injected ALI fixtures above.
    const saved=await fetch(base+"/api/admin/launcher-providers",{method:"PUT",headers:configHeaders,body:JSON.stringify({...cfg(),enabled:false})});assert.equal(saved.status,200);provider=await saved.json();
    assert.equal((await fetch(base+"/api/member",{headers:{Authorization:`Bearer ${session.token}`}})).status,401,"Saving provider configuration must invalidate old sessions");
    provider=await as(root,db=>saveGameProvider(db,root,cfg()));
    if(process.env.MUA_UNION_BROWSER_TEST==="1"){
      const {chromium,expect}=await import("@playwright/test"); const browser=await chromium.launch({channel:"msedge",headless:true});
      try{const context=await browser.newContext({viewport:{width:1440,height:1000}}); await context.addCookies([{name:"mua_session",value:cookie,url:base,httpOnly:true,sameSite:"Lax"}]);
        const page=await context.newPage();const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
        const loaded=page.waitForResponse(r=>r.url().includes("/api/admin/openapi")&&r.status()===200);
        await page.goto(base+"/admin/api"); const renderedSpec=await (await loaded).json();
        assert(renderedSpec.paths["/api/auth/launcher/yggdrasil/exchange"]);
        await page.getByRole("heading",{name:"Union Link API",exact:true}).waitFor({timeout:30_000});
        await page.screenshot({path:".local/launcher-exchange-api.png"}); assert.deepEqual(errors,[]);
        await page.goto(base+"/admin/organizations");
        await page.getByRole("columnheader",{name:/授权/}).waitFor();
        const row=page.getByRole("row").filter({hasText:"MUA"});
        await row.getByRole("button",{name:"编辑",exact:true}).click();
        const checkbox=page.getByRole("checkbox",{name:"允许启动器通过皮肤站账号登录 Union Link",exact:true});
        await checkbox.waitFor();assert.equal(await checkbox.isChecked(),true);
        await expect(page.getByRole("dialog")).toHaveCSS("opacity","1");
        await page.screenshot({path:".local/organization-launcher-authorization-editor.png"});
        await checkbox.uncheck();
        const revoked=page.waitForResponse(r=>r.url().endsWith(`/api/admin/organizations/${orgId}`)&&r.request().method()==="PATCH");
        await page.getByRole("button",{name:"保存",exact:true}).click();assert.equal((await revoked).status(),200);
        await row.getByText("未授权",{exact:true}).waitFor();
        await row.getByRole("button",{name:"编辑",exact:true}).click();await checkbox.check();
        const enabled=page.waitForResponse(r=>r.url().endsWith(`/api/admin/organizations/${orgId}`)&&r.request().method()==="PATCH");
        await page.getByRole("button",{name:"保存",exact:true}).click();assert.equal((await enabled).status(),200);
        await row.getByText("已授权",{exact:true}).waitFor();
        await page.screenshot({path:".local/organization-launcher-authorization-table.png"});
        const yitRoots=["https://skin.yitmc.cn","https://skin.uemcraft.cn"];
        const yitOrg=await owner.organization.create({data:{displayName:"YITUEM browser fixture"}});
        await owner.unionSkinSite.create({data:{code:"YITUEM",organizationId:yitOrg.id,bsRoot:yitRoots[0],bsRootAliases:[yitRoots[1]],managedBySync:true,upstreamPresent:true}});
        for(const rootUrl of yitRoots)await owner.launcherAuthProvider.create({data:{siteCode:"YITUEM",displayName:"YITUEM browser fixture",bsRoot:rootUrl,
          authApiRoot:"https://auth.yituem.example/shared/api/",enabled:true,siteRevision:1,verificationNote:"Fixture metadata only; no real credentials",managedByOrganization:true}});
        await page.reload();
        const yitRow=page.getByRole("row").filter({hasText:"YITUEM browser fixture"});
        const siteCheckbox=(url:string)=>page.getByRole("checkbox",{name:`允许 ${url} 的账号通过启动器登录 Union Link`,exact:true});
        const saveYit=async()=>{const response=page.waitForResponse(r=>r.url().endsWith(`/api/admin/organizations/${yitOrg.id}`)&&r.request().method()==="PATCH");
          await page.getByRole("button",{name:"保存",exact:true}).click();assert.equal((await response).status(),200);await page.getByRole("dialog").waitFor({state:"hidden"});};
        const visibleYit=async()=>{const response=await fetch(base+"/api/auth/launcher/providers");assert.equal(response.status,200);return(await response.json() as {siteCode:string;bsRoot:string}[]).filter(p=>p.siteCode==="YITUEM").map(p=>p.bsRoot).sort();};
        await yitRow.getByRole("button",{name:"编辑",exact:true}).click();
        assert.equal(await siteCheckbox(yitRoots[0]).isChecked(),false);assert.equal(await siteCheckbox(yitRoots[1]).isChecked(),false);
        await siteCheckbox(yitRoots[0]).check();await saveYit();assert.deepEqual(await visibleYit(),[yitRoots[0]]);
        const badges=yitRow.getByRole("cell").nth(4).locator('[data-slot="badge"]');
        await expect(badges).toHaveText(["已授权","未授权"]);
        const addresses=yitRow.getByRole("cell").nth(2).locator("p");await expect(addresses).toHaveCount(2);
        for(let i=0;i<2;i++){const a=await addresses.nth(i).boundingBox(),b=await badges.nth(i).boundingBox();assert(a&&b);assert(Math.abs(a.y+a.height/2-b.y-b.height/2)<2,"Each authorization must align with its address");}
        await page.screenshot({path:".local/yituem-authorization-table.png"});
        await yitRow.getByRole("button",{name:"编辑",exact:true}).click();await siteCheckbox(yitRoots[1]).check();await saveYit();assert.deepEqual(await visibleYit(),[...yitRoots].sort());
        await yitRow.getByRole("button",{name:"编辑",exact:true}).click();await siteCheckbox(yitRoots[0]).uncheck();await saveYit();assert.deepEqual(await visibleYit(),[yitRoots[1]]);
        await expect(badges).toHaveText(["未授权","已授权"]);
        await yitRow.getByRole("button",{name:"编辑",exact:true}).click();
        assert.equal(await siteCheckbox(yitRoots[0]).isChecked(),false);assert.equal(await siteCheckbox(yitRoots[1]).isChecked(),true);
        await expect(page.getByRole("dialog")).toHaveCSS("opacity","1");await page.screenshot({path:".local/yituem-authorization-editor.png"});
        await page.getByRole("button",{name:"Close",exact:true}).click();
        await owner.launcherAuthProvider.deleteMany({where:{siteCode:"YITUEM"}});
        await owner.unionSkinSite.delete({where:{code:"YITUEM"}});
        await owner.organization.update({where:{id:yitOrg.id},data:{archivedAt:new Date()}});
        await page.goto(base+"/admin/system/settings");
        const automatic=page.getByRole("checkbox",{name:"自动授权新添加的组织",exact:true});await automatic.waitFor();
        assert.equal(await automatic.isChecked(),false);
        const changed=page.waitForResponse(r=>r.url().endsWith("/api/admin/union-sync")&&r.request().method()==="PATCH");
        await automatic.click();assert.equal((await changed).status(),200);await expect(automatic).toBeChecked();
        await page.screenshot({path:".local/organization-launcher-authorization-settings.png"});
        const reset=page.waitForResponse(r=>r.url().endsWith("/api/admin/union-sync")&&r.request().method()==="PATCH");
        await automatic.click();assert.equal((await reset).status(),200);await expect(automatic).not.toBeChecked();
        await context.addCookies([{name:"mua-locale",value:"en-US",url:base}]);
        await page.reload();await page.getByRole("checkbox",{name:"Automatically authorize newly added organizations",exact:true}).waitFor();
        provider=await owner.launcherAuthProvider.findUniqueOrThrow({where:{id:provider.id}});
        assert.deepEqual(errors,[]);
      }finally{await browser.close();}
    }
  } finally { server.kill(); }
});
test("provider revision/disable and local stop flags invalidate sessions and in-flight exchanges", async () => {
  const session = await exchangeGameLogin(await attempt(other, "999"), transport);
  const input = await attempt();
  const stopped: GameTransport = async (u,b,s) => { const result = await transport(u,b,s); if (b) provider = await as(root, db => saveGameProvider(db, root, { ...cfg(), enabled: false })); return result; };
  await assert.rejects(exchangeGameLogin(input, stopped), /PROVIDER_DISABLED/);
  await assert.rejects(actorFromToken(web, session.token.slice(4)), error => error instanceof AppError && error.status === 401 && error.diagnostic.code === "diagnostics.auth.sessionExpiredSignInAgain");
  assert.deepEqual(await listGameProviders(), []);
  provider = await as(root, db => saveGameProvider(db, root, cfg()));
  const fresh = await exchangeGameLogin(await attempt(other, "999"), transport);
  const actor = await actorFromToken(web, fresh.token.slice(4));
  assert.deepEqual(await as(actor, db => db.launcherAuthProvider.findMany()), []);
  await assert.rejects(as(actor, db => saveGameProvider(db, actor, cfg())));
  await owner.organizationMember.update({ where: { organizationId_accountId: { organizationId: orgId, accountId: fresh.account.id } }, data: { status: "DISABLED" } });
  await assert.rejects(actorFromToken(web, fresh.token.slice(4)), error => error instanceof AppError && error.status === 401 && error.diagnostic.code === "diagnostics.auth.sessionExpiredSignInAgain");
  await assert.rejects(exchangeGameLogin(await attempt(other,"999"), transport), /ACCOUNT_OR_PROVIDER_UNAVAILABLE/);
  await owner.unionSkinSite.update({ where: { code: "MUA" }, data: { revision: { increment: 1 } } });
  assert.deepEqual(await listGameProviders(), []);
});

test("organization admins control only their own launcher authorization; stale writes and ordinary members are rejected", async () => {
  const org = await owner.organization.create({ data: { displayName: "Authorization fixture" } });
  const admin = await owner.account.create({ data: { displayName: "Organization admin" } });
  const reader = await owner.account.create({ data: { displayName: "Organization reader" } });
  await owner.organizationMember.createMany({ data: [{ organizationId: org.id, accountId: admin.id, roles: ["ORG_ADMIN"], grantedById: root.id }, { organizationId: org.id, accountId: reader.id, roles: ["READ_ONLY"], grantedById: root.id }] });
  assert.equal(org.launcherLoginEnabled, false);
  await assert.rejects(as(reader, db => updateOrganization(db, reader, org.id, { launcherLoginEnabled: true, launcherLoginRevision: 0 })));
  await assert.rejects(as(admin, db => updateOrganization(db, admin, orgId, { launcherLoginEnabled: false, launcherLoginRevision: 0 })));
  await assert.rejects(as(reader, db => db.organization.update({ where: { id: org.id }, data: { launcherLoginEnabled: true } })));
  await as(admin, db => updateOrganization(db, admin, org.id, { launcherLoginEnabled: true, launcherLoginRevision: 0 }));
  const state = await as(admin, db => getState(db, admin));
  assert.equal(state.organizations.find(row => row.id === org.id)?.launcherLoginEnabled, true);
  assert.equal(state.organizations.find(row => row.id === org.id)?.launcherLoginRevision, 1);
  await assert.rejects(as(admin, db => updateOrganization(db, admin, org.id, { launcherLoginEnabled: false, launcherLoginRevision: 0 })), error => error instanceof AppError && error.status === 409);
  await assert.rejects(as(admin, db => updateOrganization(db, admin, org.id, { launcherLoginEnabled: "true", launcherLoginRevision: 1 })));
  await assert.rejects(as(admin, db => updateUnionAuthorization(db, admin, { autoAuthorizeNewOrganizations: true, revision: 0 })));
});

test("new-organization defaults, ALI provisioning and revocation preserve existing choices and never revive old sessions", async () => {
  const kept = await owner.organization.create({ data: { displayName: "KEEP" } });
  await owner.unionSkinSite.create({ data: { code: "KEEP", organizationId: kept.id, bsRoot: "https://keep.example", upstreamPresent: true, managedBySync: true } });
  const before = await as(root, db => unionDirectoryStatus(db, root));
  await as(root, db => updateUnionAuthorization(db, root, { autoAuthorizeNewOrganizations: true, revision: before.authorizationRevision }));
  await assert.rejects(as(root, db => updateUnionAuthorization(db, root, { autoAuthorizeNewOrganizations: false, revision: before.authorizationRevision })), error => error instanceof AppError && error.status === 409);
  const sites = [{ code: "AUTOA", bs_root: "https://autoa.example" }, { code: "AUTOB", bs_root: "https://autob.example" }, { code: "KEEP", bs_root: "https://keep.example" }];
  const directoryRead: SiteReader = async url => ({ contentType: "application/json", bytes: Buffer.from(JSON.stringify(url === UNION_DIRECTORY_URL ? { servers: sites } : { meta: { serverName: "Fixture" } })) });
  const authRead: SiteReader = async url => {
    assert(!url.includes("keep.example"), "A previously unauthorized organization must not be auto-authorized");
    if (url.includes("autob.example")) throw Error("offline");
    return { status: 200, contentType: "application/json", bytes: Buffer.from(JSON.stringify({ meta: { serverName: "Fixture" }, signaturePublickey: "fixture public key", skinDomains: [] })),
      ...(url === "https://autoa.example/" ? { apiLocation: "/custom/auth/" } : {}) };
  };
  await as(root, db => requestUnionSync(db, root));
  const synced = await syncUnionDirectory(worker, directoryRead, authRead); assert(synced);
  assert(synced.issues.some(issue => issue.code === "AUTOB" && issue.issue === "LAUNCHER_API_UNAVAILABLE"));
  const site = await owner.unionSkinSite.findUniqueOrThrow({ where: { code: "AUTOA" }, include: { organization: true } });
  assert.equal(site.organization.launcherLoginEnabled, true);
  assert.equal((await owner.organization.findUniqueOrThrow({ where: { id: kept.id } })).launcherLoginEnabled, false);
  const source = await owner.launcherAuthProvider.findUniqueOrThrow({ where: { siteCode_bsRoot: { siteCode: "AUTOA", bsRoot: "https://autoa.example" } } });
  assert.equal(source.authApiRoot, "https://autoa.example/custom/auth/"); assert.equal(source.verifiedById, null); assert.equal(source.managedByOrganization, true);
  assert.equal(await owner.launcherAuthProvider.count({ where: { siteCode: "AUTOB" } }), 0);
  await as(root, db => requestUnionSync(db, root)); await syncUnionDirectory(worker, directoryRead, authRead);
  assert.equal((await owner.launcherAuthProvider.findUniqueOrThrow({ where: { id: source.id } })).revision, source.revision, "Unchanged discovery must not invalidate sessions every minute");
  const verifier = randomBytes(32).toString("base64url");
  const start = await startGameLogin({ providerId: source.id, codeChallenge: createHash("sha256").update(verifier).digest("base64url"), codeChallengeMethod: "S256" });
  const issued = await exchangeGameLogin({ attemptId: start.attemptId, nonce: start.nonce, codeVerifier: verifier, gameAccessToken: await token(), gameProfile: { id: profileA } },
    (url, body, signal) => transport(new URL(url.pathname, "https://skin.mualliance.ltd"), body, signal));
  await as(root, db => updateOrganization(db, root, site.organizationId, { launcherLoginEnabled: false, launcherLoginRevision: 0 }));
  assert(!(await listGameProviders() as { id: string }[]).some(row => row.id === source.id));
  await assert.rejects(actorFromToken(web, issued.token.slice(4)));
  await as(root, db => updateOrganization(db, root, site.organizationId, { launcherLoginEnabled: true, launcherLoginRevision: 1 }));
  await assert.rejects(actorFromToken(web, issued.token.slice(4)), "Reauthorization must not revive old sessions");
  let raced = false;
  const staleRead: SiteReader = async (url, ...args) => {
    if (url.startsWith("https://autoa.example/") && !raced) {
      raced = true;
      await as(root, db => updateOrganization(db, root, site.organizationId, { launcherLoginEnabled: false, launcherLoginRevision: 2 }));
      await as(root, db => updateOrganization(db, root, site.organizationId, { launcherLoginEnabled: true, launcherLoginRevision: 3 }));
    }
    const response = await authRead(url, ...args);
    return url === "https://autoa.example/" ? { ...response, apiLocation: "/changed/auth/" } : response;
  };
  await as(root, db => requestUnionSync(db, root)); await syncUnionDirectory(worker, directoryRead, staleRead);
  assert.equal(raced, true);
  assert.equal((await owner.launcherAuthProvider.findUniqueOrThrow({ where: { id: source.id } })).authApiRoot, source.authApiRoot,
    "Discovery started before an authorization revision change must not update the source");
  const manual = await owner.launcherAuthProvider.findUniqueOrThrow({ where: { id: source.id } });
  await as(root, db => saveGameProvider(db, root, { ...cfg(), id: source.id, revision: manual.revision, siteCode: "AUTOA", bsRoot: "https://autoa.example", enabled: false }));
  await as(root, db => requestUnionSync(db, root)); await syncUnionDirectory(worker, directoryRead, authRead);
  assert.equal((await owner.launcherAuthProvider.findUniqueOrThrow({ where: { id: source.id } })).enabled, false, "Directory synchronization must preserve explicit superadmin source stops");
  const status = await as(root, db => unionDirectoryStatus(db, root));
  await as(root, db => updateUnionAuthorization(db, root, { autoAuthorizeNewOrganizations: false, revision: status.authorizationRevision }));
  assert.equal((await owner.organization.create({ data: { displayName: "After default disabled" } })).launcherLoginEnabled, false);
});

test("YITUEM roots authorize independently even with one ALI API; revoking one preserves the other session", async () => {
  const roots = ["https://skin.yitmc.cn", "https://skin.uemcraft.cn"];
  const org = await owner.organization.create({ data: { displayName: "YITUEM independent" } });
  const admin = await owner.account.create({ data: { displayName: "YITUEM admin" } });
  await owner.organizationMember.create({ data: { organizationId: org.id, accountId: admin.id, roles: ["ORG_ADMIN"], grantedById: root.id } });
  await owner.unionSkinSite.create({ data: { code: "YITUEM", organizationId: org.id, bsRoot: roots[0], bsRootAliases: [roots[1]], managedBySync: true, upstreamPresent: true } });
  const change = (url: string, enabled: boolean, revision: number) => as(admin, db => updateOrganization(db, admin, org.id,
    { skinSiteAuthorizations: [{ code: "YITUEM", url, enabled }], launcherLoginRevision: revision }));
  const state = async () => (await as(admin, db => getState(db, admin))).organizations.find(row => row.id === org.id)!;
  assert.deepEqual((await state()).skinSites?.map(site => [site.url, site.launcherLoginEnabled]), roots.map(url => [url, false]));
  await change(roots[0], true, 0);
  const directory: SiteReader = async url => ({ contentType: "application/json", bytes: Buffer.from(JSON.stringify(url === UNION_DIRECTORY_URL
    ? { servers: roots.map(bs_root => ({ code: "YITUEM", bs_root })) } : { meta: { serverName: "YITUEM" } })) });
  const requested: string[] = [];
  const network: SiteReader = async url => { requested.push(url); return { status: 200, contentType: "application/json",
    ...(roots.some(root => url === root + "/") ? { apiLocation: "https://auth.yituem.example/shared/api/" } : {}),
    bytes: Buffer.from(JSON.stringify({ meta: { serverName: "YITUEM" }, signaturePublickey: "fixture", skinDomains: [] })) }; };
  await as(root, db => requestUnionSync(db, root)); assert(await syncUnionDirectory(worker, directory, network));
  let visible = (await listGameProviders() as { id: string; bsRoot: string; siteCode: string }[]).filter(row => row.siteCode === "YITUEM");
  assert.deepEqual(visible.map(row => row.bsRoot), [roots[0]]); assert(!requested.includes(roots[1] + "/"));
  await change(roots[1], true, 1);
  await as(root, db => requestUnionSync(db, root)); assert(await syncUnionDirectory(worker, directory, network));
  visible = (await listGameProviders() as typeof visible).filter(row => row.siteCode === "YITUEM"); assert.equal(visible.length, 2);
  const main = visible.find(row => row.bsRoot === roots[0])!, alias = visible.find(row => row.bsRoot === roots[1])!;
  const sessionFor = async (providerId: string) => {
    const verifier = randomBytes(32).toString("base64url");
    const start = await startGameLogin({ providerId, codeChallenge: createHash("sha256").update(verifier).digest("base64url"), codeChallengeMethod: "S256" });
    return exchangeGameLogin({ attemptId: start.attemptId, nonce: start.nonce, codeVerifier: verifier, gameAccessToken: await token(), gameProfile: { id: profileA } },
      (url, body, signal) => transport(new URL(url.pathname, "https://skin.mualliance.ltd"), body, signal));
  };
  const [mainSession, aliasSession] = await Promise.all([sessionFor(main.id), sessionFor(alias.id)]);
  const aliasRevision = (await owner.launcherAuthProvider.findUniqueOrThrow({ where: { id: alias.id } })).revision;
  await change(roots[0], false, 2);
  visible = (await listGameProviders() as typeof visible).filter(row => row.siteCode === "YITUEM"); assert.deepEqual(visible.map(row => row.bsRoot), [roots[1]]);
  await assert.rejects(actorFromToken(web, mainSession.token.slice(4)));
  assert.equal((await actorFromToken(web, aliasSession.token.slice(4))).id, aliasSession.account.id);
  assert.equal((await owner.launcherAuthProvider.findUniqueOrThrow({ where: { id: alias.id } })).revision, aliasRevision);
  assert.deepEqual((await state()).skinSites?.map(site => [site.url, site.launcherLoginEnabled]), [[roots[0], false], [roots[1], true]]);
  requested.length = 0;
  await as(root, db => requestUnionSync(db, root)); assert(await syncUnionDirectory(worker, directory, network));
  assert(!requested.includes(roots[0] + "/")); assert(requested.includes(roots[1] + "/"));
  await assert.rejects(change(roots[0], true, 2), error => error instanceof AppError && error.status === 409);
  await assert.rejects(change("https://other.example", true, 3), error => error instanceof AppError && error.status === 409);
  await change(roots[0], true, 3); await assert.rejects(actorFromToken(web, mainSession.token.slice(4)));
  assert.equal((await actorFromToken(web, aliasSession.token.slice(4))).id, aliasSession.account.id);
  await assert.rejects(owner.organization.update({ where: { id: org.id }, data: { launcherLoginOverrides: { [`YITUEM:${roots[0]}`]: "true" } } }));
});
