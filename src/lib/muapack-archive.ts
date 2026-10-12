import "server-only";
import { createHash, type KeyObject } from "node:crypto";
import { Readable } from "node:stream";
import yauzl, { type Entry, type ZipFile } from "yauzl";
import crc32 from "crc-32";
import { invariant } from "./errors";
import { safePackPath } from "./pack-path";
import { MUA_METADATA_LIMIT, muaDigest, decodeMuaJson, validateMuaEnvironments, validateMuaPackDocuments, verifyMuaPackSignature } from "./muapack-protocol";

const TARGET = "metadata/target-manifest.json";
const BASE = "metadata/base-manifest.json";
const SIGNATURE = "metadata/signature.json";
const DOCUMENTS = new Set(["mua-pack.json", TARGET, BASE, SIGNATURE]);
const ENVIRONMENT = /^metadata\/environments\/([0-9a-f]{64})\.json$/;
const OBJECT = /^objects\/sha256\/([0-9a-f]{64})$/;
async function openZip(path: string) {
  return new Promise<ZipFile>((resolve, reject) => yauzl.open(path, { lazyEntries: true, autoClose: false,
    strictFileNames: true, validateEntrySizes: true }, (error, zip) => error ? reject(error) : resolve(zip!)));
}
async function listEntries(zip: ZipFile) {
  return new Promise<Map<string, Entry>>((resolve, reject) => {
    const entries = new Map<string, Entry>(); let total = 0;
    function cleanup() { zip.removeListener("entry", onEntry); zip.removeListener("error", fail); zip.removeListener("end", end); }
    function fail(error: Error) { cleanup(); reject(error); }
    function end() { cleanup(); resolve(entries); }
    function onEntry(entry: Entry) {
      try {
        invariant(!entry.isEncrypted() && ((entry.externalFileAttributes >>> 16) & 0xf000) !== 0xa000, 422, "muapack 不支持加密或符号链接");
        invariant(entry.compressionMethod === 0 || entry.compressionMethod === 8, 422, "muapack 仅支持 Store 或 Deflate");
        invariant(safePackPath(entry.fileName) === entry.fileName && !entries.has(entry.fileName), 422, "muapack 存在无效或重复路径");
        invariant(DOCUMENTS.has(entry.fileName) || ENVIRONMENT.test(entry.fileName) || OBJECT.test(entry.fileName), 422, "muapack 包含未声明布局的文件");
        invariant(entry.uncompressedSize <= (OBJECT.test(entry.fileName) ? 2 * 1024 ** 3 : MUA_METADATA_LIMIT), 422, "muapack 条目超过大小限制");
        invariant(entry.uncompressedSize < 1024 ** 2 || entry.uncompressedSize <= Math.max(1, entry.compressedSize) * 1000, 422, "muapack 压缩比例异常");
        total += entry.uncompressedSize;
        invariant(total <= 40 * 1024 ** 3 + 7 * MUA_METADATA_LIMIT && entries.size < 100007, 422, "muapack 总大小或条目数超限");
        entries.set(entry.fileName, entry); zip.readEntry();
      } catch (error) { fail(error as Error); }
    }
    zip.on("entry", onEntry); zip.once("error", fail); zip.once("end", end); zip.readEntry();
  });
}
async function consumeEntry(zip: ZipFile, entry: Entry, signal?: AbortSignal, collect = false,
  onBytes?: (bytes: number) => void) {
  const stream = await new Promise<Readable>((resolve, reject) => zip.openReadStream(entry,
    (error, stream) => error ? reject(error) : resolve(stream!)));
  const abort = () => stream.destroy(new Error("muapack 校验已中断"));
  signal?.addEventListener("abort", abort, { once: true });
  const hash = createHash("sha256"); let size = 0; let crc = 0; const chunks: Buffer[] = [];
  try {
    signal?.throwIfAborted();
    for await (const chunk of stream) {
      signal?.throwIfAborted(); const bytes = Buffer.from(chunk); size += bytes.length;
      invariant(size <= entry.uncompressedSize && (!collect || size <= MUA_METADATA_LIMIT), 422, "muapack 条目展开大小异常");
      hash.update(bytes); crc = crc32.buf(bytes, crc); if (collect) chunks.push(bytes); onBytes?.(bytes.length);
    }
    invariant(size === entry.uncompressedSize && (crc >>> 0) === entry.crc32, 422, "muapack 条目大小或 CRC 校验失败");
    return { bytes: collect ? Buffer.concat(chunks) : null, size, sha256: hash.digest("hex") };
  } finally { signal?.removeEventListener("abort", abort); stream.destroy(); }
}
export { openZip as openMuaZip, consumeEntry as consumeMuaEntry };

