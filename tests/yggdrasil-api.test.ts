import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveYggdrasilApi, yggdrasilApiUrl, yggdrasilEndpoint } from "../src/lib/yggdrasil-api";
import { fetchUnionSiteName } from "../src/lib/union-site-metadata";
import { gameTransport } from "../src/lib/launcher-game-network";
import type { SiteReader, SiteResource } from "../src/lib/union-site-icons";
import { verifyGameIdentity } from "../src/lib/launcher-game-identity";
import { prepareGameProvider, discoverGameProvider, saveResolvedGameProvider } from "../src/lib/launcher-game-auth";
import type { Actor, Db } from "../src/lib/auth";

const metadata = { meta: { serverName: "ALI fixture" } };
const json = (extra: Partial<SiteResource> = {}): SiteResource => ({ bytes: Buffer.from(JSON.stringify(metadata)), contentType: "application/json", ...extra });
const signal = () => AbortSignal.timeout(1000);

test("scheme completion and no ALI retain the supplied API path without guessing a suffix", async () => {
  const calls: string[] = [];
  const result = await resolveYggdrasilApi("skin.example/custom/root", async url => { calls.push(url); return json(); }, signal());
  assert.equal(result.apiRoot, "https://skin.example/custom/root");
  assert.deepEqual(calls, [result.apiRoot]);
  assert.equal(yggdrasilEndpoint(result.apiRoot, "authserver/validate").href, "https://skin.example/custom/root/authserver/validate");
  assert.equal(yggdrasilEndpoint(result.apiRoot + "/", "authserver/validate").href, "https://skin.example/custom/root/authserver/validate");
});

test("relative ALI is resolved against the final redirect URL, not the input origin", async () => {
  const calls: string[] = [];
  const result = await resolveYggdrasilApi("https://skin.example/", async url => {
    calls.push(url);
    if (calls.length === 1) return json({ status: 302, location: "https://auth.example/landing/page" });
    if (calls.length === 2) return json({ contentType: "text/html", apiLocation: "../nested/api/" });
    return json();
  }, signal());
  assert.equal(result.apiRoot, "https://auth.example/nested/api/");
  assert.deepEqual(calls, ["https://skin.example/", "https://auth.example/landing/page", result.apiRoot]);
});

test("readers that follow redirects expose final URL for relative ALI and no-ALI fallback", async () => {
  const read: SiteReader = async url => url === "https://skin.example/"
    ? json({ url: "https://other.example/path/page", apiLocation: "./api/" }) : json();
  assert.equal((await resolveYggdrasilApi("skin.example", read, signal())).apiRoot, "https://other.example/path/api/");
  assert.equal((await resolveYggdrasilApi("skin.example", async () => json({ url: "https://other.example/real/api/" }), signal())).apiRoot, "https://other.example/real/api/");
});

test("ALI on an error response still discovers the API, but the final metadata must succeed", async () => {
  const calls: string[] = [];
  const result = await resolveYggdrasilApi("https://skin.example/old/plugin", async url => {
    calls.push(url);
    return calls.length === 1 ? json({ status: 400, apiLocation: "/new/api/" }) : json();
  }, signal());
  assert.equal(result.apiRoot, "https://skin.example/new/api/");
  assert.equal(calls.length, 2);
  await assert.rejects(resolveYggdrasilApi("skin.example", async () => json({ status: 400, apiLocation: "/" }), signal()), /AUTH_METADATA_INVALID/);
});

test("absolute ALI may change host, is one indication, and self ALI reuses metadata", async () => {
  let calls = 0;
  const result = await resolveYggdrasilApi("https://skin.example", async (_url, _limit, _signal, discovery) => {
    calls++;
    assert.equal(discovery?.followAli, calls === 1);
    return calls === 1 ? json({ apiLocation: "https://auth.example/custom/" }) : json({ apiLocation: "https://unused.example/" });
  }, signal());
  assert.equal(result.apiRoot, "https://auth.example/custom/"); assert.equal(calls, 2);
  calls = 0;
  await resolveYggdrasilApi("skin.example", async () => { calls++; return json({ apiLocation: "/" }); }, signal());
  assert.equal(calls, 1);
});

test("unsafe ALI and redirect targets are rejected before a second request", async () => {
  for (const target of ["http://public.example/", "https://127.0.0.1/", "https://[::1]/", "https://169.254.169.254/", "https://localhost/", "https://user:pass@public.example/", "https://public.example:8443/", "https://public.example/?token=x", "https://public.example/#fragment"]) {
    for (const redirect of [false, true]) {
      let calls = 0;
      await assert.rejects(resolveYggdrasilApi("skin.example", async () => { calls++; return json(redirect ? { status: 307, location: target } : { apiLocation: target }); }, signal()));
      assert.equal(calls, 1, target);
    }
  }
  assert.throws(() => yggdrasilApiUrl("https://skin.example/\n"));
});

test("redirect loops, missing locations, empty ALI, invalid metadata and oversized responses fail closed", async () => {
  const cases: SiteResource[] = [json({ status: 302, location: "/" }), json({ status: 301 }), json({ apiLocation: "" }),
    json({ status: 500 }), json({ contentType: "text/html" }), json({ bytes: Buffer.from("not JSON") }),
    json({ bytes: Buffer.from("null") }), json({ bytes: Buffer.from('{"meta":[]}') }), json({ bytes: Buffer.alloc(65537) })];
  for (const response of cases) await assert.rejects(resolveYggdrasilApi("skin.example", async () => response, signal()));
  let count = 0;
  await assert.rejects(resolveYggdrasilApi("skin.example", async () => json({ status: 302, location: `/hop/${++count}` }), signal()), /REDIRECT_LIMIT/);
  assert.equal(count, 8);
});

