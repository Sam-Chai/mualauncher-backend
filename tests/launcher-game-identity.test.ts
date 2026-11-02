import assert from "node:assert/strict";
import { test } from "node:test";
import { GameLoginError, verifyGameIdentity } from "../src/lib/launcher-game-identity";
import { gameFailure } from "../src/lib/launcher-game-auth";
import { gameIdentityErrorCodes, gameLoginErrorSchema } from "../src/lib/launcher-game-contract";
import type { GameTransport } from "../src/lib/launcher-game-network";

const uuid = "a".repeat(32), now = 1_800_000_000;
const provider = { id: "fixture", siteCode: "MUA", revision: 1, adapter: "MUA_YGGC_ONLINE_V1", authApiRoot: "https://skin.example/custom/" };
const baseClaims = { sub: "123", selectedProfile: uuid, exp: now + 3600, nbf: now - 30, iat: now - 30, aud: "fixture", jti: "fixture-id" };
// The upstream validator is mocked, not bypassed by the production verifier.
function token(claims: unknown = baseClaims, header: unknown = { alg: "RS256" }) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode(header)}.${encode(claims)}.c2ln`;
}
function network() {
  const calls: string[] = [];
  const transport: GameTransport = async (url, body) => {
    calls.push(url.href);
    return body === undefined
      ? { status: 200, contentType: "application/json", bytes: Buffer.from(JSON.stringify({ id: uuid, name: "Fixture" })) }
      : { status: 204, contentType: "", bytes: Buffer.alloc(0) };
  };
  return { calls, transport };
}

test("Passport NumericDate accepts fractional seconds without rounding expiry or weakening time checks", async t => {
  t.mock.method(Date, "now", () => now * 1000);
  for (const dates of [{}, { exp: now + 3600.125 }, { iat: now - 0.125 }, { nbf: now - 0.125 },
    { exp: now + 3600.125, iat: now - 0.125, nbf: now - 0.125 }, { exp: now + 90.125 }]) {
    const { calls, transport } = network();
    const result = await verifyGameIdentity(provider, { gameAccessToken: token({ ...baseClaims, ...dates }), gameProfile: { id: uuid } }, transport);
    assert.equal(result.subject, "MUA:123");
    assert.equal(result.upstreamExpiresAt.getTime(), (dates.exp ?? baseClaims.exp) * 1000);
    assert.deepEqual(calls, ["https://skin.example/custom/authserver/validate", `https://skin.example/custom/sessionserver/session/minecraft/profile/${uuid}`]);
  }
  for (const [dates, code] of [[{ exp: now + 89.875 }, "GAME_TOKEN_EXPIRING"], [{ exp: now + 90 }, "GAME_TOKEN_EXPIRING"],
    [{ iat: now + 30.125 }, "GAME_TOKEN_INVALID"], [{ nbf: now + 30.125 }, "GAME_TOKEN_INVALID"]] as const) {
    await assert.rejects(verifyGameIdentity(provider, { gameAccessToken: token({ ...baseClaims, ...dates }), gameProfile: { id: uuid } }, network().transport),
      (error: unknown) => error instanceof GameLoginError && error.status === 401 && error.code === code);
  }
});

