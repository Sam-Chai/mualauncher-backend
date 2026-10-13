import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { recipeDistribution, recipeDistributionSchema } from "../src/lib/recipe-distribution-contract";
import type { RecipeFile } from "../src/lib/recipe-inventory";
import { RecipeDistributionDetails } from "../src/components/admin/client-shared";
import { PreferenceProvider } from "../src/components/preferences";

const local: RecipeFile = { path: "config/a.txt", size: 10, policy: "preserve", optional: false, executable: false, hashes: { sha256: "1".repeat(64) }, source: { type: "local", entry: "overrides/config/a.txt" } };
const remote: RecipeFile = { path: "mods/a.jar", size: 100, policy: "managed", optional: true, executable: false, hashes: { sha1: "2".repeat(40), sha512: "2".repeat(128) }, source: { type: "remote", downloads: ["https://example.invalid/a.jar"] } };
const reference = { releaseId: "00000000-0000-4000-8000-000000000001", version: "1.0.0", manifestSha256: "3".repeat(64) };

test("first-install statistics separate ZIP, payload, deduplicated remote content and unknown environment sizes", () => {
  const files = [local, remote, { ...remote, path: "mods/copy.jar" }];
  const pending = recipeDistribution(files, null);
  assert.equal(pending.localPayloadBytes, 10); assert.equal(pending.remoteDeclaredBytes, 200); assert.equal(pending.remoteDownloadBytes, 100);
  assert.equal(pending.knownNetworkBytes, null); assert.equal(pending.environmentBytes, null);
  const ready = recipeDistribution(files, null, { full: 500, update: null });
  assert.equal(ready.knownNetworkBytes, 600); assert.equal(ready.selectedPackageBytes, 500);
  assert(recipeDistributionSchema.safeParse(ready).success);
  assert(!recipeDistributionSchema.safeParse({ ...ready, environmentBytes: 0 }).success);
});

test("URL-only and policy-only changes do not invent remote downloads; local policy changes retain package payload", () => {
  const base = { files: [local, remote], reference };
  const changed: RecipeFile[] = [{ ...local, optional: true }, { ...remote, optional: false, source: { type: "remote", downloads: ["https://mirror.invalid/a.jar"] } }];
  const stats = recipeDistribution(changed, base, { full: 500, update: 200 });
  assert.equal(stats.localPayloadBytes, 10); assert.equal(stats.remoteDownloadBytes, 0); assert.equal(stats.knownNetworkBytes, 200);
  assert.deepEqual(stats.changes.map(file => file.kinds), [["policy"], ["policy", "source"]]);
  const unchanged = recipeDistribution(base.files, base, { full: 500, update: 180 });
  assert.equal(unchanged.localPayloadBytes, 0); assert.equal(unchanged.remoteDownloadBytes, 0); assert.equal(unchanged.knownNetworkBytes, 180); assert.deepEqual(unchanged.changes, []);
});

test("mixed content changes and removal count only target downloads while preserve files remain a declaration difference", () => {
  const added = { ...remote, path: "mods/new.jar", size: 300, hashes: { sha1: "4".repeat(40), sha512: "4".repeat(128) } };
  const stats = recipeDistribution([added], { files: [local, remote], reference }, { full: 450, update: 200 });
  assert.equal(stats.remoteDownloadBytes, 300); assert.equal(stats.localPayloadBytes, 0); assert.equal(stats.knownNetworkBytes, 500);
  assert.equal(stats.changes.filter(file => file.kinds.includes("removed")).length, 2);
  assert.equal(stats.changes.find(file => file.path === local.path)?.before?.policy, "preserve");
});

test("v2 distribution display is bilingual and keeps unknown totals distinct from zero", () => {
  for (const locale of ["zh-CN", "en-US"] as const) {
    const statistics = recipeDistribution([local, remote], null);
    const html = renderToStaticMarkup(<PreferenceProvider initialLocale={locale}><RecipeDistributionDetails statistics={statistics} /></PreferenceProvider>);
    if (locale === "en-US") { assert(html.includes("Pending Launcher resolution")); assert(html.includes("Available after packaging")); assert(!/[\u3400-\u9fff]/.test(html)); }
    else { assert(html.includes("待 Launcher 解析")); assert(html.includes("CAS 复用率仅表示后台存储复用")); }
  }
});
