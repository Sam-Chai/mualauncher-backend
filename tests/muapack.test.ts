import { fixtureClientId } from "./fixtures/identity";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pipeline } from "node:stream/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import yazl from "yazl";
import { MUA_PLATFORMS, defaultMuaPlatforms, diffMuaFiles, muaEnvironmentManifestSchema, muaFilesSchema, muaLaunchSchema,
  muaPackMetadataSchema, muaPathSchema, muaPlatformManifestSchema, normalizeMuaPlatform, selectedPlatformsSchema } from "../src/lib/muapack-contract";
import { createMuaPackMetadata, decodeMuaJson, encodeMuaJson, signMuaPackMetadata,
  validateMuaEnvironments, validateMuaPackDocuments, verifyMuaPackSignature } from "../src/lib/muapack-protocol";
import { validateMuaPackArchive } from "../src/lib/muapack-archive";
import { muaFixture, muaFixtureDocuments } from "./fixtures/muapack";

const keys = generateKeyPairSync("ed25519");
async function withDirectory(fn: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "mua-protocol-"));
  try { await fn(directory); } finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert.match(directory.split(/[\\/]/).at(-1)!, /^mua-protocol-/);
    await rm(directory, { recursive: true, force: true });
  }
}
function archiveEntries(update = false) {
  const fixture = muaFixtureDocuments(update);
  const entries = new Map<string, Buffer>([["mua-pack.json", fixture.metadataBytes], ["metadata/target-manifest.json", fixture.targetBytes],
    ["metadata/signature.json", signMuaPackMetadata(fixture.metadataBytes, keys.privateKey)]]);
  if (fixture.baseBytes) entries.set("metadata/base-manifest.json", fixture.baseBytes);
  for (const [hash, bytes] of fixture.environmentDocuments) entries.set(`metadata/environments/${hash}.json`, bytes);
  for (const object of fixture.metadata.payload) entries.set(`objects/sha256/${object.sha256}`, fixture.objects.get(object.sha256)!);
  return { fixture, entries };
}
async function zipEntries(path: string, entries: Iterable<[string, Buffer]>) {
  const zip = new yazl.ZipFile();
  for (const [name, bytes] of entries) zip.addBuffer(bytes, name, { mtime: new Date("2026-01-01T00:00:00Z") });
  const writing = pipeline(zip.outputStream, createWriteStream(path)); zip.end(); await writing;
}