test("identity format failures have distinct, redacted public diagnostics after online validation", async t => {
  t.mock.method(Date, "now", () => now * 1000);
  const cases: { code: typeof gameIdentityErrorCodes[number]; value?: string; claims?: unknown; header?: unknown; adapter?: string }[] = [
    { code: "PROVIDER_ADAPTER_UNSUPPORTED", adapter: "unknown" },
    { code: "GAME_TOKEN_FORMAT_UNSUPPORTED", value: "private-claim-marker" },
    { code: "GAME_TOKEN_FORMAT_UNSUPPORTED", claims: [] },
    { code: "GAME_TOKEN_FORMAT_UNSUPPORTED", header: [] },
    { code: "GAME_TOKEN_ALGORITHM_UNSUPPORTED", header: { alg: "HS256" } },
    { code: "GAME_TOKEN_HEADER_UNSUPPORTED", header: { alg: "RS256", crit: ["private-claim-marker"] } },
    { code: "GAME_TOKEN_HEADER_UNSUPPORTED", header: { alg: "RS256", crit: null } },
    { code: "GAME_TOKEN_ISSUER_UNSUPPORTED", claims: { ...baseClaims, iss: "private-claim-marker" } },
    { code: "GAME_TOKEN_SUBJECT_UNSUPPORTED", claims: { ...baseClaims, sub: "private-claim-marker" } },
    { code: "GAME_TOKEN_SUBJECT_UNSUPPORTED", claims: { ...baseClaims, sub: 123 } },
    { code: "GAME_TOKEN_SUBJECT_UNSUPPORTED", claims: { ...baseClaims, sub: "0123" } },
    { code: "GAME_TOKEN_PROFILE_INVALID", claims: { ...baseClaims, selectedProfile: "private-claim-marker" } },
    { code: "GAME_TOKEN_EXPIRY_INVALID", claims: { ...baseClaims, exp: "private-claim-marker" } },
    { code: "GAME_TOKEN_EXPIRY_INVALID", claims: { ...baseClaims, exp: undefined } },
    { code: "GAME_TOKEN_EXPIRY_INVALID", claims: { ...baseClaims, exp: 0 } },
    { code: "GAME_TOKEN_EXPIRY_INVALID", claims: { ...baseClaims, exp: 8640000000001 } },
    { code: "GAME_TOKEN_NOT_BEFORE_INVALID", claims: { ...baseClaims, nbf: "private-claim-marker" } },
    { code: "GAME_TOKEN_NOT_BEFORE_INVALID", claims: { ...baseClaims, nbf: null } },
    { code: "GAME_TOKEN_ISSUED_AT_INVALID", claims: { ...baseClaims, iat: "private-claim-marker" } },
    { code: "GAME_TOKEN_ISSUED_AT_INVALID", claims: { ...baseClaims, iat: 8640000000001 } },
    { code: "GAME_TOKEN_AUDIENCE_INVALID", claims: { ...baseClaims, aud: [] } },
    { code: "GAME_TOKEN_AUDIENCE_INVALID", claims: { ...baseClaims, aud: undefined } },
    { code: "GAME_TOKEN_ID_INVALID", claims: { ...baseClaims, jti: undefined } },
    { code: "GAME_TOKEN_ID_INVALID", claims: { ...baseClaims, jti: {} } },
  ];
  const covered = new Set<string>();
  for (const row of cases) {
    const { calls, transport } = network();
    const value = row.value ?? token(row.claims ?? baseClaims, row.header ?? { alg: "RS256" });
    let failure: GameLoginError | undefined;
    await assert.rejects(verifyGameIdentity({ ...provider, adapter: row.adapter ?? provider.adapter }, { gameAccessToken: value, gameProfile: { id: uuid } }, transport),
      (error: unknown) => { if (!(error instanceof GameLoginError)) return false; failure = error; return error.status === 503 && error.code === row.code; }, row.code);
    assert(failure);
    const response = gameFailure(failure), body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(body.code, `diagnostics.game.${row.code}`);
    assert.deepEqual(body.params, {});
    assert(gameLoginErrorSchema.safeParse(body).success);
    assert(!/[\u3400-\u9fff]/.test(body.error), "API error prose is English");
    assert(!JSON.stringify(body).includes("private-claim-marker"));
    assert(!JSON.stringify(body).includes(value));
    assert.equal(calls.length, row.adapter ? 0 : 1, "No public profile lookup after a rejected identity proof");
    covered.add(row.code);
  }
  assert.deepEqual([...covered].sort(), [...gameIdentityErrorCodes].sort());
});

test("invalid upstream validation takes precedence over all token format diagnostics", async () => {
  for (const status of [400, 401, 403, 200, 302, 500]) {
    let calls = 0;
    await assert.rejects(verifyGameIdentity(provider, { gameAccessToken: "private-claim-marker", gameProfile: { id: uuid } }, async () => {
      calls++; return { status, contentType: "", bytes: Buffer.alloc(0) };
    }), (error: unknown) => error instanceof GameLoginError && error.code === ([400, 401, 403].includes(status) ? "GAME_TOKEN_INVALID" : "UPSTREAM_UNAVAILABLE"));
    assert.equal(calls, 1);
  }
});
