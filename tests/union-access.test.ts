import "dotenv/config";
import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { actorFromToken, authorized, tokenDigest, type Actor, type Db } from "../src/lib/auth";
import { securityFunction, setDatabaseActor } from "../src/lib/database-security";
import { disconnectDatabases, validateDatabase } from "../src/lib/prisma";
import { saveUnionSite, submitAccess, decideAccess, revokeAccess, accessCandidates } from "../src/lib/organization-access";
import { memberState, memberDistribution, requestMemberToken } from "../src/lib/member-access";
import { beginUnionLogin, completeUnionLogin, exchangeUnionCode, unionReturnTo } from "../src/lib/union-oauth";
import { startLauncherLogin, approveLauncherLogin, claimLauncherLogin } from "../src/lib/launcher-auth";
import { hashPassword } from "../src/lib/password";
import { login } from "../src/lib/auth";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { GET as startUnionRoute } from "../src/app/api/auth/union/start/route";
import { syncUnionDirectory, importUnionAvatars, unionDirectoryStatus, requestUnionSync } from "../src/lib/union-directory";
import { parseUnionDirectory, UNION_DIRECTORY_URL, YITUEM_ROOTS } from "../src/lib/union-directory-contract";
import { getState, searchAccounts, setGrant, setMember, updateOrganization } from "../src/lib/management";
import { fetchUnionSiteName } from "../src/lib/union-site-metadata";
import { prepareOrganizationAvatar, storeOrganizationAvatar, readOrganizationAvatar, saveOrganizationAvatar } from "../src/lib/organization-avatar";
import { iconRaster, siteIconCandidates } from "../src/lib/union-site-icons";
import sharp from "sharp";
import { storageClient, packagesBucket } from "../src/lib/storage";

