import "dotenv/config";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ZipFile } from "yazl";
import { forgeArtifactPath, forgeInstallerSource, forgeToken, forgeProcessorAllowed, prepareForgeInstaller, installForgeClient } from "../src/lib/forge-installer";
import { executeIsolated } from "../src/lib/execution-docker";
import { executionPlanDigest, type ExecutionPlan, type ExecutionBackend } from "../src/lib/execution-contract";
import { environmentCandidates, trustedEnvironmentUrl, type EnvironmentSettings } from "../src/lib/environment-source-policy";
import { DEFAULT_ENVIRONMENT_DOWNLOAD_SETTINGS } from "../src/lib/download-sources";
import { environmentCacheIdentity } from "../src/lib/environment-resolver";
import type { createEnvironmentDownloader } from "../src/lib/environment-download";
const hash = (bytes: Buffer, algorithm = "sha1") => createHash(algorithm).update(bytes).digest("hex");
const settings: EnvironmentSettings = { ...DEFAULT_ENVIRONMENT_DOWNLOAD_SETTINGS, downloadProxyEnabled: false, downloadProxyUrl: "" };
async function folder(work: (path: string) => Promise<void>) { const dir = await mkdtemp(join(tmpdir(), "mua-forge-test-")); try { await work(dir); } finally { await rm(dir, { recursive: true, force: true }); } }
async function zipBytes(entries: Record<string, Buffer>) {
  const zip = new ZipFile(); const chunks: Buffer[] = [];
  const finished = (async () => { for await (const chunk of zip.outputStream) chunks.push(Buffer.from(chunk)); })();
  for (const [name, bytes] of Object.entries(entries)) zip.addBuffer(bytes, name); zip.end(); await finished; return Buffer.concat(chunks);
}
async function fixture(dir: string, options: { minecraft?: string; sha1?: string; processors?: unknown[] } = {}) {
  const coordinate = "net.minecraftforge:forge:1.12.2-14.23.5.2860", path = forgeArtifactPath(coordinate), payload = Buffer.from("synthetic embedded loader");
  const artifact = { path, sha1: options.sha1 ?? hash(payload), size: payload.length, url: "" }, library = { name: coordinate, downloads: { artifact } };
  const profile = { id: "1.12.2-forge-14.23.5.2860", inheritsFrom: "1.12.2", mainClass: "net.minecraft.launchwrapper.Launch", libraries: [library] };
  const install = { spec: 0, minecraft: options.minecraft ?? "1.12.2", version: profile.id, json: "/version.json", libraries: [library], processors: options.processors ?? [] };
  const jar = await zipBytes({ "install_profile.json": Buffer.from(JSON.stringify(install)), "version.json": Buffer.from(JSON.stringify(profile)), [`maven/${path}`]: payload });
  const stored: string[] = [];
  const deps = { downloader: { bytes: async () => Buffer.from(hash(jar)) } as unknown as ReturnType<typeof createEnvironmentDownloader>,
    remote: async (path: string) => { const local = join(dir, "installer.jar"); await writeFile(local, jar); return { local, file: { root: "instance" as const, path, sha256: hash(jar, "sha256"), size: jar.length, policy: "managed" as const, executable: false } }; },
    store: async (path: string, local: string) => { const bytes = await readFile(local); stored.push(path); return { root: "instance" as const, path, sha256: hash(bytes, "sha256"), size: bytes.length, policy: "managed" as const, executable: false }; } };
  return { deps, stored, path };
}
test("Forge and NeoForge coordinates, classifiers, extensions and official installer identities are normalized safely", () => {
  assert.equal(forgeArtifactPath("net.neoforged:neoform:1.21.1-20240808.144430:mappings@txt"), "net/neoforged/neoform/1.21.1-20240808.144430/neoform-1.21.1-20240808.144430-mappings.txt");
  assert.equal(forgeInstallerSource("forge", "1.20.1", "47.4.0").url, forgeInstallerSource("forge", "1.20.1", "1.20.1-47.4.0").url);
  assert.match(forgeInstallerSource("neoforge", "1.21.1", "21.1.256").url, /maven.neoforged.net\/releases\/net\/neoforged\/neoforge/);
  for (const value of ["a:b:../x", "..:b:1", "a..b:b:1", "a:b:1:c@../zip", "a:b:1:../../escape"]) assert.throws(() => forgeArtifactPath(value));
  assert.throws(() => forgeInstallerSource("forge", "1.20.1", "../../escape"));
});
test("Forge Maven downloads retain domestic mirror ordering and official fallback; NeoForge releases prefix is stripped", () => {
  const url = forgeInstallerSource("neoforge", "1.21.1", "21.1.256").url;
  const values = environmentCandidates(url, settings); assert.deepEqual(values.map(value=>value.source), ["bmclapi", "ustc", "nju", "official"]);
  assert.match(values[1].url, /\/bmclapi\/net\/neoforged\/neoforge\//); assert(!values[1].url.includes("/releases/"));
  assert.equal(trustedEnvironmentUrl(url).hostname, "maven.neoforged.net"); assert.throws(()=>trustedEnvironmentUrl("https://untrusted.example/forge.jar"));
});
test("Only adapted official client processors run; unknown tasks and user executables are rejected", () => {
  forgeProcessorAllowed("net.neoforged.installertools:installertools:2.1.2", ["--task", "MERGE_MAPPING"]);
  forgeProcessorAllowed("net.minecraftforge:ForgeAutoRenamingTool:0.1.22:all", []);
  assert.throws(()=>forgeProcessorAllowed("user.uploaded:binarypatcher:1", []));
  assert.throws(()=>forgeProcessorAllowed("net.minecraftforge:installertools:1", ["--task", "EXTRACT_FILES"]));
  assert.throws(()=>forgeProcessorAllowed("net.minecraftforge:arbitrary-code:1", []));
});
test("Processor substitutions reject unknown variables and escaped Maven paths", () => {
  assert.equal(forgeToken("{SIDE}", { SIDE: "client" }, "/work"), "client");
  assert.match(forgeToken("[a.b:c:1:extra]", {}, "/work"), /a[\\/]b[\\/]c[\\/]1[\\/]c-1-extra.jar$/);
  assert.throws(()=>forgeToken("{UNKNOWN}", {}, "/work")); assert.throws(()=>forgeToken("[a:b:../../outside]", {}, "/work"));
});
test("Embedded legacy Forge payload is verified and becomes a required runtime file without executing processors", async()=>folder(async dir=>{
  const fixtureData = await fixture(dir); const prepared = await prepareForgeInstaller("forge", "1.12.2", "14.23.5.2860", dir, new AbortController().signal, fixtureData.deps);
  const game = join(dir, "game.jar"); await writeFile(game, "synthetic game");
  const installed = await installForgeClient(prepared, game, undefined, new AbortController().signal, async()=>{});
  assert.equal(installed.files.length, 1); assert.deepEqual(installed.classpath, [`libraries/${fixtureData.path}`]);
  assert.equal(installed.files[0].policy, "managed");
}));
test("Wrong Minecraft identity, unknown processor and bad embedded hash cannot produce runtime files", async()=>{
  for (const options of [{ minecraft: "1.20.1" }, { processors: [{ jar: "user.uploaded:binarypatcher:1", args: [] }] }, { sha1: "0".repeat(40) }]) await folder(async dir=>{
    const fixtureData = await fixture(dir, options); const game = join(dir, "game.jar"); await writeFile(game, "game");
    await assert.rejects(async()=>{ const prepared = await prepareForgeInstaller("forge", "1.12.2", "14.23.5.2860", dir, new AbortController().signal, fixtureData.deps); await installForgeClient(prepared, game, undefined, new AbortController().signal, async()=>{}); });
    assert.equal(fixtureData.stored.length, 0);
  });
});
test("Cancelled processor does not spawn Java, and Forge/NeoForge cache identities remain distinct", async()=>{
  const signal = AbortSignal.abort(new Error("cancelled")); await assert.rejects(executeIsolated({} as ExecutionPlan, new Map(), "/work", signal), /cancelled/);
  const base = { minecraft: "1.21.1", javaMajor: 21, platform: "windows-amd64" as const };
  assert.notEqual(environmentCacheIdentity({...base, loader: {type:"forge",version:"21.1.256"}}, "jre"), environmentCacheIdentity({...base, loader:{type:"neoforge",version:"21.1.256"}}, "jre"));
});

test("Modern Forge migrates to a portable offline execution plan and rejects unbound results before storing files", async () => {
  for (const corrupt of [false, true]) await folder(async dir => {
    const tool = "net.minecraftforge:installertools:1.4.1", target = "net.minecraftforge:forge:1.20.1-47.4.0:client";
    const toolPath = forgeArtifactPath(tool), targetPath = forgeArtifactPath(target), generated = Buffer.from("generated client jar");
    const toolBytes = await zipBytes({ "META-INF/MANIFEST.MF": Buffer.from("Manifest-Version: 1.0\r\nMain-Class: example.Processor\r\n\r\n") });
    const library = (name: string, bytes: Buffer) => ({ name, downloads: { artifact: { path: forgeArtifactPath(name), sha1: hash(bytes), size: bytes.length, url: "" } } });
    const profile = { id: "1.20.1-forge-47.4.0", inheritsFrom: "1.20.1", mainClass: "example.Game", libraries: [library(target, generated)] };
    const install = { spec: 1, minecraft: "1.20.1", version: profile.id, json: "/version.json", libraries: [library(tool, toolBytes)],
      data: { PATCHED: { client: `[${target}]` }, PATCHED_SHA: { client: `'${hash(generated)}'` } },
      processors: [{ jar: tool, classpath: [], args: ["--task", "MCP_DATA", "--output", "{PATCHED}"], outputs: { "{PATCHED}": "{PATCHED_SHA}" } }] };
    const installer = await zipBytes({ "install_profile.json": Buffer.from(JSON.stringify(install)), "version.json": Buffer.from(JSON.stringify(profile)), [`maven/${toolPath}`]: toolBytes });
    let executed = false; const stored: string[] = [];
    const execute: ExecutionBackend = async (plan, bindings, destination) => {
      executed = true; assert.equal(plan.adapter, "forge-client"); assert.equal(plan.steps.length, 1);
      assert.equal(plan.steps[0].args.at(-1), `/workspace/instance/libraries/${targetPath}`);
      assert.ok(plan.inputs.every(file => !file.path.includes("\\") && bindings.has(file.path)));
      assert.equal(plan.inputs.some(file => file.path === "installer.jar"), true);
      await mkdir(destination); const local = join(destination, "generated"); await writeFile(local, generated);
      return { protocolVersion: 1, executionId: "12345678-1234-4234-8234-123456789abc", planSha256: corrupt ? "0".repeat(64) : executionPlanDigest(plan),
        image: `sha256:${"a".repeat(64)}`, architecture: "amd64", artifacts: [{ path: `instance/libraries/${targetPath}`, local, size: generated.length, sha1: hash(generated), sha256: hash(generated, "sha256") }] };
    };
    const deps = { downloader: { bytes: async () => Buffer.from(hash(installer)) } as unknown as ReturnType<typeof createEnvironmentDownloader>,
      remote: async (path: string) => { const local = join(dir, "installer.jar"); await writeFile(local, installer); return { local, file: { root: "instance" as const, path, sha256: hash(installer, "sha256"), size: installer.length, policy: "managed" as const, executable: false } }; },
      store: async (path: string, local: string) => { stored.push(path); const bytes = await readFile(local); return { root: "instance" as const, path, sha256: hash(bytes, "sha256"), size: bytes.length, policy: "managed" as const, executable: false }; }, execute };
    const prepared = await prepareForgeInstaller("forge", "1.20.1", "47.4.0", dir, new AbortController().signal, deps);
    const game = join(dir, "game.jar"); await writeFile(game, "game");
    if (corrupt) { await assert.rejects(installForgeClient(prepared, game, undefined, new AbortController().signal, async () => {})); assert.equal(stored.length, 0); }
    else { const result = await installForgeClient(prepared, game, undefined, new AbortController().signal, async () => {});
      assert.ok(result.execution); assert.deepEqual(result.classpath, [`libraries/${targetPath}`]); assert.deepEqual(stored, [`libraries/${targetPath}`]); }
    assert.equal(executed, true);
  });
});