test("five platform defaults exclude Linux ARM while six protocol platforms and aliases remain valid", () => {
  assert.equal(defaultMuaPlatforms().length, 5); const first = defaultMuaPlatforms(); first.pop(); assert.equal(defaultMuaPlatforms().length, 5);
  assert(!defaultMuaPlatforms().includes("linux-aarch64")); assert.equal(selectedPlatformsSchema.safeParse([...MUA_PLATFORMS]).success, true);
  assert.equal(normalizeMuaPlatform("win32", "x64"), "windows-amd64");
  assert.equal(normalizeMuaPlatform("darwin", "arm64"), "macos-aarch64");
  assert.throws(() => normalizeMuaPlatform("linux", "ia32"));
  assert.equal(selectedPlatformsSchema.safeParse([]).success, false);
  assert.equal(selectedPlatformsSchema.safeParse(["linux-amd64", "linux-amd64"]).success, false);
});
test("target paths reject traversal, platform collisions, file-directory conflicts and forbidden records", () => {
  for (const path of ["../mods/a.jar", "C:/a", "a\\b", "a/CON.txt", "a/", "a//b", "a/e\u0301.txt"]) assert.equal(muaPathSchema.safeParse(path).success, false, path);
  const { manifest } = muaFixture(); const file = manifest.files[0];
  assert.equal(muaFilesSchema.safeParse([file, { ...file, path: file.path.toUpperCase() }]).success, false);
  assert.equal(muaFilesSchema.safeParse([{ ...file, path: "a" }, { ...file, path: "a/b" }]).success, false);
  assert.equal(muaFilesSchema.safeParse([{ ...file, path: "launcher_accounts.json" }]).success, false);
  assert.equal(muaFilesSchema.safeParse([file, { ...file, path: "other.jar", size: file.size + 1 }]).success, false);
});
test("runtime and prelaunch declarations must point to verified files and preserve argument boundaries", () => {
  const fixture = muaFixture(); const invalid = structuredClone(fixture.manifest);
  invalid.launch.classpath.push("missing.jar"); assert.equal(muaPlatformManifestSchema.safeParse(invalid).success, false);
  invalid.launch.classpath.pop(); invalid.runtime.java.build = ""; assert.equal(muaPlatformManifestSchema.safeParse(invalid).success, false);
  assert.equal(muaLaunchSchema.safeParse({ ...fixture.manifest.launch, jvmArgs: ["-Xmx4G"] }).success, false);
  assert.equal(muaLaunchSchema.safeParse({ ...fixture.manifest.launch, memory: { mode: "auto", minimumMiB: 4096, recommendedMiB: 2048 } }).success, false);
  const command = { type: "exec", executable: { root: "java", path: "bin/java.exe" }, args: ["a b", "$(do-not-execute)"],
    workingDirectory: null, requiresConsent: true, timeoutSeconds: 30, onFailure: "abort" };
  assert.equal(muaPlatformManifestSchema.safeParse({ ...fixture.manifest, launch: { ...fixture.manifest.launch, preLaunch: [command] } }).success, true);
  assert.equal(muaLaunchSchema.safeParse({ ...fixture.manifest.launch, preLaunch: [{ ...command, requiresConsent: false }] }).success, false);
  assert.equal(muaPlatformManifestSchema.safeParse({ ...fixture.manifest, launch: { ...fixture.manifest.launch,
    preLaunch: [{ type: "copy", from: { root: "java", path: "bin/java.exe" }, to: "mods/example.jar", ifMissing: true }] } }).success, false);
});
test("environment references lock platform, Java build and exact files", () => {
  const fixture = muaFixture(); assert.equal(validateMuaEnvironments(fixture.manifest, fixture.environmentDocuments).length, 3);
  const changed = structuredClone(fixture.manifest); changed.runtime.java.build = "new-build";
  assert.throws(() => validateMuaEnvironments(changed, fixture.environmentDocuments), /Java build/);
  const imageType = structuredClone(fixture.manifest); imageType.runtime.java.imageType = "jdk";
  assert.throws(() => validateMuaEnvironments(imageType, fixture.environmentDocuments), /Java build/);
  const wrongPlatform = structuredClone(fixture.manifest); wrongPlatform.platform = "linux-amd64";
  assert.throws(() => validateMuaEnvironments(wrongPlatform, fixture.environmentDocuments), /platform/);
  const corrupted = new Map(fixture.environmentDocuments); const hash = fixture.manifest.environments[0].sha256;
  corrupted.set(hash, Buffer.from("{}")); assert.throws(() => validateMuaEnvironments(fixture.manifest, corrupted), /digest/);
  const environment = decodeMuaJson(fixture.environmentDocuments.get(hash)!) as { files: unknown[] };
  assert.equal(muaEnvironmentManifestSchema.safeParse({ ...environment, files: [] }).success, false);
});
test("full and update declarations contain the exact payload and complete differences", () => {
  const full = muaFixtureDocuments(); const update = muaFixtureDocuments(true);
  assert.equal(full.metadata.packageType, "full"); assert.equal(full.metadata.base, null);
  assert.equal(update.metadata.packageType, "update"); assert.equal(update.metadata.base?.version, "1.0.0");
  assert.deepEqual(update.metadata.changes.added.map(file => file.path), ["config/new.json"]);
  assert.deepEqual(update.metadata.changes.modified.map(pair => pair.after.path), ["mods/example.jar"]);
  assert.deepEqual(update.metadata.changes.removed.map(file => file.path), ["mods/removed.jar"]);
  assert.equal(update.metadata.payload.length, 2);
  validateMuaPackDocuments(update.metadataBytes, update.targetBytes, update.baseBytes);
  assert.throws(() => validateMuaPackDocuments(encodeMuaJson({ ...update.metadata, payload: [] }), update.targetBytes, update.baseBytes), /match/);
  assert.throws(() => validateMuaPackDocuments(update.metadataBytes, update.targetBytes, null));
  assert.equal(muaPackMetadataSchema.safeParse({ ...full.metadata, base: update.metadata.base }).success, false);
});
test("policy and executable changes are recorded even when content is unchanged", () => {
  const fixture = muaFixture(); const original = fixture.manifest.files.find(file => file.path === "options.txt")!;
  const changed = { ...original, policy: "managed" as const, executable: true };
  const diff = diffMuaFiles([original], [changed]);
  assert.equal(diff.modified.length, 1); assert.equal(diff.policyChanged.length, 1); assert.equal(diff.modified[0].before.sha256, diff.modified[0].after.sha256);
});
test("metadata-only updates carry no objects and duplicate target content is packed once", async () => {
  const base = muaFixture(); const target = structuredClone(base.manifest);
  target.release.releaseId = "33333333-3333-4333-8333-333333333333"; target.release.version = "1.0.1";
  target.launch.jvmArgs.push("-Dnew=true"); const targetBytes = encodeMuaJson(target);
  const metadata = createMuaPackMetadata(targetBytes, base.targetBytes, "retain");
  assert.equal(metadata.payload.length, 0);
  await withDirectory(async directory => {
    const metadataBytes = encodeMuaJson(metadata); const path = join(directory, "metadata-only.muapack");
    const entries = new Map<string, Buffer>([["mua-pack.json", metadataBytes], ["metadata/target-manifest.json", targetBytes],
      ["metadata/base-manifest.json", base.targetBytes], ["metadata/signature.json", signMuaPackMetadata(metadataBytes, keys.privateKey)]]);
    for (const [hash, bytes] of base.environmentDocuments) entries.set(`metadata/environments/${hash}.json`, bytes);
    await zipEntries(path, entries); assert.equal((await validateMuaPackArchive(path, keys.publicKey)).objectCount, 0);
  });
  const duplicate = { ...target.files.find(file => file.path === "mods/example.jar")!, path: "mods/copy.jar" };
  target.files.push(duplicate);
  const full = createMuaPackMetadata(encodeMuaJson(target), null, "retain");
  assert.equal(full.payload.filter(object => object.sha256 === duplicate.sha256).length, 1);
});
test("updates cannot change client, organization, platform or reuse the same release identity", () => {
  const fixture = muaFixtureDocuments(true); const base = fixture.baseBytes!;
  for (const override of [{ clientId: fixtureClientId("OTHER") }, { organizationId: "44444444-4444-4444-8444-444444444444" }, { releaseId: muaFixture().manifest.release.releaseId }]) {
    assert.throws(() => createMuaPackMetadata(encodeMuaJson({ ...fixture.manifest, release: { ...fixture.manifest.release, ...override } }), base, "retain"));
  }
  assert.throws(() => createMuaPackMetadata(muaFixture("1.0.1", "linux-amd64").targetBytes, base, "retain"), /same platform/);
});
test("deterministic UTF-8 encoding rejects duplicate keys, whitespace, unsafe numbers and malformed Unicode", () => {
  assert.equal(encodeMuaJson({ z: "中文😀", a: 1 }).toString(), '{"a":1,"z":"中文😀"}');
  assert.equal(encodeMuaJson({ "2": 2, "10": 10 }).toString(), '{"10":10,"2":2}');
  assert.throws(() => decodeMuaJson(Buffer.from('{"a":1,"a":1}')));
  assert.throws(() => decodeMuaJson(Buffer.from(' {"a":1}')));
  assert.throws(() => decodeMuaJson(Buffer.from([0xff])));
  assert.throws(() => encodeMuaJson({ a: 1.5 })); assert.throws(() => encodeMuaJson({ a: "\ud800" }));
  assert.throws(() => encodeMuaJson({ a: "\ud800😀\udc00" }));
  let nested: unknown = {}; for (let i = 0; i < 40; i++) nested = { nested };
  assert.throws(() => encodeMuaJson(nested), /nesting/);
  assert.throws(() => encodeMuaJson({ a: undefined }));
});
test("domain-separated Ed25519 signature requires a trusted key and binds exact bytes", () => {
  const fixture = muaFixtureDocuments(); const signed = signMuaPackMetadata(fixture.metadataBytes, keys.privateKey);
  verifyMuaPackSignature(fixture.metadataBytes, signed, keys.publicKey);
  assert.throws(() => verifyMuaPackSignature(fixture.metadataBytes, signed, generateKeyPairSync("ed25519").publicKey));
  const changed = encodeMuaJson({ ...fixture.metadata, removalPolicy: "retain" });
  assert.throws(() => verifyMuaPackSignature(changed, signed, keys.publicKey));
  const ordinary = decodeMuaJson(signed) as { signature: string };
  ordinary.signature = sign(null, fixture.metadataBytes, keys.privateKey).toString("base64");
  assert.throws(() => verifyMuaPackSignature(fixture.metadataBytes, encodeMuaJson(ordinary), keys.publicKey), /verification failed/);
});
test("real full and update ZIP archives verify every object without extracting", async () => {
  await withDirectory(async directory => {
    for (const update of [false, true]) {
      const { entries, fixture } = archiveEntries(update); const path = join(directory, `${update ? "update" : "full"}.muapack`);
      await zipEntries(path, entries); const progress: number[] = [];
      const result = await validateMuaPackArchive(path, keys.publicKey, { onProgress: value => progress.push(value.bytes) });
      assert.equal(result.objectCount, fixture.metadata.payload.length); assert.equal(result.target.release.version, update ? "1.0.1" : "1.0.0");
      assert.equal(result.payloadSize, fixture.metadata.payload.reduce((sum, object) => sum + object.size, 0));
      assert.ok(progress.every((value, index) => index === 0 || value >= progress[index - 1]));
      const keyPath = join(directory, "trusted.pem"); await writeFile(keyPath, keys.publicKey.export({ format: "pem", type: "spki" }));
      await validateMuaPackArchive(path, createPublicKey(await readFile(keyPath)));
    }
  });
});
test("all six platform documents and archives retain the selected platform", async () => {
  await withDirectory(async directory => {
    for (const platform of MUA_PLATFORMS) {
      const fixture = muaFixture("1.0.0", platform); const metadataBytes = encodeMuaJson(createMuaPackMetadata(fixture.targetBytes, null, "retain"));
      const entries = new Map<string, Buffer>([["mua-pack.json", metadataBytes], ["metadata/target-manifest.json", fixture.targetBytes],
        ["metadata/signature.json", signMuaPackMetadata(metadataBytes, keys.privateKey)]]);
      for (const [hash, bytes] of fixture.environmentDocuments) entries.set(`metadata/environments/${hash}.json`, bytes);
      for (const [hash, bytes] of fixture.objects) entries.set(`objects/sha256/${hash}`, bytes);
      const path = join(directory, `${platform}.muapack`); await zipEntries(path, entries);
      assert.equal((await validateMuaPackArchive(path, keys.publicKey)).target.platform, platform);
    }
  });
});
test("CLI validates a signed archive and rejects a different trusted key", async () => {
  await withDirectory(async directory => {
    const path = join(directory, "cli.muapack"); await zipEntries(path, archiveEntries(true).entries);
    const keyPath = join(directory, "trusted.pem"); await writeFile(keyPath, keys.publicKey.export({ format: "pem", type: "spki" }));
    const command = ["--conditions=react-server", "--import", "tsx", "scripts/validate-muapack.ts", path, keyPath];
    const { stdout } = await promisify(execFile)(process.execPath, command, { cwd: process.cwd() });
    assert.equal(JSON.parse(stdout).packageType, "update");
    await writeFile(keyPath, generateKeyPairSync("ed25519").publicKey.export({ format: "pem", type: "spki" }));
    await assert.rejects(promisify(execFile)(process.execPath, command, { cwd: process.cwd() }));
  });
});
test("documentation examples contain matching canonical manifests, environment hashes and differences", async () => {
  for (const folder of ["full", "update"]) {
    const root = join(process.cwd(), "docs/examples/muapack", folder);
    const metadataBytes = await readFile(join(root, "mua-pack.json")); const targetBytes = await readFile(join(root, "metadata/target-manifest.json"));
    const baseBytes = folder === "update" ? await readFile(join(root, "metadata/base-manifest.json")) : null;
    const { metadata, target } = validateMuaPackDocuments(metadataBytes, targetBytes, baseBytes);
    assert.equal(metadata.packageType, folder);
    const environments = new Map<string, Buffer>();
    for (const reference of target.environments) environments.set(reference.sha256, await readFile(join(root, `metadata/environments/${reference.sha256}.json`)));
    assert.equal(validateMuaEnvironments(target, environments).length, 3);
  }
});
test("archives reject missing, extra, duplicate, forged and corrupted content", async () => {
  await withDirectory(async directory => {
    const variants: Array<(entries: Map<string, Buffer>) => Iterable<[string, Buffer]>> = [
      entries => { entries.delete("metadata/signature.json"); return entries; },
      entries => { entries.set("unknown.txt", Buffer.from("extra")); return entries; },
      entries => { entries.set(`objects/sha256/${"0".repeat(64)}`, Buffer.from("extra")); return entries; },
      entries => { const key = [...entries.keys()].find(name => name.startsWith("objects/"))!; entries.delete(key); return entries; },
      entries => { const key = [...entries.keys()].find(name => name.startsWith("objects/"))!; entries.set(key, Buffer.alloc(entries.get(key)!.length, 120)); return entries; },
      entries => [...entries, ["mua-pack.json", entries.get("mua-pack.json")!] as [string, Buffer]],
      entries => { entries.set("metadata/target-manifest.json", Buffer.from("{}")); return entries; },
      entries => { const key = [...entries.keys()].find(name => name.startsWith("metadata/environments/"))!; entries.set(key, Buffer.from("{}")); return entries; },
    ];
    for (let i = 0; i < variants.length; i++) {
      const path = join(directory, `invalid-${i}.muapack`); await zipEntries(path, variants[i](archiveEntries().entries));
      await assert.rejects(validateMuaPackArchive(path, keys.publicKey));
    }
    const path = join(directory, "abort.muapack"); await zipEntries(path, archiveEntries().entries);
    await assert.rejects(validateMuaPackArchive(path, keys.publicKey, { signal: AbortSignal.abort() }));
  });
});
