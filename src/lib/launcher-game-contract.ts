import { z } from "zod";

const id = z.string().uuid();
export const gameUuid = z.string().regex(/^(?:[a-fA-F0-9]{32}|[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12})$/)
  .transform(value => value.replaceAll("-", "").toLowerCase());
export const profileName = z.string().min(1).max(64).regex(/^[^\x00-\x1f\x7f]+$/);
const root = z.string().url().max(2048).refine(value => {
  const u = new URL(value);
  return u.protocol === "https:" && (!u.port || u.port === "443") && !u.username && !u.password && !u.search && !u.hash && !/[\x00-\x20\x7f]/.test(value) && !value.endsWith("/");
});
export const launcherProviderInput = z.object({
  id, revision: z.number().int().nonnegative(), siteCode: z.string().regex(/^[A-Z][A-Z0-9]{0,5}$/),
  displayName: z.string().trim().min(1).max(100), bsRoot: root, enabled: z.boolean(),
  adapter: z.literal("MUA_YGGC_ONLINE_V1"), verificationNote: z.string().trim().min(10).max(1000),
  confirmUidMapping: z.literal(true), confirmCredentialLogRedaction: z.literal(true),
}).strict();
export const gameLoginStartInput = z.object({ providerId: id, codeChallenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/), codeChallengeMethod: z.literal("S256") }).strict();
export const gameLoginExchangeInput = z.object({
  attemptId: id, nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/), codeVerifier: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  gameAccessToken: z.string().min(1).max(16384), gameClientToken: z.string().min(1).max(256).optional(),
  gameProfile: z.object({ id: gameUuid, name: profileName.optional() }).strict(),
}).strict();
export const launcherProviderPublic = z.object({ id, siteCode: z.string(), displayName: z.string(), bsRoot: z.string().url(), authApiRoot: z.string().url(), revision: z.number().int(), directExchange: z.literal(true), browserLogin: z.literal(true) }).strict();
export const launcherProviderRecord = z.object({ id, siteCode: z.string(), displayName: z.string(), bsRoot: z.string().url(), authApiRoot: z.string().url(), revision: z.number().int(), siteRevision: z.number().int(),
  enabled: z.boolean(), adapter: z.literal("MUA_YGGC_ONLINE_V1"), verificationNote: z.string(), verifiedById: id, verifiedAt: z.string().datetime(), updatedAt: z.string().datetime() }).strict();
export const gameLoginStartResult = z.object({ attemptId: id, nonce: z.string(), expiresIn: z.literal(120), providerId: id, providerRevision: z.number().int() }).strict();
export const gameLoginExchangeResult = z.object({ tokenType: z.literal("Bearer"), token: z.string().regex(/^mul_[a-f0-9]{64}$/), expiresAt: z.string().datetime(), expiresIn: z.number().int().positive().max(900),
  account: z.object({ id, unionSubject: z.string() }).strict(), gameProfile: z.object({ id: z.string().regex(/^[a-f0-9]{32}$/), name: profileName }).strict(), providerId: id }).strict();
export const gameLoginErrorSchema = z.object({ error: z.string(), code: z.string(), params: z.record(z.union([z.string(), z.number()])), requestId: z.string().uuid() }).strict();
