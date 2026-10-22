import "dotenv/config";
import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { generateKeyPair, SignJWT, jwtVerify } from "jose";
import { startGameLogin, exchangeGameLogin, listGameProviders, saveGameProvider, gameRequestPolicy, gameClientKey } from "../src/lib/launcher-game-auth";
import { GameLoginError, verifyGameIdentity } from "../src/lib/launcher-game-identity";
import { gameTransport, type GameTransport } from "../src/lib/launcher-game-network";
import { actorFromToken, tokenDigest, type Actor, type Db } from "../src/lib/auth";
import { securityFunction, setDatabaseActor } from "../src/lib/database-security";
import { disconnectDatabases, validateDatabase } from "../src/lib/prisma";
import { POST as startRoute } from "../src/app/api/auth/launcher/yggdrasil/start/route";
import { POST as exchangeRoute } from "../src/app/api/auth/launcher/yggdrasil/exchange/route";
import { spawn } from "node:child_process";
import { createServer } from "node:net";

const schema = `mua_game_${randomBytes(8).toString("hex")}`;
process.env.DATABASE_SCHEMA = schema; process.env.APP_ORIGIN = "https://link.mualliance.cn";
for (const name of ["DATABASE_URL", "DATABASE_AUTH_URL", "DATABASE_PUBLIC_URL", "DATABASE_WORKER_URL", "DATABASE_MIGRATION_URL"]) {
  const url = new URL(process.env[name]!); url.searchParams.delete("options"); process.env[name] = url.toString();
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_MIGRATION_URL, options: `-c role=mua_owner -c search_path=${schema},pg_catalog` });
const owner = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) });
const runtime = (env: string) => new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env[env], options: `-c search_path=${schema},pg_catalog` }, { schema }) });
const auth = runtime("DATABASE_AUTH_URL"), web = runtime("DATABASE_URL"), pub = runtime("DATABASE_PUBLIC_URL");
let root: Actor, orgId: string, created = false;
let provider: Awaited<ReturnType<typeof saveGameProvider>>;
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
const profileA = "a".repeat(32), profileB = "b".repeat(32), other = "c".repeat(32);
const profiles = new Map([[profileA, { id: profileA, name: "Main", uid: "123" }], [profileB, { id: profileB, name: "Test", uid: "123" }], [other, { id: other, name: "Other", uid: "999" }]]);
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
  for (const dir of (await readdir("prisma/migrations")).filter(x => /^\d/.test(x)).sort()) await pool.query(await readFile(`prisma/migrations/${dir}/migration.sql`, "utf8"));
  root = await owner.account.create({ data: { displayName: "fixture root", isSuperAdmin: true } });
  orgId = (await owner.organization.create({ data: { displayName: "MUA" } })).id;
  await owner.unionSkinSite.create({ data: { code: "MUA", organizationId: orgId, bsRoot: "https://skin.mualliance.ltd", upstreamPresent: true, managedBySync: true } });
  provider = { id: randomUUID(), revision: 0 } as typeof provider;
  provider = await as(root, db => saveGameProvider(db, root, cfg()));
});
after(async () => {
  await Promise.all([owner, auth, web, pub].map(db => db.$disconnect())); await disconnectDatabases();
  if (created) { assert.match(schema, /^mua_game_[a-f0-9]{16}$/); await pool.query(`DROP SCHEMA "${schema}" CASCADE`); await pool.query(`DROP SCHEMA IF EXISTS "${schema}_authz" CASCADE`); }
  await pool.end();
});

