import { serializeError } from "@/lib/diagnostics";
import { diagnosticText } from "@/lib/diagnostics";
import "server-only";
import yauzl, { type Entry, type ZipFile } from "yauzl";
import crc32 from "crc-32";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { join } from "node:path";
import { invariant, AppError } from "./errors";
import { putCas } from "./storage";
import { MAX_MODS, type ClientInspection, type PackFile, type UpdateStatistics, type ImportFile } from "./client-contract";
import { inspectPackLayout, inspectPackMods, inspectPackRuntime } from "./pack-inspection";
import { inspectModrinthIndex } from "./modrinth-inspection";
import { downloadRemoteFile, remoteSourceUrl } from "./remote-download";
import { DEFAULT_REMOTE_HOSTS, type DownloadSettings } from "./download-settings";
import { DEFAULT_ENVIRONMENT_DOWNLOAD_SETTINGS } from "./download-sources";
import { safePackPath } from "./pack-path";
import { parseRecipeInventory, recipePath, type RecipeFile, type RecipeImportStatistics } from "./recipe-inventory";
export { safePackPath } from "./pack-path";

const MAX_FILES = 100000;
const MAX_EXPANDED = 40 * 1024 ** 3;
const MAX_FILE = 2 * 1024 ** 3;
export function filePolicy(path: string): PackFile["policy"] {
  return /^(?:versions\/[^/]+\/)?(?:options(?:of|shaders)?\.txt|servers\.dat(?:_old)?|saves\/)/i.test(path) ? "preserve" : "managed";
}
function excluded(path: string) {
  return /^(?:versions\/[^/]+\/)?(?:logs\/|crash-reports\/|screenshots\/|webcache(?:\/|$)|launcher_accounts\.json$|launcher_profiles\.json$|usercache\.json$|usernamecache\.json$|\.mua\/|\.launcher\/|\.hmcl\/|PCL\/)/i.test(path);
}
async function openZip(path: string) {
  return new Promise<ZipFile>((resolve, reject) => yauzl.open(path, { lazyEntries: true, autoClose: false, strictFileNames: true, validateEntrySizes: true }, (error, zip) => error ? reject(error) : resolve(zip!)));
}
async function entries(zip: ZipFile) {
  return new Promise<Entry[]>((resolve, reject) => {
    const found: Entry[] = []; let total = 0; let count = 0;
    const fail = (error: Error) => { zip.removeAllListeners("entry"); reject(error); };
    zip.once("error", fail);
    zip.on("entry", entry => {
      try {
        invariant(++count <= MAX_FILES, 422, diagnosticText("diagnostics.packParser.theZipContainsMoreThan100000Entries"));
        invariant(!entry.isEncrypted(), 422, diagnosticText("diagnostics.packParser.encryptedZipsAreNotSupported"));
        invariant(((entry.externalFileAttributes >>> 16) & 0xf000) !== 0xa000, 422, diagnosticText("diagnostics.packParser.symbolicLinksAreNotAllowedInZips"));
        invariant(entry.uncompressedSize <= MAX_FILE, 422, diagnosticText("diagnostics.packParser.aZipFileExceeds2Gib"));
        total += entry.uncompressedSize; invariant(total <= MAX_EXPANDED, 422, diagnosticText("diagnostics.packParser.theExtractedZipExceeds40Gib"));
        invariant(entry.uncompressedSize < 1024 * 1024 || entry.uncompressedSize <= Math.max(1, entry.compressedSize) * 1000, 422, diagnosticText("diagnostics.packParser.suspiciousZipCompressionRatio"));
        if (!entry.fileName.endsWith("/")) { safePackPath(entry.fileName); found.push(entry); }
        zip.readEntry();
      } catch (error) { fail(error as Error); }
    });
    zip.once("end", () => { zip.removeListener("error", fail); resolve(found); }); zip.readEntry();
  });
}
function openEntry(zip: ZipFile, entry: Entry) {
  return new Promise<NodeJS.ReadableStream>((resolve, reject) => zip.openReadStream(entry, (error, stream) => error ? reject(error) : resolve(stream!)));
}
async function readSmallJson(zip: ZipFile, entry: Entry, signal?: AbortSignal, maximum = 1024 ** 2) {
  invariant(entry.uncompressedSize <= maximum, 422, diagnosticText("diagnostics.packParser.packJsonExceedsTheSizeLimit"));
  const chunks: Buffer[] = []; let size = 0; let crc = 0;
  const stream = await openEntry(zip, entry);
  const abort = () => (stream as import("node:stream").Readable).destroy(new Error(diagnosticText("diagnostics.packParser.detectionWasInterrupted")));
  signal?.addEventListener("abort", abort, { once: true });
  try {
    signal?.throwIfAborted();
    for await (const chunk of stream) {
      signal?.throwIfAborted(); const bytes = Buffer.from(chunk); size += bytes.length;
      invariant(size <= entry.uncompressedSize && size <= maximum, 422, diagnosticText("diagnostics.packParser.invalidExpandedSizeForVersionJson")); crc = crc32.buf(bytes, crc); chunks.push(bytes);
    }
    invariant(size === entry.uncompressedSize && (crc >>> 0) === entry.crc32, 422, diagnosticText("diagnostics.packParser.versionJsonValidationFailed"));
    return JSON.parse(Buffer.concat(chunks).toString("utf8").replace(/^\uFEFF/, "")) as unknown;
  } finally { signal?.removeEventListener("abort", abort); }
}
async function readJarVersion(zip: ZipFile, entry: Entry, tempDirectory: string, signal?: AbortSignal) {
  invariant(entry.uncompressedSize <= 256 * 1024 ** 2, 422, diagnosticText("diagnostics.packParser.theGameJarExceeds256MibAndCannotBeSafely"));
  const path = join(tempDirectory, "metadata-game.jar"); let size = 0; let crc = 0;
  const meter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
    size += chunk.length; if (size > entry.uncompressedSize || size > 256 * 1024 ** 2) { callback(new Error(diagnosticText("diagnostics.packParser.invalidExpandedSizeForGameJar"))); return; }
    crc = crc32.buf(chunk, crc); callback(null, chunk);
  } });
  await pipeline(await openEntry(zip, entry), meter, createWriteStream(path), { signal });
  invariant(size === entry.uncompressedSize && (crc >>> 0) === entry.crc32, 422, diagnosticText("diagnostics.packParser.gameJarValidationFailed"));
  const jar = await openZip(path);
  try { const version = (await entries(jar)).find(entry => entry.fileName === "version.json"); return version ? await readSmallJson(jar, version, signal) : null; }
  finally { jar.close(); }
}
type InspectionOptions = {
  selectedInstanceId?: string | null;
  onInspecting?: () => Promise<void>;
  onInspected?: (info: ClientInspection, mods: string[]) => Promise<void>;
  storeCas?: typeof putCas;
  downloadSettings?: DownloadSettings;
  onDownloading?: (info: ClientInspection) => Promise<void>;
  onCas?: (info: ClientInspection) => Promise<void>;
  downloadFile?: typeof downloadRemoteFile;
  packageFormatVersion?: 1 | 2;
};
export function compareFiles(files: PackFile[], previous: PackFile[], newDataSize: number, previousVersion: string | null, sourceSize: number): UpdateStatistics {
  const before = new Map(previous.map(file => [file.path, file])); const after = new Set(files.map(file => file.path));
  const previousHashes = new Set(previous.map(file => file.sha256)); const required = new Map<string, number>(); const unique = new Map<string, number>();
  let addedFiles = 0; let modifiedFiles = 0;
  for (const file of files) {
    const old = before.get(file.path); unique.set(file.sha256, file.size);
    if (!old) addedFiles++; else if (old.sha256 !== file.sha256) modifiedFiles++;
    if ((file.policy === "managed" || !old) && !previousHashes.has(file.sha256)) required.set(file.sha256, file.size);
  }
  const totalUnique = [...unique.values()].reduce((sum, size) => sum + size, 0);
  return { previousVersion, addedFiles, modifiedFiles, deletedFiles: previous.filter(file => !after.has(file.path)).length,
    fullSize: files.reduce((sum, file) => sum + file.size, 0), newDataSize,
    estimatedDownloadSize: [...required.values()].reduce((sum, size) => sum + size, 0),
    casReusePercent: totalUnique ? Number(((1 - newDataSize / totalUnique) * 100).toFixed(2)) : 100,
    fileCount: files.length, sourceSize };
}
export async function parseClientPack(path: string, tempDirectory: string, previous: PackFile[], previousVersion: string | null,
  sourceSize: number, progress: (value: number) => void, signal?: AbortSignal, options: InspectionOptions = {}) {
  const zip = await openZip(path);
  try {
    const list = await entries(zip); const inspection = inspectPackLayout(list.map(entry => entry.fileName)); const prefix = inspection.rootPrefix;
    invariant(options.packageFormatVersion !== 2 || inspection.format === "modrinth" || inspection.format === "pcl", 422, diagnosticText("diagnostics.packParser.muapackV2SupportsOnlyMrpackOrWrappedPclPacksChoose"));
    if (inspection.format === "pcl") {
      const nested = list.filter(entry => /\.mrpack$/i.test(entry.fileName));
      invariant(nested.length === 1, 422, diagnosticText("diagnostics.packParser.aWrappedPclPackMustContainExactlyOneMrpack"));
      const nestedPath = join(tempDirectory, "pcl-inner.mrpack"); await extractEntry(zip, nested[0], nestedPath, signal);
      const inner = await openZip(nestedPath);
      try { return await parseModrinthZip(inner, await entries(inner), tempDirectory, previous, previousVersion, sourceSize, progress, signal, options, "pcl"); }
      finally { inner.close(); }
    }
    if (inspection.format === "modrinth") return await parseModrinthZip(zip, list, tempDirectory, previous, previousVersion, sourceSize, progress, signal, options, null);
    const files: PackFile[] = []; const seenPaths = new Set<string>(); const seenHashes = new Set<string>();
    // Validate all normalized paths and collisions before using any metadata or writing CAS.
    const normalized = new Map<string, Entry>();
    for (const entry of list) {
      if (!entry.fileName.startsWith(prefix)) continue;
      const target = safePackPath(entry.fileName.slice(prefix.length)); const folded = target.toLocaleLowerCase("en-US");
      invariant(!seenPaths.has(folded), 422, diagnosticText("diagnostics.packParser.theZipContainsDuplicateOrCaseConflictingFilePaths")); seenPaths.add(folded);
      normalized.set(target, entry);
    }
    await options.onInspecting?.();
    const info = await inspectPackRuntime(inspection.format, [...normalized.keys()], {
      json: target => readSmallJson(zip, normalized.get(target)!, signal),
      jar: target => readJarVersion(zip, normalized.get(target)!, tempDirectory, signal),
    }, options.selectedInstanceId);
    const keepVersions = new Set<string>(); const seenInstances = new Set<string>(); let instance = info.instanceId;
    while (instance && !seenInstances.has(instance) && seenInstances.size < 16) {
      seenInstances.add(instance);
      keepVersions.add(instance); const entry = normalized.get(`versions/${instance}/${instance}.json`);
      if (!entry) break;
      let json: { inheritsFrom?: unknown; jar?: unknown };
      try { json = await readSmallJson(zip, entry, signal) as typeof json; } catch (error) { if (!(error instanceof SyntaxError)) throw error; break; }
      if (typeof json.jar === "string" && !json.jar.includes("/")) keepVersions.add(json.jar);
      instance = typeof json.inheritsFrom === "string" ? json.inheritsFrom : null;
    }
    const retained = (target: string) => !excluded(target) && (!info.instanceId || !target.startsWith("versions/") || keepVersions.has(target.split("/")[1]));
    const detectedMods = info.requiresSelection ? [] : inspectPackMods(inspection.format, [...normalized.keys()].filter(retained).map(path => ({ path, sha256: "", size: 0, policy: filePolicy(path) })), info.instanceId);
    await options.onInspected?.(info, detectedMods);
    if (info.requiresSelection) return null;
    const warnings = [...info.warnings];
    let newDataSize = 0; let skipped = 0;
    for (let i = 0; i < list.length; i++) {
      signal?.throwIfAborted(); const entry = list[i];
      if (!entry.fileName.startsWith(prefix)) { skipped++; continue; }
      const target = safePackPath(entry.fileName.slice(prefix.length));
      if (!retained(target)) { skipped++; continue; }
      const hash = createHash("sha256"); let crc = 0; let size = 0;
      const meter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length; if (size > entry.uncompressedSize || size > MAX_FILE) { callback(new Error(diagnosticText("diagnostics.packParser.invalidExpandedSizeForAZipFile"))); return; }
        hash.update(chunk); crc = crc32.buf(chunk, crc); callback(null, chunk);
      } });
      const local = join(tempDirectory, "current-file");
      await pipeline(await openEntry(zip, entry), meter, createWriteStream(local), { signal });
      invariant(size === entry.uncompressedSize && (crc >>> 0) === entry.crc32, 422, diagnosticText("diagnostics.packParser.zipFileValidationFailed0", { arg0: target }));
      const sha256 = hash.digest("hex");
      if (!seenHashes.has(sha256)) { if (await (options.storeCas ?? putCas)(sha256, local, size)) newDataSize += size; seenHashes.add(sha256); }
      files.push({ path: target, sha256, size, policy: filePolicy(target) }); progress(Math.floor((i + 1) / list.length * 95));
    }
    invariant(files.length > 0, 422, diagnosticText("diagnostics.packParser.theZipContainsNoPublishableClientFiles"));
    if (skipped) warnings.push(diagnosticText("diagnostics.packParser.ignored0FilesOutsideThePackOtherInstancesAccountCredentials", { arg0: skipped }));
    if (files.some(file => file.policy === "preserve")) warnings.push(diagnosticText("diagnostics.packParser.personalSettingsServerListsAndSavesUsePreserveExistingPlayer"));
    files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    return { format: inspection.format, files, statistics: compareFiles(files, previous, newDataSize, previousVersion, sourceSize),
      detectedInfo: info, detectedMods, warnings };
  } finally { zip.close(); }
}

