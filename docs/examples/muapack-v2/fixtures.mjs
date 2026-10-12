// Offline documentation fixtures. No network, database, OSS, installer or production keys.
import assert from "node:assert/strict";
import { createHash, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import yazl from "yazl";
import yauzl from "yauzl";
import crc32 from "crc-32";
import { encodeMuaJson, decodeMuaJson } from "../../../src/lib/muapack-protocol.ts";
import { safePackPath } from "../../../src/lib/pack-path.ts";

const root = dirname(fileURLToPath(import.meta.url));
const hash = (bytes, algorithm = "sha256") => createHash(algorithm).update(bytes).digest("hex");
const encode = encodeMuaJson;
const equal = (a, b) => encode(a).equals(encode(b));
const copy = value => JSON.parse(JSON.stringify(value));
const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const platforms = ["windows-amd64", "windows-aarch64", "linux-amd64", "linux-aarch64", "macos-amd64", "macos-aarch64"];
const domain = Buffer.from("MUA-MUAPACK-V2\0", "ascii");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const sha = (value, length) => typeof value === "string" && new RegExp(`^[0-9a-f]{${length}}$`).test(value);
function fields(value, required, optional = []) {
  assert(value && Object.getPrototypeOf(value) === Object.prototype, "plain object required");
  assert(required.every(key => Object.hasOwn(value, key)), "missing field");
  assert(Object.keys(value).every(key => required.includes(key) || optional.includes(key)), "unknown field");
}
function text(value, limit = 200) { assert(typeof value === "string" && value.length > 0 && value.length <= limit && !/[\x00-\x1f\x7f]/.test(value), "invalid text"); }
function safePath(path) { assert.equal(safePackPath(path), path); }
function publicUrl(value) {
  text(value, 4000); const url = new URL(value);
  assert.equal(url.protocol, "https:"); assert(!url.username && !url.password && !url.hash && (!url.port || url.port === "443"));
  assert(!/^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[)/i.test(url.hostname), "private target");
  assert(![...url.searchParams.keys()].some(key => /signature|token|credential|expires|x-amz-|x-goog-/i.test(key)), "temporary URL");
  // DNS/redirect checks belong to the installer. This offline sample never resolves hosts.
}
function validatePlatforms(values) {
  assert(Array.isArray(values) && values.length > 0 && values.length <= platforms.length);
  assert.equal(new Set(values).size, values.length);
  assert(values.every(value => platforms.includes(value)));
  assert.deepEqual(values, [...values].sort((a, b) => platforms.indexOf(a) - platforms.indexOf(b)));
}
function validateTarget(target) {
  const revised = Object.hasOwn(target, "protocolRevision");
  fields(target, ["format", "formatVersion", "release", revised ? "protocolRevision" : "supportedPlatforms", "runtime", "launch", "files"]);
  if (revised) assert.equal(target.protocolRevision, 2);
  assert.equal(target.format, "mua-recipe-manifest"); assert.equal(target.formatVersion, 2);
  fields(target.release, ["organizationId", "clientId", "releaseId", "version", "name", "summary", "description", "sourceSha256", "contentRevision"]);
  assert(uuid.test(target.release.organizationId) && uuid.test(target.release.releaseId));
  for (const key of ["clientId", "version", "name", "summary"]) text(target.release[key]);
  assert(typeof target.release.description === "string" && target.release.description.length <= 20000);
  assert(sha(target.release.sourceSha256, 64)); assert(Number.isSafeInteger(target.release.contentRevision) && target.release.contentRevision > 0);
  if (!revised) validatePlatforms(target.supportedPlatforms);
  fields(target.runtime, ["minecraft", "loader", "java", "resolverVersion"]); text(target.runtime.minecraft);
  assert.equal(target.runtime.resolverVersion, "mua-runtime-resolver-1");
  if (target.runtime.loader) {
    fields(target.runtime.loader, ["type", "version"]);
    assert(["fabric", "quilt", "forge", "neoforge"].includes(target.runtime.loader.type)); text(target.runtime.loader.version);
  } else assert.equal(target.runtime.loader, null);
  fields(target.runtime.java, ["major", "vendor", "imageType"]);
  assert(Number.isSafeInteger(target.runtime.java.major) && target.runtime.java.major >= 7);
  assert.equal(target.runtime.java.vendor, "adoptium"); assert(["jre", "jdk"].includes(target.runtime.java.imageType));
  assert(Array.isArray(target.files) && target.files.length <= 100000);
  assert.deepEqual(target.files.map(file => file.path), target.files.map(file => file.path).sort(order));
  const paths = new Set(), sizes = new Map(); let total = 0;
  for (const file of target.files) {
    fields(file, ["path", "size", "hashes", "source", "policy", "optional", "executable"]); safePath(file.path);
    assert(!/^(\.mua|versions|libraries|assets|natives|runtime)(\/|$)|^(launcher_accounts|launcher_profiles)\.json$/i.test(file.path), "reserved target");
    assert(!paths.has(file.path.toLowerCase()), "case collision"); paths.add(file.path.toLowerCase());
    assert(Number.isSafeInteger(file.size) && file.size >= 0 && file.size <= 2 * 1024 ** 3); total += file.size;
    assert(["managed", "preserve"].includes(file.policy)); assert.equal(typeof file.optional, "boolean"); assert.equal(typeof file.executable, "boolean");
    let identity;
    if (file.source.type === "local") {
      fields(file.source, ["type", "entry"]); assert.equal(file.source.entry, "overrides/" + file.path);
      fields(file.hashes, ["sha256"]); assert(sha(file.hashes.sha256, 64)); identity = "sha256:" + file.hashes.sha256;
    } else {
      fields(file.source, ["type", "downloads"]); assert.equal(file.source.type, "remote");
      fields(file.hashes, ["sha1", "sha512"], ["sha256"]);
      assert(sha(file.hashes.sha1, 40) && sha(file.hashes.sha512, 128)); if (file.hashes.sha256) assert(sha(file.hashes.sha256, 64));
      assert(Array.isArray(file.source.downloads) && file.source.downloads.length > 0 && file.source.downloads.length <= 10);
      file.source.downloads.forEach(publicUrl); identity = "sha512:" + file.hashes.sha512;
    }
    assert(!sizes.has(identity) || sizes.get(identity) === file.size, "same hash inconsistent size"); sizes.set(identity, file.size);
  }
  assert(total <= 40 * 1024 ** 3);
  for (const path of paths) {
    const segments = path.split("/");
    for (let i = 1; i < segments.length; i++) assert(!paths.has(segments.slice(0, i).join("/")), "file-directory collision");
  }
  validateLaunch(target);
}
function validateLaunch(target) {
  const launch = target.launch; fields(launch, ["jvmArgs", "gameArgs", "memory", "preLaunch"]);
  for (const values of [launch.jvmArgs, launch.gameArgs]) {
    assert(Array.isArray(values) && values.length <= 256);
    for (const arg of values) assert(typeof arg === "string" && arg.length <= 4000 && !/[\x00\r\n]|\$\{/.test(arg));
  }
  assert(launch.jvmArgs.every(arg => !/^-Xm[sx]|^-cp$|^-classpath$|^--class-path|^--module-path|^-p$|^-jar$/i.test(arg)));
  assert(launch.gameArgs.every(arg => !/^--(username|uuid|accessToken|gameDir|assetsDir|assetIndex|version)(=|$)/i.test(arg)));
  fields(launch.memory, ["mode", "minimumMiB", "recommendedMiB"]); assert.equal(launch.memory.mode, "auto");
  for (const value of [launch.memory.minimumMiB, launch.memory.recommendedMiB]) assert(Number.isSafeInteger(value) && value >= 256 && value <= 1048576);
  assert(launch.memory.recommendedMiB >= launch.memory.minimumMiB);
  assert(Array.isArray(launch.preLaunch) && launch.preLaunch.length <= 32);
  for (const task of launch.preLaunch) {
    if (task.type === "mkdir") { fields(task, ["type", "path"]); safePath(task.path); }
    else {
      const isCopy = task.type === "copy"; assert(isCopy || task.type === "exec");
      fields(task, isCopy ? ["type", "from", "to", "ifMissing"] : ["type", "executable", "args", "workingDirectory", "requiresConsent", "timeoutSeconds", "onFailure"]);
      const location = isCopy ? task.from : task.executable; fields(location, ["root", "path"]); assert.equal(location.root, "instance"); safePath(location.path);
      const file = target.files.find(file => file.path === location.path);
      assert(file?.source.type === "local" && file.policy === "managed" && !file.optional, "command source must be required local managed");
      if (isCopy) { safePath(task.to); assert.equal(task.ifMissing, true); }
      else {
        assert(file.executable); assert.equal(task.requiresConsent, true); assert(Number.isSafeInteger(task.timeoutSeconds) && task.timeoutSeconds >= 1 && task.timeoutSeconds <= 300);
        assert(["abort", "continue"].includes(task.onFailure)); assert(Array.isArray(task.args) && task.args.length <= 256);
        for (const arg of task.args) assert(typeof arg === "string" && arg.length <= 4000 && !/[\x00\r\n]|\$\{/.test(arg));
        if (task.workingDirectory !== null) safePath(task.workingDirectory);
      }
    }
    if (task.type !== "exec") {
      const path = task.type === "mkdir" ? task.path : task.to;
      assert(!/^(\.mua|versions|libraries|assets|natives|runtime)(\/|$)|^(launcher_accounts|launcher_profiles)\.json$/i.test(path));
      const file = target.files.find(file => file.path === path);
      assert(!file || task.type !== "mkdir" && file.policy !== "managed");
    }
  }
}
function indexFor(target) {
  const loaderKey = { fabric: "fabric-loader", quilt: "quilt-loader", forge: "forge", neoforge: "neoforge" };
  return { formatVersion: 1, game: "minecraft", versionId: target.release.version, name: target.release.name, summary: target.release.summary,
    dependencies: { minecraft: target.runtime.minecraft, ...(target.runtime.loader ? { [loaderKey[target.runtime.loader.type]]: target.runtime.loader.version } : {}) },
    files: target.files.filter(file => file.source.type === "remote").map(file => ({ path: file.path, hashes: file.hashes, fileSize: file.size,
      downloads: file.source.downloads, env: { client: file.optional ? "optional" : "required", server: "unsupported" } })) };
}
function ref(target, bytes) {
  const { organizationId, clientId, releaseId, version } = target.release; return { organizationId, clientId, releaseId, version, manifestSha256: hash(bytes) };
}
function differences(base, target) {
  const legacy = !Object.hasOwn(target, "protocolRevision");
  const changes = { added: [], modified: [], removed: [], policyChanged: [], sourceChanged: [], runtimeChanged: null, launchChanged: null,
    ...(legacy ? { platformsChanged: null } : {}) };
  if (!base) return changes;
  const old = new Map(base.files.map(file => [file.path, file])), current = new Map(target.files.map(file => [file.path, file]));
  for (const after of target.files) {
    const before = old.get(after.path); if (!before) { changes.added.push(after); continue; }
    const modified = before.source.type !== after.source.type || !equal(before.hashes, after.hashes) || before.size !== after.size || before.executable !== after.executable;
    if (modified) changes.modified.push({ before, after });
    if (before.policy !== after.policy || before.optional !== after.optional) changes.policyChanged.push({ before, after });
    if (!modified && before.source.type === "remote" && !equal(before.source.downloads, after.source.downloads)) changes.sourceChanged.push({ before, after });
  }
  changes.removed = base.files.filter(file => !current.has(file.path));
  assert(!legacy || Object.hasOwn(base, "supportedPlatforms"), "legacy target needs legacy baseline");
  for (const [key, field] of [["runtimeChanged", "runtime"], ["launchChanged", "launch"], ...(legacy ? [["platformsChanged", "supportedPlatforms"]] : [])]) {
    if (!equal(base[field], target[field])) changes[key] = { before: base[field], after: target[field] };
  }
  return changes;
}
function metadataFor(targetBytes, baseBytes) {
  const target = decodeMuaJson(targetBytes), base = baseBytes ? decodeMuaJson(baseBytes) : null;
  const changes = differences(base, target);
  const candidates = base ? [...changes.added, ...changes.modified.map(pair => pair.after), ...changes.policyChanged.map(pair => pair.after)] : target.files;
  const locals = new Map(candidates.filter(file => file.source.type === "local").map(file => [file.path, file]));
  return { format: "muapack", formatVersion: 2, ...(Object.hasOwn(target, "protocolRevision") ? { protocolRevision: 2 } : {}),
    packageType: base ? "update" : "full", target: ref(target, targetBytes), base: base ? ref(base, baseBytes) : null,
    indexSha256: hash(encode(indexFor(target))), changes,
    payload: [...locals.values()].map(file => ({ entry: file.source.entry, sha256: file.hashes.sha256, size: file.size })).sort((a, b) => order(a.entry, b.entry)),
    removalPolicy: "backup-managed", minimumLauncherProtocol: 2 };
}
function signDocuments(documents, privateKey, signingDomain = domain) {
  const bytes = documents.get("mua-pack.json"), publicKey = createPublicKey(privateKey);
  documents.set("metadata/signature.json", encode({ format: "mua-pack-signature", formatVersion: 2, algorithm: "Ed25519",
    keyId: hash(publicKey.export({ format: "der", type: "spki" })).slice(0, 24), metadataSha256: hash(bytes),
    signature: sign(null, Buffer.concat([signingDomain, bytes]), privateKey).toString("base64") }));
}
function validateDocuments(documents, trustedPublicKey) {
  assert.equal(trustedPublicKey.asymmetricKeyType, "ed25519");
  const metadataBytes = documents.get("mua-pack.json"), targetBytes = documents.get("metadata/target-manifest.json"), indexBytes = documents.get("modrinth.index.json");
  assert(metadataBytes && targetBytes && indexBytes && documents.has("metadata/signature.json"), "missing metadata");
  const metadata = decodeMuaJson(metadataBytes), target = decodeMuaJson(targetBytes), signature = decodeMuaJson(documents.get("metadata/signature.json"));
  fields(signature, ["format", "formatVersion", "algorithm", "keyId", "metadataSha256", "signature"]);
  assert.equal(signature.format, "mua-pack-signature"); assert.equal(signature.formatVersion, 2); assert.equal(signature.algorithm, "Ed25519");
  assert.equal(signature.keyId, hash(trustedPublicKey.export({ format: "der", type: "spki" })).slice(0, 24)); assert.equal(signature.metadataSha256, hash(metadataBytes));
  const signatureBytes = Buffer.from(signature.signature, "base64"); assert.equal(signatureBytes.length, 64); assert.equal(signatureBytes.toString("base64"), signature.signature);
  assert(verify(null, Buffer.concat([domain, metadataBytes]), trustedPublicKey, signatureBytes), "signature mismatch");
  validateTarget(target); fields(metadata, ["format", "formatVersion", "packageType", "target", "base", "indexSha256", "changes", "payload", "removalPolicy", "minimumLauncherProtocol",
    ...(Object.hasOwn(target, "protocolRevision") ? ["protocolRevision"] : [])]);
  if (Object.hasOwn(target, "protocolRevision")) assert.equal(metadata.protocolRevision, target.protocolRevision);
  assert.equal(metadata.format, "muapack"); assert.equal(metadata.formatVersion, 2); assert(["full", "update"].includes(metadata.packageType));
  assert(["retain", "backup-managed"].includes(metadata.removalPolicy)); assert.equal(metadata.minimumLauncherProtocol, 2);
  const baseBytes = documents.get("metadata/base-manifest.json") ?? null, base = baseBytes ? decodeMuaJson(baseBytes) : null;
  assert.equal(metadata.packageType === "update", !!baseBytes);
  if (base) {
    validateTarget(base); assert.equal(base.release.organizationId, target.release.organizationId); assert.equal(base.release.clientId, target.release.clientId);
    assert.notEqual(base.release.releaseId, target.release.releaseId); assert.notEqual(base.release.version, target.release.version);
    const sizes = new Map();
    for (const file of [...base.files, ...target.files]) {
      const identity = file.source.type === "local" ? "sha256:" + file.hashes.sha256 : "sha512:" + file.hashes.sha512;
      assert(!sizes.has(identity) || sizes.get(identity) === file.size, "cross-release hash size mismatch"); sizes.set(identity, file.size);
    }
  }
  const expected = metadataFor(targetBytes, baseBytes); expected.removalPolicy = metadata.removalPolicy;
  assert(equal(metadata, expected), "metadata/delta/payload mismatch");
  assert.equal(hash(indexBytes), metadata.indexSha256); decodeMuaJson(indexBytes);
  assert(indexBytes.equals(encode(indexFor(target))), "index conflicts with target");
  const allowed = new Set(["mua-pack.json", "modrinth.index.json", "metadata/target-manifest.json", "metadata/signature.json", ...(base ? ["metadata/base-manifest.json"] : []), ...metadata.payload.map(file => file.entry)]);
  assert.equal(documents.size, allowed.size, "missing or extra entries");
  for (const [path] of documents) { safePath(path); assert(allowed.has(path), "undeclared entry"); }
  for (const file of metadata.payload) {
    const bytes = documents.get(file.entry); assert(bytes, "missing local payload"); assert.equal(bytes.length, file.size); assert.equal(hash(bytes), file.sha256);
  }
  return { metadata, target, base };
}
async function zipBytes(documents) {
  const zip = new yazl.ZipFile(), chunks = [];
  const finished = new Promise((accept, reject) => { zip.outputStream.on("data", bytes => chunks.push(bytes)); zip.outputStream.on("end", () => accept(Buffer.concat(chunks))); zip.outputStream.on("error", reject); });
  for (const [path, bytes] of [...documents].sort(([a], [b]) => order(a, b))) zip.addBuffer(bytes, path, { mtime: new Date("2000-01-01T00:00:00Z"), mode: 0o100644, compress: false });
  zip.end({ forceZip64Format: true }); return finished;
}
async function readZip(bytes) {
  return new Promise((accept, reject) => yauzl.fromBuffer(bytes, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true }, (error, zip) => {
    if (error) { reject(error); return; }
    const documents = new Map(), paths = new Set(); let total = 0;
    const fail = error => { zip.close(); reject(error); };
    zip.on("error", fail); zip.on("end", () => accept(documents));
    zip.on("entry", async entry => {
      try {
        safePath(entry.fileName); assert(!entry.fileName.endsWith("/")); assert(!paths.has(entry.fileName.toLowerCase()), "duplicate ZIP entry"); paths.add(entry.fileName.toLowerCase());
        assert(!(entry.generalPurposeBitFlag & 1)); assert([0, 8].includes(entry.compressionMethod));
        const mode = (entry.externalFileAttributes >>> 16) & 0xf000; assert(mode !== 0xa000, "link ZIP entry");
        // Fixture checker limits memory. This is not the production streaming parser.
        total += entry.uncompressedSize; assert(entry.uncompressedSize <= 16 * 1024 ** 2 && total <= 64 * 1024 ** 2 && paths.size <= 10000);
        const stream = await new Promise((accept, reject) => zip.openReadStream(entry, (error, stream) => error ? reject(error) : accept(stream)));
        const chunks = []; for await (const chunk of stream) chunks.push(chunk); const content = Buffer.concat(chunks);
        assert.equal(content.length, entry.uncompressedSize); assert.equal(crc32.buf(content) >>> 0, entry.crc32 >>> 0);
        documents.set(entry.fileName, content); zip.readEntry();
      } catch (error) { fail(error); }
    }); zip.readEntry();
  }));
}
async function writeDocuments(folder, documents) {
  for (const [path, bytes] of documents) { const file = resolve(root, folder, path); assert(file.startsWith(root + (process.platform === "win32" ? "\\" : "/"))); await mkdir(dirname(file), { recursive: true }); await writeFile(file, bytes); }
}
const remoteBytes = {
  "core-1.jar": Buffer.from("synthetic remote core v1\n"), "core-2.jar": Buffer.from("synthetic remote core v2\n"),
  "optional.jar": Buffer.from("synthetic optional mod\n"), "mirror.jar": Buffer.from("synthetic stable mirrored mod\n"),
  "new.jar": Buffer.from("synthetic new optional mod\n"), "shadowed.jar": Buffer.from("synthetic overridden remote mod\n"),
  "server.jar": Buffer.from("synthetic server-only mod\n"),
};
function remoteEntry(path, filename, optional = false, mirror = "origin", client = null) {
  const bytes = remoteBytes[filename]; return { path, fileSize: bytes.length, hashes: { sha1: hash(bytes, "sha1"), sha512: hash(bytes, "sha512") },
    downloads: [`https://${mirror}.fixtures.mua.invalid/${filename}`], env: { client: client ?? (optional ? "optional" : "required"), server: "unsupported" } };
}
function sourceDocuments(updated) {
  const local = new Map([
    ["overrides/mods/local.jar", Buffer.from(updated ? "synthetic local mod v2\n" : "synthetic local mod v1\n")],
    ["overrides/mods/override.jar", Buffer.from("synthetic local override wins\n")],
    ["overrides/config/game.toml", Buffer.from("discarded earlier layer\n")],
    ["client-overrides/config/game.toml", Buffer.from(updated ? "mode = \"new\"\n" : "mode = \"old\"\n")],
    ["overrides/options.txt", Buffer.from("synthetic player defaults\n")],
    [updated ? "overrides/config/new.toml" : "overrides/config/old.toml", Buffer.from(updated ? "new = true\n" : "old = true\n")],
    ["server-overrides/mods/server-only.jar", Buffer.from("not a client file\n")],
  ]);
  const index = { formatVersion: 1, game: "minecraft", name: "MUA v2 offline fixture", summary: "Synthetic protocol example; not an installable game", versionId: updated ? "1.1.0" : "1.0.0",
    dependencies: { minecraft: "1.21.1", "fabric-loader": updated ? "0.16.10" : "0.16.9" },
    files: [remoteEntry("mods/core.jar", updated ? "core-2.jar" : "core-1.jar"), remoteEntry("mods/optional.jar", "optional.jar", !updated),
      remoteEntry("mods/mirror.jar", "mirror.jar", false, updated ? "mirror" : "origin"), remoteEntry("mods/override.jar", "shadowed.jar", true),
      remoteEntry("mods/server.jar", "server.jar", false, "origin", "unsupported"), ...(updated ? [remoteEntry("mods/new.jar", "new.jar", true)] : [])] };
  return new Map([["modrinth.index.json", encode(index)], ...local]);
}
function normalizeSource(source, sourceSha256, updated) {
  const index = decodeMuaJson(source.get("modrinth.index.json")); const files = new Map();
  for (const file of index.files) if (file.env?.client !== "unsupported") files.set(file.path, { path: file.path, size: file.fileSize, hashes: file.hashes,
    source: { type: "remote", downloads: file.downloads }, policy: "managed", optional: file.env?.client === "optional", executable: false });
  const locals = new Map();
  for (const prefix of ["overrides/", "client-overrides/"]) for (const [entry, bytes] of source) if (entry.startsWith(prefix)) {
    const path = entry.slice(prefix.length), optional = files.get(path)?.optional ?? false;
    files.set(path, { path, size: bytes.length, hashes: { sha256: hash(bytes) }, source: { type: "local", entry: "overrides/" + path },
      policy: path === "options.txt" ? "preserve" : "managed", optional, executable: false }); locals.set("overrides/" + path, bytes);
  }
  const target = { format: "mua-recipe-manifest", formatVersion: 2,
    release: { organizationId: "11111111-1111-4111-8111-111111111111", clientId: "22222222-2222-4222-8222-222222222222",
      releaseId: updated ? "33333333-3333-4333-8333-333333333332" : "33333333-3333-4333-8333-333333333331",
      version: index.versionId, name: index.name, summary: index.summary, description: "# Offline sample\nSynthetic bytes only.", sourceSha256, contentRevision: 1 },
    supportedPlatforms: updated ? ["windows-amd64", "linux-amd64"] : ["windows-amd64"],
    runtime: { minecraft: index.dependencies.minecraft, loader: { type: "fabric", version: index.dependencies["fabric-loader"] }, java: { major: 21, vendor: "adoptium", imageType: "jre" }, resolverVersion: "mua-runtime-resolver-1" },
    launch: { jvmArgs: updated ? ["-Dmua.example=true"] : [], gameArgs: [], memory: { mode: "auto", minimumMiB: 1024, recommendedMiB: 2048 }, preLaunch: [] },
    files: [...files.values()].sort((a, b) => order(a.path, b.path)) };
  validateTarget(target); return { target, locals };
}
function packDocuments(targetBytes, baseBytes, locals, privateKey) {
  const target = decodeMuaJson(targetBytes), metadata = metadataFor(targetBytes, baseBytes);
  const documents = new Map([["mua-pack.json", encode(metadata)], ["modrinth.index.json", encode(indexFor(target))], ["metadata/target-manifest.json", targetBytes],
    ...(baseBytes ? [["metadata/base-manifest.json", baseBytes]] : [])]);
  for (const file of metadata.payload) documents.set(file.entry, locals.get(file.entry));
  signDocuments(documents, privateKey); return documents;
}
async function checks() {
  const publicDocument = JSON.parse(await readFile(resolve(root, "test-public-key.json"), "utf8"));
  const publicKey = createPublicKey({ key: Buffer.from(publicDocument.spkiDerBase64, "base64"), format: "der", type: "spki" });
  assert.equal(publicDocument.keyId, hash(publicKey.export({ format: "der", type: "spki" })).slice(0, 24));
  const cases = [], packages = [], loaded = [];
  for (const file of ["base-full.muapack", "target-full.muapack", "update.muapack"]) {
    const bytes = await readFile(resolve(root, file)), documents = await readZip(bytes), checked = validateDocuments(documents, publicKey);
    loaded.push({ documents, ...checked }); cases.push(file + ": CRC, signature, inventories and payload verified");
    packages.push({ file, sha256: hash(bytes), size: bytes.length, localPayloadFiles: checked.metadata.payload.length, remoteDeclarations: checked.target.files.filter(file => file.source.type === "remote").length });
  }
  const [base, target, update] = loaded;
  assert.equal(base.metadata.target.manifestSha256, update.metadata.base.manifestSha256); cases.push("exact baseline binding");
  assert.equal(target.metadata.target.manifestSha256, update.metadata.target.manifestSha256); cases.push("full/update target identity");
  assert.deepEqual(Object.fromEntries(["added", "modified", "removed", "policyChanged", "sourceChanged"].map(key => [key, update.metadata.changes[key].length])),
    { added: 2, modified: 3, removed: 1, policyChanged: 1, sourceChanged: 1 }); cases.push("complete delta counts");
  assert(update.metadata.changes.runtimeChanged && update.metadata.changes.launchChanged && update.metadata.changes.platformsChanged); cases.push("environment, launch and platform changes");
  for (const [i, name] of ["base.mrpack", "target.mrpack"].entries()) {
    const bytes = await readFile(resolve(root, "inputs", name)), source = await readZip(bytes), normalized = normalizeSource(source, hash(bytes), i === 1);
    assert(equal(normalized.target, loaded[i].target)); cases.push(name + ": local overrides and source hash preserved");
    assert.equal(normalized.target.files.find(file => file.path === "mods/override.jar").source.type, "local");
    assert(!indexFor(normalized.target).files.some(file => file.path === "mods/override.jar")); cases.push(name + ": shadowed remote not downloaded");
    assert(!normalized.target.files.some(file => file.path.includes("server"))); cases.push(name + ": server-only bytes excluded");
    assert.equal(normalized.locals.get("overrides/config/game.toml").toString(), i ? "mode = \"new\"\n" : "mode = \"old\"\n"); cases.push(name + ": client-overrides wins");
  }
  for (const file of [...base.target.files, ...target.target.files].filter(file => file.source.type === "remote")) {
    const filename = new URL(file.source.downloads[0]).pathname.slice(1), bytes = await readFile(resolve(root, "fixtures", "remote", filename));
    assert.equal(bytes.length, file.size); assert.equal(hash(bytes, "sha1"), file.hashes.sha1); assert.equal(hash(bytes, "sha512"), file.hashes.sha512);
  } cases.push("remote hashes match external synthetic bytes");
  assert(update.metadata.payload.every(file => !file.entry.includes("core.jar") && !file.entry.includes("optional.jar"))); cases.push("remote changes never produce local payload");
  const fullLocalPaths = new Set(target.metadata.payload.map(file => file.entry));
  for (const file of target.target.files.filter(file => file.source.type === "local")) assert(fullLocalPaths.has(file.source.entry)); cases.push("full package repairs absent unchanged local bytes");
  assert(target.target.files.find(file => file.path === "mods/override.jar").optional);
  assert(fullLocalPaths.has("overrides/mods/override.jar")); cases.push("optional local bytes remain in full payload");
  assert.equal(target.target.files.find(file => file.path === "options.txt").policy, "preserve"); cases.push("player defaults retain preserve policy");
  const variantKey = generateKeyPairSync("ed25519"), variantLocals = new Map([...target.documents].filter(([path]) => path.startsWith("overrides/")));
  const zeroContent = copy(base.target); zeroContent.release.releaseId = target.target.release.releaseId; zeroContent.release.version = "1.0.1";
  const zeroChecked = validateDocuments(packDocuments(encode(zeroContent), encode(base.target), variantLocals, variantKey.privateKey), variantKey.publicKey);
  assert.equal(zeroChecked.metadata.payload.length, 0);
  assert(equal(zeroChecked.metadata.changes, differences(null, zeroContent))); cases.push("zero-content update has no payload or artificial file changes");
  const policyOnly = copy(zeroContent); policyOnly.files.find(file => file.path === "mods/override.jar").optional = false;
  const policyChecked = validateDocuments(packDocuments(encode(policyOnly), encode(base.target), variantLocals, variantKey.privateKey), variantKey.publicKey);
  assert.equal(policyChecked.metadata.changes.modified.length, 0); assert.equal(policyChecked.metadata.changes.policyChanged.length, 1);
  assert.deepEqual(policyChecked.metadata.payload.map(file => file.entry), ["overrides/mods/override.jar"]); cases.push("local optional-only update includes required enablement bytes");
  const removedPreserve = copy(zeroContent); removedPreserve.files = removedPreserve.files.filter(file => file.path !== "options.txt");
  const preserveChecked = validateDocuments(packDocuments(encode(removedPreserve), encode(base.target), variantLocals, variantKey.privateKey), variantKey.publicKey);
  assert.equal(preserveChecked.metadata.changes.removed[0].policy, "preserve"); cases.push("removed player defaults retain preserve declaration for installer");
  const inputKey = generateKeyPairSync("ed25519"), rejectCase = (name, mutate, oldDomain = false) => {
    const documents = new Map(update.documents); mutate(documents);
    signDocuments(documents, inputKey.privateKey, oldDomain ? Buffer.from("MUA-MUAPACK-V1\0", "ascii") : domain);
    assert.throws(() => validateDocuments(documents, inputKey.publicKey), undefined, name); cases.push("reject: " + name);
  };
  const changeMetadata = (documents, change) => { const value = decodeMuaJson(documents.get("mua-pack.json")); change(value); documents.set("mua-pack.json", encode(value)); };
  rejectCase("wrong protocol version", docs => changeMetadata(docs, value => { value.formatVersion = 1; }));
  rejectCase("unknown metadata field", docs => changeMetadata(docs, value => { value.unknown = true; }));
  rejectCase("wrong target digest", docs => changeMetadata(docs, value => { value.target.manifestSha256 = "0".repeat(64); }));
  rejectCase("delta omitted removed file", docs => changeMetadata(docs, value => { value.changes.removed = []; }));
  rejectCase("missing update baseline", docs => { docs.delete("metadata/base-manifest.json"); });
  rejectCase("v1 signature domain", () => {}, true);
  rejectCase("tampered local bytes", docs => { docs.set("overrides/mods/local.jar", Buffer.from("corrupted")); });
  rejectCase("missing local payload", docs => { docs.delete("overrides/config/game.toml"); });
  rejectCase("undeclared remote bytes", docs => { docs.set("overrides/mods/core.jar", remoteBytes["core-2.jar"]); });
  rejectCase("undeclared environment bytes", docs => { docs.set("runtime/java.exe", Buffer.from("not permitted")); });
  rejectCase("unsafe archive path", docs => { docs.set("overrides/../escape.txt", Buffer.from("escape")); });
  rejectCase("conflicting mrpack index", docs => {
    const index = decodeMuaJson(docs.get("modrinth.index.json")); index.versionId = "9.9.9"; docs.set("modrinth.index.json", encode(index));
    changeMetadata(docs, value => { value.indexSha256 = hash(docs.get("modrinth.index.json")); });
  });
  const replaceTarget = (docs, change) => {
    const candidate = copy(target.target); change(candidate); const bytes = encode(candidate); docs.set("metadata/target-manifest.json", bytes);
    docs.set("mua-pack.json", encode(metadataFor(bytes, docs.get("metadata/base-manifest.json")))); docs.set("modrinth.index.json", encode(indexFor(candidate)));
  };
  rejectCase("cross-client baseline", docs => replaceTarget(docs, value => { value.release.clientId = "another-client"; }));
  rejectCase("remote missing strong hash", docs => replaceTarget(docs, value => { delete value.files.find(file => file.source.type === "remote").hashes.sha512; }));
  rejectCase("temporary signed URL", docs => replaceTarget(docs, value => { value.files.find(file => file.source.type === "remote").source.downloads[0] += "?X-Amz-Signature=abc"; }));
  rejectCase("private remote target", docs => replaceTarget(docs, value => { value.files.find(file => file.source.type === "remote").source.downloads[0] = "https://127.0.0.1/mod.jar"; }));
  rejectCase("reserved environment target", docs => replaceTarget(docs, value => { value.files[0].path = "versions/game.jar"; }));
  rejectCase("case-insensitive file collision", docs => replaceTarget(docs, value => {
    const duplicate = copy(value.files[0]); duplicate.path = duplicate.path.toUpperCase(); duplicate.source.entry = "overrides/" + duplicate.path;
    value.files.push(duplicate); value.files.sort((a, b) => order(a.path, b.path));
  }));
  rejectCase("file-directory collision", docs => replaceTarget(docs, value => {
    const duplicate = copy(value.files[0]); duplicate.path = "config"; duplicate.source.entry = "overrides/config";
    value.files.push(duplicate); value.files.sort((a, b) => order(a.path, b.path));
  }));
  rejectCase("same content hash with inconsistent size", docs => replaceTarget(docs, value => {
    const duplicate = copy(value.files[0]); duplicate.path = "config/size-conflict.toml"; duplicate.source.entry = "overrides/" + duplicate.path; duplicate.size++;
    value.files.push(duplicate); value.files.sort((a, b) => order(a.path, b.path));
  }));
  rejectCase("unknown target field", docs => replaceTarget(docs, value => { value.hiddenCommand = "not allowed"; }));
  rejectCase("unsupported resolver version", docs => replaceTarget(docs, value => { value.runtime.resolverVersion = "untrusted-resolver"; }));
  rejectCase("unconfirmed executable", docs => replaceTarget(docs, value => {
    value.launch.preLaunch = [{ type: "exec", executable: { root: "instance", path: "mods/local.jar" }, args: [], workingDirectory: null, requiresConsent: false, timeoutSeconds: 1, onFailure: "abort" }];
  }));
  const modified = new Map(update.documents); const raw = Buffer.from(modified.get("mua-pack.json")); raw[0] ^= 1; modified.set("mua-pack.json", raw);
  assert.throws(() => validateDocuments(modified, publicKey)); cases.push("reject: post-signature metadata tamper");
  assert.throws(() => validateDocuments(update.documents, inputKey.publicKey)); cases.push("reject: untrusted public key");
  const badZip = Buffer.from(await readFile(resolve(root, "update.muapack"))); const local = update.documents.get("overrides/mods/local.jar"), offset = badZip.indexOf(local); assert(offset >= 0); badZip[offset] ^= 1;
  await assert.rejects(readZip(badZip)); cases.push("reject: ZIP CRC corruption");
  await assert.rejects(readZip(await zipBytes([...update.documents, ["overrides/mods/local.jar", local]]))); cases.push("reject: duplicate ZIP entry");
  const nonCanonical = new Map(update.documents); nonCanonical.set("metadata/target-manifest.json", Buffer.from(JSON.stringify(update.target, null, 2)));
  changeMetadata(nonCanonical, value => { value.target.manifestSha256 = hash(nonCanonical.get("metadata/target-manifest.json")); });
  signDocuments(nonCanonical, inputKey.privateKey);
  assert.throws(() => validateDocuments(nonCanonical, inputKey.publicKey)); cases.push("reject: noncanonical target encoding");
  const duplicateJson = new Map(update.documents); duplicateJson.set("metadata/target-manifest.json", Buffer.from('{"formatVersion":2,"formatVersion":2}'));
  changeMetadata(duplicateJson, value => { value.target.manifestSha256 = hash(duplicateJson.get("metadata/target-manifest.json")); });
  signDocuments(duplicateJson, inputKey.privateKey);
  assert.throws(() => validateDocuments(duplicateJson, inputKey.publicKey)); cases.push("reject: duplicate JSON key");
  const revisedPublicDocument = JSON.parse(await readFile(resolve(root, "revision-2/test-public-key.json"), "utf8"));
  const revisedKey = createPublicKey({ key: Buffer.from(revisedPublicDocument.spkiDerBase64, "base64"), format: "der", type: "spki" });
  const revisedLoaded = [];
  for (const name of ["base-full", "target-full", "update"]) {
    const file = `revision-2/${name}.muapack`, bytes = await readFile(resolve(root, file)), documents = await readZip(bytes);
    const checked = validateDocuments(documents, revisedKey); revisedLoaded.push({ documents, ...checked });
    assert.equal(checked.target.protocolRevision, 2); assert.equal(checked.metadata.protocolRevision, 2);
    assert(!Object.hasOwn(checked.target, "supportedPlatforms")); assert(!Object.hasOwn(checked.metadata.changes, "platformsChanged"));
    cases.push(file + ": revision, signature, inventories and payload verified without platform declarations");
    packages.push({ file, sha256: hash(bytes), size: bytes.length, localPayloadFiles: checked.metadata.payload.length, remoteDeclarations: checked.target.files.filter(file => file.source.type === "remote").length });
  }
  assert.equal(revisedLoaded[0].metadata.target.manifestSha256, revisedLoaded[2].metadata.base.manifestSha256);
  assert.equal(revisedLoaded[1].metadata.target.manifestSha256, revisedLoaded[2].metadata.target.manifestSha256);
  cases.push("revision 2 exact full/update baseline and target binding");
  const current = revisedLoaded[1], currentLocals = new Map([...current.documents].filter(([path]) => path.startsWith("overrides/")));
  const mixed = packDocuments(encode(current.target), encode(base.target), currentLocals, variantKey.privateKey);
  validateDocuments(mixed, variantKey.publicKey); cases.push("revision 2 update accepts exact legacy baseline without a platform gate");
  for (const [name, change] of [
    ["unknown revision", value => { value.protocolRevision = 3; }],
    ["missing revision", value => { delete value.protocolRevision; }],
    ["legacy field in revised target", value => { value.supportedPlatforms = ["windows-amd64"]; }],
  ]) {
    const value = copy(current.target); change(value); assert.throws(() => validateTarget(value)); cases.push("reject: " + name);
  }
  const badRevision = new Map(current.documents);
  changeMetadata(badRevision, value => { value.protocolRevision = 3; }); signDocuments(badRevision, variantKey.privateKey);
  assert.throws(() => validateDocuments(badRevision, variantKey.publicKey)); cases.push("reject: signed mismatched metadata revision");
  const badChanges = new Map(current.documents);
  changeMetadata(badChanges, value => { value.changes.platformsChanged = null; }); signDocuments(badChanges, variantKey.privateKey);
  assert.throws(() => validateDocuments(badChanges, variantKey.publicKey)); cases.push("reject: legacy platform changes in revised metadata");
  return { format: "muapack-v2-offline-fixture-report", formatVersion: 1, packages, checksPassed: cases.length, cases,
    networkRequests: 0, databaseWrites: 0, installedGames: 0, runtimeBinariesBundled: false, note: "Synthetic fixtures only; not a production installer or playable client." };
}
async function generate() {
  const key = generateKeyPairSync("ed25519"), normalized = [];
  for (const updated of [false, true]) {
    const documents = sourceDocuments(updated), bytes = await zipBytes(documents); const name = updated ? "target" : "base";
    await writeDocuments("inputs/" + name, documents); await writeFile(resolve(root, "inputs", name + ".mrpack"), bytes);
    normalized.push(normalizeSource(documents, hash(bytes), updated));
  }
  for (const [name, bytes] of Object.entries(remoteBytes)) await writeDocuments("fixtures/remote", new Map([[name, bytes]]));
  const publicDer = key.publicKey.export({ format: "der", type: "spki" });
  await writeFile(resolve(root, "test-public-key.json"), encode({ algorithm: "Ed25519", keyId: hash(publicDer).slice(0, 24), spkiDerBase64: publicDer.toString("base64"), testOnly: true }));
  const baseBytes = encode(normalized[0].target), targetBytes = encode(normalized[1].target);
  for (const [name, target, base, locals] of [["base-full", baseBytes, null, normalized[0].locals], ["target-full", targetBytes, null, normalized[1].locals], ["update", targetBytes, baseBytes, normalized[1].locals]]) {
    const documents = packDocuments(target, base, locals, key.privateKey); validateDocuments(documents, key.publicKey);
    await writeDocuments(name, documents); await writeFile(resolve(root, name + ".muapack"), await zipBytes(documents));
  }
  const report = await checks(); await writeFile(resolve(root, "verification-report.json"), encode(report)); return report;
}
async function generateRevision2() {
  const key = generateKeyPairSync("ed25519"), targets = [], locals = [];
  for (const name of ["base-full", "target-full"]) {
    const docs = await readZip(await readFile(resolve(root, name + ".muapack")));
    const target = decodeMuaJson(docs.get("metadata/target-manifest.json"));
    delete target.supportedPlatforms; target.protocolRevision = 2; validateTarget(target);
    targets.push(encode(target)); locals.push(new Map([...docs].filter(([path]) => path.startsWith("overrides/"))));
  }
  const publicDer = key.publicKey.export({ format: "der", type: "spki" });
  await writeDocuments("revision-2", new Map([["test-public-key.json", encode({ algorithm: "Ed25519", keyId: hash(publicDer).slice(0, 24), spkiDerBase64: publicDer.toString("base64"), testOnly: true })]]));
  for (const [name, target, base, local] of [["base-full", targets[0], null, locals[0]], ["target-full", targets[1], null, locals[1]], ["update", targets[1], targets[0], locals[1]]]) {
    const docs = packDocuments(target, base, local, key.privateKey); validateDocuments(docs, key.publicKey);
    await writeDocuments("revision-2/" + name, docs); await writeFile(resolve(root, "revision-2", name + ".muapack"), await zipBytes(docs));
  }
  const report = await checks(); await writeFile(resolve(root, "revision-2/verification-report.json"), encode(report)); return report;
}
const mode = process.argv[2] ?? "--check"; assert(["--generate", "--generate-revision-2", "--check"].includes(mode), "use --generate, --generate-revision-2 or --check");
const report = mode === "--generate-revision-2" ? await generateRevision2() : mode === "--generate" ? await generate() : await checks();
console.log(JSON.stringify({ mode, checksPassed: report.checksPassed, packages: report.packages, networkRequests: report.networkRequests, installedGames: report.installedGames }));
