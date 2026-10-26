import { diagnosticText } from "@/lib/diagnostics";
import "server-only";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { environmentsBucket, casKey, readObject, storageClient, missingObject } from "./storage";
import { putImmutableBytes, storedHead, downloadStoredFile } from "./package-storage";
import { createEnvironmentDownloader } from "./environment-download";
import { workerDownloadSettings, type DownloadSettings } from "./download-settings";
import { unpackEnvironment } from "./environment-archive";
import { encodeMuaJson, decodeMuaJson, muaDigest } from "./muapack-protocol";
import { muaEnvironmentManifestSchema, muaLaunchSchema, type MuaPlatform, type MuaFile } from "./muapack-contract";
import { safePackPath } from "./pack-path";
import { invariant } from "./errors";
import { createReadStream } from "node:fs";
import { workerPrisma as prisma } from "./prisma";
import { prepareForgeInstaller, installForgeClient, forgeArtifactPath } from "./forge-installer";
import { executionProfileIdentity } from "./execution-policy";
import { managedExecution, type ExecutionContext } from "./execution-management";

const VERSION = "mirrors-jre-2";
const resolverVersion = (request: EnvironmentRequest) => request.loader && ["forge", "neoforge"].includes(request.loader.type) ? `forge-execution-2-${request.execution?.mode ?? "DOCKER_GVISOR"}-${request.execution?.profile ?? executionProfileIdentity()}` : VERSION;
const ruleSchema = z.object({ action: z.enum(["allow", "disallow"]), os: z.object({ name: z.string().optional(), arch: z.string().optional(), version: z.string().optional() }).optional(), features: z.record(z.string(), z.boolean()).optional() });
type Rule = z.infer<typeof ruleSchema>;
export function environmentRules(rules: Rule[] | undefined, platform: MuaPlatform) {
  if (!rules) return true; let allowed = false;
  const [system, arch] = platform.split("-"); const os = system === "macos" ? "osx" : system;
  for (const rule of rules) {
    // Version-dependent OS rules cannot be resolved from the six platform identifiers.
    if (rule.os?.version) throw new Error(diagnosticText("diagnostics.environmentResolver.thisEnvironmentHasOsVersionRulesAndCannotBePackaged"));
    if (rule.os?.name && rule.os.name !== os) continue;
    if (rule.os?.arch && !(arch === "amd64" ? ["x86_64", "amd64", "x64"] : ["aarch64", "arm64"]).includes(rule.os.arch)) continue;
    if (rule.features && Object.entries(rule.features).some(([, expected]) => expected)) continue;
    allowed = rule.action === "allow";
  }
  return allowed;
}
const downloadSchema = z.object({ url: z.string().url(), sha1: z.string().regex(/^[a-f0-9]{40}$/), size: z.number().int().nonnegative(), path: z.string().optional() });
const librarySchema = z.object({ name: z.string(), url: z.string().optional(), rules: z.array(ruleSchema).optional(),
  downloads: z.object({ artifact: downloadSchema.optional(), classifiers: z.record(z.string(), downloadSchema).optional() }).optional(), natives: z.record(z.string(), z.string()).optional() });
const argumentSchema = z.union([z.string(), z.object({ rules: z.array(ruleSchema), value: z.union([z.string(), z.array(z.string())]) })]);
const profileSchema = z.object({ id: z.string(), mainClass: z.string(), libraries: z.array(librarySchema),
  javaVersion: z.object({ majorVersion: z.number().int() }).optional(), minecraftArguments: z.string().optional(),
  arguments: z.object({ jvm: z.array(argumentSchema).optional(), game: z.array(argumentSchema).optional() }).optional(),
  downloads: z.object({ client: downloadSchema, client_mappings: downloadSchema.optional() }).optional(), assetIndex: downloadSchema.extend({ id: z.string() }).optional() });
const resolvedSchema = z.object({ minecraft: z.string(), loader: z.object({ type: z.enum(["fabric", "quilt", "forge", "neoforge"]), version: z.string() }).nullable(),
  java: z.object({ major: z.number().int(), vendor: z.string(), version: z.string(), build: z.string(), imageType: z.enum(["jre", "jdk"]), executable: z.string(), manifestSha256: z.string() }),
  environments: z.array(z.object({ kind: z.enum(["minecraft", "loader", "java"]), sha256: z.string() })), files: z.array(z.object({ root: z.enum(["instance", "java"]), path: z.string(), sha256: z.string(), size: z.number().int(), policy: z.enum(["managed", "preserve"]), executable: z.boolean() })), launch: muaLaunchSchema });
