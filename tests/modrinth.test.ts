import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createHash, generateKeyPairSync, createPublicKey } from "node:crypto";
import { Readable } from "node:stream";
import http from "node:http";
import https from "node:https";
import type { IncomingMessage } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { ZipFile } from "yazl";
import { inspectModrinthIndex } from "../src/lib/modrinth-inspection";
import { parseClientPack } from "../src/lib/pack-parser";
import { parseRecipeInventory } from "../src/lib/recipe-inventory";
import { remoteSourceUrl, publicDownloadAddress, downloadRemoteFile, type RemoteDeclaration } from "../src/lib/remote-download";
import { DEFAULT_REMOTE_HOSTS, downloadSettingsSchema, type DownloadSettings } from "../src/lib/download-settings";
import { muaFixture } from "./fixtures/muapack";
import { encodeMuaJson, createMuaPackMetadata, signMuaPackMetadata, verifyMuaPackSignature } from "../src/lib/muapack-protocol";
import { muaPlatformManifestSchema } from "../src/lib/muapack-contract";
const settings: DownloadSettings = downloadSettingsSchema.parse({ remoteSourceWhitelistEnabled: false, remoteSourceHosts: DEFAULT_REMOTE_HOSTS, downloadProxyEnabled: false, downloadProxyUrl: "" });
const hashes = (bytes: Buffer) => ({ sha1: createHash("sha1").update(bytes).digest("hex"), sha512: createHash("sha512").update(bytes).digest("hex") });
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
function remote(path: string, bytes: Buffer, client: "required" | "optional" | "unsupported" = "required"): RemoteDeclaration & { env: { client: typeof client; server: "required" } } {
  return { path, fileSize: bytes.length, hashes: hashes(bytes), downloads: ["https://cdn.modrinth.com/" + path], env: { client, server: "required" } };
}
function index(files: ReturnType<typeof remote>[] = []) { return { formatVersion: 1, game: "minecraft", name: "Example pack", versionId: "1.4.3", summary: "Test import", dependencies: { minecraft: "26.1", "fabric-loader": "0.19.5" }, files }; }
async function archive(files: Record<string, Buffer>) {
  const zip = new ZipFile(), chunks: Buffer[] = [];
  const complete = (async () => { for await (const chunk of zip.outputStream as AsyncIterable<Buffer>) chunks.push(chunk); })();
  for (const [name, bytes] of Object.entries(files)) zip.addBuffer(bytes, name);
  zip.end(); await complete; return Buffer.concat(chunks);
}
async function directory(work: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "mua-mrpack-test-"));
  try { await work(dir); } finally { assert(resolve(dir).startsWith(resolve(tmpdir()) + sep)); await rm(dir, { recursive: true, force: true }); }
}
function fakeResponse(bytes: Buffer, length = bytes.length): IncomingMessage {
  return Object.assign(Readable.from([bytes]), { headers: { "content-length": String(length) }, statusCode: 200 }) as IncomingMessage;
}
test("mrpack dependencies infer Java independently of pack version, and all optional client files remain selected", () => {
  const info = inspectModrinthIndex(index([remote("mods/optional.jar", Buffer.from("a"), "optional"), remote("mods/server.jar", Buffer.from("b"), "unsupported")]));
  assert.equal(info.info.minecraftVersion, "26.1"); assert.equal(info.info.javaVersion, 25); assert.equal(info.info.loader, "fabric");
  assert.equal(info.info.pack?.version, "1.4.3"); assert.equal(info.files.length, 1); assert.equal(info.files[0].env?.client, "optional");
  const unknown = inspectModrinthIndex({ ...index(), dependencies: { minecraft: "99.1" } }); assert.equal(unknown.info.javaVersion, null);
  assert.throws(() => inspectModrinthIndex({ ...index(), dependencies: { minecraft: "26.1", "fabric-loader": "1", neoforge: "2" } }));
  assert.throws(() => inspectModrinthIndex({ ...index(), dependencies: { minecraft: "26.1", "unknown-loader": "1" } }));
});
test("mrpack rejects invalid markers, unsafe and duplicate paths, sizes and absent integrity hashes", () => {
  const file = remote("mods/a.jar", Buffer.from("a"));
  for (const raw of [{ ...index(), formatVersion: 2 }, { ...index(), game: "other" }, index([file, file]),
    index([{ ...file, path: "../escape.jar" }]), index([{ ...file, path: "C:/escape.jar" }]),
    { ...index(), files: [{ ...file, hashes: { sha1: file.hashes.sha1 } }] }, index([{ ...file, fileSize: 2 * 1024 ** 3 + 1 }])]) assert.throws(() => inspectModrinthIndex(raw));
});
test("source whitelist is off by default; URL protections remain on and enabled lists require exact hosts", () => {
  assert.equal(remoteSourceUrl("https://unlisted.example/file.jar", settings).hostname, "unlisted.example");
  assert.throws(() => remoteSourceUrl("https://unlisted.example/file.jar", { ...settings, remoteSourceWhitelistEnabled: true }));
  assert.equal(remoteSourceUrl("https://cdn.modrinth.com/a", { ...settings, remoteSourceWhitelistEnabled: true }).hostname, "cdn.modrinth.com");
  for (const value of ["http://cdn.modrinth.com/a", "https://127.0.0.1/a", "https://[::1]/a", "https://2130706433/a", "https://user:secret@cdn.modrinth.com/a", "https://cdn.modrinth.com:444/a"])
    assert.throws(() => remoteSourceUrl(value, settings));
  for (const address of ["127.0.0.1", "10.1.1.1", "169.254.169.254", "192.168.1.1", "172.16.1.1", "100.64.0.1", "::1", "::ffff:127.0.0.1", "fe80::1", "2001:db8::1", "2002:7f00:1::1"]) assert.equal(publicDownloadAddress(address), false, address);
  assert.equal(publicDownloadAddress("1.1.1.1"), true); assert.equal(publicDownloadAddress("2606:4700:4700::1111"), true);
  assert.equal(downloadSettingsSchema.parse({ ...settings, remoteSourceHosts: ["CDN.MODRINTH.COM"] }).remoteSourceHosts[0], "cdn.modrinth.com");
  assert.throws(() => downloadSettingsSchema.parse({ ...settings, downloadProxyEnabled: true }));
  assert.throws(() => downloadSettingsSchema.parse({ ...settings, downloadProxyUrl: "http://user:secret@localhost:7890" }));
});
test("remote downloads validate both upstream hashes and size, retry mirrors and compute CAS SHA-256", async () => directory(async dir => {
  const bytes = Buffer.from("verified file"), file = remote("mods/a.jar", bytes); let calls = 0;
  const result = await downloadRemoteFile(file, join(dir, "good"), settings, new AbortController().signal, () => {}, async () => { calls++; return fakeResponse(calls === 1 ? Buffer.alloc(bytes.length) : bytes); });
  assert.equal(calls, 2); assert.equal(result.sha256, digest(bytes)); assert.deepEqual(await readFile(join(dir, "good")), bytes);
  for (const corrupt of [{ ...file, hashes: { ...file.hashes, sha512: "0".repeat(128) } }, { ...file, fileSize: bytes.length + 1 }])
    await assert.rejects(downloadRemoteFile(corrupt, join(dir, "bad"), settings, new AbortController().signal, () => {}, async () => fakeResponse(bytes)));
  const aborted = new AbortController(); aborted.abort(); await assert.rejects(downloadRemoteFile(file, join(dir, "abort"), settings, aborted.signal, () => {}, async () => fakeResponse(bytes)));
}));
test("mrpack applies client overrides, reports local/remote/optional before CAS and downloads with at most four workers", async () => directory(async dir => {
  const remoteBytes = new Map(Array.from({ length: 7 }, (_, i) => [`mods/remote${i}.jar`, Buffer.from(`mod ${i}`)]));
  const manifest = index([...remoteBytes].map(([path, bytes]) => remote(path, bytes, path.endsWith("0.jar") ? "optional" : "required")));
  manifest.files.push(remote("mods/server.jar", Buffer.from("server"), "unsupported"));
  const bytes = await archive({ "modrinth.index.json": Buffer.from(JSON.stringify(manifest)), "overrides/config/a.json": Buffer.from("old"),
    "client-overrides/config/a.json": Buffer.from("client"), "overrides/mods/local.jar": Buffer.from("local"), "server-overrides/mods/server.jar": Buffer.from("must exclude") });
  const source = join(dir, "source.mrpack"); await writeFile(source, bytes);
  let active = 0, maximum = 0, inspected = false, downloading = false; const stored: Buffer[] = [];
  const parsed = await parseClientPack(source, dir, [], null, bytes.length, () => {}, undefined, {
    onInspected: async (info, mods) => { inspected = true; assert.equal(stored.length, 0); assert.equal(mods.length, 8); assert(info.importFiles?.some(file => file.optional)); },
    onDownloading: async info => { downloading = true; assert(inspected); assert.equal(stored.length, 0); assert(info.importFiles?.some(file => file.source === "remote")); },
    downloadFile: async (file, path, _settings, signal, progress) => {
      assert(inspected); active++; maximum = Math.max(maximum, active); progress(1);
      await new Promise(resolve => setTimeout(resolve, 15)); signal.throwIfAborted(); const bytes = remoteBytes.get(file.path)!;
      await writeFile(path, bytes); active--; return { sha256: digest(bytes), size: bytes.length };
    },
    storeCas: async (_hash, path) => { assert(downloading); stored.push(await readFile(path)); return true; },
  });
  assert(parsed); assert.equal(maximum, 4); assert.equal(parsed.files.find(file => file.path === "mods/remote0.jar")?.optional, true);
  assert.equal(parsed.files.find(file => file.path === "config/a.json")?.sha256, digest(Buffer.from("client")));
  assert(!parsed.files.some(file => file.path.includes("server"))); assert(parsed.detectedInfo.importFiles?.every(file => file.status === "VERIFIED"));
}));
test("PCL outer executable is ignored and nested mrpack uses the same adapter", async () => directory(async dir => {
  const nested = await archive({ "modrinth.index.json": Buffer.from(JSON.stringify(index())), "overrides/mods/a.jar": Buffer.from("mod") });
  const outer = await archive({ "modpack.mrpack": nested, "Plain Craft Launcher.exe": Buffer.from("never execute"), "PCL/Setup.ini": Buffer.from("setup") });
  const source = join(dir, "pcl.zip"); await writeFile(source, outer);
  const parsed = await parseClientPack(source, dir, [], null, outer.length, () => {}, undefined, { storeCas: async () => true });
  assert(parsed); assert.equal(parsed.detectedInfo.pack?.wrapper, "pcl"); assert.deepEqual(parsed.detectedMods, ["a.jar"]); assert.equal(parsed.files.length, 1);
}));
test("v2 retains complete remote declarations without downloading and stores only layered local overrides", async () => directory(async dir => {
  const declared = remote("mods/remote.jar", Buffer.from("remote"), "optional");
  declared.hashes = { ...declared.hashes, sha256: "1".repeat(64) } as typeof declared.hashes;
  const overridden = remote("mods/local.jar", Buffer.from("old remote"), "optional");
  const manifest = index([declared, overridden, remote("mods/server.jar", Buffer.from("server"), "unsupported")]);
  const source = join(dir, "v2.mrpack"); await writeFile(source, await archive({ "modrinth.index.json": Buffer.from(JSON.stringify(manifest)),
    "overrides/mods/local.jar": Buffer.from("old local"), "client-overrides/mods/local.jar": Buffer.from("winner"),
    "overrides/options.txt": Buffer.from("preserve"), "server-overrides/mods/server.jar": Buffer.from("ignored"),
    "overrides/PCL/config.json": Buffer.from("{}"), "overrides/PCL/Setup.ini": Buffer.from("launcher-only"),
    "overrides/launcher_accounts.json": Buffer.from("private") }));
  const stored: Buffer[] = []; let inspected = false;
  const parsed = await parseClientPack(source, dir, [], null, 0, () => {}, undefined, { packageFormatVersion: 2,
    downloadSettings: settings, downloadFile: async () => { assert.fail("v2 must not download remote binaries"); },
    onDownloading: async () => { assert.fail("v2 must not report download progress"); },
    onInspected: async info => { inspected = true; assert.equal(stored.length, 0); assert.equal(info.importFiles?.find(file => file.source === "remote")?.status, "DECLARED"); },
    storeCas: async (_sha, path) => { assert(inspected); stored.push(await readFile(path)); return true; } });
  assert(parsed && "recipeInventory" in parsed && parsed.recipeInventory); const inventory = parseRecipeInventory(parsed.recipeInventory);
  assert.equal(parsed.statistics, null); assert.deepEqual(stored, [Buffer.from("winner"), Buffer.from("preserve")]);
  assert.equal(inventory.files.length, 3); const local = inventory.files.find(file => file.path === "mods/local.jar")!;
  assert.equal(local.source.type, "local"); assert.equal(local.optional, true); assert.equal(local.hashes.sha256, digest(Buffer.from("winner")));
  const remoteFile = inventory.files.find(file => file.source.type === "remote")!; assert.deepEqual(remoteFile.hashes, declared.hashes);
  assert(!inventory.files.some(file => file.path.includes("server"))); assert.equal(inventory.files.find(file => file.path === "options.txt")?.policy, "preserve");
  assert.equal(parsed.detectedInfo.importFiles?.find(file => file.source === "remote")?.downloadedBytes, 0);
}));
test("v2 accepts remote-only and PCL inputs using the same recipe processor", async () => directory(async dir => {
  const inner = await archive({ "modrinth.index.json": Buffer.from(JSON.stringify(index([remote("mods/a.jar", Buffer.from("mod"))]))) });
  const source = join(dir, "pcl.zip"); await writeFile(source, await archive({ "modpack.mrpack": inner, "Plain Craft Launcher.exe": Buffer.from("ignored"), "PCL/Setup.ini": Buffer.from("setup") }));
  const parsed = await parseClientPack(source, dir, [], null, 1, () => {}, undefined, { packageFormatVersion: 2,
    storeCas: async () => { assert.fail("remote-only v2 has no CAS bytes"); }, downloadFile: async () => { assert.fail("v2 has no remote download"); } });
  assert(parsed && "recipeStatistics" in parsed); assert.equal(parsed.recipeStatistics?.localFiles, 0);
  assert.equal(parsed.recipeStatistics?.remoteFiles, 1); assert.equal(parsed.detectedInfo.pack?.wrapper, "pcl");
}));
test("v2 rejects unsafe recipes before CAS and cannot treat minecraft ZIP as a recipe", async () => directory(async dir => {
  const file = remote("mods/a.jar", Buffer.from("mod")); let cas = 0;
  const unsafe = [index([{ ...file, downloads: ["https://cdn.modrinth.com/a?X-Amz-Signature=secret"] }]),
    index([{ ...file, downloads: ["https://localhost/a"] }]), index([{ ...file, downloads: ["https://127.0.0.1/a"] }]),
    index([{ ...file, path: "runtime/a.jar" }]), index([file, { ...file, path: "mods/b.jar", fileSize: 99 }]),
    { ...index(), files: [{ ...file, hashes: { sha1: file.hashes.sha1 } }] }];
  for (let i = 0; i < unsafe.length; i++) {
    const source = join(dir, `bad-${i}.mrpack`); await writeFile(source, await archive({ "modrinth.index.json": Buffer.from(JSON.stringify(unsafe[i])), "overrides/config/local.txt": Buffer.from("not stored") }));
    await assert.rejects(parseClientPack(source, dir, [], null, 1, () => {}, undefined, { packageFormatVersion: 2, storeCas: async () => { cas++; return true; } }));
  }
  const source = join(dir, "minecraft.zip"); await writeFile(source, await archive({ ".minecraft/mods/local.jar": Buffer.from("local") }));
  await assert.rejects(parseClientPack(source, dir, [], null, 1, () => {}, undefined, { packageFormatVersion: 2, storeCas: async () => { cas++; return true; } }));
  const allowed = join(dir, "allowed.mrpack"); await writeFile(allowed, await archive({ "modrinth.index.json": Buffer.from(JSON.stringify(index([file]))) }));
  await assert.rejects(parseClientPack(allowed, dir, [], null, 1, () => {}, undefined, { packageFormatVersion: 2,
    downloadSettings: { ...settings, remoteSourceWhitelistEnabled: true, remoteSourceHosts: ["different.example"] } }));
  assert.equal(cas, 0);
}));
test("failed remote integrity cannot produce a ready inventory or write CAS", async () => directory(async dir => {
  const bytes = Buffer.from("mod"), declared = remote("mods/a.jar", bytes, "optional");
  const source = join(dir, "bad.mrpack"); await writeFile(source, await archive({ "modrinth.index.json": Buffer.from(JSON.stringify(index([declared]))) }));
  let cas = 0;
  await assert.rejects(parseClientPack(source, dir, [], null, 1, () => {}, undefined, {
    downloadFile: (file, path, settings, signal, progress) => downloadRemoteFile(file, path, settings, signal, progress, async () => fakeResponse(Buffer.alloc(bytes.length))),
    storeCas: async () => { cas++; return true; },
  })); assert.equal(cas, 0);
}));
test("optional flags are signed, included in full payload and carried by metadata-only updates", () => {
  const base = muaFixture(), next = muaFixture("1.0.1");
  next.manifest.files = structuredClone(base.manifest.files); next.manifest.mods[0].optional = true;
  next.manifest.files.find(file => file.path === "mods/example.jar")!.optional = true;
  const bytes = encodeMuaJson(next.manifest); muaPlatformManifestSchema.parse(next.manifest);
  const full = createMuaPackMetadata(bytes, null, "retain"), update = createMuaPackMetadata(bytes, base.targetBytes, "retain");
  assert(full.payload.some(object => object.sha256 === next.manifest.files.find(file => file.path === "mods/example.jar")!.sha256));
  assert.equal(update.changes.policyChanged[0].after.optional, true); assert.equal(update.payload.length, 1);
  const key = generateKeyPairSync("ed25519").privateKey, metadata = encodeMuaJson(full), signature = signMuaPackMetadata(metadata, key);
  verifyMuaPackSignature(metadata, signature, createPublicKey(key));
  const inconsistent = structuredClone(next.manifest); inconsistent.mods[0].optional = false; assert.throws(() => muaPlatformManifestSchema.parse(inconsistent));
});

