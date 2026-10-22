import "server-only";
import { randomBytes, createHash, timingSafeEqual, randomUUID } from "node:crypto";
import { authPrisma, validateDatabase } from "./prisma";
import { locked, tokenDigest, type Db, type Actor } from "./auth";
import { securityFunction } from "./database-security";
import { gameLoginExchangeInput, gameLoginStartInput, launcherProviderInput } from "./launcher-game-contract";
import { gameCheck, GameLoginError, verifyGameIdentity } from "./launcher-game-identity";
import { type GameTransport } from "./launcher-game-network";
import { publicDownloadAddress } from "./remote-download";
import { isIP } from "node:net";
import { superOnly } from "./rbac";
import { audit } from "./management";
import { appOrigin, json } from "./http";
import { AppError } from "./errors";

// Deliberately no IP derived from arbitrary forwarded headers. Shared DB quotas are authoritative.
async function quota(entries: [string, number][]) {
  await locked(async db => {
    const now = new Date();
    for (const [name, limit] of entries) {
      const key = tokenDigest(`game-login:${name}`), old = await db.loginThrottle.findUnique({ where: { key } });
      gameCheck(!old || old.resetAt <= now || old.attempts < limit, 429, "RATE_LIMITED");
      await db.loginThrottle.upsert({ where: { key }, create: { key, attempts: 1, resetAt: new Date(Date.now() + 300_000) },
        update: old && old.resetAt > now ? { attempts: { increment: 1 } } : { attempts: 1, resetAt: new Date(Date.now() + 300_000) } });
    }
    await db.loginThrottle.deleteMany({ where: { resetAt: { lt: now } } });
  }, authPrisma);
}
async function providerValid(db: Db, id: string, revision: number) {
  const [row] = await db.$queryRaw<{ valid: boolean }[]>`SELECT ${securityFunction("launcher_provider_valid")}(${id}::uuid,${revision}) AS valid`;
  gameCheck(row?.valid, 403, "PROVIDER_DISABLED");
}
export function gameRequestPolicy(request: Request) {
  const origin = request.headers.get("origin"), site = request.headers.get("sec-fetch-site");
  const configured = new URL(appOrigin());
  gameCheck(configured.protocol === "https:" || ["localhost", "127.0.0.1", "[::1]"].includes(configured.hostname), 503, "HTTPS_REQUIRED");
  gameCheck(origin === null || origin === configured.origin, 403, "INVALID_ORIGIN");
  gameCheck(site === null || site === "same-origin" || site === "none", 403, "INVALID_ORIGIN");
  gameCheck(!request.headers.has("authorization"), 400, "INVALID_REQUEST");
  gameCheck(!new URL(request.url).search, 400, "INVALID_REQUEST");
}
export function gameClientKey(request: Request) {
  const header = process.env.LAUNCHER_AUTH_CLIENT_IP_HEADER;
  if (!header) return undefined; // No trusted proxy configured: global/provider quotas still apply.
  gameCheck(/^[a-z0-9-]+$/.test(header), 503, "SERVICE_UNAVAILABLE");
  const address = request.headers.get(header)?.trim();
  gameCheck(address && isIP(address), 400, "INVALID_CLIENT_ADDRESS");
  return `ip:${tokenDigest(address)}`;
}
export function gameFailure(error: unknown) {
  const status = error instanceof AppError ? error.status : 500;
  const code = error instanceof GameLoginError ? error.code : ({ 400: "INVALID_REQUEST", 413: "REQUEST_TOO_LARGE", 415: "JSON_REQUIRED" } as Record<number, string>)[status] ?? (status === 500 ? "SERVICE_UNAVAILABLE" : "INVALID_REQUEST");
  const response = json({ error: code, code, requestId: randomUUID() }, status);
  if (status === 429) response.headers.set("Retry-After", "300");
  return response;
}
export async function listGameProviders() {
  await validateDatabase("auth");
  const [row] = await authPrisma.$queryRaw<{ providers: unknown }[]>`SELECT ${securityFunction("launcher_provider_list")}() AS providers`;
  return row.providers;
}
export async function startGameLogin(raw: unknown, clientKey?: string) {
  const input = gameLoginStartInput.safeParse(raw); gameCheck(input.success, 400, "INVALID_REQUEST");
  await validateDatabase("auth");
  await quota([["start", 120], [`provider:${input.data.providerId}:start`, 60], ...(clientKey ? [[`${clientKey}:start`, 20] as [string, number]] : [])]);
  const nonce = randomBytes(32).toString("base64url");
  const attempt = await locked(async db => {
    const p = await db.launcherAuthProvider.findUnique({ where: { id: input.data.providerId } });
    gameCheck(p, 403, "PROVIDER_DISABLED"); await providerValid(db, p.id, p.revision);
    // Retain consumed attempts referenced by sessions; expired sessions are reclaimed first.
    await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    await db.launcherGameLoginAttempt.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 86400_000) }, session: { is: null } } });
    const createdAt = new Date();
    return db.launcherGameLoginAttempt.create({ data: { providerId: p.id, providerRevision: p.revision, codeChallenge: input.data.codeChallenge,
      nonceHash: tokenDigest(nonce), createdAt, expiresAt: new Date(createdAt.getTime() + 120_000) } });
  }, authPrisma);
  return { attemptId: attempt.id, nonce, expiresIn: 120, providerId: attempt.providerId, providerRevision: attempt.providerRevision };
}
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
function databaseDenied(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== "object" || depth > 5) return false;
  const record = error as Record<string, unknown>;
  return record.code === "42501" || record.originalCode === "42501" ||
    ["meta", "cause", "driverAdapterError"].some(key => databaseDenied(record[key], depth + 1));
}
export async function exchangeGameLogin(raw: unknown, transport?: GameTransport, clientKey?: string) {
  const input = gameLoginExchangeInput.safeParse(raw); gameCheck(input.success, 400, "INVALID_REQUEST"); const v = input.data;
  await validateDatabase("auth");
  await quota([["exchange", 300], [`attempt:${v.attemptId}`, 5], ...(clientKey ? [[`${clientKey}:exchange`, 20] as [string, number]] : [])]);
  const provider = await locked(async db => {
    const a = await db.launcherGameLoginAttempt.findUnique({ where: { id: v.attemptId }, include: { provider: true } });
    gameCheck(a && a.expiresAt > new Date(), 400, "LOGIN_ATTEMPT_INVALID");
    gameCheck(a.status === "PENDING", 409, "LOGIN_ATTEMPT_USED");
    gameCheck(same(a.nonceHash, tokenDigest(v.nonce)) && same(a.codeChallenge, createHash("sha256").update(v.codeVerifier).digest("base64url")), 400, "LOGIN_ATTEMPT_INVALID");
    await providerValid(db, a.providerId, a.providerRevision);
    const active = await db.launcherGameLoginAttempt.count({ where: { providerId: a.providerId, status: "VERIFYING", expiresAt: { gt: new Date() } } });
    gameCheck(active < 4, 429, "RATE_LIMITED");
    await db.launcherGameLoginAttempt.update({ where: { id: a.id }, data: { status: "VERIFYING" } });
    return a.provider;
  }, authPrisma);
  try {
    await quota([[`provider:${provider.id}:exchange`, 60], ...(clientKey ? [[`${clientKey}:provider:${provider.id}`, 10] as [string, number]] : [])]);
    const identity = await verifyGameIdentity(provider, v, transport);
    await quota([[`account:${identity.subject}`, 10]]);
    const expiresAt = new Date(Math.min(Date.now() + 900_000, identity.upstreamExpiresAt.getTime() - 30_000));
    gameCheck(expiresAt.getTime() - Date.now() >= 60_000, 401, "GAME_TOKEN_EXPIRING");
    const token = randomBytes(32).toString("hex");
    const accountId = await locked(async db => {
      await providerValid(db, provider.id, provider.revision);
      const [row] = await db.$queryRaw<{ id: string }[]>`SELECT ${securityFunction("launcher_game_issue")}(${v.attemptId}::uuid,${provider.revision},${identity.subject},${identity.profile.id},${identity.profile.name},${identity.upstreamExpiresAt},${expiresAt},${tokenDigest(token)}) AS id`;
      return row.id;
    }, authPrisma);
    return { tokenType: "Bearer", token: `mul_${token}`, expiresAt: expiresAt.toISOString(), expiresIn: Math.floor((expiresAt.getTime() - Date.now()) / 1000),
      account: { id: accountId, unionSubject: identity.subject }, gameProfile: identity.profile, providerId: provider.id };
  } catch (error) {
    await authPrisma.launcherGameLoginAttempt.updateMany({ where: { id: v.attemptId, status: "VERIFYING" }, data: { status: "FAILED" } }).catch(() => undefined);
    if (error instanceof GameLoginError) throw error;
    if (databaseDenied(error)) throw new GameLoginError(403, "ACCOUNT_OR_PROVIDER_UNAVAILABLE");
    throw new GameLoginError(503, "SERVICE_UNAVAILABLE");
  }
}

