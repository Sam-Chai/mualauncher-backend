import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PackageFormatChoice } from "../src/components/admin/package-format-choice";
import { PackageBuildOptions } from "../src/components/admin/package-platforms";
import { ModTable, RecipeImportStats, RecipeFileTable } from "../src/components/admin/client-shared";
import { packageFormatVersionSchema, uploadProcessingLabel } from "../src/lib/client-contract";
import { defaultUploadPackageFormat, enabledPackageFormatsSchema } from "../src/lib/package-format-policy";

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
    assert(!html.includes(version === 1 ? "v2 · 轻量配方包" : "v1 · 完整环境包"));
  }
  const resumed = renderToStaticMarkup(createElement(PackageFormatChoice, { value: 2, enabledFormats: [1], locked: true, onChange: () => {} }));
  assert(!resumed.includes("<button")); assert(resumed.includes("本次上传已锁定为 v2"));
  for (const invalid of [[], [1, 1], [3], ["1"]]) assert.throws(() => enabledPackageFormatsSchema.parse(invalid));
});

test("only v1 offers architecture selection, v2 always describes one universal package", () => {
  const props = { value: [] as never[], onChange: () => {} };
  const v2 = renderToStaticMarkup(createElement(PackageBuildOptions, { ...props, packageFormatVersion: 2 }));
  assert(v2.includes("各系统下载相同的文件"));
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
  assert(saved.includes("本次上传已锁定为 v2")); assert(saved.includes("跨平台")); assert(saved.includes("审核"));
});

test("v2 review file table distinguishes verified local payloads from optional remote declarations", () => {
  const html = renderToStaticMarkup(createElement(RecipeFileTable, { files: [
    { path: "mods/local.jar", size: 10, hashes: { sha256: "a".repeat(64) }, source: { type: "local", entry: "overrides/mods/local.jar" }, policy: "managed", optional: false, executable: false },
    { path: "mods/remote.jar", size: 20, hashes: { sha1: "b".repeat(40), sha512: "c".repeat(128) }, source: { type: "remote", downloads: ["https://remote.invalid/mod.jar"] }, policy: "managed", optional: true, executable: false },
  ] }));
  assert(html.includes("本地 · 已校验")); assert(html.includes("远程声明 · Launcher 下载"));
  assert(html.includes("optional · 玩家选择")); assert(html.includes("SHA-256")); assert(html.includes("SHA-512"));
});

test("format discriminator accepts only supported package formats and queued work is explicit", () => {
  assert.equal(packageFormatVersionSchema.parse(1), 1); assert.equal(packageFormatVersionSchema.parse(2), 2);
  assert.throws(() => packageFormatVersionSchema.parse("2")); assert.throws(() => packageFormatVersionSchema.parse(3));
  assert.match(uploadProcessingLabel({ status: "QUEUED", processingPhase: null, progress: 0 }), /等待 Worker/);
});

test("v2 remote declarations have no fake download progress and import sizes are separated", () => {
  const table = renderToStaticMarkup(createElement(ModTable, { mods: ["remote.jar"], details: [{ path: "mods/remote.jar", source: "remote",
    optional: true, size: 500, downloads: ["https://remote.invalid/mod.jar"], status: "DECLARED", downloadedBytes: 0, error: null }] }));
  assert(table.includes("声明已保存 · 由 Launcher 下载")); assert(table.includes("文件字节未校验"));
  assert(table.includes("optional · 玩家选择")); assert(table.includes("下载直链 1")); assert(!table.includes('role="progressbar"'));
  const card = renderToStaticMarkup(createElement(RecipeImportStats, { statistics: { localFiles: 1, remoteFiles: 1, optionalFiles: 1,
    localSize: 50, remoteDeclaredSize: 500, newLocalDataSize: 10, localCasReusePercent: 80, sourceSize: 100 } }));
  assert(card.includes("本地文件 CAS 复用率")); assert(card.includes("远程声明大小")); assert(card.includes("不代表玩家预计更新量"));
  assert.match(uploadProcessingLabel({ status: "READY", packageFormatVersion: 2, processingPhase: "CAS", progress: 100 }), /待提交/);
});