const openssl = process.platform === "win32" ? "C:/Program Files/Git/usr/bin/openssl.exe" : "openssl";
test("CONNECT proxy pins public addresses, verifies TLS and rejects private or nonwhitelisted redirects", { skip: spawnSync(openssl, ["version"]).status !== 0, timeout: 20000 }, async () => directory(async dir => {
  const cert = join(dir, "certificate.pem"), key = join(dir, "key.pem");
  const generated = spawnSync(openssl, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=1.1.1.1", "-addext", "subjectAltName=IP:1.1.1.1,DNS:dual-stack.example", "-keyout", key, "-out", cert], { windowsHide: true });
  assert.equal(generated.status, 0, generated.stderr?.toString());
  const bytes = Buffer.from("proxy verified bytes"), connections: string[] = [];
  const upstream = https.createServer({ key: await readFile(key), cert: await readFile(cert) }, (request, response) => {
    if (request.url?.startsWith("/dns-query?")) {
      const url = new URL(request.url, "https://1.1.1.1"), privateAnswer = url.searchParams.get("name") === "mixed-private.example";
      response.writeHead(200, { "Content-Type": "application/dns-json" }); response.end(JSON.stringify({ Status: 0,
        Answer: url.searchParams.get("type") === "A" ? [{ type: 1, TTL: 60, data: privateAnswer ? "10.0.0.1" : "1.1.1.1" }] : [] }));
    } else if (request.url === "/private") { response.writeHead(302, { Location: "https://127.0.0.1/private" }); response.end(); }
    else if (request.url === "/unlisted") { response.writeHead(302, { Location: "https://1.0.0.1/file" }); response.end(); }
    else { response.writeHead(200, { "Content-Length": bytes.length }); response.end(bytes); }
  });
  const proxy = http.createServer();
  proxy.on("connect", (request, socket, head) => { connections.push(request.url!); socket.write("HTTP/1.1 200 Connection Established\r\n\r\n"); if (head.length) socket.unshift(head); upstream.emit("connection", socket); });
  await new Promise<void>(resolve => proxy.listen(0, "127.0.0.1", resolve));
  const port = (proxy.address() as { port: number }).port;
  const source = `
    process.env.DOWNLOAD_DNS_OVER_HTTPS='false';
    import assert from 'node:assert/strict';
    import dns from 'node:dns';
    import {syncBuiltinESMExports} from 'node:module';
    const lookup = dns.promises.lookup;
    dns.promises.lookup = async (host, options) => host === 'dual-stack.example' ? [{address:'2606:4700::1111',family:6},{address:'1.1.1.1',family:4}] :
      host === 'mixed-private.example' ? [{address:'1.1.1.1',family:4},{address:'10.0.0.1',family:4}] : lookup(host, options);
    syncBuiltinESMExports();
    const imported = await import(${JSON.stringify(pathToFileURL(resolve("src/lib/remote-download.ts")).href)});
    const {downloadRemoteFile} = imported.default ?? imported;
    const settings=${JSON.stringify({ ...settings, downloadProxyEnabled: true, downloadProxyUrl: `http://127.0.0.1:${port}` })};
    const file=${JSON.stringify(remote("mods/proxy.jar", bytes))};
    file.downloads=['https://1.1.1.1/good'];
    const result=await downloadRemoteFile(file,${JSON.stringify(join(dir, "downloaded"))},settings,new AbortController().signal,()=>{});
    assert.equal(result.sha256,${JSON.stringify(digest(bytes))});
    file.downloads=['https://dual-stack.example/good'];
    assert.equal((await downloadRemoteFile(file,${JSON.stringify(join(dir, "dual-stack"))},settings,new AbortController().signal,()=>{})).sha256,${JSON.stringify(digest(bytes))});
    file.downloads=['https://mixed-private.example/good'];
    await assert.rejects(downloadRemoteFile(file,${JSON.stringify(join(dir, "mixed-private"))},settings,new AbortController().signal,()=>{}),/私有网络/);
    file.downloads=['https://1.1.1.1/private'];
    await assert.rejects(downloadRemoteFile(file,${JSON.stringify(join(dir, "private"))},settings,new AbortController().signal,()=>{}),/禁止下载/);
    file.downloads=['https://1.1.1.1/unlisted'];
    await assert.rejects(downloadRemoteFile(file,${JSON.stringify(join(dir, "unlisted"))},{...settings,remoteSourceWhitelistEnabled:true,remoteSourceHosts:['1.1.1.1']},new AbortController().signal,()=>{}),/未获允许/);
    process.env.DOWNLOAD_DNS_OVER_HTTPS='true';
    file.downloads=['https://dual-stack.example/good'];
    assert.equal((await downloadRemoteFile(file,${JSON.stringify(join(dir, "encrypted-dns"))},settings,new AbortController().signal,()=>{})).sha256,${JSON.stringify(digest(bytes))});
    file.downloads=['https://mixed-private.example/good'];
    await assert.rejects(downloadRemoteFile(file,${JSON.stringify(join(dir, "encrypted-private"))},settings,new AbortController().signal,()=>{}),/私有或保留地址/);
    console.log('proxy verified');
  `;
  const child = spawn(process.execPath, ["--conditions=react-server", "--import", "tsx", "--input-type=module", "-e", source],
    { windowsHide: true, env: { ...process.env, NODE_EXTRA_CA_CERTS: cert }, stdio: ["ignore", "pipe", "pipe"] });
  let output = ""; child.stdout.on("data", chunk => output += chunk); child.stderr.on("data", chunk => output += chunk);
  try {
    const exitCode = await new Promise<number | null>((resolve, reject) => { child.once("exit", resolve); child.once("error", reject); });
    assert.equal(exitCode, 0, output); assert.match(output, /proxy verified/); assert(connections.length >= 3); assert(connections.every(target => target === "1.1.1.1:443"));
  } finally { child.kill(); proxy.closeAllConnections(); await new Promise<void>(resolve => proxy.close(() => resolve())); upstream.closeAllConnections(); }
}));