async function extractEntry(zip: ZipFile, entry: Entry, local: string, signal?: AbortSignal) {
  const hash = createHash("sha256"); let size = 0, crc = 0;
  await pipeline(await openEntry(zip, entry), new Transform({ transform(chunk: Buffer, _, callback) {
    size += chunk.length;
    if (size > entry.uncompressedSize || size > MAX_FILE) { callback(new AppError(422, diagnosticText("diagnostics.packParser.invalidExpandedSizeForAZipFile"))); return; }
    hash.update(chunk); crc = crc32.buf(chunk, crc); callback(null, chunk);
  } }), createWriteStream(local, { flags: "wx" }), { signal });
  invariant(size === entry.uncompressedSize && (crc >>> 0) === entry.crc32, 422, diagnosticText("diagnostics.packParser.zipFileValidationFailed0", { arg0: entry.fileName }));
  return { size, sha256: hash.digest("hex") };
}

async function parseModrinthZip(zip: ZipFile, list: Entry[], temp: string, previous: PackFile[], previousVersion: string | null,
  sourceSize: number, progress: (value: number) => void, signal: AbortSignal | undefined, options: InspectionOptions, wrapper: "pcl" | null) {
  const rawPaths = new Set<string>();
  for (const entry of list) {
    const folded = safePackPath(entry.fileName).toLowerCase(); invariant(!rawPaths.has(folded), 422, diagnosticText("diagnostics.packParser.theZipContainsDuplicateOrCaseConflictingPaths")); rawPaths.add(folded);
  }
  const indexEntry = list.find(entry => entry.fileName === "modrinth.index.json"); invariant(indexEntry, 422, diagnosticText("diagnostics.packParser.rootModrinthIndexJsonWasNotFound"));
  await options.onInspecting?.();
  const rawIndex = await readSmallJson(zip, indexEntry, signal, 16 * 1024 ** 2);
  if (options.packageFormatVersion === 2) {
    const pending = [{ value: rawIndex, depth: 0 }];
    while (pending.length) { const { value, depth } = pending.pop()!; invariant(depth <= 32, 422, diagnosticText("diagnostics.packParser.v2JsonNestingExceeds32Levels"));
      if (value && typeof value === "object") for (const child of Object.values(value)) pending.push({ value: child, depth: depth + 1 }); }
  }
  const { index, files: declared, info } = inspectModrinthIndex(rawIndex, wrapper);
  const settings = options.downloadSettings ?? { remoteSourceWhitelistEnabled: false, remoteSourceHosts: DEFAULT_REMOTE_HOSTS, downloadProxyEnabled: false, downloadProxyUrl: "", ...DEFAULT_ENVIRONMENT_DOWNLOAD_SETTINGS };
  type Target = { path: string; optional: boolean; entry?: Entry; remote?: (typeof declared)[number]; local?: string; size?: number; sha256?: string; view?: ImportFile };
  const targets = new Map<string, Target>(); const foldedPaths = new Map<string, string>();
  const unsupported = new Set(index.files.filter(file => file.env?.client === "unsupported").map(file => file.path.toLowerCase()));
  function add(target: Target) {
    const path = safePackPath(target.path); const folded = path.toLowerCase();
    if (excluded(path) || unsupported.has(folded)) return;
    if (options.packageFormatVersion === 2) recipePath(path);
    invariant(!/^(versions|libraries|assets|natives|runtime)\//i.test(path), 422, diagnosticText("diagnostics.packParser.mrpackFilesMustNotOverwriteGameEnvironmentsManagedByMua"));
    invariant(!foldedPaths.has(folded) || foldedPaths.get(folded) === path, 422, diagnosticText("diagnostics.packParser.mrpackLayersContainCaseConflictingPaths"));
    foldedPaths.set(folded, path); const old = targets.get(path);
    targets.set(path, { ...target, path, optional: old?.optional ?? target.optional });
  }
  for (const file of declared) add({ path: file.path, optional: file.env?.client === "optional", remote: file });
  // Apply the documented client layer order, retaining optional identity when bytes are overridden.
  for (const prefix of ["overrides/", "client-overrides/"]) for (const entry of list) {
    if (entry.fileName.startsWith(prefix)) add({ path: entry.fileName.slice(prefix.length), optional: false, entry });
  }
  invariant(targets.size > 0 && targets.size <= MAX_FILES, 422, diagnosticText("diagnostics.packParser.theMrpackContainsNoPublishableFilesOrTooManyFiles"));
  let total = 0;
  for (const target of targets.values()) {
    const parts = target.path.toLowerCase().split("/");
    for (let i = 1; i < parts.length; i++) invariant(!foldedPaths.has(parts.slice(0, i).join("/")), 422, diagnosticText("diagnostics.packParser.theMrpackContainsAFileDirectoryConflict"));
    total += target.entry?.uncompressedSize ?? target.remote!.fileSize;
    if (target.remote) target.remote.downloads.forEach(url => {
      const parsed = remoteSourceUrl(url, settings);
      if (options.packageFormatVersion === 2) invariant(parsed.hostname.includes(".") && !/(?:^|\.)(?:localhost|local|internal|home|lan)$/.test(parsed.hostname.replace(/\.$/, "")) &&
        ![...parsed.searchParams.keys()].some(key => /^(?:x-amz-|x-goog-|signature$|sig$|token$|expires$|se$|sp$|sv$)/i.test(key)), 422, diagnosticText("diagnostics.packParser.v2RequiresPersistentPublicDownloadUrlsWithoutLocalDomainsOr"));
    });
  }
  invariant(total <= MAX_EXPANDED, 422, diagnosticText("diagnostics.packParser.expandedMrpackFilesExceed40Gib"));
  const ordered = [...targets.values()].sort((a, b) => a.path < b.path ? -1 : 1);
  const mods = ordered.filter(file => /^mods\/.+\.jar$/i.test(file.path)).map(file => file.path.slice(5));
  invariant(mods.length <= MAX_MODS, 422, diagnosticText("diagnostics.packParser.theModCountExceeds0", { arg0: MAX_MODS }));
  info.importFiles = ordered.map(target => target.view = { path: target.path, source: target.remote ? "remote" : "local", optional: target.optional,
    size: target.remote?.fileSize ?? target.entry!.uncompressedSize, downloads: target.remote?.downloads ?? [],
    ...(target.remote ? { hashes: target.remote.hashes } : {}),
    status: options.packageFormatVersion === 2 && target.remote ? "DECLARED" : "PENDING", downloadedBytes: 0, error: null });
  await options.onInspected?.(info, mods);
  if (options.packageFormatVersion === 2) {
    // Validate every declaration and collision before any local CAS mutation. Remote bytes are never fetched.
    const identities = new Map<string, number>();
    for (const target of ordered) if (target.remote) {
      const sha = target.remote.hashes.sha512;
      invariant(!identities.has(sha) || identities.get(sha) === target.remote.fileSize, 422, diagnosticText("diagnostics.packParser.v2RemoteFilesWithTheSameDigestDeclareDifferentSizes")); identities.set(sha, target.remote.fileSize);
    }
    await options.onCas?.(info);
    const recipeFiles: RecipeFile[] = []; const hashes = new Map<string, number>(); let newLocalDataSize = 0;
    for (let i = 0; i < ordered.length; i++) {
      signal?.throwIfAborted(); const target = ordered[i];
      const common = { path: target.path, policy: filePolicy(target.path), optional: target.optional, executable: false };
      if (target.remote) recipeFiles.push({ ...common, size: target.remote.fileSize, hashes: target.remote.hashes,
        source: { type: "remote", downloads: target.remote.downloads } });
      else {
        const local = join(temp, `override-${i}`); const result = await extractEntry(zip, target.entry!, local, signal);
        if (!hashes.has(result.sha256)) { if (await (options.storeCas ?? putCas)(result.sha256, local, result.size)) newLocalDataSize += result.size; hashes.set(result.sha256, result.size); }
        Object.assign(target.view!, { status: "VERIFIED", downloadedBytes: result.size, hashes: { sha256: result.sha256 } });
        recipeFiles.push({ ...common, hashes: { sha256: result.sha256 }, size: result.size,
          executable: !!((target.entry!.externalFileAttributes >>> 16) & 0o111), source: { type: "local", entry: `overrides/${target.path}` } });
      }
      progress(Math.floor((i + 1) / ordered.length * 95));
    }
    const inventory = parseRecipeInventory({ schemaVersion: 2, format: "mua-import-recipe", files: recipeFiles,
      runtime: { minecraft: info.minecraftVersion, loader: info.loader ? { type: info.loader, version: info.loaderVersion } : null, javaMajor: info.javaVersion } });
    const local = recipeFiles.filter(file => file.source.type === "local"); const remote = recipeFiles.filter(file => file.source.type === "remote");
    const uniqueSize = [...hashes.values()].reduce((sum, size) => sum + size, 0);
    const recipeStatistics: RecipeImportStatistics = { localFiles: local.length, remoteFiles: remote.length, optionalFiles: recipeFiles.filter(file => file.optional).length,
      localSize: local.reduce((sum, file) => sum + file.size, 0), remoteDeclaredSize: remote.reduce((sum, file) => sum + file.size, 0),
      newLocalDataSize, localCasReusePercent: uniqueSize ? Number(((1 - newLocalDataSize / uniqueSize) * 100).toFixed(2)) : 100, sourceSize };
    return { format: "modrinth" as const, files: [] as PackFile[], statistics: null, recipeInventory: inventory, recipeStatistics,
      detectedInfo: info, detectedMods: mods, warnings: info.warnings };
  }
  const controller = new AbortController(); const downloadSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  let next = 0, downloaded = 0, lastNotify = 0; let notification = Promise.resolve(); let notificationError: unknown;
  function notify(force = false) {
    if (!force && Date.now() - lastNotify < 1000) return notification;
    lastNotify = Date.now(); const snapshot = structuredClone(info);
    notification = notification.then(() => options.onDownloading?.(snapshot)).then(() => {}, error => { notificationError = error; controller.abort(error); });
    return notification;
  }
  const remote = ordered.filter(target => target.remote);
  if (remote.length) await notify(true);
  const outcomes = await Promise.allSettled(Array.from({ length: Math.min(4, remote.length) }, async () => {
    while (next < remote.length) {
      const number = next++; const target = remote[number]; const view = target.view!; view.status = "DOWNLOADING";
      try {
        target.local = join(temp, `remote-${number}`); await notify(true); downloadSignal.throwIfAborted();
        const result = await (options.downloadFile ?? downloadRemoteFile)(target.remote!, target.local, settings, downloadSignal, bytes => {
          view.downloadedBytes = bytes; void notify();
        });
        Object.assign(target, result); view.status = "VERIFIED"; view.downloadedBytes = result.size;
        progress(Math.floor(++downloaded / remote.length * 50)); await notify(true);
      } catch (error) {
        view.status = "FAILED"; view.error = error instanceof Error ? serializeError(error) : diagnosticText("diagnostics.packParser.downloadFailed");
        controller.abort(error); await notify(true); throw error;
      }
    }
  }));
  await notification;
  if (notificationError) throw notificationError;
  const failed = outcomes.find(outcome => outcome.status === "rejected"); if (failed?.status === "rejected") throw failed.reason;
  signal?.throwIfAborted(); await options.onCas?.(info);
  const files: PackFile[] = []; const hashes = new Set<string>(); let newDataSize = 0;
  for (let i = 0; i < ordered.length; i++) {
    signal?.throwIfAborted(); const target = ordered[i];
    if (target.entry) { target.local = join(temp, `override-${i}`); Object.assign(target, await extractEntry(zip, target.entry, target.local, signal));
      target.view!.status = "VERIFIED"; target.view!.downloadedBytes = target.size!; }
    const { sha256, size, local } = target; invariant(sha256 && size !== undefined && local, 422, diagnosticText("diagnostics.packParser.anImportedFileHasNotBeenVerified"));
    if (!hashes.has(sha256)) { if (await (options.storeCas ?? putCas)(sha256, local, size)) newDataSize += size; hashes.add(sha256); }
    files.push({ path: target.path, sha256, size, policy: filePolicy(target.path), ...(target.optional ? { optional: true } : {}) });
    progress(50 + Math.floor((i + 1) / ordered.length * 45));
  }
  return { format: "modrinth" as const, files, detectedInfo: info, detectedMods: mods, warnings: info.warnings,
    statistics: compareFiles(files, previous, newDataSize, previousVersion, sourceSize) };
}
