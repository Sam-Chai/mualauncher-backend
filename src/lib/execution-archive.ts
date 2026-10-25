import "server-only";
import { createReadStream, createWriteStream } from "node:fs";
import { lstat, readdir, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import tar from "tar-stream";
import { safePackPath } from "./pack-path";
import type { ExecutionArtifact, ExecutionBindings, ExecutionInput, ExecutionPlan } from "./execution-contract";
import { ExecutionError, type ExecutionPolicy } from "./execution-policy";

export async function executionInputs(root: string, signal: AbortSignal): Promise<{ inputs: ExecutionInput[]; bindings: Map<string, string>; directories: string[] }> {
  const inputs: ExecutionInput[] = [], bindings = new Map<string, string>(), directories: string[] = [];
  const walk = async (directory: string, prefix: string) => {
    for (const name of (await readdir(directory)).sort()) {
      signal.throwIfAborted(); const path = safePackPath(prefix + name), local = join(directory, name), info = await lstat(local);
      if (info.isSymbolicLink() || !info.isDirectory() && (!info.isFile() || info.nlink !== 1)) throw new ExecutionError("integrity", false, "input-type");
      if (info.isDirectory()) {
        if (directories.length >= 20000) throw new ExecutionError("integrity", false, "input-directories");
        directories.push(path); await walk(local, path + "/");
      }
      else {
        if (inputs.length >= 20000 || info.size > 2 * 1024 ** 3) throw new ExecutionError("integrity", false, "input-size");
        const hash = createHash("sha256"); for await (const chunk of createReadStream(local, { signal })) hash.update(chunk);
        inputs.push({ path, size: info.size, sha256: hash.digest("hex") }); bindings.set(path, local);
      }
    }
  };
  await walk(root, ""); return { inputs, bindings, directories };
}

export async function writeExecutionArchive(plan: ExecutionPlan, bindings: ExecutionBindings, destination: string, policy: ExecutionPolicy, signal: AbortSignal) {
  if (bindings.size !== plan.inputs.length || plan.inputs.length > policy.maxFiles || (plan.directories?.length ?? 0) > policy.maxFiles || plan.inputs.reduce((sum, file) => sum + file.size, 0) > policy.maxInputBytes)
    throw new ExecutionError("integrity", false, "input-limit");
  const pack = tar.pack(), completion = pipeline(pack, createWriteStream(destination, { flags: "wx", mode: 0o600 }), { signal });
  // Attach a handler while producing entries to avoid an unhandled rejection on sink failure.
  void completion.catch(() => {});
  try {
    for (const directory of plan.directories ?? []) await new Promise<void>((yes, no) => {
      pack.entry({ name: directory + "/", type: "directory", size: 0, mode: 0o555, uid: 0, gid: 0, mtime: new Date(0) }, error => error ? no(error) : yes());
    });
    for (const file of plan.inputs) {
      const local = bindings.get(file.path); if (!local) throw new ExecutionError("integrity", false, "input-binding");
      const info = await lstat(local);
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size !== file.size) throw new ExecutionError("integrity", false, "input-file");
      const hash = createHash("sha256"); let size = 0;
      const entry = pack.entry({ name: file.path, type: "file", size: file.size, mode: 0o444, uid: 0, gid: 0, mtime: new Date(0) });
      await pipeline(createReadStream(local), new Transform({ transform(chunk: Buffer, _, next) {
        size += chunk.length; hash.update(chunk); next(size > file.size ? new ExecutionError("integrity", false, "input-size") : null, chunk);
      } }), entry, { signal });
      if (size !== file.size || hash.digest("hex") !== file.sha256) throw new ExecutionError("integrity", false, "input-digest");
    }
    pack.finalize(); await completion;
  } catch (error) { pack.destroy(error as Error); await completion.catch(() => {}); throw error; }
}

export async function readExecutionArchive(source: Readable, plan: ExecutionPlan, destination: string, policy: ExecutionPolicy, signal: AbortSignal) {
  await mkdir(destination, { recursive: true, mode: 0o700 });
  const extract = tar.extract(), seen = new Map<string, "file" | "directory">(), parents = new Set<string>(), inputs = new Map(plan.inputs.map(file => [file.path, file]));
  const outputs = new Map(plan.outputs.map(file => [file.path, file])); const found = new Set<string>(), artifacts: ExecutionArtifact[] = [];
  let total = 0, outputTotal = 0, count = 0;
  extract.on("entry", (header, stream, next) => { void (async () => {
    if (header.type === "directory" && header.size) throw new ExecutionError("integrity", false, "directory-payload");
    if (header.type === "directory" && [".", "./"].includes(header.name)) { stream.resume(); next(); return; }
    const path = safePackPath(header.name.replace(/^\.\//, "").replace(/\/$/, ""));
    const key = path.toLowerCase();
    if (++count > policy.maxFiles * 2 || seen.has(key) || !["file", "directory"].includes(header.type ?? "file")) throw new ExecutionError("integrity", false, "output-type");
    seen.set(key, header.type === "directory" ? "directory" : "file");
    if (header.type !== "directory" && parents.has(key)) throw new ExecutionError("integrity", false, "output-collision");
    const parts = key.split("/");
    for (let i = 1; i < parts.length; i++) {
      const parent = parts.slice(0, i).join("/");
      if (seen.get(parent) === "file") throw new ExecutionError("integrity", false, "output-collision");
      parents.add(parent);
    }
    if (header.type === "directory") { stream.resume(); next(); return; }
    const declaredSize = header.size ?? 0;
    const output = outputs.get(path), input = inputs.get(path);
    if (!Number.isSafeInteger(declaredSize) || declaredSize < 0 || declaredSize > (output || !input ? policy.maxOutputBytes : input.size)) throw new ExecutionError("integrity", false, "output-size");
    const hash = createHash("sha256"), sha1 = createHash("sha1"); let size = 0;
    const local = join(destination, `artifact-${artifacts.length}`);
    const meter = new Transform({ transform(chunk: Buffer, _, callback) {
      size += chunk.length; total += chunk.length; if (output) outputTotal += chunk.length;
      if (size > declaredSize || outputTotal > policy.maxOutputBytes || total > Math.min(policy.workspaceMiB * 1024 ** 2, policy.maxInputBytes + policy.maxOutputBytes)) return callback(new ExecutionError("integrity", false, "output-limit"));
      hash.update(chunk); sha1.update(chunk); callback(null, chunk);
    } });
    if (output) await pipeline(stream, meter, createWriteStream(local, { flags: "wx", mode: 0o600 }), { signal });
    else { meter.resume(); await pipeline(stream, meter, { signal }); }
    const digest = hash.digest("hex"), sha1Digest = sha1.digest("hex");
    if (size !== header.size) throw new ExecutionError("integrity", false, "output-size");
    if (input) { found.add(path); if (input.sha256 !== digest || input.size !== size) throw new ExecutionError("integrity", false, "modified-input"); }
    if (output) {
      if (output.expected && output.expected.hash !== (output.expected.algorithm === "sha1" ? sha1Digest : digest)) throw new ExecutionError("integrity", false, "output-digest");
      artifacts.push({ path, size, sha256: digest, sha1: sha1Digest, local });
    }
    next();
  })().catch(error => extract.destroy(error)); });
  await pipeline(source, extract, { signal });
  if (artifacts.length !== outputs.size || found.size !== inputs.size) throw new ExecutionError("integrity", false, "missing-file");
  return artifacts;
}
