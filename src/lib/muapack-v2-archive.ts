import "server-only";
import type { KeyObject } from "node:crypto";
import type { Entry, ZipFile } from "yauzl";
import { invariant } from "./errors";
import { safePackPath } from "./pack-path";
import { MUA_METADATA_LIMIT, muaDigest } from "./muapack-protocol";
import { openMuaZip, consumeMuaEntry } from "./muapack-archive";
import { validateRecipePackDocuments, verifyRecipePackSignature } from "./muapack-v2-protocol";

const TARGET = "metadata/target-manifest.json", BASE = "metadata/base-manifest.json", SIGNATURE = "metadata/signature.json";
const documents = new Set(["mua-pack.json", "modrinth.index.json", TARGET, BASE, SIGNATURE]);
function list(zip: ZipFile, signal?: AbortSignal) {
  return new Promise<Map<string, Entry>>((ok, bad) => {
    const found = new Map<string, Entry>(), folded = new Set<string>(); let size = 0;
    function cleanup() { zip.removeListener("entry", entry); zip.removeListener("error", fail); zip.removeListener("end", end); }
    function fail(error: Error) { cleanup(); bad(error); }
    function end() { cleanup(); ok(found); }
    function entry(value: Entry) {
      try {
        signal?.throwIfAborted(); const name = value.fileName, local = name.startsWith("overrides/");
        invariant(!value.isEncrypted() && ((value.externalFileAttributes >>> 16) & 0xf000) !== 0xa000 && [0, 8].includes(value.compressionMethod), 422, "v2 包不支持加密、符号链接或此压缩方式");
        invariant(safePackPath(name) === name && !folded.has(name.toLowerCase()) && (documents.has(name) || local), 422, "v2 包包含无效、重复或未知条目");
        invariant(value.uncompressedSize <= (local ? 2 * 1024 ** 3 : MUA_METADATA_LIMIT), 422, "v2 包条目超过大小限制");
        invariant(value.uncompressedSize < 1024 ** 2 || value.uncompressedSize <= Math.max(1, value.compressedSize) * 1000, 422, "v2 包压缩比例异常");
        size += value.uncompressedSize; invariant(size <= 40 * 1024 ** 3 + 5 * MUA_METADATA_LIMIT && found.size < 100005, 422, "v2 包条目或大小超限");
        found.set(name, value); folded.add(name.toLowerCase()); zip.readEntry();
      } catch (error) { fail(error as Error); }
    }
    zip.on("entry", entry); zip.once("error", fail); zip.once("end", end); zip.readEntry();
  });
}
/** Verify without extraction, remote downloads, environment installation or command execution. */
export async function validateRecipePackArchive(path: string, key: KeyObject, options: { signal?: AbortSignal; onProgress?: (bytes: number, totalBytes: number) => void } = {}) {
  options.signal?.throwIfAborted(); const zip = await openMuaZip(path);
  try {
    const entries = await list(zip, options.signal);
    async function read(name: string) { const entry = entries.get(name); invariant(entry, 422, `v2 包缺少 ${name}`); return (await consumeMuaEntry(zip, entry, options.signal, true)).bytes!; }
    const metadataBytes = await read("mua-pack.json"); const signature = verifyRecipePackSignature(metadataBytes, await read(SIGNATURE), key);
    const targetBytes = await read(TARGET), baseBytes = entries.has(BASE) ? await read(BASE) : null, indexBytes = await read("modrinth.index.json");
    const parsed = validateRecipePackDocuments(metadataBytes, targetBytes, baseBytes, indexBytes);
    const expected = new Set(["mua-pack.json", "modrinth.index.json", TARGET, SIGNATURE, ...parsed.metadata.payload.map(file => file.entry)]);
    if (baseBytes) expected.add(BASE);
    invariant(expected.size === entries.size && [...entries.keys()].every(name => expected.has(name)), 422, "v2 包包含缺失或额外载荷");
    let bytes = 0; const totalBytes = parsed.metadata.payload.reduce((sum, file) => sum + file.size, 0); options.onProgress?.(0, totalBytes);
    for (const file of parsed.metadata.payload) {
      const entry = entries.get(file.entry); invariant(entry && entry.uncompressedSize === file.size, 422, "v2 本地载荷缺失或大小错误");
      const actual = await consumeMuaEntry(zip, entry, options.signal, false, size => { bytes += size; options.onProgress?.(bytes, totalBytes); });
      invariant(actual.sha256 === file.sha256, 422, "v2 本地载荷 SHA-256 不匹配");
    }
    return { ...parsed, signature, metadataSha256: muaDigest(metadataBytes), objectCount: parsed.metadata.payload.length, payloadSize: bytes };
  } finally { zip.close(); }
}
