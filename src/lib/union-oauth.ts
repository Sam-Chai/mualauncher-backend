import { diagnosticText } from "@/lib/diagnostics";
import "server-only";
import * as oauth from "oauth4webapi";
import { randomBytes } from "node:crypto";
import { authPrisma, validateDatabase } from "./prisma";
import { locked, SESSION_SECONDS, tokenDigest } from "./auth";
import { securityFunction } from "./database-security";
import { appOrigin } from "./http";
import { invariant } from "./errors";
import { unionUserInput } from "./union-contract";

export const UNION_COOKIE = "mua_union_login";
export const UNION_LOGIN_SECONDS = 300;
export const unionServer: oauth.AuthorizationServer = { issuer: "https://skin.mualliance.ltd",
  authorization_endpoint: "https://skin.mualliance.ltd/api/union/oauth2/authorize", token_endpoint: "https://skin.mualliance.ltd/api/union/oauth2/token" };
export const unionConfigured = () => !!process.env.UNION_OAUTH_CLIENT_ID && !!process.env.UNION_OAUTH_CLIENT_SECRET;
export function unionConfiguration() {
  invariant(unionConfigured(), 503, diagnosticText("diagnostics.unionOauth.unionOauthIsNotConfiguredSignInWithYourUsername"));
  invariant(!process.env.UNION_OAUTH_CLIENT_AUTH || ["post", "basic"].includes(process.env.UNION_OAUTH_CLIENT_AUTH), 500, "UNION_OAUTH_CLIENT_AUTH must be post or basic");
  const origin = appOrigin();
  invariant(origin.startsWith("https://") || process.env.NODE_ENV !== "production" && new URL(origin).hostname === "localhost", 500, diagnosticText("diagnostics.unionOauth.unionOauthRequiresAnHttpsApplicationOrigin"));
  return { client: { client_id: process.env.UNION_OAUTH_CLIENT_ID! } satisfies oauth.Client,
    secret: process.env.UNION_OAUTH_CLIENT_SECRET!, redirectUri: `${origin}/api/auth/union/callback` };
}
// Fixed endpoints only. No redirect follows, credential logging or arbitrary provider URLs.
const boundedFetch: typeof fetch = (input, init) => fetch(input, { ...init, redirect: "error", signal: AbortSignal.timeout(15_000), cache: "no-store" });
export async function exchangeUnionCode(url: URL, state: string, verifier: string, transport: typeof fetch = boundedFetch) {
  const config = unionConfiguration();
  const params = oauth.validateAuthResponse(unionServer, config.client, url, state);
  const auth = process.env.UNION_OAUTH_CLIENT_AUTH === "basic" ? oauth.ClientSecretBasic(config.secret) : oauth.ClientSecretPost(config.secret);
  const response = await oauth.authorizationCodeGrantRequest(unionServer, config.client, auth, params, config.redirectUri, verifier, { [oauth.customFetch]: transport });
  const result = await oauth.processAuthorizationCodeResponse(unionServer, config.client, response);
  const userResponse = await oauth.protectedResourceRequest(result.access_token, "GET", new URL("https://skin.mualliance.ltd/api/union/oauth2/user"), undefined, undefined, { [oauth.customFetch]: (url, options) => transport(url, options as RequestInit) });
  invariant(userResponse.ok && userResponse.headers.get("content-type")?.includes("application/json"), 502, diagnosticText("diagnostics.unionOauth.invalidUnionUserInformationResponse"));
  const reader = userResponse.body?.getReader();
  invariant(reader, 502, diagnosticText("diagnostics.unionOauth.invalidUnionUserInformationResponse"));
  let bytes = 0; const chunks: Uint8Array[] = [];
  for (;;) { const item = await reader.read(); if (item.done) break; bytes += item.value.byteLength; if (bytes > 16384) { await reader.cancel(); invariant(false, 502, diagnosticText("diagnostics.unionOauth.invalidUnionUserInformationResponse")); } chunks.push(item.value); }
  const parsed = unionUserInput.safeParse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  invariant(parsed.success, 502, diagnosticText("diagnostics.unionOauth.invalidUnionUserInformationResponse"));
  return parsed.data;
}
export function unionReturnTo(value: string | null) {
  if (value === null || value === "/member") return "/member";
  invariant(/^\/launcher\/connect\?id=[0-9a-f-]{36}$/.test(value), 400, diagnosticText("diagnostics.unionOauth.invalidSignInReturnAddress"));
  return value;
}
export async function beginUnionLogin(returnTo: string) {
  returnTo = unionReturnTo(returnTo);
  const config = unionConfiguration();
  await validateDatabase("auth");
  const state = oauth.generateRandomState(), browser = randomBytes(32).toString("hex"), verifier = oauth.generateRandomCodeVerifier();
  await locked(async db => {
    const key = tokenDigest("union-login-start"), now = new Date();
    const prior = await db.loginThrottle.findUnique({ where: { key } });
    invariant(!prior || prior.resetAt <= now || prior.attempts < 120, 429, diagnosticText("diagnostics.auth.tooManySignInAttemptsTryAgainLater"));
    await db.loginThrottle.upsert({ where: { key }, create: { key, attempts: 1, resetAt: new Date(Date.now() + 300_000) },
      update: prior && prior.resetAt > now ? { attempts: { increment: 1 } } : { attempts: 1, resetAt: new Date(Date.now() + 300_000) } });
    await db.unionOAuthAttempt.deleteMany({ where: { expiresAt: { lt: now } } });
    await db.unionOAuthAttempt.create({ data: { stateHash: tokenDigest(state), browserHash: tokenDigest(browser), verifier, returnTo, expiresAt: new Date(Date.now() + UNION_LOGIN_SECONDS * 1000) } });
  }, authPrisma);
  const url = new URL(unionServer.authorization_endpoint!);
  url.search = new URLSearchParams({ client_id: config.client.client_id, redirect_uri: config.redirectUri, response_type: "code", state,
    code_challenge: await oauth.calculatePKCECodeChallenge(verifier), code_challenge_method: "S256" }).toString();
  if (process.env.UNION_OAUTH_SCOPE) url.searchParams.set("scope", process.env.UNION_OAUTH_SCOPE);
  return { url, browser };
}
export async function completeUnionLogin(url: URL, browser: string | undefined, transport?: typeof fetch) {
  const state = url.searchParams.get("state");
  invariant(state && state.length <= 256 && browser && /^[a-f0-9]{64}$/.test(browser), 400, diagnosticText("diagnostics.unionOauth.theUnionSignInAttemptHasExpiredOrWasAlready"));
  await validateDatabase("auth");
  // DELETE ... RETURNING atomically consumes state before any network request, including failed callbacks.
  const attempt = await locked(async db => {
    const rows = await db.$queryRaw<{ verifier: string; returnTo: string }[]>`DELETE FROM ${securityAttemptTable()} WHERE "stateHash"=${tokenDigest(state)} AND "browserHash"=${tokenDigest(browser)} AND "expiresAt">now() RETURNING verifier,"returnTo"`;
    invariant(rows[0], 400, diagnosticText("diagnostics.unionOauth.theUnionSignInAttemptHasExpiredOrWasAlready")); return rows[0];
  }, authPrisma);
  const user = await exchangeUnionCode(url, state, attempt.verifier, transport);
  const token = randomBytes(32).toString("hex"), expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000);
  await locked(async db => { await db.$queryRaw`SELECT ${securityFunction("union_login")}(${user.sub},${user.nickname},${tokenDigest(token)},${expiresAt})`; }, authPrisma);
  return { token, expiresAt, returnTo: attempt.returnTo };
}
// Prisma's raw SQL identifiers use the same schema selection as the RLS helpers.
import { Prisma } from "@/generated/prisma/client";
function securityAttemptTable() { return Prisma.raw(`"${(process.env.DATABASE_SCHEMA ?? "public").replaceAll('"', '""')}"."UnionOAuthAttempt"`); }