/** Only selects the strict validator; this does not authenticate the package. */
export async function muaArchiveFormat(path: string): Promise<1 | 2> {
  const zip = await openZip(path);
  try {
    const entry = await new Promise<Entry>((resolve, reject) => {
      let count = 0;
      zip.on("error", reject); zip.on("end", () => reject(new Error("缺少 mua-pack.json")));
      zip.on("entry", entry => {
        if (++count > 100005) { reject(new Error("muapack 条目超限")); return; }
        if (entry.fileName === "mua-pack.json") resolve(entry); else zip.readEntry();
      }); zip.readEntry();
    });
    invariant(!entry.isEncrypted() && entry.uncompressedSize <= MUA_METADATA_LIMIT, 422, "muapack 元数据无效或超限");
    const value = decodeMuaJson((await consumeEntry(zip, entry, undefined, true)).bytes!) as { format?: string; formatVersion?: number };
    invariant(value.format === "muapack" && (value.formatVersion === 1 || value.formatVersion === 2), 422, "不支持此 muapack 格式");
    return value.formatVersion;
  } finally { zip.close(); }
}

/** Read-only verification; never extracts files or executes uploaded launch tasks. */
export async function validateMuaPackArchive(path: string, trustedPublicKey: KeyObject, options: {
  signal?: AbortSignal; onProgress?: (progress: { bytes: number; totalBytes: number; objects: number; totalObjects: number }) => void;
} = {}) {
  options.signal?.throwIfAborted(); const zip = await openZip(path);
  try {
    const entries = await listEntries(zip);
    async function readDocument(name: string) {
      const entry = entries.get(name); invariant(entry, 422, `muapack 缺少 ${name}`);
      return (await consumeEntry(zip, entry, options.signal, true)).bytes!;
    }
    const metadataBytes = await readDocument("mua-pack.json");
    const signature = verifyMuaPackSignature(metadataBytes, await readDocument(SIGNATURE), trustedPublicKey);
    const targetBytes = await readDocument(TARGET); const baseBytes = entries.has(BASE) ? await readDocument(BASE) : null;
    const documents = validateMuaPackDocuments(metadataBytes, targetBytes, baseBytes);
    const environmentDocuments = new Map<string, Buffer>();
    for (const reference of documents.target.environments) {
      const name = `metadata/environments/${reference.sha256}.json`;
      environmentDocuments.set(reference.sha256, await readDocument(name));
    }
    validateMuaEnvironments(documents.target, environmentDocuments);
    const expected = new Set(["mua-pack.json", TARGET, SIGNATURE, ...[...environmentDocuments.keys()].map(hash => `metadata/environments/${hash}.json`),
      ...documents.metadata.payload.map(object => `objects/sha256/${object.sha256}`)]);
    if (documents.metadata.base) expected.add(BASE);
    invariant(expected.size === entries.size && [...entries.keys()].every(name => expected.has(name)), 422, "muapack 包含缺失或额外的条目");
    let bytes = 0; let objects = 0; const totalBytes = documents.metadata.payload.reduce((sum, object) => sum + object.size, 0);
    const progress = () => options.onProgress?.({ bytes, totalBytes, objects, totalObjects: documents.metadata.payload.length });
    progress();
    for (const object of documents.metadata.payload) {
      const entry = entries.get(`objects/sha256/${object.sha256}`);
      invariant(entry && entry.uncompressedSize === object.size, 422, "muapack 载荷缺失或大小不匹配");
      const result = await consumeEntry(zip, entry, options.signal, false, count => { bytes += count; progress(); });
      invariant(result.sha256 === object.sha256, 422, "muapack 文件 SHA-256 不匹配"); objects++; progress();
    }
    return { ...documents, signature, metadataSha256: muaDigest(metadataBytes), objectCount: objects, payloadSize: bytes };
  } finally { zip.close(); }
}