export type ResolvedEnvironment = z.infer<typeof resolvedSchema>;
export type EnvironmentRequest = { minecraft: string; javaMajor: number; loader: ResolvedEnvironment["loader"]; platform: MuaPlatform; execution?: ExecutionContext };
export type EnvironmentResolver = (request: EnvironmentRequest, directory: string, signal: AbortSignal, progress: (phase: string) => Promise<void>) => Promise<ResolvedEnvironment>;
async function storeFile(sha256: string, path: string, size: number) {
  const bucket = environmentsBucket(), key = casKey(sha256); const found = await storedHead(bucket, key);
  if (found) { invariant(found.ContentLength === size && found.Metadata?.sha256 === sha256, 422, diagnosticText("diagnostics.environmentResolver.environmentCacheObjectDoesNotMatch")); return; }
  try { await storageClient().putObject({ Bucket: bucket, Key: key, Body: createReadStream(path), ContentLength: size,
    Metadata: { sha256 }, ChecksumSHA256: Buffer.from(sha256, "hex").toString("base64"), IfNoneMatch: "*" }); }
  catch (error) { if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 412) throw error; }
}
async function mapConcurrent<T>(items: T[], work: (item: T, index: number) => Promise<void>) {
  let next = 0, stopped = false; const results = await Promise.allSettled(Array.from({ length: Math.min(4, items.length) }, async () => {
    while (!stopped && next < items.length) { const at = next++; try { await work(items[at], at); } catch (error) { stopped = true; throw error; } }
  })); for (const result of results) if (result.status === "rejected") throw result.reason;
}
export const resolveEnvironment: EnvironmentResolver = async (request, directory, signal, progress) => {
  const settings = await workerDownloadSettings(prisma);
  const identity = environmentCacheIdentity(request, settings.javaImageType);
  const lock = Buffer.from(identity.slice(0, 8), "hex").readInt32BE();
  // A separate environment lock coalesces equal requests without holding the management lock.
  return prisma.$transaction(async db => {
    await db.$executeRaw`SELECT pg_advisory_xact_lock(731405, ${lock}::integer)`;
    signal.throwIfAborted(); return resolveOfficialEnvironment(request, directory, signal, progress, settings);
  }, { maxWait: 10000, timeout: 2 * 60 * 60 * 1000 });
};
export function environmentCacheIdentity(request: EnvironmentRequest, imageType: "jre" | "jdk") {
  return muaDigest(encodeMuaJson({ resolver: resolverVersion(request), imageType, minecraft: request.minecraft, javaMajor: request.javaMajor, loader: request.loader, platform: request.platform }));
}
async function resolveOfficialEnvironment(request: EnvironmentRequest, directory: string, signal: AbortSignal, progress: (phase: string) => Promise<void>, settings: DownloadSettings) {
  const cacheKey = `cache/${environmentCacheIdentity(request, settings.javaImageType)}.json`;
  const downloader = createEnvironmentDownloader(settings);
  try {
    const bytes = await readObject(cacheKey, environmentsBucket(), 16 * 1024 ** 2); const head = await storedHead(environmentsBucket(), cacheKey);
    invariant(head?.Metadata?.sha256 === muaDigest(bytes), 422, diagnosticText("diagnostics.environmentResolver.environmentCacheIndexDigestDoesNotMatch"));
    const cached = resolvedSchema.parse(decodeMuaJson(bytes));
    invariant(cached.minecraft === request.minecraft && cached.java.major === request.javaMajor && cached.java.imageType === settings.javaImageType && JSON.stringify(cached.loader) === JSON.stringify(request.loader), 422, diagnosticText("diagnostics.environmentResolver.environmentCacheIdentityDoesNotMatch"));
    await progress(diagnosticText("diagnostics.environmentResolver.reusingVerifiedEnvironmentCache")); return cached;
  } catch (error) { if (!missingObject(error)) throw error; }
  const files: MuaFile[] = []; const environments: ResolvedEnvironment["environments"] = []; const classpath: string[] = [];
  const common = { format: "mua-environment-manifest", formatVersion: 1, resolverVersion: resolverVersion(request), platform: request.platform };
  async function document(value: unknown) {
    const parsed = muaEnvironmentManifestSchema.parse(value); const bytes = encodeMuaJson(parsed); const sha256 = muaDigest(bytes);
    await putImmutableBytes(environmentsBucket(), `manifests/${sha256}.json`, bytes); environments.push({ kind: parsed.kind, sha256 }); files.push(...parsed.files);
    return sha256;
  }
  async function remote(path: string, url: string, expected: { hash: string; algorithm: "sha1" | "sha256"; size?: number }, root: MuaFile["root"] = "instance") {
    const local = join(directory, randomUUID()); const sourceKey = `sources/${expected.algorithm}/${expected.hash}.json`;
    let stored: { sha256: string; size: number };
    try {
      const bytes = await readObject(sourceKey, environmentsBucket(), 1024), head = await storedHead(environmentsBucket(), sourceKey);
      invariant(head?.Metadata?.sha256 === muaDigest(bytes), 422, diagnosticText("diagnostics.environmentResolver.sourceCacheIndexValidationFailed"));
      stored = z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/), size: z.number().int().nonnegative().max(2 * 1024 ** 3) }).parse(decodeMuaJson(bytes));
      invariant(expected.size === undefined || stored.size === expected.size, 422, diagnosticText("diagnostics.environmentResolver.sourceCacheSizeDoesNotMatch"));
      await downloadStoredFile(environmentsBucket(), casKey(stored.sha256), local, stored.sha256, stored.size, signal);
    } catch (error) {
      if (!missingObject(error)) throw error;
      stored = await downloader.download(url, local, signal, expected); await storeFile(stored.sha256, local, stored.size);
      await putImmutableBytes(environmentsBucket(), sourceKey, encodeMuaJson(stored));
    }
    return { file: { root, path: safePackPath(path), ...stored, policy: "managed" as const, executable: false }, local };
  }
  async function storeLocal(path: string, local: string): Promise<MuaFile> {
    const { createHash } = await import("node:crypto"); const hash = createHash("sha256"); let size = 0;
    for await (const bytes of createReadStream(local)) { signal.throwIfAborted(); size += bytes.length; invariant(size <= 2 * 1024 ** 3, 422, diagnosticText("diagnostics.environmentResolver.theLoaderFileIsTooLarge")); hash.update(bytes); }
    const sha256 = hash.digest("hex"); await storeFile(sha256, local, size);
    return { root: "instance", path: safePackPath(path), sha256, size, policy: "managed", executable: false };
  }
  const indexSchema = z.object({ versions: z.array(z.object({ id: z.string(), url: z.string().url(), sha1: z.string().regex(/^[a-f0-9]{40}$/) })) });
  const indexBytes = await downloader.bytes("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json", signal, undefined,
    { validate: bytes => { const index = indexSchema.parse(JSON.parse(bytes.toString("utf8"))); invariant(index.versions.some(value => value.id === request.minecraft), 422, diagnosticText("diagnostics.environmentResolver.theMirrorVersionCatalogHasNotSynchronizedTheRequestedMinecraft")); } });
  const index = indexSchema.parse(JSON.parse(indexBytes.toString("utf8")));
  const version = index.versions.find(value => value.id === request.minecraft); invariant(version, 422, diagnosticText("diagnostics.environmentResolver.theOfficialMinecraftVersionDoesNotExist"));
  const source = await downloader.bytes(version.url, signal, undefined, { expected: { algorithm: "sha1", hash: version.sha1 },
    validate: bytes => { const profile = profileSchema.parse(JSON.parse(bytes.toString("utf8"))); invariant(profile.id === request.minecraft, 422, diagnosticText("diagnostics.environmentResolver.minecraftMetadataVersionDoesNotMatch")); } });
  const game = profileSchema.parse(JSON.parse(source.toString("utf8"))); invariant(game.downloads?.client && game.assetIndex, 422, diagnosticText("diagnostics.environmentResolver.thisGameVersionHasNoClientOrAssetIndex"));
  invariant(request.javaMajor >= (game.javaVersion?.majorVersion ?? 8), 422, diagnosticText("diagnostics.environmentResolver.theSelectedJavaVersionIsBelowMinecraftSOfficialRequirement"));
  const [system, architecture] = request.platform.split("-"); const os = system === "macos" ? "mac" : system; const arch = architecture === "amd64" ? "x64" : "aarch64";
  const javaBytes = await downloader.bytes(`https://api.adoptium.net/v3/assets/latest/${request.javaMajor}/hotspot?architecture=${arch}&image_type=${settings.javaImageType}&os=${os}&vendor=eclipse`, signal);
  const javaVersions = z.array(z.object({ release_name: z.string(), binary: z.object({ architecture: z.string(), os: z.string(), image_type: z.enum(["jre", "jdk"]),
    package: z.object({ link: z.string(), checksum: z.string().regex(/^[a-f0-9]{64}$/), name: z.string(), size: z.number().int().positive() }) }) })).parse(JSON.parse(javaBytes.toString("utf8")));
  const java = javaVersions.find(value => value.binary.architecture === arch && value.binary.os === os && value.binary.image_type === settings.javaImageType);
  invariant(java, 422, diagnosticText("diagnostics.environmentResolver.java0HasNo2For1ChangeThePlatform", { arg0: request.javaMajor, arg1: request.platform, arg2: settings.javaImageType.toUpperCase() }));
  const nativeCompatible = (name: string) => {
    const match = /:natives-(windows|linux|macos)(?:-([^:]+))?$/.exec(name);
    return !match || match[1] === system && (architecture === "aarch64" ? ["arm64", "aarch64"].includes(match[2]) : !match[2] || match[2] === "patch");
  };
  const nativeGroups = new Map<string, boolean>();
  for (const library of game.libraries.filter(library => environmentRules(library.rules, request.platform))) {
    if (library.natives?.[system === "macos" ? "osx" : system] && architecture === "aarch64" && !/arm64|aarch64/.test(library.natives[system === "macos" ? "osx" : system])) throw new Error(diagnosticText("diagnostics.environmentResolver.minecraft0HasNoOfficialNativeLibraryFor1", { arg0: request.minecraft, arg1: request.platform }));
    const match = /^(.*):natives-(windows|linux|macos)(?:-[^:]+)?$/.exec(library.name);
    if (match) nativeGroups.set(match[1], (nativeGroups.get(match[1]) ?? false) || nativeCompatible(library.name));
  }
  invariant([...nativeGroups.values()].every(Boolean), 422, diagnosticText("diagnostics.environmentResolver.minecraft0HasNoOfficialNativeLibraryFor1A", { arg0: request.minecraft, arg1: request.platform }));
  const gameFiles: MuaFile[] = [];
  await progress(diagnosticText("diagnostics.environmentResolver.downloadingMinecraftAndPlatformDependencies"));
  const jarPath = `versions/${request.minecraft}/${request.minecraft}.jar`;
  const gameJar = await remote(jarPath, game.downloads.client.url, { algorithm: "sha1", hash: game.downloads.client.sha1, size: game.downloads.client.size });
  gameFiles.push(gameJar.file); classpath.push(jarPath);
  async function libraries(libraries: z.infer<typeof librarySchema>[], output: MuaFile[]) {
    let hasNative = false, platformNative = false;
    await mapConcurrent(libraries, async library => {
      if (!environmentRules(library.rules, request.platform)) return;
      const [system, arch] = request.platform.split("-"); const os = system === "macos" ? "osx" : system;
      const nativeName = /:natives-(windows|linux|macos)(?:-([^:]+))?$/.exec(library.name);
      if (nativeName) {
        hasNative = true; const nativeOS = system === "macos" ? "macos" : system;
        if (nativeName[1] !== nativeOS || !nativeCompatible(library.name)) return;
        platformNative = true;
      }
      const artifact = library.downloads?.artifact;
      if (!artifact && !library.downloads?.classifiers) {
        const match = /^([^:]+):([^:]+):([^:]+)(?::([^:]+))?$/.exec(library.name); invariant(match, 422, diagnosticText("diagnostics.environmentResolver.invalidLoaderMavenCoordinates"));
        const path = `${match[1].replaceAll(".", "/")}/${match[2]}/${match[3]}/${match[2]}-${match[3]}${match[4] ? `-${match[4]}` : ""}.jar`;
        const url = `${library.url ?? "https://libraries.minecraft.net/"}${path}`;
        const sha1 = (await downloader.bytes(`${url}.sha1`, signal, 1024, { validate: bytes => invariant(/^[a-f0-9]{40}$/.test(bytes.toString("utf8").trim().split(/\s/)[0]), 422, diagnosticText("diagnostics.environmentResolver.theLoaderLibraryHasNoSha1")) })).toString("utf8").trim().split(/\s/)[0];
        const downloaded = await remote(`libraries/${path}`, url, { algorithm: "sha1", hash: sha1 }); output.push(downloaded.file); classpath.push(downloaded.file.path);
      } else if (artifact) {
        invariant(artifact.path, 422, diagnosticText("diagnostics.environmentResolver.theGameLibraryHasNoInstallationPath")); const downloaded = await remote(`libraries/${artifact.path}`, artifact.url, { algorithm: "sha1", hash: artifact.sha1, size: artifact.size });
        output.push(downloaded.file); classpath.push(downloaded.file.path);
        if (nativeName) await extractNatives(downloaded.local, output);
      }
      if (library.natives?.[os]) {
        hasNative = true; const classifier = library.natives[os].replace("${arch}", "64");
        invariant(arch === "amd64" || /arm64|aarch64/.test(classifier), 422, diagnosticText("diagnostics.environmentResolver.minecraft0HasNoOfficialNativeLibraryFor1Detail", { arg0: request.minecraft, arg1: request.platform }));
        const native = library.downloads?.classifiers?.[classifier]; invariant(native, 422, diagnosticText("diagnostics.environmentResolver.theMinecraftNativeLibraryDoesNotExist")); platformNative = true;
        const downloaded = await remote(`libraries/${native.path ?? `${library.name.replaceAll(":", "-")}-${classifier}.jar`}`, native.url, { algorithm: "sha1", hash: native.sha1, size: native.size });
        output.push(downloaded.file); await extractNatives(downloaded.local, output);
      }
    });
    invariant(!hasNative || platformNative, 422, diagnosticText("diagnostics.environmentResolver.minecraft0HasNoOfficialNativeLibraryFor1Detail", { arg0: request.minecraft, arg1: request.platform }));
  }
  async function extractNatives(local: string, output: MuaFile[]) {
    const folder = join(directory, randomUUID()); await mkdir(folder); const extracted = await unpackEnvironment(local, folder, "zip", false, signal);
    for (const entry of extracted) { await storeFile(entry.sha256, entry.local, entry.size); output.push({ root: "instance", path: `natives/${entry.path}`, sha256: entry.sha256, size: entry.size, policy: "managed", executable: entry.executable }); }
  }
  await libraries(game.libraries, gameFiles);
  await progress(diagnosticText("diagnostics.environmentResolver.downloadingAndCachingMinecraftAssets"));
  const assets = await remote(`assets/indexes/${game.assetIndex.id}.json`, game.assetIndex.url, { algorithm: "sha1", hash: game.assetIndex.sha1, size: game.assetIndex.size }); gameFiles.push(assets.file);
  const assetsBytes = await readObject(casKey(assets.file.sha256), environmentsBucket(), 16 * 1024 ** 2);
  const assetIndex = z.object({ objects: z.record(z.string(), z.object({ hash: z.string().regex(/^[a-f0-9]{40}$/), size: z.number().int().nonnegative().max(2 * 1024 ** 3) })), virtual: z.boolean().optional(), map_to_resources: z.boolean().optional() }).parse(JSON.parse(assetsBytes.toString("utf8")));
  invariant(Object.keys(assetIndex.objects).length <= 60000, 422, diagnosticText("diagnostics.environmentResolver.tooManyGameAssets"));
  let done = 0; const assetsByHash = [...new Map(Object.values(assetIndex.objects).map(item => [item.hash, item])).values()];
  await mapConcurrent(assetsByHash, async asset => {
    const prefix = asset.hash.slice(0, 2); const downloaded = await remote(`assets/objects/${prefix}/${asset.hash}`, `https://resources.download.minecraft.net/${prefix}/${asset.hash}`, { algorithm: "sha1", hash: asset.hash, size: asset.size }); gameFiles.push(downloaded.file);
    done++; if (done % 100 === 0) await progress(diagnosticText("diagnostics.environmentResolver.downloadingMinecraftAssets01", { arg0: done, arg1: assetsByHash.length }));
  });
  if (assetIndex.virtual || assetIndex.map_to_resources) {
    const byHash = new Map(gameFiles.filter(file => file.path.startsWith("assets/objects/")).map(file => [file.path.split("/").at(-1), file]));
    for (const [path, asset] of Object.entries(assetIndex.objects)) {
      const file = byHash.get(asset.hash)!;
      if (assetIndex.virtual) gameFiles.push({ ...file, path: safePackPath(`assets/virtual/${game.assetIndex.id}/${path}`) });
      if (assetIndex.map_to_resources) gameFiles.push({ ...file, path: safePackPath(`resources/${path}`) });
    }
  }
  // Preserve upstream profile for launcher interoperability, while platform manifest locks all bytes.
  const profilePath = `versions/${request.minecraft}/${request.minecraft}.json`; const profileLocal = join(directory, randomUUID()); await writeFile(profileLocal, source);
  await storeFile(muaDigest(source), profileLocal, source.length); gameFiles.push({ root: "instance", path: profilePath, sha256: muaDigest(source), size: source.length, policy: "managed", executable: false });
  function unique(values: MuaFile[]) { const map = new Map<string, MuaFile>(); for (const file of values) {
    const key = `${file.root}/${file.path}`; const old = map.get(key); invariant(!old || old.sha256 === file.sha256, 422, diagnosticText("diagnostics.environmentResolver.conflictingPlatformEnvironmentFiles")); map.set(key, file); }
    return [...map.values()].sort((a, b) => a.path < b.path ? -1 : 1); }
  await document({ ...common, kind: "minecraft", minecraft: request.minecraft, sourceMetadataSha256: muaDigest(source), files: unique(gameFiles) });
  let loaderProfile: z.infer<typeof profileSchema> | null = null;
  if (request.loader) {
    await progress(diagnosticText("diagnostics.environmentResolver.downloading01", { arg0: request.loader.type, arg1: request.loader.version }));
    if (request.loader.type === "forge" || request.loader.type === "neoforge") {
      const prepared = await prepareForgeInstaller(request.loader.type, request.minecraft, request.loader.version, directory, signal, { downloader, remote, store: storeLocal,
        ...(request.execution ? { execute: managedExecution(request.execution) } : {}) });
      // Forge validates and installs its own libraries, including embedded jars
      // with an empty download URL. Only coordinates are needed for overrides.
      loaderProfile = profileSchema.parse({ ...prepared.profile, libraries: prepared.profile.libraries.map(library => ({ name: library.name })) });
      const installed = await installForgeClient(prepared, gameJar.local, game.downloads.client_mappings, signal, progress);
      if (installed.execution) await putImmutableBytes(environmentsBucket(), `executions/${installed.execution.executionId}.json`, encodeMuaJson(installed.execution));
      const overrides = new Set(loaderProfile.libraries.map(library => library.name.split(":").filter((_, index) => index !== 2).join(":")));
      const removed = new Set(game.libraries.filter(library => overrides.has(library.name.split(":").filter((_, index) => index !== 2).join(":")))
        .map(library => `libraries/${library.downloads?.artifact?.path ?? forgeArtifactPath(library.name)}`));
      for (let index = classpath.length - 1; index >= 0; index--) if (removed.has(classpath[index])) classpath.splice(index, 1);
      classpath.push(...installed.classpath);
      const local = join(directory, randomUUID()); await writeFile(local, prepared.bytes);
      installed.files.push(await storeLocal(`versions/${safePackPath(loaderProfile.id)}/${safePackPath(loaderProfile.id)}.json`, local));
      await document({ ...common, kind: "loader", minecraft: request.minecraft, loader: request.loader, sourceMetadataSha256: prepared.installer.file.sha256, files: unique(installed.files) });
    } else {
    const base = request.loader.type === "fabric" ? "https://meta.fabricmc.net/v2" : "https://meta.quiltmc.org/v3";
    const bytes = await downloader.bytes(`${base}/versions/loader/${encodeURIComponent(request.minecraft)}/${encodeURIComponent(request.loader.version)}/profile/json`, signal, undefined,
      { validate: bytes => { profileSchema.parse(JSON.parse(bytes.toString("utf8"))); } });
    loaderProfile = profileSchema.parse(JSON.parse(bytes.toString("utf8"))); const loaderFiles: MuaFile[] = []; await libraries(loaderProfile.libraries, loaderFiles);
    await document({ ...common, kind: "loader", minecraft: request.minecraft, loader: request.loader, sourceMetadataSha256: muaDigest(bytes), files: unique(loaderFiles) });
    }
  }
  await progress(diagnosticText("diagnostics.environmentResolver.downloadingJava012", { arg0: request.javaMajor, arg1: settings.javaImageType.toUpperCase(), arg2: request.platform }));
  const archive = await remote("java-archive", java.binary.package.link, { algorithm: "sha256", hash: java.binary.package.checksum, size: java.binary.package.size }, "java");
  const folder = join(directory, randomUUID()); await mkdir(folder); const extracted = await unpackEnvironment(archive.local, folder, java.binary.package.name.endsWith(".zip") ? "zip" : "tar.gz", true, signal);
  const javaFiles: MuaFile[] = []; for (const entry of extracted) { await storeFile(entry.sha256, entry.local, entry.size);
    javaFiles.push({ root: "java", path: entry.path, sha256: entry.sha256, size: entry.size, policy: "managed", executable: entry.executable || /(?:^|\/)bin\/java(?:\.exe)?$/.test(entry.path) }); }
  const executable = system === "windows" ? "bin/java.exe" : system === "macos" ? "Contents/Home/bin/java" : "bin/java";
  const javaIdentity = { major: request.javaMajor, vendor: "Eclipse Adoptium", version: java.release_name, build: java.release_name, imageType: settings.javaImageType, executable };
  const javaSha = await document({ ...common, kind: "java", java: { ...javaIdentity, archiveSha256: java.binary.package.checksum }, files: javaFiles });
  const args = (values: z.infer<typeof argumentSchema>[] | undefined) => (values ?? []).flatMap(value => typeof value === "string" ? [value] : environmentRules(value.rules, request.platform) ? typeof value.value === "string" ? [value.value] : value.value : []);
  const launch = muaLaunchSchema.parse({ mainClass: loaderProfile?.mainClass ?? game.mainClass, classpath: [...new Set(classpath)].sort(),
    jvmArgs: [...(game.arguments?.jvm ? args(game.arguments.jvm) : ["-Djava.library.path=${natives_directory}", "-cp", "${classpath}"]), ...args(loaderProfile?.arguments?.jvm).map(arg => arg.startsWith("-DignoreList=") ? arg.replaceAll("${version_name}", request.minecraft) : arg)].filter(arg => !/^-Xm[sx]/i.test(arg)),
    gameArgs: loaderProfile?.minecraftArguments ? loaderProfile.minecraftArguments.split(/\s+/) : [...(game.arguments?.game ? args(game.arguments.game) : game.minecraftArguments?.split(/\s+/) ?? []), ...args(loaderProfile?.arguments?.game)],
    memory: { mode: "auto", minimumMiB: 1024, recommendedMiB: 4096 }, preLaunch: [] });
  const resolved = resolvedSchema.parse({ minecraft: request.minecraft, loader: request.loader, java: { ...javaIdentity, manifestSha256: javaSha }, environments, files: unique(files), launch });
  await putImmutableBytes(environmentsBucket(), cacheKey, encodeMuaJson(resolved)); return resolved;
}

export async function readEnvironmentDocuments(environment: Pick<ResolvedEnvironment, "environments">) {
  const documents = new Map<string, Buffer>();
  for (const ref of environment.environments) { const bytes = await readObject(`manifests/${ref.sha256}.json`, environmentsBucket(), 16 * 1024 ** 2);
    invariant(muaDigest(bytes) === ref.sha256, 422, diagnosticText("diagnostics.environmentResolver.cachedEnvironmentManifestValidationFailed")); muaEnvironmentManifestSchema.parse(decodeMuaJson(bytes)); documents.set(ref.sha256, bytes); }
  return documents;
}