export async function listGameProvidersAdmin(db: Db, actor: Actor) {
  superOnly(actor); return db.launcherAuthProvider.findMany({ orderBy: [{ siteCode: "asc" }, { displayName: "asc" }] });
}
export async function saveGameProvider(db: Db, actor: Actor, raw: unknown) {
  superOnly(actor);
  const input = launcherProviderInput.safeParse(raw); gameCheck(input.success, 400, "INVALID_REQUEST"); const v = input.data;
  const hostname = new URL(v.bsRoot).hostname.replace(/^\[|\]$/g, "");
  gameCheck(!isIP(hostname) || publicDownloadAddress(hostname), 400, "INVALID_REQUEST");
  const site = await db.unionSkinSite.findUnique({ where: { code: v.siteCode }, include: { organization: true } });
  gameCheck(site && site.enabled && !site.organization.archivedAt && (!site.managedBySync || site.upstreamPresent) && [site.bsRoot, ...site.bsRootAliases].includes(v.bsRoot), 409, "PROVIDER_CHANGED");
  const old = await db.launcherAuthProvider.findUnique({ where: { id: v.id } });
  gameCheck((old?.revision ?? 0) === v.revision, 409, "PROVIDER_CHANGED");
  gameCheck(!old || old.siteCode === v.siteCode && old.bsRoot === v.bsRoot, 409, "PROVIDER_CHANGED");
  const data = { siteCode: v.siteCode, displayName: v.displayName, bsRoot: v.bsRoot, authApiRoot: `${v.bsRoot}/api/yggdrasil`, enabled: v.enabled,
    adapter: v.adapter, verificationNote: v.verificationNote, siteRevision: site.revision, verifiedById: actor.id, verifiedAt: new Date() };
  const saved = await db.launcherAuthProvider.upsert({ where: { id: v.id }, create: { ...data, id: v.id }, update: { ...data, revision: { increment: 1 } } });
  await audit(db, actor, "LAUNCHER_PROVIDER_SET", "LauncherAuthProvider", v.id, site.organizationId, undefined, { enabled: saved.enabled, revision: saved.revision });
  return saved;
}