const schema = `mua_union_${randomBytes(8).toString("hex")}`;
process.env.DATABASE_SCHEMA = schema;
process.env.APP_ORIGIN = "https://link.mualliance.cn";
process.env.UNION_OAUTH_CLIENT_ID = "test-client";
process.env.UNION_OAUTH_CLIENT_SECRET = "test-secret-not-a-real-credential";
for (const key of ["DATABASE_URL", "DATABASE_AUTH_URL", "DATABASE_WORKER_URL", "DATABASE_PUBLIC_URL", "DATABASE_MIGRATION_URL"]) {
  const u = new URL(process.env[key]!); u.searchParams.delete("options"); process.env[key] = u.toString();
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_MIGRATION_URL, options: `-c role=mua_owner -c search_path=${schema},pg_catalog` });
const owner = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) });
function runtime(key: string) { return new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env[key], options: `-c search_path=${schema},pg_catalog` }, { schema }) }); }
const web = runtime("DATABASE_URL"), auth = runtime("DATABASE_AUTH_URL"), pub = runtime("DATABASE_PUBLIC_URL"), worker = runtime("DATABASE_WORKER_URL");
let root: Actor, sourceAdmin: Actor, targetAdmin: Actor, sourceOrg: string, targetOrg: string, memberId: string, memberCookie: string, adminCookie: string;
let created = false;
const avatarObjects = new Set<string>();
const oldDescriptionId = randomUUID(), oldClearedId = randomUUID(), oldUntouchedId = randomUUID();
const req = (cookie = memberCookie) => new Request("https://link.mualliance.cn/api/member", { headers: { cookie: `mua_session=${cookie}` } });
async function as<T>(actor: Actor, work: (db: Db) => Promise<T>) { return web.$transaction(async db => { await db.$executeRaw`SELECT pg_advisory_xact_lock(731402,1)`; await setDatabaseActor(db, actor); return work(db); }); }
async function published(serverId: string, org = targetOrg, publish = true) {
  return owner.$transaction(async db => {
    await db.server.create({ data: { serverId, organizationId: org, displayName: serverId, isListed: publish } });
    const c = await db.client.create({ data: { organizationId: org, name: serverId, nameKey: serverId.toLowerCase(), scopeServerId: serverId } });
    const d = await db.clientDraft.create({ data: { clientId: c.id, createdById: root.id, name: serverId, versionLabel: "1.0.0", status: "APPROVED",
      reviewedById: root.id, reviewedAt: new Date(), reviewedRevision: 1, reviewedPackageRevision: 1, candidateMetadata: {}, candidateManifestKey: `${serverId}/manifest`, candidateManifestSha256: "a".repeat(64) } });
    const r = await db.clientRelease.create({ data: { clientId: c.id, sourceDraftId: d.id, versionLabel: "1.0.0", name: serverId, summary: "", description: "", changelog: "",
      environmentSnapshot: {}, manifestObjectKey: `${serverId}/manifest`, manifestSha256: "a".repeat(64), signingKeyId: "fixture", signature: "fixture", approvedById: root.id, publishedById: root.id } });
    await db.client.update({ where: { id: c.id }, data: { currentReleaseId: r.id } });
    await db.serverPublication.create({ data: { serverId, clientId: c.id, releaseId: r.id, changedById: root.id } });
    return { client: c, release: r };
  });
}
const transport = (sub: string): typeof fetch => async (url, init) => {
  if (String(url).endsWith("/token")) {
    const body = new URLSearchParams(String(init?.body)); assert(body.get("code_verifier")); assert.equal(body.get("redirect_uri"), "https://link.mualliance.cn/api/auth/union/callback");
    return Response.json({ access_token: "mock-union-token", token_type: "Bearer", expires_in: 60 });
  }
  assert.equal(String(url), "https://skin.mualliance.ltd/api/union/oauth2/user");
  return Response.json({ sub, nickname: sub, email: "same@example.invalid" });
};
before(async () => {
  await pool.query(`CREATE SCHEMA "${schema}"`); created = true;
  for (const dir of (await readdir("prisma/migrations")).filter(x => /^\d/.test(x)).sort()) {
    if (dir === "202610220003_union_site_descriptions") {
      const author = randomUUID();
      await pool.query('INSERT INTO "Account"(id,"displayName","updatedAt") VALUES($1,\'historical author\',now())', [author]);
      await pool.query('INSERT INTO "Organization"(id,"displayName",description,"updatedAt") VALUES($1,\'historical prose\',\'原有简介\',now()),($2,\'historical clear\',\'\',now()),($3,\'untouched\',\'\',now())', [oldDescriptionId, oldClearedId, oldUntouchedId]);
      await pool.query('INSERT INTO "AuditEvent"(id,"actorId",action,"targetType","targetId",details) VALUES($1,$2,\'ORGANIZATION_EDIT\',\'Organization\',$3,\'{"fields":["description"]}\')', [randomUUID(), author, oldClearedId]);
    }
    await pool.query(await readFile(`prisma/migrations/${dir}/migration.sql`, "utf8"));
  }
  root = await owner.account.create({ data: { displayName: "root", isSuperAdmin: true } });
  sourceAdmin = await owner.account.create({ data: { displayName: "MUA admin" } }); targetAdmin = await owner.account.create({ data: { displayName: "NPU admin" } });
  sourceOrg = (await owner.organization.create({ data: { displayName: "MUA" } })).id;
  targetOrg = (await owner.organization.create({ data: { displayName: "NPU" } })).id;
  for (const [org, account] of [[sourceOrg, sourceAdmin.id], [targetOrg, targetAdmin.id]]) await owner.organizationMember.create({ data: { organizationId: org, accountId: account, roles: ["ORG_ADMIN"], grantedById: root.id } });
  await as(root, db => saveUnionSite(db, root, { code: "MUA", organizationId: sourceOrg, bsRoot: "https://skin.mualliance.ltd", enabled: true, revision: 0 }));
  await as(root, db => saveUnionSite(db, root, { code: "NPU", organizationId: targetOrg, bsRoot: "https://skin.example.invalid", enabled: true, revision: 0 }));
  memberCookie = randomBytes(32).toString("hex");
  const rows = await auth.$queryRaw<{ id: string }[]>`SELECT ${securityFunction("union_login")}(\'MUA:123\',\'member\',${tokenDigest(memberCookie)},${new Date(Date.now() + 3600_000)}) AS id`; memberId = rows[0].id;
  adminCookie = randomBytes(32).toString("hex"); await owner.session.create({ data: { tokenHash: tokenDigest(adminCookie), accountId: sourceAdmin.id, expiresAt: new Date(Date.now()+3600_000) } });
  await published("MUA",sourceOrg); await published("NPA"); await published("NPB"); await published("NPC",targetOrg,false);
});
after(async () => {
  for (const key of avatarObjects) for (const name of ["image.webp", "source.webp", "metadata.json"]) await storageClient().deleteObject({ Bucket: packagesBucket(), Key: key.slice(0,-10)+name });
  await Promise.all([owner,web,auth,pub,worker].map(db=>db.$disconnect())); await disconnectDatabases();
  if (created) { assert.match(schema,/^mua_union_[a-f0-9]{16}$/); await pool.query(`DROP SCHEMA "${schema}" CASCADE`); await pool.query(`DROP SCHEMA IF EXISTS "${schema}_authz" CASCADE`); }
  await pool.end();
});
test("new models force RLS and anonymous distribution projections are gone", async () => {
  for (const purpose of ["web","auth","worker","public"] as const) await validateDatabase(purpose);
  await assert.rejects(pub.$queryRaw`SELECT ${securityFunction("distribution_servers")}()`);
  await assert.rejects(web.$queryRaw`SELECT ${securityFunction("distribution_servers")}()`);
  await assert.rejects(auth.organizationAccessGrant.findMany());
  await assert.rejects(worker.organizationAccessGrant.findMany());
});
test("description migration preserves existing prose and historical manual clearing", async () => {
  for (const id of [oldDescriptionId, oldClearedId]) assert.equal((await owner.organization.findUniqueOrThrow({ where: { id } })).descriptionMode, "MANUAL");
  assert.equal((await owner.organization.findUniqueOrThrow({ where: { id: oldUntouchedId } })).descriptionMode, "AUTO");
});
test("automatic membership has no admin roles, credentials or superadmin privilege", async () => {
  const a = await owner.account.findUniqueOrThrow({ where: { id: memberId }, include: { credential:true, memberships:true } });
  assert.equal(a.isSuperAdmin,false); assert.equal(a.credential,null); assert.deepEqual(a.memberships[0].roles,["PLAYER"]); assert.equal(a.memberships[0].source,"UNION"); assert.equal(a.memberships[0].grantedById,null);
  await assert.rejects(authorized(memberCookie,false,async()=>undefined));
  const state = await memberState(req()); assert.deepEqual(state.servers.map(s=>s.serverId),["MUA"]); assert.equal(state.actor.canManage,false);
});
test("Union identity is projected to authorized member lists and account search, without granting PLAYER backstage access",async()=>{
  const state=await as(sourceAdmin,db=>getState(db,sourceAdmin));
  const account=state.organizations.find(o=>o.id===sourceOrg)!.members.find(m=>m.account.id===memberId)!.account;
  assert.equal(account.unionSubject,"MUA:123");assert.equal(account.username,"");assert.equal(state.accounts.length,0);
  assert.equal((await as(sourceAdmin,db=>searchAccounts(db,sourceAdmin,sourceOrg,"MUA:123")))[0].unionSubject,"MUA:123");
  assert.deepEqual(await web.$queryRaw`SELECT * FROM ${securityFunction("account_identity_directory")}()`,[]);
  await assert.rejects(pub.$queryRaw`SELECT * FROM ${securityFunction("account_identity_directory")}()`);
  const actor=await actorFromToken(web,memberCookie);assert.equal(actor.unionSubject,"MUA:123");assert.equal(actor.canManage,false);
  assert.equal(await as(actor,db=>db.clientDraft.count()),0);
  await as(root,db=>setMember(db,root,sourceOrg,memberId,{roles:[],status:"ACTIVE"}));
  assert.deepEqual((await owner.organizationMember.findUniqueOrThrow({where:{organizationId_accountId:{organizationId:sourceOrg,accountId:memberId}}})).roles,["PLAYER"]);
  assert.equal((await actorFromToken(web,memberCookie)).canManage,false);
  await assert.rejects(as(root,db=>setGrant(db,root,sourceOrg,memberId,"MUA",{roles:["PLAYER"]})));
  await as(root,db=>setGrant(db,root,sourceOrg,memberId,"MUA",{roles:["SERVER_EDITOR"]}));
  assert.equal((await actorFromToken(web,memberCookie)).canManage,true);
  await as(root,db=>setGrant(db,root,sourceOrg,memberId,"MUA",{roles:[]}));
  assert.equal((await actorFromToken(web,memberCookie)).canManage,false);
});
test("local username/password login still creates an existing-system web session", async () => {
  await owner.localCredential.create({ data: { accountId:sourceAdmin.id,username:"union-local-admin",passwordHash:await hashPassword("local-password-fixture") } });
  const result=await login("union-local-admin","local-password-fixture",undefined,auth);
  const actor=await actorFromToken(web,result.token); assert.equal(actor.id,sourceAdmin.id); assert.equal(actor.canManage,true);
});
test("OAuth uses S256 and browser-bound one-use state, independent of old login Cookie", async () => {
  const start=await beginUnionLogin("/member"); const state=start.url.searchParams.get("state")!;
  assert.equal(start.url.searchParams.get("code_challenge_method"),"S256"); assert(start.url.searchParams.get("code_challenge"));
  const callback=new URL(`https://link.mualliance.cn/api/auth/union/callback?code=test-code&state=${state}`);
  await assert.rejects(completeUnionLogin(callback,randomBytes(32).toString("hex"),transport("MUA:123")));
  const session=await completeUnionLogin(callback,start.browser,transport("MUA:123")); assert.equal((await actorFromToken(web,session.token)).id,memberId);
  await assert.rejects(completeUnionLogin(callback,start.browser,transport("MUA:123")));
  assert.equal(await owner.unionIdentity.count({where:{subject:"MUA:123"}}),1);
});
test("OAuth start sets a separate five-minute Secure HttpOnly Lax transaction cookie",async()=>{
  const response=await startUnionRoute(new Request("https://link.mualliance.cn/api/auth/union/start",{headers:{cookie:`mua_session=${memberCookie}`}}));
  assert.equal(response.status,303);const cookie=response.headers.get("set-cookie")!;assert.match(cookie,/mua_union_login=/);assert.match(cookie,/Max-Age=300/i);assert.match(cookie,/SameSite=lax/i);assert.match(cookie,/HttpOnly/i);assert.match(cookie,/Secure/i);assert.match(cookie,/Path=\/api\/auth\/union/i);assert(!cookie.includes(memberCookie));
  assert.equal(new URL(response.headers.get("location")!).searchParams.get("redirect_uri"),"https://link.mualliance.cn/api/auth/union/callback");
});
test("invalid state is rejected before token exchange; failed exchange consumes state",async()=>{
  const start=await beginUnionLogin("/member"),state=start.url.searchParams.get("state")!;
  let called=false;const broken:typeof fetch=async()=>{called=true;throw new Error("fixture exchange failure");};
  await assert.rejects(completeUnionLogin(new URL(`https://link.mualliance.cn/api/auth/union/callback?code=x&state=${state}`),undefined,broken));assert.equal(called,false);
  await assert.rejects(completeUnionLogin(new URL(`https://link.mualliance.cn/api/auth/union/callback?code=x&state=${state}`),start.browser,broken));assert.equal(called,true);
  called=false;await assert.rejects(completeUnionLogin(new URL(`https://link.mualliance.cn/api/auth/union/callback?code=x&state=${state}`),start.browser,broken));assert.equal(called,false);
});
test("protocol rejects mismatched state and arbitrary return targets",async()=>{
  await assert.rejects(exchangeUnionCode(new URL("https://link.mualliance.cn/api/auth/union/callback?code=x&state=wrong"),"expected","verifier",transport("MUA:123")));
  assert.throws(()=>unionReturnTo("https://example.invalid")); assert.throws(()=>unionReturnTo("//example.invalid"));
});
test("same email from another skin site stays a separate local identity",async()=>{
  const start=await beginUnionLogin("/member");const session=await completeUnionLogin(new URL(`https://link.mualliance.cn/api/auth/union/callback?code=x&state=${start.url.searchParams.get("state")}`),start.browser,transport("NPU:123"));
  const other=await actorFromToken(web,session.token);assert.notEqual(other.id,memberId);assert.deepEqual((await memberState(req(session.token))).servers.map(s=>s.serverId),["NPA","NPB"]);
});
test("source admin cannot approve, external raw writes and unpublished candidates are denied",async()=>{
  const candidates=await as(sourceAdmin,db=>accessCandidates(db,sourceOrg,targetOrg)) as {serverId:string}[];assert.deepEqual(candidates.map(s=>s.serverId),["NPA","NPB"]);
  const r=await as(sourceAdmin,db=>submitAccess(db,{sourceOrganizationId:sourceOrg,targetOrganizationId:targetOrg,accountId:memberId,serverIds:["NPA"],autoIncludeNewServers:true,reason:"fixture"}));
  await assert.rejects(as(sourceAdmin,db=>decideAccess(db,r.id,{revision:1,decision:"APPROVED",note:""})));
  await assert.rejects(as(sourceAdmin,db=>db.organizationAccessGrant.create({data:{id:randomUUID(),requestId:r.id,sourceOrganizationId:sourceOrg,targetOrganizationId:targetOrg,accountId:memberId,serverIds:["NPB"],autoIncludeNewServers:true,approvedAt:new Date()}})));
  assert.deepEqual((await memberState(req())).servers.map(s=>s.serverId),["MUA"]);
  await as(targetAdmin,db=>decideAccess(db,r.id,{revision:1,decision:"APPROVED",note:"approved"}));
  assert.deepEqual((await memberState(req())).servers.map(s=>s.serverId),["MUA","NPA"]);
  await assert.rejects(as(targetAdmin,db=>decideAccess(db,r.id,{revision:1,decision:"APPROVED",note:""})));
  await assert.rejects(memberDistribution(req(),"NPB",null,async()=>({})));
});
test("auto-new includes first published server, never an unselected existing server",async()=>{
  await owner.server.update({where:{serverId:"NPC"},data:{isListed:true}});
  await owner.server.update({where:{serverId:"NPB"},data:{isListed:false}});await owner.server.update({where:{serverId:"NPB"},data:{isListed:true}});
  assert.deepEqual((await memberState(req())).servers.map(s=>s.serverId),["MUA","NPA","NPC"]);
});
test("scheduled first availability is captured before reads and later window changes cannot add existing servers",async()=>{
  await published("NPD",targetOrg,false);
  await owner.server.update({where:{serverId:"NPD"},data:{isListed:true,displayMode:"RANGE",displayStartsAt:new Date(Date.now()+60_000),displayEndsAt:new Date(Date.now()+120_000)}});
  assert(!(await memberState(req())).servers.some(s=>s.serverId==="NPD"));
  const v=await owner.serverMemberVisibility.findUniqueOrThrow({where:{serverId:"NPD"}});assert(v.firstVisibleAt>new Date());
  await owner.server.update({where:{serverId:"NPD"},data:{isListed:false}});assert.equal(await owner.serverMemberVisibility.findUnique({where:{serverId:"NPD"}}),null);
});
test("revocation removes direct downloads and old sessions without changing home membership",async()=>{
  const grant=await owner.organizationAccessGrant.findFirstOrThrow({where:{accountId:memberId,revokedAt:null}});
  await as(sourceAdmin,db=>revokeAccess(db,grant.id,{reason:"source withdrawal"}));
  assert.deepEqual((await memberState(req())).servers.map(s=>s.serverId),["MUA"]);await assert.rejects(memberDistribution(req(),"NPA",null,async()=>({})));
  assert.equal(await owner.organizationMember.count({where:{accountId:memberId}}),1);
});
test("Launcher uses verifier-bound one-time claim and cannot be used as admin or browser Cookie",async()=>{
  const verifier=randomBytes(32).toString("base64url"), challenge=createHash("sha256").update(verifier).digest("base64url");
  const attempt=await startLauncherLogin({challenge});assert.deepEqual(await claimLauncherLogin({id:attempt.id,verifier}),{pending:true});
  await assert.rejects(claimLauncherLogin({id:attempt.id,verifier:randomBytes(32).toString("base64url")}));
  assert.equal((await auth.loginThrottle.findUniqueOrThrow({where:{key:tokenDigest(`launcher-claim:${attempt.id}`)}})).attempts,2,"bad verifier attempts must remain counted after rejection");
  await approveLauncherLogin(attempt.id,memberCookie);const result=await claimLauncherLogin({id:attempt.id,verifier});assert.equal(result.pending,false);assert("token" in result);
  const request=new Request("https://link.mualliance.cn/api/member",{headers:{authorization:`Bearer ${result.token}`}});assert.equal((await memberState(request)).actor.id,memberId);
  await assert.rejects(authorized(result.token!.slice(4),false,async()=>undefined));await assert.rejects(memberState(req(result.token!.slice(4))));
  await assert.rejects(claimLauncherLogin({id:attempt.id,verifier}));
  assert.throws(()=>requestMemberToken(new Request("https://link.mualliance.cn",{headers:{authorization:"Bearer invalid",cookie:`mua_session=${memberCookie}`}})));
});
test("manual disable is never undone by a new OAuth login",async()=>{
  await owner.organizationMember.update({where:{organizationId_accountId:{organizationId:sourceOrg,accountId:memberId}},data:{status:"DISABLED"}});
  const cookie=randomBytes(32).toString("hex");await assert.rejects(auth.$queryRaw`SELECT ${securityFunction("union_login")}(\'MUA:123\',\'member\',${tokenDigest(cookie)},${new Date(Date.now()+60_000)})`);
  assert.deepEqual((await memberState(req())).servers,[]);
});

