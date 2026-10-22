import { diagnosticText } from "@/lib/diagnostics";
import "server-only";
import { createReadStream, createWriteStream } from "node:fs";
import { createHash } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Transform, type Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import { posix, join } from "node:path";
import yauzl from "yauzl";
import tar from "tar-stream";
import { safePackPath } from "./pack-path";
import { invariant } from "./errors";

type Entry = { path: string; local: string; sha256: string; size: number; executable: boolean };
export async function unpackEnvironment(path: string, directory: string, type: "zip" | "tar.gz", stripRoot: boolean, signal: AbortSignal) {
  const entries: Entry[] = []; const links: { path: string; target: string }[] = []; const paths = new Set<string>(); let total = 0;
  let archiveRoot: string | undefined;
  const normalize = (raw: string) => {
    const safe = safePackPath(raw);
    if (!stripRoot) return safe;
    const root = safe.split("/")[0]; archiveRoot ??= root;
    invariant(root === archiveRoot, 422, diagnosticText("diagnostics.environmentArchive.anEnvironmentArchiveMustContainExactlyOneRootDirectory"));
    return safePackPath(safe.split("/").slice(1).join("/"));
  };
  async function consume(raw: string, stream: Readable, executable: boolean) {
    signal.throwIfAborted(); const normalized = normalize(raw); invariant(!paths.has(normalized.toLowerCase()), 422, diagnosticText("diagnostics.environmentArchive.duplicatePathInEnvironmentArchive")); paths.add(normalized.toLowerCase());
    invariant(paths.size <= 20000, 422, diagnosticText("diagnostics.environmentArchive.tooManyFilesInEnvironmentArchive")); const local = join(directory, `entry-${entries.length}`); const hash = createHash("sha256"); let size = 0;
    await pipeline(stream, new Transform({ transform(chunk, _, callback) {
      size += chunk.length; total += chunk.length;
      if (size > 2 * 1024 ** 3 || total > 10 * 1024 ** 3) { callback(new Error(diagnosticText("diagnostics.environmentArchive.theExtractedEnvironmentExceedsTheSizeLimit"))); return; }
      hash.update(chunk); callback(null, chunk);
    } }), createWriteStream(local, { flags: "wx" }), { signal });
    entries.push({ path: normalized, local, sha256: hash.digest("hex"), size, executable });
  }
  if (type === "zip") {
    const zip = await new Promise<yauzl.ZipFile>((resolve, reject) => yauzl.open(path, { lazyEntries: true, validateEntrySizes: true }, (error, value) => error ? reject(error) : resolve(value!)));
    try { await new Promise<void>((resolve, reject) => {
      const abort = () => { zip.close(); reject(signal.reason); }; signal.addEventListener("abort", abort, { once: true });
      zip.on("error", reject); zip.on("end", () => { signal.removeEventListener("abort", abort); resolve(); });
      zip.on("entry", (entry: yauzl.Entry) => { void (async () => {
        invariant(!(entry.generalPurposeBitFlag & 1), 422, diagnosticText("diagnostics.environmentArchive.encryptedEnvironmentZipsAreNotAllowed")); const mode = entry.externalFileAttributes >>> 16;
        if (entry.fileName.endsWith("/")) { zip.readEntry(); return; }
        invariant((mode & 0xf000) !== 0xa000, 422, diagnosticText("diagnostics.environmentArchive.symbolicLinksAreNotAllowedInEnvironmentZips"));
        if (!stripRoot && /^META-INF\//i.test(entry.fileName)) { zip.readEntry(); return; }
        const stream = await new Promise<Readable>((yes, no) => zip.openReadStream(entry, (error, value) => error ? no(error) : yes(value!)));
        await consume(entry.fileName, stream, !!(mode & 0o111)); zip.readEntry();
      })().catch(reject); }); zip.readEntry();
    }); } finally { zip.close(); }
  } else {
    const extract = tar.extract();
    extract.on("entry", (header, stream, next) => { void (async () => {
      if (header.type === "directory") { stream.resume(); next(); return; }
      invariant(["file", "symlink", "link"].includes(header.type ?? "file"), 422, diagnosticText("diagnostics.environmentArchive.theEnvironmentTarContainsASpecialFile"));
      if (header.type === "file") await consume(header.name, stream, !!((header.mode ?? 0) & 0o111));
      else {
        invariant(header.linkname && !header.linkname.startsWith("/") && !header.linkname.includes("\\"), 422, diagnosticText("diagnostics.environmentArchive.invalidEnvironmentLinkTarget"));
        const normalized = normalize(header.name); invariant(!paths.has(normalized.toLowerCase()) && paths.size < 20000, 422, diagnosticText("diagnostics.environmentArchive.duplicateOrExcessiveEnvironmentLinkPaths")); paths.add(normalized.toLowerCase());
        const target = normalize(header.type === "link" ? header.linkname! : posix.normalize(posix.join(posix.dirname(header.name), header.linkname!)));
        links.push({ path: normalized, target }); stream.resume();
      }
      next();
    })().catch(error => extract.destroy(error)); });
    await pipeline(createReadStream(path), createGunzip(), extract, { signal });
    const byPath = new Map(entries.map(entry => [entry.path, entry]));
    for (let pass = 0; links.length && pass < 16; pass++) for (let i = links.length - 1; i >= 0; i--) {
      const link = links[i], target = byPath.get(link.target); if (!target) continue;
      const entry = { ...target, path: link.path }; entries.push(entry); byPath.set(link.path, entry); links.splice(i, 1);
    }
    invariant(!links.length, 422, diagnosticText("diagnostics.environmentArchive.environmentLinksMustNotTargetExternalFilesDirectoriesOrCyclic"));
  }
  return entries;
}
