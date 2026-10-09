import "server-only";
import yauzl, { type Entry, type ZipFile } from "yauzl";
import crc32 from "crc-32";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { join } from "node:path";
import { invariant } from "./errors";
import { putCas } from "./storage";
import type { ClientInspection, PackFile, UpdateStatistics } from "./client-contract";
import { inspectPackLayout, inspectPackMods, inspectPackRuntime } from "./pack-inspection";

const MAX_FILES = 100000;
const MAX_EXPANDED = 40 * 1024 ** 3;
const MAX_FILE = 2 * 1024 ** 3;
export function safePackPath(path: string) {
  invariant(path.length > 0 && path.length <= 1000 && !path.startsWith("/") && !path.includes("\\"), 422, "ZIP 中包含无效路径");
  const segments = path.normalize("NFC").split("/");
  invariant(segments.every(segment => segment && segment !== "." && segment !== ".." && !/[\x00-\x1f\x7f<>:"|?*]/.test(segment) &&
    !/[. ]$/.test(segment) && !/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(segment)), 422, "ZIP 中包含不安全或 Windows 不兼容的路径");
  return segments.join("/");
}
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
        invariant(++count <= MAX_FILES, 422, "ZIP 条目数量超过 100000");
        invariant(!entry.isEncrypted(), 422, "不支持加密 ZIP");
        invariant(((entry.externalFileAttributes >>> 16) & 0xf000) !== 0xa000, 422, "ZIP 不允许符号链接");
        invariant(entry.uncompressedSize <= MAX_FILE, 422, "ZIP 单文件超过 2 GiB");
        total += entry.uncompressedSize; invariant(total <= MAX_EXPANDED, 422, "ZIP 解包后超过 40 GiB");
        invariant(entry.uncompressedSize < 1024 * 1024 || entry.uncompressedSize <= Math.max(1, entry.compressedSize) * 1000, 422, "ZIP 压缩比例异常");
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
async function readSmallJson(zip: ZipFile, entry: Entry, signal?: AbortSignal) {
  invariant(entry.uncompressedSize <= 1024 ** 2, 422, "版本 JSON 超过 1 MiB，请检查整合包");
  const chunks: Buffer[] = []; let size = 0; let crc = 0;
  const stream = await openEntry(zip, entry);
  const abort = () => (stream as import("node:stream").Readable).destroy(new Error("识别已中断"));
  signal?.addEventListener("abort", abort, { once: true });
  try {
    signal?.throwIfAborted();
    for await (const chunk of stream) {
      signal?.throwIfAborted(); const bytes = Buffer.from(chunk); size += bytes.length;
      invariant(size <= entry.uncompressedSize && size <= 1024 ** 2, 422, "版本 JSON 展开大小异常"); crc = crc32.buf(bytes, crc); chunks.push(bytes);
    }
    invariant(size === entry.uncompressedSize && (crc >>> 0) === entry.crc32, 422, "版本 JSON 校验失败");
    return JSON.parse(Buffer.concat(chunks).toString("utf8").replace(/^\uFEFF/, "")) as unknown;
  } finally { signal?.removeEventListener("abort", abort); }
}
async function readJarVersion(zip: ZipFile, entry: Entry, tempDirectory: string, signal?: AbortSignal) {
  invariant(entry.uncompressedSize <= 256 * 1024 ** 2, 422, "游戏 JAR 超过 256 MiB，无法安全识别版本");
  const path = join(tempDirectory, "metadata-game.jar"); let size = 0; let crc = 0;
  const meter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
    size += chunk.length; if (size > entry.uncompressedSize || size > 256 * 1024 ** 2) { callback(new Error("游戏 JAR 展开大小异常")); return; }
    crc = crc32.buf(chunk, crc); callback(null, chunk);
  } });
  await pipeline(await openEntry(zip, entry), meter, createWriteStream(path), { signal });
  invariant(size === entry.uncompressedSize && (crc >>> 0) === entry.crc32, 422, "游戏 JAR 校验失败");
  const jar = await openZip(path);
  try { const version = (await entries(jar)).find(entry => entry.fileName === "version.json"); return version ? await readSmallJson(jar, version, signal) : null; }
  finally { jar.close(); }
}
type InspectionOptions = {
  selectedInstanceId?: string | null;
  onInspecting?: () => Promise<void>;
  onInspected?: (info: ClientInspection, mods: string[]) => Promise<void>;
  storeCas?: typeof putCas;
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
    const files: PackFile[] = []; const seenPaths = new Set<string>(); const seenHashes = new Set<string>();
    // Validate all normalized paths and collisions before using any metadata or writing CAS.
    const normalized = new Map<string, Entry>();
    for (const entry of list) {
      if (!entry.fileName.startsWith(prefix)) continue;
      const target = safePackPath(entry.fileName.slice(prefix.length)); const folded = target.toLocaleLowerCase("en-US");
      invariant(!seenPaths.has(folded), 422, "ZIP 存在重复或大小写冲突的文件路径"); seenPaths.add(folded);
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
        size += chunk.length; if (size > entry.uncompressedSize || size > MAX_FILE) { callback(new Error("ZIP 文件展开大小异常")); return; }
        hash.update(chunk); crc = crc32.buf(chunk, crc); callback(null, chunk);
      } });
      const local = join(tempDirectory, "current-file");
      await pipeline(await openEntry(zip, entry), meter, createWriteStream(local), { signal });
      invariant(size === entry.uncompressedSize && (crc >>> 0) === entry.crc32, 422, `ZIP 文件校验失败：${target}`);
      const sha256 = hash.digest("hex");
      if (!seenHashes.has(sha256)) { if (await (options.storeCas ?? putCas)(sha256, local, size)) newDataSize += size; seenHashes.add(sha256); }
      files.push({ path: target, sha256, size, policy: filePolicy(target) }); progress(Math.floor((i + 1) / list.length * 95));
    }
    invariant(files.length > 0, 422, "ZIP 没有可发布的客户端文件");
    if (skipped) warnings.push(`已忽略 ${skipped} 个包外文件、其他实例、账号凭据、日志或截图。`);
    if (files.some(file => file.policy === "preserve")) warnings.push("个人设置、服务器列表和 saves 使用 preserve，玩家已有文件不会被覆盖或删除。");
    files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    return { format: inspection.format, files, statistics: compareFiles(files, previous, newDataSize, previousVersion, sourceSize),
      detectedInfo: info, detectedMods, warnings };
  } finally { zip.close(); }
}