test("new models enforce RLS and only approved safe provider data are public", async () => {
  for (const purpose of ["web", "auth", "public", "worker"] as const) await validateDatabase(purpose);
  const rows = await listGameProviders() as Record<string, unknown>[];
  assert.equal(rows.length, 1); assert.equal(rows[0].id, provider.id); assert.equal(rows[0].directExchange, true);
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
  assert.equal(invalid.status, 400); const error = await invalid.json(); assert.equal(error.code, "INVALID_REQUEST"); assert(!JSON.stringify(error).includes("private-secret"));
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
  await owner.launcherGameLoginAttempt.update({ where: { id: input.attemptId }, data: { createdAt: new Date(Date.now()-300_000), expiresAt: new Date(Date.now()-180_000) } });
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
    env:{...process.env,APP_ORIGIN:base,NODE_ENV:"production"},windowsHide:true,stdio:["ignore","ignore","ignore"]});
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
    const bad = await fetch(base+"/api/auth/launcher/yggdrasil/exchange",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({gameProfile:{id:profileA},sub:"MUA:999"})});assert.equal(bad.status,400);assert.equal((await bad.json()).code,"INVALID_REQUEST");
    const blocked = await fetch(base+"/api/auth/launcher/yggdrasil/start",{method:"POST",headers:{Origin:"https://evil.invalid","Content-Type":"application/json"},body:"{}"});assert.equal(blocked.status,403);
    const configHeaders={Origin:base,"Content-Type":"application/json",cookie:`mua_session=${cookie}`};
    const noOrigin=await fetch(base+"/api/admin/launcher-providers",{method:"PUT",headers:{"Content-Type":"application/json",cookie:`mua_session=${cookie}`},body:JSON.stringify(cfg())});assert.equal(noOrigin.status,403);
    const saved=await fetch(base+"/api/admin/launcher-providers",{method:"PUT",headers:configHeaders,body:JSON.stringify(cfg())});assert.equal(saved.status,200);provider=await saved.json();
    assert.equal((await fetch(base+"/api/member",{headers:{Authorization:`Bearer ${session.token}`}})).status,401,"Saving provider configuration must invalidate old sessions");
    if(process.env.MUA_UNION_BROWSER_TEST==="1"){
      const {chromium}=await import("@playwright/test"); const browser=await chromium.launch({channel:"msedge",headless:true});
      try{const context=await browser.newContext({viewport:{width:1440,height:1000}}); await context.addCookies([{name:"mua_session",value:cookie,url:base,httpOnly:true,sameSite:"Lax"}]);
        const page=await context.newPage();const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
        const loaded=page.waitForResponse(r=>r.url().includes("/api/admin/openapi")&&r.status()===200);
        await page.goto(base+"/admin/api"); const renderedSpec=await (await loaded).json();
        assert(renderedSpec.paths["/api/auth/launcher/yggdrasil/exchange"]);
        await page.getByRole("heading",{name:"Union Link API",exact:true}).waitFor({timeout:30_000});
        await page.screenshot({path:".local/launcher-exchange-api.png"}); assert.deepEqual(errors,[]);
      }finally{await browser.close();}
    }
  } finally { server.kill(); }
});
test("provider revision/disable and local stop flags invalidate sessions and in-flight exchanges", async () => {
  const session = await exchangeGameLogin(await attempt(other, "999"), transport);
  const input = await attempt();
  const stopped: GameTransport = async (u,b,s) => { const result = await transport(u,b,s); if (b) provider = await as(root, db => saveGameProvider(db, root, { ...cfg(), enabled: false })); return result; };
  await assert.rejects(exchangeGameLogin(input, stopped), /PROVIDER_DISABLED/);
  await assert.rejects(actorFromToken(web, session.token.slice(4)), /会话已失效/);
  assert.deepEqual(await listGameProviders(), []);
  provider = await as(root, db => saveGameProvider(db, root, cfg()));
  const fresh = await exchangeGameLogin(await attempt(other, "999"), transport);
  const actor = await actorFromToken(web, fresh.token.slice(4));
  assert.deepEqual(await as(actor, db => db.launcherAuthProvider.findMany()), []);
  await assert.rejects(as(actor, db => saveGameProvider(db, actor, cfg())));
  await owner.organizationMember.update({ where: { organizationId_accountId: { organizationId: orgId, accountId: fresh.account.id } }, data: { status: "DISABLED" } });
  await assert.rejects(actorFromToken(web, fresh.token.slice(4)), /会话已失效/);
  await assert.rejects(exchangeGameLogin(await attempt(other,"999"), transport), /ACCOUNT_OR_PROVIDER_UNAVAILABLE/);
  await owner.unionSkinSite.update({ where: { code: "MUA" }, data: { revision: { increment: 1 } } });
  assert.deepEqual(await listGameProviders(), []);
});
