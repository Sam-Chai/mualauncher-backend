import "dotenv/config";
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import tar from "tar-stream";
import { ZipFile } from "yazl";
import { trustedEnvironmentUrl, environmentCandidates, environmentCandidateUrl, createEnvironmentDownloader } from "../src/lib/environment-download";
import { downloadSettingsSchema } from "../src/lib/download-settings";
import { Readable } from "node:stream";
import type { IncomingMessage } from "node:http";
import { unpackEnvironment } from "../src/lib/environment-archive";
import { environmentRules, environmentCacheIdentity } from "../src/lib/environment-resolver";

const settings = downloadSettingsSchema.parse({ remoteSourceWhitelistEnabled: true, remoteSourceHosts: ["cdn.modrinth.com"], downloadProxyEnabled: true, downloadProxyUrl: "http://127.0.0.1:7890" });
const signal = () => new AbortController().signal;
const sha1 = (bytes: Buffer) => createHash("sha1").update(bytes).digest("hex");
function response(bytes: Buffer, statusCode = 200) {
  return Object.assign(Readable.from([bytes]), { statusCode, headers: { "content-length": String(bytes.length) } }) as IncomingMessage;
}
test("mirror settings default to domestic sources and JRE, keep source order, and reject unknown or duplicate sources", () => {
  assert.deepEqual(settings.minecraftDownloadSources, ["bmclapi", "ustc", "nju"]); assert.deepEqual(settings.javaDownloadSources, ["tuna"]);
  assert.equal(settings.mirrorProxyEnabled, false); assert.equal(settings.javaImageType, "jre");
  assert.throws(() => downloadSettingsSchema.parse({ ...settings, minecraftDownloadSources: ["bmclapi", "bmclapi"] }));
  assert.throws(() => downloadSettingsSchema.parse({ ...settings, javaDownloadSources: ["https://evil.test"] }));
  const urls = environmentCandidates("https://libraries.minecraft.net/org/example/a.jar", { ...settings, minecraftDownloadSources: ["nju", "ustc"] });
  assert.deepEqual(urls.map(item => item.source), ["nju", "ustc", "official"]);
});
test("BMCLAPI API, assets, Maven and university static paths have distinct mappings and preserve official fallback", () => {
  const candidates = (url: string) => environmentCandidates(url, settings).map(item => item.url);
  assert.deepEqual(candidates("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json"), ["https://bmclapi2.bangbang93.com/mc/game/version_manifest_v2.json", "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json"]);
  assert.equal(candidates("https://meta.fabricmc.net/v2/versions/loader/26.1/0.19.5/profile/json")[0], "https://bmclapi2.bangbang93.com/fabric-meta/v2/versions/loader/26.1/0.19.5/profile/json");
  assert.equal(candidates("https://meta.quiltmc.org/v3/versions/loader/1.21/0.27/profile/json")[0], "https://bmclapi2.bangbang93.com/quilt-meta/v3/versions/loader/1.21/0.27/profile/json");
  assert.equal(candidates("https://resources.download.minecraft.net/ab/abc")[0], "https://bmclapi2.bangbang93.com/assets/ab/abc");
  assert.equal(candidates("https://repo.maven.apache.org/maven2/org/example/a.jar")[1], "https://mirrors.ustc.edu.cn/bmclapi/org/example/a.jar");
  assert.equal(candidates("https://maven.quiltmc.org/repository/release/org/example/a.jar")[2], "https://mirrors.nju.edu.cn/bmclapi/org/example/a.jar");
  assert.deepEqual(environmentCandidates("https://maven.fabricmc.net/org/example/a.jar", { ...settings, minecraftDownloadSources: [] }).map(item => item.source), ["official"]);
});
test("Temurin JRE and JDK archive mirrors keep exact build, OS and architecture; metadata uses official API", () => {
  const java = "https://github.com/adoptium/temurin25-binaries/releases/download/jdk-25.0.4.1%2B1/OpenJDK25U-jre_x64_windows_hotspot_25.0.4.1_1.zip";
  const candidates = environmentCandidates(java, settings);
  assert.equal(candidates[0].url, "https://mirrors.tuna.tsinghua.edu.cn/Adoptium/25/jre/x64/windows/OpenJDK25U-jre_x64_windows_hotspot_25.0.4.1_1.zip");
  assert.equal(environmentCandidates(java.replaceAll("jre_x64_windows", "jdk_aarch64_mac").replace(".zip", ".tar.gz"), settings)[0].url,
    "https://mirrors.tuna.tsinghua.edu.cn/Adoptium/25/jdk/aarch64/mac/OpenJDK25U-jdk_aarch64_mac_hotspot_25.0.4.1_1.tar.gz");
  assert.equal(environmentCandidates("https://api.adoptium.net/v3/assets/latest/25/hotspot?image_type=jre", settings).length, 1);
  assert.equal(environmentCandidates(java, { ...settings, javaDownloadSources: [] }).length, 1);
});
test("mirror proxy defaults off, official fallback uses proxy, and every redirect preserves URL safety", () => {
  const candidates = environmentCandidates("https://libraries.minecraft.net/a.jar", settings);
  assert.deepEqual(candidates.map(item => item.proxy), [false, false, false, true]);
  assert(environmentCandidates("https://libraries.minecraft.net/a.jar", { ...settings, mirrorProxyEnabled: true }).every(item => item.proxy));
  assert(environmentCandidates("https://libraries.minecraft.net/a.jar", { ...settings, mirrorProxyEnabled: true, downloadProxyEnabled: false }).every(item => !item.proxy));
  assert.equal(environmentCandidateUrl("https://cdn.example.org/download/hash", candidates[0], settings).hostname, "cdn.example.org");
  for (const url of ["https://127.0.0.1/a", "https://10.0.0.1/a", "http://public.example.org/a", "https://user:pass@public.example.org/a", "https://public.example.org:444/a"]) assert.throws(() => environmentCandidateUrl(url, candidates[0], settings));
  assert.throws(() => environmentCandidateUrl("https://evil.test/a", candidates.at(-1)!, settings));
  assert.throws(() => environmentCandidateUrl("https://mirrors.ustc.edu.cn/other/a", candidates[1], settings));
});
test("environment download retries bad hash, HTTP error and failed connection before verified official fallback", async () => directory(async dir => {
  const expected = Buffer.from("verified bytes"), calls: { source: string; proxy: boolean }[] = [];
  const downloader = createEnvironmentDownloader(settings, async candidate => {
    calls.push(candidate);
    if (candidate.source === "bmclapi") return response(Buffer.from("corrupt bytes!"));
    if (candidate.source === "ustc") return response(Buffer.from("missing"), 404);
    if (candidate.source === "nju") throw new Error("connection timed out");
    return response(expected);
  });
  const path = join(dir, "env.jar"); const result = await downloader.download("https://libraries.minecraft.net/a.jar", path, signal(), { algorithm: "sha1", hash: sha1(expected), size: expected.length });
  assert.deepEqual(await readFile(path), expected); assert.equal(result.sha256, createHash("sha256").update(expected).digest("hex"));
  assert.deepEqual(calls.map(item => [item.source, item.proxy]), [["bmclapi", false], ["ustc", false], ["nju", false], ["official", true]]);
}));
test("metadata invalid JSON, missing target versions and hash mismatch trigger official fallback", async () => {
  const expected = Buffer.from('{"version":"26.1"}'); let count = 0;
  const downloader = createEnvironmentDownloader(settings, async candidate => { count++; return response(candidate.mirror ? Buffer.from('{"version":"old"}') : expected); });
  const bytes = await downloader.bytes("https://piston-meta.mojang.com/a.json", signal(), 1024,
    { validate: bytes => assert.equal(JSON.parse(bytes.toString()).version, "26.1") });
  assert.deepEqual(bytes, expected); assert.equal(count, 2);
  const hashed = createEnvironmentDownloader(settings, async candidate => response(candidate.mirror ? Buffer.from("bad JSON") : expected));
  assert.deepEqual(await hashed.bytes("https://piston-meta.mojang.com/a.json", signal(), 1024, { expected: { algorithm: "sha1", hash: sha1(expected) } }), expected);
});
test("failed downloads remove owned partial files, preserve existing files and stop immediately on cancellation", async () => directory(async dir => {
  const downloader = createEnvironmentDownloader(settings, async () => response(Buffer.from("bad")));
  const path = join(dir, "partial"); await assert.rejects(downloader.download("https://libraries.minecraft.net/a.jar", path, signal(), { algorithm: "sha1", hash: "0".repeat(40) }));
  await assert.rejects(readFile(path), { code: "ENOENT" });
  await writeFile(path, "caller-owned"); await assert.rejects(downloader.download("https://libraries.minecraft.net/a.jar", path, signal()));
  assert.equal((await readFile(path)).toString(), "caller-owned");
  const controller = new AbortController(); let count = 0;
  const cancelled = createEnvironmentDownloader(settings, async () => { count++; controller.abort(new Error("job cancelled")); throw new Error("interrupted"); });
  await assert.rejects(cancelled.bytes("https://libraries.minecraft.net/a.jar", controller.signal), /job cancelled/); assert.equal(count, 1);
}));
test("failing mirror groups temporarily back off without disabling official fallback or other resource groups", async () => {
  let mirror = 0, official = 0;
  const downloader = createEnvironmentDownloader({ ...settings, minecraftDownloadSources: ["bmclapi"] }, async candidate => {
    if (candidate.mirror) { mirror++; return response(Buffer.from("missing"), 404); } official++; return response(Buffer.from("good"));
  });
  for (let i = 0; i < 3; i++) await downloader.bytes(`https://libraries.minecraft.net/${i}.jar.sha1`, signal());
  assert.equal(mirror, 2); assert.equal(official, 3);
  await downloader.bytes("https://piston-meta.mojang.com/a.json", signal()); assert.equal(mirror, 3);
});
test("JRE and JDK environment caches differ while changing mirror preference leaves content identity stable", () => {
  const request = { minecraft: "26.1", javaMajor: 25, loader: null, platform: "windows-amd64" as const };
  assert.notEqual(environmentCacheIdentity(request, "jre"), environmentCacheIdentity(request, "jdk"));
  assert.equal(environmentCacheIdentity(request, "jre"), environmentCacheIdentity({ ...request }, "jre"));
});

