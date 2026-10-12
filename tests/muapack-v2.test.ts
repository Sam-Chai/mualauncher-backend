import assert from "node:assert/strict";
import { test } from "node:test";
import { createPublicKey, generateKeyPairSync } from "node:crypto";
import { readFile, writeFile, mkdtemp, rm, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { ZipFile } from "yazl";
import { encodeMuaJson } from "../src/lib/muapack-protocol";
import { createRecipePackMetadata, readRecipeManifest, recipeModrinthIndex, signRecipePackMetadata, validateRecipePackDocuments, verifyRecipePackSignature } from "../src/lib/muapack-v2-protocol";
import { validateRecipePackArchive } from "../src/lib/muapack-v2-archive";

const root = "docs/examples/muapack-v2";
async function key() { const value = JSON.parse(await readFile(join(root, "test-public-key.json"), "utf8")); return createPublicKey({ key: Buffer.from(value.spkiDerBase64, "base64"), format: "der", type: "spki" }); }
async function documents(name: string) {
  const dir = join(root, name);
  return { metadata: await readFile(join(dir, "mua-pack.json")), target: await readFile(join(dir, "metadata/target-manifest.json")),
    base: name === "update" ? await readFile(join(dir, "metadata/base-manifest.json")) : null, index: await readFile(join(dir, "modrinth.index.json")), signature: await readFile(join(dir, "metadata/signature.json")) };
}
test("production v2 verifier accepts all frozen full/update fixtures and binds regenerated mrpack indexes", async () => {
  for (const name of ["base-full", "target-full", "update"]) {
    const docs = await documents(name), result = await validateRecipePackArchive(join(root, name + ".muapack"), await key());
    assert.equal(result.target.formatVersion, 2); assert.equal(result.metadata.packageType, name === "update" ? "update" : "full");
    assert.equal(result.objectCount, name === "update" ? 3 : 5);
    assert.deepEqual(createRecipePackMetadata(docs.target, docs.base, result.metadata.removalPolicy), result.metadata);
    assert(encodeMuaJson(recipeModrinthIndex(result.target)).equals(docs.index));
    assert(!result.metadata.payload.some(file => result.target.files.find(f => f.source.type === "remote" && "overrides/" + f.path === file.entry)));
  }
});
test("v2 signatures reject another key, altered documents and the v1 signature domain", async () => {
  const docs = await documents("target-full"), pair = generateKeyPairSync("ed25519"), signature = signRecipePackMetadata(docs.metadata, pair.privateKey);
  verifyRecipePackSignature(docs.metadata, signature, pair.publicKey);
  assert.throws(() => verifyRecipePackSignature(docs.metadata, signature, generateKeyPairSync("ed25519").publicKey));
  assert.throws(() => verifyRecipePackSignature(Buffer.from(docs.metadata.toString().replace("backup-managed", "retain")), signature, pair.publicKey));
  const modified = JSON.parse(docs.target.toString()); modified.files[0].size++;
  assert.throws(() => validateRecipePackDocuments(docs.metadata, encodeMuaJson(modified), null, docs.index));
  assert.throws(() => validateRecipePackDocuments(docs.metadata, docs.target, null, Buffer.from("{}")));
  const v1Signature = JSON.parse(signature.toString()); v1Signature.formatVersion = 1;
  assert.throws(() => verifyRecipePackSignature(docs.metadata, encodeMuaJson(v1Signature), pair.publicKey));
});

test("v2 delta distinguishes URL, optional, preserve, runtime and launch changes without inventing payloads", async () => {
  const baseBytes = (await documents("base-full")).target, base = readRecipeManifest(baseBytes), nextRelease = readRecipeManifest((await documents("target-full")).target).release;
  function target() { return { ...structuredClone(base), release: structuredClone(nextRelease) }; }
  const unchanged = createRecipePackMetadata(encodeMuaJson(target()), baseBytes); assert.deepEqual(unchanged.payload, []); assert.equal(unchanged.changes.runtimeChanged, null);
  const sourceOnly = target(); const remote = sourceOnly.files.find(file => file.source.type === "remote")!;
  assert(remote.source.type === "remote"); remote.source.downloads = ["https://other.fixtures.mua.invalid/core.jar"];
  const sourceChanges = createRecipePackMetadata(encodeMuaJson(sourceOnly), baseBytes);
  assert.equal(sourceChanges.changes.sourceChanged.length, 1); assert.deepEqual(sourceChanges.changes.modified, []); assert.deepEqual(sourceChanges.payload, []);
  const optional = target(); const local = optional.files.find(file => file.path === "mods/local.jar")!; local.optional = !local.optional;
  const optionalChanges = createRecipePackMetadata(encodeMuaJson(optional), baseBytes);
  assert.equal(optionalChanges.changes.policyChanged.length, 1); assert.deepEqual(optionalChanges.changes.modified, []); assert.equal(optionalChanges.payload.length, 1);
  const policy = target(); policy.files.find(file => file.path === "options.txt")!.policy = "managed";
  const policyChanges = createRecipePackMetadata(encodeMuaJson(policy), baseBytes); assert.equal(policyChanges.payload[0].entry, "overrides/options.txt");
  const runtime = target(); runtime.runtime.minecraft = "1.21.4"; runtime.runtime.loader = { type: "fabric", version: "0.16.11" };
  const runtimeChanges = createRecipePackMetadata(encodeMuaJson(runtime), baseBytes); assert(runtimeChanges.changes.runtimeChanged); assert.deepEqual(runtimeChanges.payload, []);
  const launch = target(); launch.launch.memory.recommendedMiB += 1024;
  const launchChanges = createRecipePackMetadata(encodeMuaJson(launch), baseBytes); assert(launchChanges.changes.launchChanged); assert.deepEqual(launchChanges.payload, []);
  const removed = target(); removed.files = removed.files.filter(file => file.path !== "options.txt");
  const removals = createRecipePackMetadata(encodeMuaJson(removed), baseBytes); assert.equal(removals.removalPolicy, "retain"); assert.equal(removals.changes.removed[0].policy, "preserve"); assert.deepEqual(removals.payload, []);
  const wrong = target(); wrong.release.clientId = "44444444-4444-4444-8444-444444444444";
  assert.throws(() => createRecipePackMetadata(encodeMuaJson(wrong), baseBytes));
});
test("v2 rejects protected paths, private addresses, credential URLs and noncanonical platform lists", async () => {
  const original = JSON.parse((await documents("target-full")).target.toString());
  for (const mutate of [
    (value: typeof original) => { value.files[0].path = "PCL/config.json"; value.files[0].source.entry = "overrides/PCL/config.json"; },
    (value: typeof original) => { value.files[2].source.downloads = ["https://127.0.0.1/mod.jar"]; },
    (value: typeof original) => { value.files[2].source.downloads = ["https://remote.invalid/mod.jar?token=secret"]; },
    (value: typeof original) => { value.supportedPlatforms.reverse(); },
  ]) { const value = structuredClone(original); mutate(value); assert.throws(() => readRecipeManifest(encodeMuaJson(value))); }
});
test("v2 archive verifier rejects missing, additional and tampered local payloads without extraction", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mua-v2-archive-"));
  try {
    const entries: { name: string; bytes: Buffer }[] = [];
    async function walk(current: string, prefix = "") {
      for (const entry of await readdir(current, { withFileTypes: true })) {
        const name = prefix + entry.name;
        if (entry.isDirectory()) await walk(join(current, entry.name), name + "/");
        else entries.push({ name, bytes: await readFile(join(current, entry.name)) });
      }
    }
    await walk(join(root, "target-full"));
    for (const variant of ["missing", "additional", "tampered"]) {
      const zip = new ZipFile(), chunks: Buffer[] = [], path = join(dir, variant + ".muapack");
      const done = new Promise<Buffer>((ok, bad) => { zip.outputStream.on("data", b => chunks.push(b)); zip.outputStream.on("error", bad); zip.outputStream.on("end", () => ok(Buffer.concat(chunks))); });
      for (const entry of entries) {
        if (variant === "missing" && entry.name === "overrides/mods/local.jar") continue;
        zip.addBuffer(variant === "tampered" && entry.name === "overrides/mods/local.jar" ? Buffer.alloc(entry.bytes.length, 0) : entry.bytes, entry.name);
      }
      if (variant === "additional") zip.addBuffer(Buffer.from("extra"), "overrides/mods/extra.jar");
      zip.end(); await writeFile(path, await done); await assert.rejects(validateRecipePackArchive(path, await key()));
    }
  } finally { assert(resolve(dir).startsWith(resolve(tmpdir()))); await rm(dir, { recursive: true, force: true }); }
});