test("discovery aborts without a request and never retries a guessed conventional path", async () => {
  const controller = new AbortController(); controller.abort();
  let calls = 0;
  await assert.rejects(resolveYggdrasilApi("skin.example", async () => { calls++; return json(); }, controller.signal));
  assert.equal(calls, 0);
  await assert.rejects(resolveYggdrasilApi("skin.example", async () => { calls++; return json({ contentType: "text/html" }); }, signal()));
  assert.equal(calls, 1);
});

test("directory names use ALI with merged-domain fallback and invalid-name rejection", async () => {
  const calls: string[] = [];
  assert.equal(await fetchUnionSiteName(["https://down.example", "https://skin.example"], async url => {
    calls.push(url);
    if (url.includes("down.example")) throw Error("offline");
    return url === "https://skin.example/" ? json({ apiLocation: "/special/auth/" }) : json();
  }, signal()), metadata.meta.serverName);
  assert.deepEqual(calls, ["https://down.example/", "https://skin.example/", "https://skin.example/special/auth/"]);
  await assert.rejects(fetchUnionSiteName(["https://skin.example"], async () => json({ bytes: Buffer.from('{"meta":{"serverName":"bad\\u0000name"}}') }), signal()));
});

test("the production transport blocks loopback, reserved and private DNS even during anonymous discovery", async () => {
  for (const value of ["https://127.0.0.1/", "https://[::1]/", "https://169.254.169.254/", "https://localhost/"]) {
    await assert.rejects(gameTransport(new URL(value), undefined, signal(), "ali"));
  }
});

test("credential requests use the saved custom root without discovery, redirects or double slashes", async () => {
  const uuid = "a".repeat(32);
  const encoded = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const token = `${encoded({ alg: "RS256" })}.${encoded({ sub: "123", selectedProfile: uuid, exp: Math.floor(Date.now()/1000)+3600, aud: "fixture", jti: "fixture" })}.c2ln`;
  for (const root of ["https://auth.example/deep/api", "https://auth.example/deep/api/"]) {
    const calls: string[] = [];
    const result = await verifyGameIdentity({ id: "fixture", siteCode: "MUA", revision: 1, adapter: "MUA_YGGC_ONLINE_V1", authApiRoot: root },
      { gameAccessToken: token, gameProfile: { id: uuid } }, async (url, body) => {
        calls.push(url.href);
        return body ? { status: 204, bytes: Buffer.alloc(0), contentType: "" }
          : { ...json({ bytes: Buffer.from(JSON.stringify({ id: uuid, name: "Fixture" })) }), status: 200 };
      });
    assert.equal(result.subject, "MUA:123");
    assert.deepEqual(calls, ["https://auth.example/deep/api/authserver/validate", `https://auth.example/deep/api/sessionserver/session/minecraft/profile/${uuid}`]);
  }
});

test("disabling an existing provider works offline; reapproval discovers anew and rejects stale revisions", async () => {
  const actor = { id: "fixture-admin", isSuperAdmin: true } as Actor;
  const input = { id: "a6be107b-3ee1-4f3a-95e9-d5d4b6fb3d91", revision: 1, siteCode: "MUA", bsRoot: "https://skin.example", displayName: "Fixture",
    adapter: "MUA_YGGC_ONLINE_V1", enabled: false, verificationNote: "Fixture mapping and logging verified", confirmUidMapping: true, confirmCredentialLogRedaction: true };
  let siteRevision = 1, providerRevision = 1, writes = 0, calls = 0;
  const db = { unionSkinSite: { findUnique: async () => ({ enabled: true, managedBySync: true, upstreamPresent: true,
    organization: { archivedAt: null, launcherLoginEnabled: true }, bsRoot: input.bsRoot, bsRootAliases: [], revision: siteRevision }) },
    launcherAuthProvider: { findUnique: async () => ({ ...input, authApiRoot: "https://old.example/api/", revision: providerRevision }),
      upsert: async () => { writes++; } } } as unknown as Db;
  const prepared = await prepareGameProvider(db, actor, input);
  assert.equal(await discoverGameProvider(prepared, async () => { throw Error("offline"); }), "https://old.example/api/");
  const enabled = await prepareGameProvider(db, actor, { ...input, enabled: true });
  assert.equal(await discoverGameProvider(enabled, async (_url, body) => { calls++; assert.equal(body, undefined); return { ...json(), status: 200 }; }), "https://skin.example/");
  assert.equal(calls, 1);
  await assert.rejects(discoverGameProvider(enabled, async () => { throw Error("offline"); }), /UPSTREAM_UNAVAILABLE/);
  siteRevision++;
  await assert.rejects(saveResolvedGameProvider(db, actor, enabled, "https://auth.example/api/"), /PROVIDER_CHANGED/);
  siteRevision--; providerRevision++;
  await assert.rejects(saveResolvedGameProvider(db, actor, enabled, "https://auth.example/api/"), /PROVIDER_CHANGED/);
  assert.equal(writes, 0);
  await assert.rejects(prepareGameProvider(db, { ...actor, isSuperAdmin: false }, input));
});
