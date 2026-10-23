import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PackageFormatChoice } from "../src/components/admin/package-format-choice";
import { PackageBuildOptions } from "../src/components/admin/package-platforms";
import { ModTable, RecipeImportStats, RecipeFileTable } from "../src/components/admin/client-shared";
import { packageFormatVersionSchema, uploadProcessingLabel } from "../src/lib/client-contract";
import { defaultUploadPackageFormat, enabledPackageFormatsSchema } from "../src/lib/package-format-policy";
import { translator } from "../src/lib/i18n";
const t = translator("zh-CN");

test("update defaults follow the first published format; closed formats are hidden and a single choice is selected", () => {
  assert.equal(defaultUploadPackageFormat([1, 2], 2), 2);
  assert.equal(defaultUploadPackageFormat([1, 2], 1), 1);
  assert.equal(defaultUploadPackageFormat([1, 2]), null);
  assert.equal(defaultUploadPackageFormat([1], 2), 1);
  assert.equal(defaultUploadPackageFormat([2], 1), 2);
  for (const version of [1, 2] as const) {
    const html = renderToStaticMarkup(createElement(PackageFormatChoice, { value: version, enabledFormats: [version], onChange: () => {} }));
    assert.equal((html.match(/<button/g) ?? []).length, 1);
    assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1);
    assert(!html.includes(t(version === 1 ? "packageFormatChoice.v2LightweightRecipe" : "packageFormatChoice.v1FullEnvironmentPackage")));
  }
  const resumed = renderToStaticMarkup(createElement(PackageFormatChoice, { value: 2, enabledFormats: [1], locked: true, onChange: () => {} }));
  assert(!resumed.includes("<button")); assert(resumed.includes(t("packageFormatChoice.lockedFormatHint", { format: 2 })));
  for (const invalid of [[], [1, 1], [3], ["1"]]) assert.throws(() => enabledPackageFormatsSchema.parse(invalid));
});

test("only v1 offers architecture selection, v2 always describes one universal package", () => {
  const props = { value: [] as never[], onChange: () => {} };
  const v2 = renderToStaticMarkup(createElement(PackageBuildOptions, { ...props, packageFormatVersion: 2 }));
  assert(v2.includes(t("packagePlatforms.v2GeneratesOneUniversalRecipeDownloadedByAllSystems")));
  assert(!v2.includes("checkbox")); assert(!v2.includes("linux-aarch64"));
  const v1 = renderToStaticMarkup(createElement(PackageBuildOptions, { ...props, packageFormatVersion: 1 }));
  assert.equal((v1.match(/type="checkbox"/g) ?? []).length, 6);
  assert.equal(renderToStaticMarkup(createElement(PackageBuildOptions, { ...props, packageFormatVersion: null })), "");
});

test("new format choice has no implicit selection; a saved upload displays its locked format", () => {
  const empty = renderToStaticMarkup(createElement(PackageFormatChoice, { value: null, onChange: () => {} }));
  assert.equal((empty.match(/aria-pressed="false"/g) ?? []).length, 2); assert(!empty.includes("<fieldset disabled"));
  const saved = renderToStaticMarkup(createElement(PackageFormatChoice, { value: 2, onChange: () => {}, locked: true }));
  assert(saved.includes("<fieldset disabled")); assert.equal((saved.match(/aria-pressed="true"/g) ?? []).length, 1);
  assert(saved.includes(t("packageFormatChoice.lockedFormatHint", { format: 2 }))); assert(saved.includes(t("packageFormatChoice.v2SupportsModrinthMrpackAndPclArchivesItCreates")));
});

test("v2 review file table distinguishes verified local payloads from optional remote declarations", () => {
  const html = renderToStaticMarkup(createElement(RecipeFileTable, { files: [
    { path: "mods/local.jar", size: 10, hashes: { sha256: "a".repeat(64) }, source: { type: "local", entry: "overrides/mods/local.jar" }, policy: "managed", optional: false, executable: false },
    { path: "mods/remote.jar", size: 20, hashes: { sha1: "b".repeat(40), sha512: "c".repeat(128) }, source: { type: "remote", downloads: ["https://remote.invalid/mod.jar"] }, policy: "managed", optional: true, executable: false },
  ] }));
  assert(html.includes(t("clientShared.localVerified"))); assert(html.includes(t("clientShared.remoteDeclarationLauncherDownload")));
  assert(html.includes(t("clientShared.optionalPlayerChoice"))); assert(html.includes("SHA-256")); assert(html.includes("SHA-512"));
});

test("format discriminator accepts only supported package formats and queued work is explicit", () => {
  assert.equal(packageFormatVersionSchema.parse(1), 1); assert.equal(packageFormatVersionSchema.parse(2), 2);
  assert.throws(() => packageFormatVersionSchema.parse("2")); assert.throws(() => packageFormatVersionSchema.parse(3));
  assert.equal(uploadProcessingLabel({ status: "QUEUED", processingPhase: null, progress: 0 }), t("system.waitingForWorkerProcessing"));
});

test("v2 remote declarations have no fake download progress and import sizes are separated", () => {
  const table = renderToStaticMarkup(createElement(ModTable, { mods: ["remote.jar"], details: [{ path: "mods/remote.jar", source: "remote",
    optional: true, size: 500, downloads: ["https://remote.invalid/mod.jar"], status: "DECLARED", downloadedBytes: 0, error: null }] }));
  assert(table.includes(t("clientShared.declarationSavedDownloadedByLauncher"))); assert(table.includes(t("clientShared.fileBytesNotVerified")));
  assert(table.includes(t("clientShared.optionalPlayerChoice"))); assert(table.includes(t("clientShared.directDownload") + " ")); assert(!table.includes('role="progressbar"'));
  const card = renderToStaticMarkup(createElement(RecipeImportStats, { statistics: { localFiles: 1, remoteFiles: 1, optionalFiles: 1,
    localSize: 50, remoteDeclaredSize: 500, newLocalDataSize: 10, localCasReusePercent: 80, sourceSize: 100 } }));
  assert(card.includes(t("clientShared.localFileCasReuse"))); assert(card.includes("80%")); assert(card.includes(t("clientShared.declaredRemoteSize"))); assert(card.includes(t("clientShared.launcherDownloadsRemoteModsAndEnvironmentsRemoteSizesAre")));
  assert.equal(uploadProcessingLabel({ status: "READY", packageFormatVersion: 2, processingPhase: "CAS", progress: 100 }), t("system.v2DetectionCompleteAwaitingSubmission"));
});
