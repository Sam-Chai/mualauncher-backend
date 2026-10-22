import "server-only";
import { decodeJwt, decodeProtectedHeader } from "jose";
import { z } from "zod";
import { gameUuid, profileName } from "./launcher-game-contract";
import { gameTransport, type GameTransport } from "./launcher-game-network";
import { AppError } from "./errors";

export class GameLoginError extends AppError {
  constructor(status: number, public code: string) { super(status, code); }
}
export function gameCheck(condition: unknown, status: number, code: string): asserts condition {
  if (!condition) throw new GameLoginError(status, code);
}
export type GameProvider = { id: string; siteCode: string; revision: number; authApiRoot: string; adapter: string };
const verifiedIdentity = Symbol("verified-game-identity");
export type VerifiedGameIdentity = { readonly [verifiedIdentity]: true; subject: string; profile: { id: string; name: string }; upstreamExpiresAt: Date };
const claims = z.object({ sub: z.string().regex(/^[1-9][0-9]{0,19}$/), selectedProfile: gameUuid,
  exp: z.number().int().positive().max(8640000000000), nbf: z.number().int().optional(), iat: z.number().int().optional(),
  aud: z.union([z.string().min(1).max(256), z.array(z.string().min(1).max(256)).min(1).max(8)]), jti: z.string().min(1).max(256) });

// The only identity-producing entrypoint: full token online validation precedes use of its claims.
export async function verifyGameIdentity(provider: GameProvider, input: { gameAccessToken: string; gameClientToken?: string; gameProfile: { id: string; name?: string } }, transport: GameTransport = gameTransport): Promise<VerifiedGameIdentity> {
  gameCheck(provider.adapter === "MUA_YGGC_ONLINE_V1", 503, "IDENTITY_PROOF_UNSUPPORTED");
  const signal = AbortSignal.timeout(10_000);
  try {
    const validation = await transport(new URL(`${provider.authApiRoot}/authserver/validate`), JSON.stringify({ accessToken: input.gameAccessToken,
      ...(input.gameClientToken ? { clientToken: input.gameClientToken } : {}) }), signal);
    gameCheck(validation.status !== 400 && validation.status !== 401 && validation.status !== 403, 401, "GAME_TOKEN_INVALID");
    gameCheck(validation.status === 204 && validation.bytes.length === 0, 502, "UPSTREAM_UNAVAILABLE");
    let header: ReturnType<typeof decodeProtectedHeader>, payload: ReturnType<typeof decodeJwt>;
    try { header = decodeProtectedHeader(input.gameAccessToken); payload = decodeJwt(input.gameAccessToken); }
    catch { throw new GameLoginError(503, "IDENTITY_PROOF_UNSUPPORTED"); }
    // This adapter supports traditional Passport game tokens only, not Janus or arbitrary issuers.
    gameCheck(header.alg === "RS256" && !header.crit && payload.iss === undefined, 503, "IDENTITY_PROOF_UNSUPPORTED");
    const parsed = claims.safeParse(payload);
    gameCheck(parsed.success, 503, "IDENTITY_PROOF_UNSUPPORTED");
    const c = parsed.data, now = Date.now() / 1000;
    gameCheck(c.exp > now + 90, 401, "GAME_TOKEN_EXPIRING");
    gameCheck((c.nbf === undefined || c.nbf <= now + 30) && (c.iat === undefined || c.iat <= now + 30), 401, "GAME_TOKEN_INVALID");
    gameCheck(c.selectedProfile === input.gameProfile.id, 409, "PROFILE_MISMATCH");
    const response = await transport(new URL(`${provider.authApiRoot}/sessionserver/session/minecraft/profile/${c.selectedProfile}`), undefined, signal);
    gameCheck(response.status === 200 && response.contentType.split(";")[0].trim() === "application/json" && response.bytes.length <= 65536, 502, "UPSTREAM_UNAVAILABLE");
    let raw: unknown;
    try { raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(response.bytes)); } catch { throw new GameLoginError(502, "UPSTREAM_UNAVAILABLE"); }
    const profile = z.object({ id: gameUuid, name: profileName }).safeParse(raw);
    gameCheck(profile.success && profile.data.id === c.selectedProfile, 409, "PROFILE_MISMATCH");
    gameCheck(input.gameProfile.name === undefined || input.gameProfile.name === profile.data.name, 409, "PROFILE_CHANGED");
    return { [verifiedIdentity]: true, subject: `${provider.siteCode}:${c.sub}`, profile: profile.data, upstreamExpiresAt: new Date(c.exp * 1000) };
  } catch (error) {
    if (error instanceof GameLoginError) throw error;
    // Never log/forward network exceptions, upstream response bodies or decode errors (may contain secrets).
    throw new GameLoginError(502, "UPSTREAM_UNAVAILABLE");
  }
}
