import "server-only";
import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, lstat } from "node:fs/promises";
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import yauzl from "yauzl";
import crc32 from "crc-32";
import { unpackEnvironment } from "./environment-archive";
import { safePackPath } from "./pack-path";
import { invariant } from "./errors";
import type { EnvironmentExpected, createEnvironmentDownloader } from "./environment-download";
import type { MuaFile } from "./muapack-contract";

const artifactSchema = z.object({ path: z.string(), url: z.string(), sha1: z.string().regex(/^[a-f0-9]{40}$/), size: z.number().int().nonnegative().max(2 * 1024 ** 3) });
const librarySchema = z.object({ name: z.string(), downloads: z.object({ artifact: artifactSchema }) });
const processorSchema = z.object({ sides: z.array(z.enum(["client", "server", "extract"])).optional(), jar: z.string(),
  classpath: z.array(z.string()).max(100).default([]), args: z.array(z.string().max(4000)).max(100), outputs: z.record(z.string()).default({}) });
const installSchema = z.object({ spec: z.union([z.literal(0), z.literal(1)]), minecraft: z.string(), version: z.string(), json: z.string(),
  data: z.record(z.object({ client: z.string().max(4000), server: z.string().optional() })).default({}),
  libraries: z.array(librarySchema).max(500), processors: z.array(processorSchema).max(32).default([]) });
export type ForgeInstallProfile = z.infer<typeof installSchema>;
type RuntimeProfile = { id: string; inheritsFrom: string; mainClass: string; libraries: z.infer<typeof librarySchema>[]; arguments?: unknown; minecraftArguments?: string };
const runtimeSchema = z.object({ id: z.string(), inheritsFrom: z.string(), mainClass: z.string(), libraries: z.array(librarySchema).max(500),
  arguments: z.unknown().optional(), minecraftArguments: z.string().optional() });