test("environment URL and rule evaluation reject untrusted sources, features and unknown platform requirements", () => {
  for (const url of ["http://piston-data.mojang.com/a", "https://127.0.0.1/a", "https://github.com.evil.test/a", "https://github.com:444/a", "https://user:password@github.com/a"]) assert.throws(() => trustedEnvironmentUrl(url));
  assert.equal(trustedEnvironmentUrl("https://release-assets.githubusercontent.com/a").protocol, "https:");
  assert.equal(environmentRules([{ action: "allow", os: { name: "osx" } }], "macos-aarch64"), true);
  assert.equal(environmentRules([{ action: "allow", os: { arch: "x86" } }], "windows-amd64"), false);
  assert.equal(environmentRules([{ action: "allow", features: { is_demo_user: true } }], "linux-amd64"), false);
  assert.equal(environmentRules([{ action: "allow" }, { action: "disallow", os: { name: "linux" } }], "linux-aarch64"), false);
  assert.throws(() => environmentRules([{ action: "allow", os: { version: "^10" } }], "windows-amd64"));
});
async function directory(work: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "mua-env-test-"));
  try { await work(directory); } finally { assert(resolve(directory).startsWith(resolve(tmpdir()) + sep)); await rm(directory, { recursive: true, force: true }); }
}
async function tarBytes(entries: { name: string; type?: "file" | "symlink" | "link"; linkname?: string; data?: string; mode?: number }[]) {
  const pack = tar.pack(); const chunks: Buffer[] = [];
  const completed = (async () => { for await (const chunk of pack) chunks.push(chunk); })();
  for (const entry of entries) pack.entry({ name: entry.name, type: entry.type ?? "file", linkname: entry.linkname, mode: entry.mode ?? 0o644 }, entry.data ?? "");
  pack.finalize(); await completed; return gzipSync(Buffer.concat(chunks));
}
test("Java tar files and internal symlinks become hashed ordinary files without executing archives", async () => directory(async dir => {
  const bytes = await tarBytes([{ name: "jdk/bin/java", data: "synthetic Java", mode: 0o755 }, { name: "jdk/lib/java", type: "symlink", linkname: "../bin/java" }]);
  const path = join(dir, "java.tar.gz"); await writeFile(path, bytes);
  const files = await unpackEnvironment(path, dir, "tar.gz", true, new AbortController().signal);
  assert.equal(files.length, 2); assert.equal(files.find(file => file.path === "bin/java")!.executable, true);
  assert.equal(files[0].sha256, createHash("sha256").update("synthetic Java").digest("hex")); assert.equal(files[0].sha256, files[1].sha256);
  assert.equal((await readFile(files[1].local)).toString(), "synthetic Java");
}));
test("Java tar escapes, mixed roots, cyclic links and devices are rejected", async () => {
  for (const entries of [
    [{ name: "jdk/bin/java", data: "java" }, { name: "jdk/link", type: "symlink" as const, linkname: "../../outside" }],
    [{ name: "jdk/bin/java", data: "java" }, { name: "outside/bin/extra", data: "other root" }],
    [{ name: "jdk/a", type: "symlink" as const, linkname: "b" }, { name: "jdk/b", type: "symlink" as const, linkname: "a" }],
  ]) await directory(async dir => { const path = join(dir, "bad.tar.gz"); await writeFile(path, await tarBytes(entries)); await assert.rejects(unpackEnvironment(path, dir, "tar.gz", true, new AbortController().signal)); });
});
test("native ZIP metadata is excluded and actual native files retain verified bytes", async () => directory(async dir => {
  const zip = new ZipFile(); const chunks: Buffer[] = [];
  const completed = (async () => { for await (const chunk of zip.outputStream as AsyncIterable<Buffer>) chunks.push(chunk); })();
  zip.addBuffer(Buffer.from("metadata"), "META-INF/MANIFEST.MF"); zip.addBuffer(Buffer.from("native"), "liblwjgl.so", { mode: 0o100755 }); zip.end(); await completed;
  const path = join(dir, "native.zip"); await writeFile(path, Buffer.concat(chunks));
  const files = await unpackEnvironment(path, dir, "zip", false, new AbortController().signal); assert.equal(files.length, 1); assert.equal(files[0].path, "liblwjgl.so"); assert(files[0].executable);
}));
