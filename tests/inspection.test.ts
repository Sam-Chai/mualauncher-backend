import assert from "node:assert/strict";
import { test } from "node:test";
import { inspectMinecraftRuntime } from "../src/lib/minecraft-inspection";
import { inspectPackMods } from "../src/lib/pack-inspection";
import { minecraftJava } from "../src/lib/minecraft-java";
import { uploadProcessingLabel, runtimeAutofill, type PackFile } from "../src/lib/client-contract";

function inspect(records: Record<string, unknown>, jars: Record<string, unknown> = {}, selected?: string) {
  return inspectMinecraftRuntime([...Object.keys(records), ...Object.keys(jars)], {
    json: async path => records[path], jar: async path => jars[path],
  }, selected);
}
test("PCL renamed NeoForge instances use clientVersion and explicit Java, never mixin libraries as Fabric", async () => {
  const info = await inspect({ "versions/custom/custom.json": { id: "custom", clientVersion: "1.21.1", javaVersion: { majorVersion: 21, component: "java-runtime-delta" },
    arguments: { game: ["--fml.mcVersion", "1.21.1", "--fml.neoForgeVersion", "21.1.256"] }, libraries: [{ name: "net.fabricmc:sponge-mixin:0.15.2" }] } },
  { "versions/custom/custom.jar": { id: "1.21.1", java_version: 21 } });
  assert.equal(info.minecraftVersion, "1.21.1"); assert.equal(info.javaVersion, 21); assert.equal(info.loader, "neoforge"); assert.equal(info.loaderVersion, "21.1.256");
});
test("HMCL game and Fabric patches identify MC 26.1 and Java 25 independently of the instance name", async () => {
  const info = await inspect({ "versions/test/test.json": { id: "test", javaVersion: { majorVersion: 25 },
    patches: [{ id: "game", version: "26.1" }, { id: "fabric", version: "0.19.5" }] } });
  assert.equal(info.minecraftVersion, "26.1"); assert.equal(info.javaVersion, 25); assert.equal(info.loader, "fabric"); assert.equal(info.loaderVersion, "0.19.5");
});
test("inherited Fabric profiles resolve parents and offer only independent leaf instances", async () => {
  const info = await inspect({ "versions/1.21.1/1.21.1.json": { id: "1.21.1", javaVersion: { majorVersion: 21 } },
    "versions/fabric/fabric.json": { id: "fabric", inheritsFrom: "1.21.1", libraries: [{ name: "net.fabricmc:fabric-loader:0.16.0" }] } });
  assert.equal(info.requiresSelection, false); assert.equal(info.instanceId, "fabric"); assert.equal(info.minecraftVersion, "1.21.1"); assert.equal(info.javaVersion, 21);
});
test("multiple standalone instances require selection; arbitrary names cannot bypass the candidate list", async () => {
  const records = { "versions/a/a.json": { clientVersion: "1.21.1" }, "versions/b/b.json": { patches: [{ id: "game", version: "26.1" }] } };
  const info = await inspect(records); assert.equal(info.requiresSelection, true); assert.equal(info.minecraftVersion, null); assert.equal(info.candidates.length, 2);
  const selected = await inspect(records, {}, "b"); assert.equal(selected.requiresSelection, false); assert.equal(selected.minecraftVersion, "26.1"); assert.equal(selected.javaVersion, 25);
  await assert.rejects(inspect(records, {}, "../other"));
});
test("JAR metadata supplies missing game identity and Java; conflicting game versions require manual confirmation", async () => {
  const info = await inspect({ "versions/renamed/renamed.json": { id: "renamed" } }, { "versions/renamed/renamed.jar": { id: "26.1", java_version: 25 } });
  assert.equal(info.minecraftVersion, "26.1"); assert.equal(info.javaVersion, 25);
  const conflict = await inspect({ "versions/renamed/renamed.json": { clientVersion: "1.21.1", javaVersion: { majorVersion: 21 } } },
    { "versions/renamed/renamed.jar": { id: "26.1", java_version: 25 } });
  assert.equal(conflict.minecraftVersion, null); assert.equal(conflict.javaVersion, null); assert(conflict.warnings.some(w => w.includes("冲突")));
});
test("missing parent metadata and cyclic inheritance produce warnings without executing or downloading uploaded references", async () => {
  const missing = await inspect({ "versions/custom/custom.json": { inheritsFrom: "1.20.4", downloads: { client: { url: "http://127.0.0.1/private" } } } });
  assert.equal(missing.minecraftVersion, "1.20.4"); assert.equal(missing.javaVersion, 17); assert(missing.warnings.some(w => w.includes("缺少父版本")));
  const cycle = await inspect({ "versions/a/a.json": { inheritsFrom: "b" }, "versions/b/b.json": { inheritsFrom: "a" } }, {}, "a");
  assert(cycle.warnings.some(w => w.includes("循环"))); assert.equal(cycle.minecraftVersion, null);
});
test("known official runtime boundaries are exact; unknown future releases and unlisted snapshots are not guessed", () => {
  for (const [version, java] of [["1.16.5", 8], ["1.17.1", 16], ["1.18", 17], ["1.20.4", 17], ["1.20.5", 21], ["1.21.11", 21], ["26.1", 25]] as const)
    assert.equal(minecraftJava(version)?.javaVersion, java);
  assert.equal(minecraftJava("99.1"), null); assert.equal(minecraftJava("99w99z"), null);
  assert.equal(minecraftJava("__proto__"), null); assert.equal(minecraftJava("1.16.999"), null);
});
test("isolated mods use only the selected instance and retain real paths; root layouts retain existing contracts", () => {
  const files = ["mods/root.jar", "versions/test/mods/sub/a.jar", "versions/other/mods/b.jar", "versions/test/config/options.json"].map(path => ({ path, sha256: "", size: 1, policy: "managed" }) as PackFile);
  assert.deepEqual(inspectPackMods("minecraft-zip", files, "test"), ["versions/test/mods/sub/a.jar"]);
  assert.deepEqual(inspectPackMods("minecraft-zip", files), ["root.jar"]);
});
test("Worker feedback distinguishes recognition, CAS and instance selection", () => {
  assert.equal(uploadProcessingLabel({ status: "PROCESSING", processingPhase: "INSPECTING", progress: 0 }), "正在识别客户端信息");
  assert.match(uploadProcessingLabel({ status: "PROCESSING", processingPhase: "CAS", progress: 25 }), /校验与去重 25%/);
  assert.match(uploadProcessingLabel({ status: "QUEUED", processingPhase: "SELECT_INSTANCE", progress: 0 }), /请选择/);
});
test("new runtime replaces prefilled update values, preserves manual edits and clears unresolved old runtime", async () => {
  const info = await inspect({ "versions/test/test.json": { id: "test", clientVersion: "26.1", javaVersion: { majorVersion: 25 } } });
  const old = { minecraftVersion: "1.21.1", javaVersion: 21 };
  assert.deepEqual(runtimeAutofill(info, old, old), { minecraftVersion: "26.1", javaVersion: 25 });
  assert.deepEqual(runtimeAutofill(info, { minecraftVersion: "custom", javaVersion: 24 }, old), {});
  assert.deepEqual(runtimeAutofill({ ...info, minecraftVersion: null, javaVersion: null }, old, old), { minecraftVersion: "", javaVersion: 0 });
});