export function forgeArtifactPath(value: string) {
  const match = /^([A-Za-z0-9_.-]+):([A-Za-z0-9_.-]+):([A-Za-z0-9_.+-]+)(?::([A-Za-z0-9_.+-]+))?(?:@([A-Za-z0-9]+))?$/.exec(value);
  invariant(match && !match.slice(1).some(part => part === "." || part === "..") && !match[1].split(".").some(part => !part), 422, "Forge Maven 坐标无效");
  return safePackPath(`${match[1].replaceAll(".", "/")}/${match[2]}/${match[3]}/${match[2]}-${match[3]}${match[4] ? `-${match[4]}` : ""}.${match[5] ?? "jar"}`);
}
export function forgeInstallerSource(type: "forge" | "neoforge", minecraft: string, version: string) {
  invariant(/^[A-Za-z0-9_.+-]+$/.test(minecraft) && /^[0-9][A-Za-z0-9_.+-]*$/.test(version), 422, "Forge 版本标识无效");
  const full = type === "forge" ? version.startsWith(`${minecraft}-`) ? version : `${minecraft}-${version}` : version;
  const coordinate = type === "forge" ? `net.minecraftforge:forge:${full}:installer` : `net.neoforged:neoforge:${full}:installer`;
  return { coordinate, url: `${type === "forge" ? "https://maven.minecraftforge.net/" : "https://maven.neoforged.net/releases/"}${forgeArtifactPath(coordinate)}` };
}
function contained(root: string, path: string) {
  const part = relative(resolve(root), resolve(path));
  invariant(part !== "" && !isAbsolute(part) && part !== ".." && !part.startsWith(`..${sep}`), 422, "Forge 处理器路径越界"); return resolve(path);
}
export function forgeToken(value: string, data: Record<string, string>, root: string) {
  if (value.startsWith("[") && value.endsWith("]")) return join(root, "libraries", forgeArtifactPath(value.slice(1, -1)));
  return value.replace(/\{([A-Z_]+)\}/g, (_, key: string) => { invariant(Object.hasOwn(data, key), 422, `Forge 未知处理器变量 ${key}`); return data[key]; });
}
async function hashFile(file: string, algorithm: "sha1" | "sha256", signal: AbortSignal) {
  invariant((await lstat(file)).isFile(), 422, "Forge 产物不是普通文件");
  const hash = createHash(algorithm); let size = 0; const stream = createReadStream(file);
  const abort = () => stream.destroy(new Error("Forge 校验已取消")); signal.addEventListener("abort", abort, { once: true });
  try { signal.throwIfAborted(); for await (const bytes of stream) { size += bytes.length; invariant(size <= 2 * 1024 ** 3, 422, "Forge 文件超过 2 GiB"); hash.update(bytes); } }
  finally { signal.removeEventListener("abort", abort); }
  return { hash: hash.digest("hex"), size };
}
async function mainClass(jar: string) {
  const zip = await new Promise<yauzl.ZipFile>((yes, no) => yauzl.open(jar, { lazyEntries: true }, (error, zip) => error ? no(error) : yes(zip!)));
  try { return await new Promise<string>((yes, no) => {
    zip.on("error", no); zip.on("end", () => no(new Error("Forge 处理器缺少 Main-Class")));
    zip.on("entry", entry => {
      if (entry.fileName !== "META-INF/MANIFEST.MF") { zip.readEntry(); return; }
      if (entry.uncompressedSize > 65536) { no(new Error("处理器 Manifest 过大")); return; }
      zip.openReadStream(entry, (error, stream) => {
        if (error) { no(error); return; }
        void (async () => { const chunks: Buffer[] = []; let size = 0, crc = 0;
          for await (const chunk of stream!) { size += chunk.length; invariant(size <= 65536, 422, "处理器 Manifest 过大"); crc = crc32.buf(chunk, crc); chunks.push(chunk); }
          invariant(size === entry.uncompressedSize && (crc >>> 0) === entry.crc32, 422, "处理器 Manifest 校验失败");
          const value = /^Main-Class: (.+)$/mi.exec(Buffer.concat(chunks).toString("utf8").replace(/\r?\n /g, ""))?.[1].trim();
          invariant(value && /^[A-Za-z_$][A-Za-z0-9_$.]+$/.test(value), 422, "Forge 处理器主类无效"); yes(value);
        })().catch(no);
      });
    }); zip.readEntry();
  }); } finally { zip.close(); }
}
export function forgeProcessorAllowed(coordinate: string, args: string[]) {
  forgeArtifactPath(coordinate);
  const [group, name] = coordinate.split(":");
  invariant(["net.minecraftforge", "net.neoforged", "net.neoforged.installertools"].includes(group) &&
    ["installertools", "jarsplitter", "binarypatcher", "ForgeAutoRenamingTool", "AutoRenamingTool"].includes(name), 422, "Forge 官方处理器类型尚未适配");
  if (name === "installertools") {
    const task = args[args.indexOf("--task") + 1]; invariant(["MCP_DATA", "DOWNLOAD_MOJMAPS", "MERGE_MAPPING"].includes(task), 422, "Forge 安装任务尚未适配");
  }
}
export async function runForgeProcessor(java: string, classpath: string[], main: string, args: string[], directory: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const env: NodeJS.ProcessEnv = { NODE_ENV: "production" };
  for (const key of ["PATH", "Path", "SystemRoot", "WINDIR", "LANG", "LC_ALL"]) if (process.env[key]) env[key] = process.env[key];
  env.TEMP = directory; env.TMP = directory;
  const timeout = AbortSignal.any([signal, AbortSignal.timeout(10 * 60 * 1000)]);
  await new Promise<void>((yes, no) => {
    const child = spawn(java, ["-Xmx2G", `-Djava.io.tmpdir=${directory}`, "-Djava.awt.headless=true", "-cp", classpath.join(delimiter), main, ...args],
      { cwd: directory, env, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let log = "", settled = false;
    const finish = (error?: Error) => { if (settled) return; settled = true; timeout.removeEventListener("abort", abort); if (error) no(error); else yes(); };
    const abort = () => child.kill(); timeout.addEventListener("abort", abort, { once: true });
    for (const stream of [child.stdout, child.stderr]) stream.on("data", (bytes: Buffer) => { log = (log + bytes.toString()).slice(-8192); });
    child.on("error", error => finish(new Error(`无法执行 Forge 处理器 Java，请配置 FORGE_PROCESSOR_JAVA：${error.message}`)));
    child.on("close", code => finish(timeout.aborted ? new Error("Forge 处理器已取消或超过十分钟") : code === 0 ? undefined : new Error(`Forge 处理器失败 (${code})：${log.slice(-2000)}`)));
    if (timeout.aborted) abort();
  }); signal.throwIfAborted();
}

type Dependencies = {
  downloader: ReturnType<typeof createEnvironmentDownloader>;
  remote: (path: string, url: string, expected: EnvironmentExpected) => Promise<{ file: MuaFile; local: string }>;
  store: (path: string, local: string) => Promise<MuaFile>;
};
export async function prepareForgeInstaller(type: "forge" | "neoforge", minecraft: string, version: string, directory: string, signal: AbortSignal, deps: Dependencies) {
  const source = forgeInstallerSource(type, minecraft, version);
  const hash = (await deps.downloader.bytes(source.url + ".sha1", signal, 1024, { validate: bytes => invariant(/^[a-f0-9]{40}(?:\s|$)/.test(bytes.toString().trim()), 422, "Forge 安装器缺少 SHA-1") })).toString().trim().split(/\s/)[0];
  const installer = await deps.remote("installer.jar", source.url, { algorithm: "sha1", hash });
  const work = join(directory, `forge-${randomUUID()}`); await mkdir(work);
  const archive = join(work, "archive"); await mkdir(archive);
  const entries = new Map((await unpackEnvironment(installer.local, archive, "zip", false, signal)).map(entry => [entry.path, entry]));
  const read = async (path: string) => { const entry = entries.get(safePackPath(path.replace(/^\//, ""))); invariant(entry && entry.size <= 16 * 1024 ** 2, 422, "Forge 安装元数据缺失或过大"); return readFile(entry.local); };
  const install = installSchema.parse(JSON.parse((await read("install_profile.json")).toString()));
  invariant(install.minecraft === minecraft, 422, "Forge 安装器 Minecraft 版本不匹配");
  const bytes = await read(install.json); const profile = runtimeSchema.parse(JSON.parse(bytes.toString())) as RuntimeProfile;
  invariant(profile.inheritsFrom === minecraft && profile.id === install.version && profile.id.includes(version.replace(`${minecraft}-`, "")), 422, "Forge 加载配置身份不匹配");
  for (const proc of install.processors.filter(proc => !proc.sides || proc.sides.includes("client"))) forgeProcessorAllowed(proc.jar, proc.args);
  return { install, profile, bytes, installer, entries, work, deps };
}
export async function installForgeClient(prepared: Awaited<ReturnType<typeof prepareForgeInstaller>>, minecraftJar: string,
  mappings: { url: string; sha1: string; size: number } | undefined, signal: AbortSignal, progress: (message: string) => Promise<void>) {
  const { install, profile, work, entries, deps, installer } = prepared;
  const root = join(work, "instance"), lib = join(root, "libraries"); await mkdir(lib, { recursive: true });
  const base = join(root, "versions", install.minecraft, install.minecraft + ".jar"); await mkdir(dirname(base), { recursive: true }); await copyFile(minecraftJar, base);
  const locals = new Map<string, { path: string; sha1: string }>();
  const runtime = new Set(profile.libraries.map(library => forgeArtifactPath(library.name)));
  const all = new Map<string, z.infer<typeof librarySchema>>();
  for (const library of [...install.libraries, ...profile.libraries]) {
    const path = forgeArtifactPath(library.name); invariant(path === library.downloads.artifact.path, 422, "Forge 库路径与坐标不一致");
    const previous = all.get(path); invariant(!previous || previous.downloads.artifact.sha1 === library.downloads.artifact.sha1, 422, "Forge 同路径库摘要冲突"); all.set(path, library);
  }
  let count = 0;
  // Installation libraries are not added to the runtime classpath.
  for (const [path, library] of all) {
    signal.throwIfAborted(); const artifact = library.downloads.artifact, target = join(lib, path); await mkdir(dirname(target), { recursive: true });
    if (artifact.url) { const downloaded = await deps.remote(`libraries/${path}`, artifact.url, { algorithm: "sha1", hash: artifact.sha1, size: artifact.size }); await copyFile(downloaded.local, target); }
    else { const embedded = entries.get(`maven/${path}`); if (embedded) await copyFile(embedded.local, target); else continue; }
    const checked = await hashFile(target, "sha1", signal); invariant(checked.hash === artifact.sha1 && checked.size === artifact.size, 422, "Forge 库摘要不符");
    locals.set(path, { path: target, sha1: checked.hash });
    if (++count % 10 === 0) await progress(`下载 Forge 安装依赖 ${count}/${all.size}`);
  }
  const data: Record<string, string> = { SIDE: "client", MINECRAFT_JAR: base, MINECRAFT_VERSION: install.minecraft,
    ROOT: root, INSTALLER: installer.local, LIBRARY_DIR: lib };
  for (const [key, value] of Object.entries(install.data)) {
    invariant(!Object.hasOwn(data, key) && /^[A-Z_]+$/.test(key), 422, "Forge 安装变量无效");
    if (value.client.startsWith("[") && value.client.endsWith("]")) { data[key] = forgeToken(value.client, {}, root); await mkdir(dirname(data[key]), { recursive: true }); }
    else if (value.client.startsWith("'") && value.client.endsWith("'")) {
      data[key] = value.client.slice(1, -1); invariant(/^[A-Za-z0-9_.+-]+$/.test(data[key]), 422, "Forge 安装字面量无效");
    }
    else { const entry = entries.get(safePackPath(value.client.replace(/^\//, ""))); invariant(entry, 422, "Forge 安装数据不存在"); data[key] = entry.local; }
  }
  const processors = install.processors.filter(proc => !proc.sides || proc.sides.includes("client"));
  for (const [index, proc] of processors.entries()) {
    signal.throwIfAborted(); await progress(`处理 ${profile.id} ${index + 1}/${processors.length} · ${proc.jar.split(":")[1]}`);
    const args = proc.args.map(arg => forgeToken(arg, data, root));
    for (const [key, value] of Object.entries(proc.outputs)) {
      contained(root, forgeToken(key, data, root)); invariant(/^[a-f0-9]{40}$/.test(forgeToken(value, data, root)), 422, "Forge 输出摘要无效");
    }
    if (proc.jar.split(":")[1] === "installertools" && proc.args[proc.args.indexOf("--task") + 1] === "DOWNLOAD_MOJMAPS") {
      invariant(mappings && data.MOJMAPS, 422, "Minecraft 官方客户端 mappings 缺失");
      const target = contained(root, data.MOJMAPS); await mkdir(dirname(target), { recursive: true });
      const downloaded = await deps.remote("client-mappings.txt", mappings.url, { algorithm: "sha1", hash: mappings.sha1, size: mappings.size }); await copyFile(downloaded.local, target);
    } else {
      const paths = [...new Set([proc.jar, ...proc.classpath])].map(coordinate => {
        const item = locals.get(forgeArtifactPath(coordinate)); invariant(item, 422, "Forge 处理器依赖未校验"); return item.path;
      });
      const jar = paths[0]; const main = await mainClass(jar);
      await runForgeProcessor(process.env.FORGE_PROCESSOR_JAVA || (process.env.JAVA_HOME ? join(process.env.JAVA_HOME, "bin", process.platform === "win32" ? "java.exe" : "java") : "java"), paths, main, args, work, signal);
    }
    for (const [key, value] of Object.entries(proc.outputs)) invariant((await hashFile(forgeToken(key, data, root), "sha1", signal)).hash === forgeToken(value, data, root), 422, "Forge 处理器输出哈希不符");
  }
  for (const item of locals.values()) invariant((await hashFile(item.path, "sha1", signal)).hash === item.sha1, 422, "Forge 处理器修改了已校验依赖");
  const files: MuaFile[] = []; let total = 0;
  for (const path of runtime) {
    const target = contained(root, join(lib, path)); const expected = all.get(path)!.downloads.artifact;
    const check = await hashFile(target, "sha1", signal); invariant(check.hash === expected.sha1 && check.size === expected.size, 422, "Forge 运行产物摘要不符");
    total += check.size; invariant(total <= 10 * 1024 ** 3, 422, "Forge 环境超过 10 GiB"); files.push(await deps.store(`libraries/${path}`, target));
  }
  // Loader payload embedded in the signed-by-digest installer and generated game jars
  // may be absent from version.json; FML resolves them from the library directory.
  for (const [path, entry] of entries) if (path.startsWith("maven/") && path.endsWith(".jar")) {
    const name = safePackPath(path.slice(6)); if (!files.some(file => file.path === `libraries/${name}`)) {
      files.push(await deps.store(`libraries/${name}`, entry.local)); runtime.add(name);
    }
  }
  for (const key of ["MC_EXTRA", "PATCHED"]) if (data[key]) {
    const target = contained(root, data[key]); const path = safePackPath(relative(root, target).split(sep).join("/"));
    if (data[key + "_SHA"]) invariant((await hashFile(target, "sha1", signal)).hash === data[key + "_SHA"], 422, "Forge 最终产物摘要不符");
    if (!files.some(file => file.path === path)) files.push(await deps.store(path, target));
    if (key === "MC_EXTRA") runtime.add(path.slice("libraries/".length));
  }
  return { files, classpath: [...runtime].map(path => `libraries/${path}`) };
}