test("directory parsing de-duplicates identical sites, isolates conflicting CODEs and accepts actual alphanumeric CODEs",()=>{
  const parsed=parseUnionDirectory({version:1,servers:[{code:"TEST2",bs_root:"https://test.example/"},{code:"TEST2",bs_root:"https://test.example"},{code:"DUP",bs_root:"https://a.example"},{code:"DUP",bs_root:"https://b.example"},{code:"BAD",bs_root:"http://127.0.0.1"}]});
  assert.deepEqual(parsed.sites,[{code:"TEST2",bsRoot:"https://test.example"}]);assert(parsed.issues.some(x=>x.issue==="DUPLICATE_CODE"));assert(parsed.issues.some(x=>x.issue==="INVALID_URL"));
  assert.throws(()=>parseUnionDirectory({servers:[]}));
});
test("YITUEM accepts only its confirmed merged domains and preserves one CODE identity",async()=>{
  const servers=YITUEM_ROOTS.map(bs_root=>({code:"YITUEM",bs_root}));
  const parsed=parseUnionDirectory({servers:[...servers].reverse()});
  assert.deepEqual(parsed.issues,[]);assert.deepEqual(parsed.sites,[{code:"YITUEM",bsRoot:YITUEM_ROOTS[0],bsRootAliases:[YITUEM_ROOTS[1]]}]);
  const unknown=parseUnionDirectory({servers:[...servers,{code:"YITUEM",bs_root:"https://unknown.example"}]});
  assert.equal(unknown.sites.length,0);assert.deepEqual(unknown.issues,[{code:"YITUEM",issue:"DUPLICATE_CODE"}]);
  const read=async(url:string)=>({bytes:Buffer.from(JSON.stringify(url===UNION_DIRECTORY_URL?{servers}:{meta:{serverName:"YIT & UEM 联合皮肤站"}})),contentType:"application/json"});
  await as(root,db=>requestUnionSync(db,root));const first=await syncUnionDirectory(worker,read);assert(first);assert.equal(first.created,1);assert.equal(first.synced,1);assert.deepEqual(first.issues,[]);
  const site=await owner.unionSkinSite.findUniqueOrThrow({where:{code:"YITUEM"}});assert.deepEqual([site.bsRoot,...site.bsRootAliases],YITUEM_ROOTS);
  assert.equal((await owner.organization.findUniqueOrThrow({where:{id:site.organizationId}})).description,"YIT & UEM 联合皮肤站");
  assert.equal(await owner.organizationMember.count({where:{organizationId:site.organizationId}}),0);
  assert.deepEqual((await as(root,db=>getState(db,root))).organizations.find(o=>o.id===site.organizationId)?.skinSites,YITUEM_ROOTS.map(url=>({code:"YITUEM",url})));
  await as(root,db=>requestUnionSync(db,root));const second=await syncUnionDirectory(worker,read);assert(second);assert.equal(second.created,0);
  const repeated=await owner.unionSkinSite.findUniqueOrThrow({where:{code:"YITUEM"}});assert.equal(repeated.organizationId,site.organizationId);assert.equal(repeated.revision,site.revision);
  const token=randomBytes(32).toString("hex");await auth.$queryRaw`SELECT ${securityFunction("union_login")}('YITUEM:123','merged member',${tokenDigest(token)},${new Date(Date.now()+60_000)})`;
  const member=(await memberState(req(token)));assert.equal(member.organizations.length,1);assert.equal(member.organizations[0].id,site.organizationId);
  const createdMember=await owner.organizationMember.findFirstOrThrow({where:{organizationId:site.organizationId}});assert.deepEqual(createdMember.roles,["PLAYER"]);
  await assert.rejects(owner.unionSkinSite.update({where:{code:"YITUEM"},data:{bsRootAliases:["https://unknown.example"]}}));
  await assert.rejects(worker.$transaction(async tx=>{const lease=randomUUID();await tx.unionSyncState.update({where:{id:"union"},data:{leaseToken:lease,leaseUntil:new Date(Date.now()+60_000)}});
    await tx.$queryRaw`SELECT ${securityFunction("union_apply_sites")}(${JSON.stringify([{code:"OTHER",bsRoot:YITUEM_ROOTS[0],bsRootAliases:[YITUEM_ROOTS[1]]}])}::jsonb,${lease}::uuid)`;}));
});
test("minute directory sync creates stable organizations without members, reuses existing CODE names and preserves manual controls",async()=>{
  const existing=await owner.organization.create({data:{displayName:"AUTO"}});
  const payload={version:99,servers:[{code:"AUTO",bs_root:"https://auto.example"},{code:"TEST2",bs_root:"https://test.example"},{code:"DUP",bs_root:"https://a.example"},{code:"DUP",bs_root:"https://b.example"}]};
  const read=async()=>({bytes:Buffer.from(JSON.stringify(payload)),contentType:"application/json"});
  await as(root,db=>requestUnionSync(db,root));const first=await syncUnionDirectory(worker,read);assert(first);assert.equal(first.created,1);assert.equal(first.synced,2);
  assert.equal((await owner.unionSkinSite.findUniqueOrThrow({where:{code:"AUTO"}})).organizationId,existing.id);
  const auto=await owner.unionSkinSite.findUniqueOrThrow({where:{code:"TEST2"}});assert.equal(await owner.organizationMember.count({where:{organizationId:auto.organizationId}}),0);
  assert.equal(await syncUnionDirectory(worker,read),false);await as(root,db=>requestUnionSync(db,root));
  await owner.unionSkinSite.update({where:{code:"TEST2"},data:{enabled:false}});
  const second=await syncUnionDirectory(worker,read);assert(second);assert.equal(second.created,0);assert.equal((await owner.unionSkinSite.findUniqueOrThrow({where:{code:"TEST2"}})).enabled,false);
  await assert.rejects(worker.organization.create({data:{displayName:"Unauthorized"}}));
  const status=await as(root,db=>unionDirectoryStatus(db,root));assert.equal(status.status,"PARTIAL");assert.equal(status.intervalSeconds,60);assert.equal(status.syncedCount,2);
  await assert.rejects(as(sourceAdmin,db=>unionDirectoryStatus(db,sourceAdmin)));await assert.rejects(as(sourceAdmin,db=>requestUnionSync(db,sourceAdmin)));
  await owner.unionSkinSite.update({where:{code:"TEST2"},data:{enabled:true}});
  const token=randomBytes(32).toString("hex");await auth.$queryRaw`SELECT ${securityFunction("union_login")}('TEST2:1','test member',${tokenDigest(token)},${new Date(Date.now()+60_000)})`;
  assert.equal((await memberState(req(token))).organizations[0].displayName,"TEST2");
});
test("upstream failure preserves mappings and schedules the next minute instead of clearing existing organizations",async()=>{
  await as(root,db=>requestUnionSync(db,root));const count=await owner.organization.count();const mappings=await owner.unionSkinSite.count();
  assert.equal(await syncUnionDirectory(worker,async()=>{throw Error("network unavailable");}),false);
  assert.equal(await owner.organization.count(),count);assert.equal(await owner.unionSkinSite.count(),mappings);
  const status=await as(root,db=>unionDirectoryStatus(db,root));assert.equal(status.status,"ERROR");assert(status.syncedAt);assert(status.nextSyncAt);
});
test("site names come only from bounded Yggdrasil metadata, with merged-domain fallback",async()=>{
  const attempted:string[]=[];
  const name=await fetchUnionSiteName([...YITUEM_ROOTS],async(url,limit)=>{
    attempted.push(url);assert.equal(limit,64*1024);
    if(url.startsWith(YITUEM_ROOTS[0]))throw Error("unavailable");
    return{bytes:Buffer.from(JSON.stringify({meta:{serverName:"  YIT & UEM 联合皮肤站  "}})),contentType:"application/json; charset=utf-8"};
  },AbortSignal.timeout(1000));
  assert.equal(name,"YIT & UEM 联合皮肤站");assert.deepEqual(attempted,YITUEM_ROOTS.map(root=>`${root}/api/yggdrasil`));
  for(const serverName of [null,""," ","x".repeat(201),"bad\u0000name","hidden\u202ename",{name:"wrong"}])
    await assert.rejects(fetchUnionSiteName(["https://name.example"],async()=>({bytes:Buffer.from(JSON.stringify({meta:{serverName}})),contentType:"application/json"}),AbortSignal.timeout(1000)));
  await assert.rejects(fetchUnionSiteName(["https://name.example"],async()=>({bytes:Buffer.from('<title>HTML is not metadata</title>'),contentType:"text/html"}),AbortSignal.timeout(1000)));
});
test("organization avatars retain source, enforce square crops and revisions, and protect manual preferences from automatic import",async()=>{
  const site=await owner.unionSkinSite.findUniqueOrThrow({where:{code:"AUTO"}});
  const bytes=await sharp({create:{width:800,height:400,channels:4,background:{r:40,g:150,b:220,alpha:1}}}).png().toBuffer();
  await assert.rejects(prepareOrganizationAvatar(bytes,{left:0,top:0,width:1,height:1}));
  const prepared=await prepareOrganizationAvatar(bytes,{left:.25,top:0,width:.5,height:1});
  const metadata=await sharp(prepared.image).metadata();assert.equal(metadata.width,512);assert.equal(metadata.height,512);
  const key=await storeOrganizationAvatar(site.organizationId,prepared);avatarObjects.add(key);
  await assert.rejects(as(sourceAdmin,db=>saveOrganizationAvatar(db,sourceAdmin,site.organizationId,0,key)));
  await as(root,db=>saveOrganizationAvatar(db,root,site.organizationId,0,key));
  await assert.rejects(as(root,db=>saveOrganizationAvatar(db,root,site.organizationId,0,null)));
  const original=await readOrganizationAvatar(key,site.organizationId,"source");assert(original.bytes);assert.equal(original.metadata.width,800);
  await importUnionAvatars(worker,async(url)=>{assert.notEqual(url,"https://auto.example");return{bytes,contentType:"image/png"};});
  assert.equal((await owner.organization.findUniqueOrThrow({where:{id:site.organizationId}})).avatarObjectKey,key);
  const auto=await owner.unionSkinSite.findUniqueOrThrow({where:{code:"TEST2"}});const imported=await owner.organization.findUniqueOrThrow({where:{id:auto.organizationId}});assert(imported.avatarObjectKey);avatarObjects.add(imported.avatarObjectKey);
  assert.equal(imported.avatarMode,"AUTO");const output=await readOrganizationAvatar(imported.avatarObjectKey,auto.organizationId,"image");assert.equal((await sharp(output.bytes!).metadata()).width,512);
  await as(root,db=>saveOrganizationAvatar(db,root,site.organizationId,1,null));await owner.unionSkinSite.update({where:{code:"AUTO"},data:{avatarNextAt:new Date(0)}});
  await importUnionAvatars(worker,async()=>{throw Error("manual avatars must not be fetched");});assert.equal((await owner.organization.findUniqueOrThrow({where:{id:site.organizationId}})).avatarObjectKey,null);
});
test("website icon extraction accepts HTTPS declarations, decodes ICO raster entries and never follows data or script URLs",async()=>{
  const urls=siteIconCandidates('<link rel="icon" href="javascript:alert(1)"><link rel="apple-touch-icon" href="/icon.png">',"https://site.example/path");assert(urls.includes("https://site.example/icon.png"));assert(!urls.some(u=>u.startsWith("javascript:")));
  const png=await sharp({create:{width:32,height:32,channels:4,background:"red"}}).png().toBuffer();const head=Buffer.alloc(22);head.writeUInt16LE(1,2);head.writeUInt16LE(1,4);head[6]=32;head[7]=32;head.writeUInt32LE(png.length,14);head.writeUInt32LE(22,18);
  assert.deepEqual(await iconRaster(Buffer.concat([head,png])),png);
  assert.equal(UNION_DIRECTORY_URL,"https://skin.mualliance.ltd/api/union");
});
test("merged YITUEM avatar import falls back to its second retained domain",async()=>{
  await owner.unionSkinSite.updateMany({data:{upstreamPresent:false}});
  const site=await owner.unionSkinSite.update({where:{code:"YITUEM"},data:{upstreamPresent:true,avatarNextAt:new Date(0)}});
  const png=await sharp({create:{width:32,height:32,channels:4,background:"blue"}}).png().toBuffer();const attempted:string[]=[];
  await importUnionAvatars(worker,async url=>{attempted.push(url);if(url.startsWith(YITUEM_ROOTS[0]))throw Error("Primary unavailable");
    assert(url.startsWith(YITUEM_ROOTS[1]));return url.endsWith(".png")?{bytes:png,contentType:"image/png"}:{bytes:Buffer.from('<link rel="icon" href="/icon.png">'),contentType:"text/html"};});
  assert(attempted.some(url=>url.startsWith(YITUEM_ROOTS[0])));assert(attempted.some(url=>url.startsWith(YITUEM_ROOTS[1])));
  const saved=await owner.organization.findUniqueOrThrow({where:{id:site.organizationId}});assert(saved.avatarObjectKey);avatarObjects.add(saved.avatarObjectKey);
  assert.equal((await owner.unionSkinSite.findUniqueOrThrow({where:{code:"YITUEM"}})).avatarError,null);
});
test("description synchronization updates automatic prose but permanently preserves manual edits and clearing",async()=>{
  const payload={servers:[{code:"NAME",bs_root:"https://name.example"}]};let siteName="皮肤站别名";
  const read=async(url:string)=>({bytes:Buffer.from(JSON.stringify(url===UNION_DIRECTORY_URL?payload:{meta:{serverName:siteName}})),contentType:"application/json"});
  const sync=async()=>{await as(root,db=>requestUnionSync(db,root));const result=await syncUnionDirectory(worker,read);assert(result);return result;};
  await sync();const mapping=await owner.unionSkinSite.findUniqueOrThrow({where:{code:"NAME"}});
  const current=()=>owner.organization.findUniqueOrThrow({where:{id:mapping.organizationId}});
  assert.equal((await current()).displayName,"NAME");assert.equal((await current()).description,siteName);assert.equal((await current()).descriptionMode,"AUTO");
  await as(root,db=>updateOrganization(db,root,mapping.organizationId,{description:siteName}));assert.equal((await current()).descriptionMode,"AUTO");
  const previous=await current();await sync();assert.equal((await current()).updatedAt.getTime(),previous.updatedAt.getTime());
  siteName="更新的皮肤站别名";await sync();assert.equal((await current()).description,siteName);
  await as(root,db=>updateOrganization(db,root,mapping.organizationId,{displayName:"本地别名"}));
  assert.equal((await current()).descriptionMode,"AUTO");
  siteName="新名称";await sync();assert.equal((await current()).description,siteName);
  await as(root,db=>updateOrganization(db,root,mapping.organizationId,{description:"人工简介"}));
  assert.equal((await current()).descriptionMode,"MANUAL");siteName="不应覆盖";await sync();assert.equal((await current()).description,"人工简介");
  await as(root,db=>updateOrganization(db,root,mapping.organizationId,{description:""}));await sync();assert.equal((await current()).description,"");
  await as(root,db=>db.organization.update({where:{id:mapping.organizationId},data:{descriptionMode:"AUTO"}}));assert.equal((await current()).descriptionMode,"MANUAL");
  await assert.rejects(as(sourceAdmin,db=>updateOrganization(db,sourceAdmin,mapping.organizationId,{description:"跨组织修改"})));
  await assert.rejects(worker.organization.update({where:{id:mapping.organizationId},data:{description:"Worker 不能通用写"}}));
});
test("metadata failures, disabled mappings, archived organizations and edits during fetching retain saved descriptions",async()=>{
  const org=await owner.organization.create({data:{displayName:"KEEP"}});
  const payload={servers:[{code:"KEEP",bs_root:"https://keep.example"}]};let fail=false,editDuringFetch=false;
  const read=async(url:string)=>{
    if(url===UNION_DIRECTORY_URL)return{bytes:Buffer.from(JSON.stringify(payload)),contentType:"application/json"};
    if(fail)throw Error("offline");
    if(editDuringFetch){editDuringFetch=false;await as(root,db=>updateOrganization(db,root,org.id,{description:"网络请求期间人工修改"}));}
    return{bytes:Buffer.from(JSON.stringify({meta:{serverName:"自动简介"}})),contentType:"application/json"};
  };
  const sync=async()=>{await as(root,db=>requestUnionSync(db,root));return syncUnionDirectory(worker,read);};
  await sync();fail=true;const result=await sync();assert(result);assert(result.issues.some(issue=>issue.issue==="SITE_NAME_UNAVAILABLE"));
  assert.equal((await owner.organization.findUniqueOrThrow({where:{id:org.id}})).description,"自动简介");fail=false;
  await owner.organization.update({where:{id:org.id},data:{description:"保留"}});
  await owner.unionSkinSite.update({where:{code:"KEEP"},data:{enabled:false}});await sync();assert.equal((await owner.organization.findUniqueOrThrow({where:{id:org.id}})).description,"保留");
  await owner.unionSkinSite.update({where:{code:"KEEP"},data:{enabled:true}});await owner.organization.update({where:{id:org.id},data:{archivedAt:new Date()}});
  await sync();assert.equal((await owner.organization.findUniqueOrThrow({where:{id:org.id}})).description,"保留");
  await owner.organization.update({where:{id:org.id},data:{archivedAt:null}});editDuringFetch=true;await sync();
  assert.equal((await owner.organization.findUniqueOrThrow({where:{id:org.id}})).description,"网络请求期间人工修改");
});
const httpMode=process.env.MUA_HTTP_TEST_DEV==="1"?"development":"production";
test(`${httpMode} HTTP gates every resource endpoint, preserves password login and confirms Launcher sessions`, {skip:!process.env.MUA_HTTP_TEST_DIST,timeout:180_000}, async()=>{
  const probe=createServer();await new Promise<void>(resolve=>probe.listen(0,"127.0.0.1",resolve));const port=(probe.address() as {port:number}).port;await new Promise<void>(resolve=>probe.close(()=>resolve()));
  const origin=`http://127.0.0.1:${port}`;
  const processServer=spawn(process.execPath,["node_modules/next/dist/bin/next",httpMode==="development"?"dev":"start","-p",String(port),"-H","127.0.0.1"],{windowsHide:true,env:{...process.env,NODE_ENV:httpMode,APP_ORIGIN:origin,NEXT_DIST_DIR:process.env.MUA_HTTP_TEST_DIST!,UNION_OAUTH_CLIENT_ID:"",UNION_OAUTH_CLIENT_SECRET:""},stdio:["ignore","pipe","pipe"]});
  let output="";processServer.stdout.on("data",chunk=>{output+=chunk.toString();});processServer.stderr.on("data",chunk=>{output+=chunk.toString();});
  const exit=new Promise<void>(resolve=>processServer.once("exit",()=>resolve()));
  try {
    let ready=false;for(let i=0;i<100;i++){try{if((await fetch(origin+"/login",{signal:AbortSignal.timeout(1000)})).ok){ready=true;break;}}catch{/* Wait only for this test's service. */}await new Promise(resolve=>setTimeout(resolve,200));}
    assert(ready,output.slice(-1000));
    for(const path of ["/api/v1/servers","/api/v1/servers/NPA/manifest?acceptedFormatVersions=1","/api/v1/servers/NPA/packages?acceptedFormatVersions=1&platform=windows-amd64",`/api/v1/servers/NPA/releases/${root.id}/packages?acceptedFormatVersions=1&platform=windows-amd64`])assert.equal((await fetch(origin+path)).status,401,path);
    const cookie=randomBytes(32).toString("hex");await auth.$queryRaw`SELECT ${securityFunction("union_login")}(\'MUA:124\',\'HTTP member\',${tokenDigest(cookie)},${new Date(Date.now()+3600_000)})`;
    const headers={Cookie:`mua_session=${cookie}`,Origin:origin,"Content-Type":"application/json"};
    const directory=await fetch(origin+"/api/v1/servers",{headers});assert.equal(directory.status,200);assert.deepEqual((await directory.json()).servers.map((s:{serverId:string})=>s.serverId),["MUA"]);
    assert.equal(directory.headers.get("cache-control"),"private, no-store");
    assert.equal((await fetch(origin+"/api/admin/state",{headers})).status,403);assert.equal((await fetch(origin+"/api/admin/openapi",{headers})).status,403);
    assert.equal((await fetch(origin+"/api/v1/servers/NPA/manifest?acceptedFormatVersions=1",{headers})).status,404);
    const callback=await fetch(origin+"/api/auth/union/callback?code=not-real&state=not-real",{headers,redirect:"manual"});assert.equal(callback.status,303);assert.equal(callback.headers.get("location"),origin+"/login?unionError=1");assert.match(callback.headers.get("set-cookie")!,/SameSite=lax/i);
    assert.equal((await fetch(origin+"/api/auth/union/start",{redirect:"manual"})).status,503);
    const passwordLogin=await fetch(origin+"/api/auth/login",{method:"POST",headers:{Origin:origin,"Content-Type":"application/json"},body:JSON.stringify({username:"union-local-admin",password:"local-password-fixture"})});assert.equal(passwordLogin.status,200);assert.match(passwordLogin.headers.get("set-cookie")!,/SameSite=lax/i);
    const rootCookie=randomBytes(32).toString("hex");await owner.session.create({data:{accountId:root.id,tokenHash:tokenDigest(rootCookie),expiresAt:new Date(Date.now()+600_000)}});
    const rootHeaders={Cookie:`mua_session=${rootCookie}`,Origin:origin,"Content-Type":"application/json"};
    assert.equal((await fetch(origin+"/api/admin/union-sync",{headers})).status,403);
    assert.equal((await fetch(origin+"/api/admin/union-sync",{headers:{Cookie:`mua_session=${adminCookie}`}})).status,403);
    assert.equal((await fetch(origin+"/api/admin/union-sync",{headers:rootHeaders})).status,200);
    assert.equal((await fetch(origin+"/api/admin/union-sync",{method:"POST",headers:rootHeaders,body:"{}"})).status,200);
    const organizationEndpoint=`/api/admin/organizations/${sourceOrg}`;
    const adminHeaders={Cookie:`mua_session=${adminCookie}`,Origin:origin,"Content-Type":"application/json"};
    let siteName="HTTP 皮肤站名称";
    const syncDescription=async()=>{
      await as(root,db=>requestUnionSync(db,root));
      assert(await syncUnionDirectory(worker,async url=>({contentType:"application/json",bytes:Buffer.from(JSON.stringify(url===UNION_DIRECTORY_URL
        ?{servers:[{code:"MUA",bs_root:"https://skin.mualliance.ltd"}]}:{meta:{serverName:siteName}}))})));
    };
    const displayedDescription=async()=>{
      const response=await fetch(origin+"/api/admin/state",{headers:adminHeaders});assert.equal(response.status,200);
      return(await response.json()).organizations.find((organization:{id:string})=>organization.id===sourceOrg).description;
    };
    const editDescription=async(description:string)=>fetch(origin+organizationEndpoint,{method:"PATCH",headers:adminHeaders,body:JSON.stringify({description})});
    await syncDescription();assert.equal(await displayedDescription(),siteName);
    assert.equal((await editDescription(siteName)).status,200);siteName="HTTP 更新的名称";await syncDescription();assert.equal(await displayedDescription(),siteName);
    assert.equal((await fetch(origin+organizationEndpoint,{method:"PATCH",headers,body:JSON.stringify({description:"玩家不能编辑"})})).status,403);
    assert.equal((await editDescription("HTTP 人工简介")).status,200);siteName="不应覆盖人工内容";await syncDescription();assert.equal(await displayedDescription(),"HTTP 人工简介");
    assert.equal((await editDescription("")).status,200);await syncDescription();assert.equal(await displayedDescription(),"");
    const avatarEndpoint=`/api/admin/organizations/${sourceOrg}/avatar-image`;
    assert.equal((await fetch(origin+avatarEndpoint+"?variant=metadata",{headers})).status,403);
    assert.equal((await fetch(origin+`/api/admin/organizations/${targetOrg}/avatar-image?variant=metadata`,{headers:{Cookie:`mua_session=${adminCookie}`}})).status,404);
    const avatarBytes=await sharp({create:{width:800,height:400,channels:4,background:{r:60,g:140,b:210,alpha:1}}}).png().toBuffer();
    const avatarForm=()=>{const form=new FormData();form.append("source",new Blob([new Uint8Array(avatarBytes)],{type:"image/png"}),"avatar.png");form.append("crop",JSON.stringify({left:.25,top:0,width:.5,height:1}));form.append("expectedRevision","0");return form;};
    assert.equal((await fetch(origin+avatarEndpoint,{method:"POST",headers:{Cookie:`mua_session=${rootCookie}`,Origin:"https://untrusted.invalid"},body:avatarForm()})).status,403);
    assert.equal((await fetch(origin+avatarEndpoint,{method:"POST",headers:{Cookie:`mua_session=${rootCookie}`,Origin:origin},body:avatarForm()})).status,200);
    avatarObjects.add((await owner.organization.findUniqueOrThrow({where:{id:sourceOrg}})).avatarObjectKey!);
    const avatarImage=await fetch(origin+avatarEndpoint,{headers:rootHeaders});assert.equal(avatarImage.status,200);const actualAvatar=await sharp(Buffer.from(await avatarImage.arrayBuffer())).metadata();assert.equal(actualAvatar.width,512);assert.equal(actualAvatar.height,512);
    assert.equal((await fetch(origin+avatarEndpoint,{method:"POST",headers:{Cookie:`mua_session=${rootCookie}`,Origin:origin},body:avatarForm()})).status,409);
    assert.equal((await fetch(origin+avatarEndpoint,{method:"DELETE",headers:rootHeaders,body:JSON.stringify({expectedRevision:1})})).status,200);
    const verifier=randomBytes(32).toString("base64url"),challenge=createHash("sha256").update(verifier).digest("base64url");
    const start=await fetch(origin+"/api/auth/launcher/start",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({challenge})});assert.equal(start.status,201);const attempt=await start.json();
    assert.equal((await fetch(origin+"/api/auth/launcher/approve",{method:"POST",headers:{...headers,Origin:"https://untrusted.invalid"},body:JSON.stringify({id:attempt.id})})).status,403);
    assert.equal((await fetch(origin+"/api/auth/launcher/approve",{method:"POST",headers,body:JSON.stringify({id:attempt.id})})).status,200);
    const claim=await fetch(origin+"/api/auth/launcher/claim",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:attempt.id,verifier})});assert.equal(claim.status,200);const session=await claim.json();
    const tokenHeader={Authorization:`Bearer ${session.token}`};assert.equal((await fetch(origin+"/api/member",{headers:tokenHeader})).status,200);assert.equal((await fetch(origin+"/api/v1/clients",{headers:tokenHeader})).status,401);
    assert.equal((await fetch(origin+"/api/auth/launcher/logout",{method:"POST",headers:tokenHeader})).status,200);assert.equal((await fetch(origin+"/api/member",{headers:tokenHeader})).status,401);
    if(process.env.MUA_AUTH_BROWSER_TEST==="1"){
      // Use only the isolated schema's synthetic credentials and the loopback test server.
      // Never send local bootstrap credentials to a deployed site from this harness.
      const browserTests=spawn(process.execPath,["node_modules/@playwright/test/cli.js","test","--config","playwright.auth.config.ts"],{
        windowsHide:true,env:{...process.env,SMOKE_ORIGIN:origin,SMOKE_USERNAME:"union-local-admin",SMOKE_PASSWORD:"local-password-fixture"},stdio:["ignore","pipe","pipe"]});
      let browserOutput="";browserTests.stdout.on("data",chunk=>{browserOutput+=chunk.toString();});browserTests.stderr.on("data",chunk=>{browserOutput+=chunk.toString();});
      const code=await new Promise<number|null>((resolve,reject)=>{browserTests.once("error",reject);browserTests.once("exit",resolve);});
      assert.equal(code,0,browserOutput);console.log(browserOutput);
    }
    if(process.env.MUA_OPENAPI_BROWSER_TEST==="1"){
      await owner.localCredential.create({data:{accountId:root.id,username:"scalar-root-fixture",passwordHash:await hashPassword("scalar-password-fixture")}});
      const browserTests=spawn(process.execPath,["node_modules/@playwright/test/cli.js","test","--config","playwright.openapi.config.ts"],{
        windowsHide:true,env:{...process.env,SMOKE_ORIGIN:origin,SMOKE_USERNAME:"scalar-root-fixture",SMOKE_PASSWORD:"scalar-password-fixture"},stdio:["ignore","pipe","pipe"]});
      let browserOutput="";browserTests.stdout.on("data",chunk=>{browserOutput+=chunk.toString();});browserTests.stderr.on("data",chunk=>{browserOutput+=chunk.toString();});
      const code=await new Promise<number|null>((resolve,reject)=>{browserTests.once("error",reject);browserTests.once("exit",resolve);});
      assert.equal(code,0,browserOutput);console.log(browserOutput);
    }
    if(process.env.MUA_UNION_BROWSER_TEST==="1"){
      const {chromium}=await import("@playwright/test");const browser=await chromium.launch({channel:"msedge",headless:true});
      try{const context=await browser.newContext();await context.addCookies([{name:"mua_session",value:cookie,url:origin}]);const page=await context.newPage();const browserErrors:string[]=[];
       page.on("pageerror",error=>browserErrors.push(error.message));page.on("console",message=>{if(/hydrat|server rendered HTML/i.test(message.text()))browserErrors.push(message.text());});
       await page.goto(origin+"/member");await page.getByRole("heading",{name:"Union Link",exact:true}).waitFor();assert.equal(await page.getByText("MUA",{exact:true}).count()>0,true);await page.screenshot({path:".local/union-member-preview.png",fullPage:true,animations:"disabled",caret:"initial"});
       await context.clearCookies();await context.addCookies([{name:"mua_session",value:adminCookie,url:origin}]);await page.goto(origin+"/admin/access");await page.getByRole("heading",{name:"跨组织访问",exact:true}).waitFor();
       assert.equal(await page.getByRole("combobox",{name:"所属组织",exact:true}).getAttribute("data-slot"),"select-trigger");
       await page.getByRole("combobox",{name:"成员",exact:true}).click();await page.getByRole("option",{name:"HTTP member",exact:true}).click();
       await page.getByRole("combobox",{name:"访问哪个组织",exact:true}).click();await page.getByRole("option",{name:"NPU",exact:true}).click();
       await page.getByRole("checkbox",{name:"选择服务器NPA",exact:true}).check();await page.getByLabel("申请理由",{exact:true}).fill("浏览器验证");await page.getByRole("button",{name:"提交申请",exact:true}).click();
       await page.getByRole("row").filter({hasText:"浏览器验证"}).waitFor();
       const targetCookie=randomBytes(32).toString("hex");await owner.session.create({data:{accountId:targetAdmin.id,tokenHash:tokenDigest(targetCookie),expiresAt:new Date(Date.now()+600_000)}});
       await context.clearCookies();await context.addCookies([{name:"mua_session",value:targetCookie,url:origin}]);await page.goto(origin+"/admin/access");
       await page.getByRole("row").filter({hasText:"浏览器验证"}).getByRole("button",{name:"同意",exact:true}).click();await page.getByRole("row").filter({hasText:"浏览器验证"}).getByText("已同意",{exact:true}).waitFor();
       await context.clearCookies();await context.addCookies([{name:"mua_session",value:cookie,url:origin}]);await page.goto(origin+"/member");await page.getByRole("cell",{name:"NPA",exact:true}).first().waitFor();await page.screenshot({path:".local/union-member-preview.png",fullPage:true,animations:"disabled",caret:"initial"});
       await context.clearCookies();await context.addCookies([{name:"mua_session",value:adminCookie,url:origin}]);await page.goto(origin+"/admin/access");await page.getByRole("heading",{name:"跨组织访问",exact:true}).waitFor();await page.screenshot({path:".local/union-access-preview.png",fullPage:true,animations:"disabled",caret:"initial"});
       await page.getByLabel("审批说明或撤销原因",{exact:true}).fill("浏览器撤销验证");
       const revoked=page.waitForResponse(response=>response.url().includes("/api/admin/access/grants/")&&response.url().endsWith("/revoke")&&response.request().method()==="POST");
       await page.getByRole("row").filter({hasText:"HTTP member"}).getByRole("button",{name:"撤销授权",exact:true}).click();assert.equal((await revoked).status(),200);await page.getByText("已撤销",{exact:true}).waitFor();
       await context.clearCookies();await context.addCookies([{name:"mua_session",value:cookie,url:origin}]);await page.goto(origin+"/member");await page.getByRole("heading",{name:"Union Link",exact:true}).waitFor();assert.equal(await page.getByRole("cell",{name:"NPA",exact:true}).count(),0);
       await context.clearCookies();await context.addCookies([{name:"mua_session",value:rootCookie,url:origin}]);await page.goto(origin+"/admin/access");
       const mappingTable=page.getByRole("table",{name:"Union 皮肤站与组织",exact:true});await mappingTable.waitFor();
       const mappingCard=page.locator('[data-slot="card"]').filter({has:mappingTable});
       await mappingCard.getByRole("textbox",{name:"搜索皮肤站或组织…",exact:true}).fill("YITUEM");
       const mergedRow=mappingTable.getByRole("row").filter({hasText:"YITUEM"});await mergedRow.waitFor();
       assert((await mergedRow.textContent())?.includes(YITUEM_ROOTS[0]));assert((await mergedRow.textContent())?.includes(YITUEM_ROOTS[1]));
       await mappingCard.getByRole("textbox",{name:"搜索皮肤站或组织…",exact:true}).fill("TEST2");
       const mappingRow=mappingTable.getByRole("row").filter({hasText:"TEST2"});await mappingRow.waitFor();
       const disabled=page.waitForResponse(response=>response.url().endsWith("/api/admin/union-sites")&&response.request().method()==="PUT");
       await mappingRow.getByRole("button",{name:"停用",exact:true}).click();assert.equal((await disabled).status(),200);await mappingRow.getByRole("button",{name:"启用",exact:true}).waitFor();
       const enabled=page.waitForResponse(response=>response.url().endsWith("/api/admin/union-sites")&&response.request().method()==="PUT");
       await mappingRow.getByRole("button",{name:"启用",exact:true}).click();assert.equal((await enabled).status(),200);await mappingRow.getByRole("button",{name:"停用",exact:true}).waitFor();
       await mappingCard.getByRole("textbox",{name:"搜索皮肤站或组织…",exact:true}).fill("");
       await mappingTable.screenshot({path:".local/union-site-mapping-table.png",animations:"disabled",caret:"initial"});
       await page.getByRole("combobox",{name:"所属组织",exact:true}).scrollIntoViewIfNeeded();
       await page.getByRole("combobox",{name:"所属组织",exact:true}).click();await page.screenshot({path:".local/organization-access-selects.png",animations:"disabled",caret:"initial"});await page.keyboard.press("Escape");
       await page.getByRole("button",{name:"切换黑白主题",exact:true}).click();await page.getByRole("combobox",{name:"所属组织",exact:true}).click();
       await page.screenshot({path:".local/organization-access-selects-dark.png",animations:"disabled",caret:"initial"});await page.keyboard.press("Escape");
       await page.getByRole("button",{name:"切换黑白主题",exact:true}).click();
       await page.goto(origin+"/admin/organizations");
       await page.getByRole("row").filter({hasText:"MUA"}).getByRole("button",{name:"编辑",exact:true}).click();await page.getByLabel("简介",{exact:true}).fill("未保存的组织简介");await page.getByRole("button",{name:"上传头像",exact:true}).click();
       await page.getByLabel("选择组织头像图片",{exact:true}).setInputFiles({name:"avatar.png",mimeType:"image/png",buffer:avatarBytes});
       await page.getByRole("application").press("ArrowRight");await page.getByRole("slider").press("Home");
       await page.screenshot({path:".local/organization-avatar-crop-preview.png",fullPage:true,animations:"disabled",caret:"initial"});
       const uploaded=page.waitForResponse(r=>r.url().includes(avatarEndpoint)&&r.request().method()==="POST");await page.getByRole("button",{name:"上传并保存",exact:true}).click();assert.equal((await uploaded).status(),200);
       await page.getByRole("heading",{name:"编辑组织头像",exact:true}).waitFor({state:"hidden"});avatarObjects.add((await owner.organization.findUniqueOrThrow({where:{id:sourceOrg}})).avatarObjectKey!);
       assert.equal(await page.getByLabel("简介",{exact:true}).inputValue(),"未保存的组织简介");
       await page.getByRole("button",{name:"重新裁剪",exact:true}).click();await page.getByRole("application").waitFor();await page.getByRole("button",{name:"重置选区",exact:true}).click();
       const recropped=page.waitForResponse(r=>r.url().includes(avatarEndpoint)&&r.request().method()==="POST");await page.getByRole("button",{name:"上传并保存",exact:true}).click();assert.equal((await recropped).status(),200);
       avatarObjects.add((await owner.organization.findUniqueOrThrow({where:{id:sourceOrg}})).avatarObjectKey!);
       await page.goto(origin+"/admin/system/settings");await page.getByText("Union 组织目录同步",{exact:true}).waitFor();await page.getByText("目录组织数 / 已同步",{exact:true}).waitFor();
       const siteInfo=page.getByRole("region",{name:"网站基础信息",exact:true});await siteInfo.waitFor();assert((await siteInfo.textContent())?.includes("组织简介") || (await siteInfo.textContent())?.includes("简介"));assert((await siteInfo.textContent())?.includes("每分钟"));
       await page.getByRole("region",{name:"同步日志",exact:true}).waitFor();assert.equal(await page.getByText("网站头像／手动头像",{exact:true}).count(),0);assert.equal(await page.getByText("头像等待／失败",{exact:true}).count(),0);
       assert(!(await page.locator("main").first().innerText()).includes("裁剪或移除头像后保留人工选择"));
       await page.screenshot({path:".local/union-directory-settings-preview.png",fullPage:true,animations:"disabled",caret:"initial"});
       await page.route("**/api/admin/union-sync",async route=>{const response=await route.fetch();const body=await response.json();await route.fulfill({response,json:{...body,issues:[{code:"MUA",issue:"SITE_NAME_UNAVAILABLE"}]}});});
       await page.reload();await page.getByRole("region",{name:"同步日志",exact:true}).getByText(/暂时无法获取皮肤站名称/).waitFor();
       await page.getByRole("button",{name:"切换语言",exact:true}).click();await page.getByRole("menuitem",{name:/English/}).click();
       await page.getByRole("region",{name:"Website information",exact:true}).waitFor();await page.getByRole("region",{name:"Sync log",exact:true}).getByText(/The skin-site name is unavailable/).waitFor();
       assert(!(await page.locator("main").first().innerText()).includes("SITE_NAME_UNAVAILABLE"));await page.screenshot({path:".local/union-directory-settings-en-preview.png",fullPage:true,animations:"disabled",caret:"initial"});
       await page.goto(origin+"/admin/system/signing-keys");await page.getByText("Public key (SPKI / Base64):",{exact:true}).waitFor();assert(!/development|开发/i.test(await page.locator("main").first().innerText()));
       await page.getByRole("button",{name:"Change language",exact:true}).click();await page.getByRole("menuitem",{name:/简体中文/}).click();
       await page.goto(origin+"/admin");await page.getByRole("heading",{name:"控制台",exact:true}).waitFor();
       await context.clearCookies();await context.addCookies([{name:"mua_session",value:adminCookie,url:origin}]);await page.goto(origin+"/admin/system/settings");await page.getByRole("heading",{name:"设置",exact:true}).waitFor();assert.equal(await page.getByText("Union 组织目录同步",{exact:true}).count(),0);
       assert.deepEqual(browserErrors,[]);await context.close();
      }finally{await browser.close();}
    }
  }finally{processServer.kill();await exit;}
});
