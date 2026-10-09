import "server-only";
import type { ClientInspection, DetectedRuntime } from "./client-contract";
import { minecraftJava } from "./minecraft-java";
import { invariant } from "./errors";

type Json = Record<string, unknown>;
const object = (value: unknown): Json => value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
const string = (value: unknown): string | null => typeof value === "string" && value.trim().length > 0 && value.length <= 100 ? value.trim() : null;
const major = (value: unknown): number | null => typeof value === "number" && Number.isInteger(value) && value >= 7 && value <= 25 ? value : null;
export type MetadataReader = { json: (path: string) => Promise<unknown>; jar: (path: string) => Promise<unknown> };
function empty(instanceId: string | null): DetectedRuntime {
  return { instanceId, minecraftVersion: null, javaVersion: null, javaComponent: null, loader: null, loaderVersion: null,
    minecraftSource: null, javaSource: null, warnings: [] };
}
function loader(json: Json) {
  const patches = Array.isArray(json.patches) ? json.patches.map(object) : [];
  for (const name of ["neoforge", "forge", "fabric", "quilt"]) {
    const patch = patches.find(patch => patch.id === name);
    if (patch) return { loader: name, loaderVersion: string(patch.version) };
  }
  const game = object(json.arguments).game; const args = Array.isArray(game) ? game : [];
  const arg = (key: string) => { const at = args.indexOf(key); return at >= 0 ? string(args[at + 1]) : null; };
  if (arg("--fml.neoForgeVersion")) return { loader: "neoforge", loaderVersion: arg("--fml.neoForgeVersion") };
  if (arg("--fml.forgeVersion")) return { loader: "forge", loaderVersion: arg("--fml.forgeVersion") };
  const libraries = Array.isArray(json.libraries) ? json.libraries.map(lib => string(object(lib).name)).filter(Boolean) as string[] : [];
  for (const [name, prefix] of [["fabric", "net.fabricmc:fabric-loader:"], ["quilt", "org.quiltmc:quilt-loader:"],
    ["neoforge", "net.neoforged:neoforge:"], ["forge", "net.minecraftforge:forge:"]] as const) {
    const library = libraries.find(lib => lib.startsWith(prefix));
    if (library) return { loader: name, loaderVersion: library.slice(prefix.length).split(":")[0] };
  }
  return { loader: null, loaderVersion: null };
}
function gameHints(json: Json, path: string): { value: string; source: string }[] {
  const hints: { value: string; source: string }[] = [];
  const add = (value: unknown, field: string) => { const text = string(value); if (text) hints.push({ value: text, source: `${path} · ${field}` }); };
  add(json.clientVersion, "clientVersion");
  if (Array.isArray(json.patches)) for (const item of json.patches) {
    const patch = object(item); if (patch.id === "game") add(patch.version, "patches[game].version");
  }
  const game = object(json.arguments).game;
  if (Array.isArray(game)) { const at = game.indexOf("--fml.mcVersion"); if (at >= 0) add(game[at + 1], "--fml.mcVersion"); }
  // The id is often a custom instance name. Accept it only when it is a plain game version identifier.
  if (typeof json.id === "string" && /^(?:1\.\d+(?:\.\d+)?|\d{2}\.\d+(?:\.\d+)?|\d{2}w\d{2}[a-z])$/.test(json.id)) add(json.id, "id");
  return hints;
}
export async function inspectMinecraftRuntime(paths: readonly string[], reader: MetadataReader, selectedInstanceId?: string | null): Promise<ClientInspection> {
  const versions = new Map<string, { path: string; json: Json }>(); const warnings: string[] = [];
  const metadataPaths = paths.filter(path => { const match = /^versions\/([^/]+)\/([^/]+)\.json$/i.exec(path); return match && match[1] === match[2]; });
  invariant(metadataPaths.length <= 64, 422, "客户端包含超过 64 个版本，请精简后上传");
  for (const path of metadataPaths) {
    const id = path.split("/")[1];
    try { versions.set(id, { path, json: object(await reader.json(path)) }); }
    catch (error) { if (!(error instanceof SyntaxError)) throw error; versions.set(id, { path, json: {} }); warnings.push(`${path} 无法解析，请手动确认运行环境。`); }
  }
  const parents = new Set([...versions.values()].map(version => string(version.json.inheritsFrom)).filter(Boolean));
  let ids = [...versions.keys()].filter(id => !parents.has(id));
  if (!ids.length && versions.size) { ids = [...versions.keys()]; warnings.push("版本继承关系存在循环，请检查客户端。"); }
  invariant(!selectedInstanceId || ids.includes(selectedInstanceId), 422, "所选实例不属于此整合包的可用实例");
  const candidates: DetectedRuntime[] = [];
  for (const id of ids) {
    const result = empty(id); const seen = new Set<string>(); const chain: { path: string; json: Json; id: string }[] = [];
    let next: string | null = id;
    while (next) {
      if (seen.has(next) || seen.size >= 16) { result.warnings.push("版本继承存在循环或层级过深，请手动确认。"); break; }
      seen.add(next); const version = versions.get(next);
      if (!version) {
        const known = minecraftJava(next);
        if (known) { chain.push({ id: next, path: `父版本 ${next}`, json: { id: next } }); }
        result.warnings.push(`包内缺少父版本 ${next}，请检查游戏文件是否完整。`); break;
      }
      chain.push({ ...version, id: next }); next = string(version.json.inheritsFrom);
    }
    const hints = chain.flatMap(version => gameHints(version.json, version.path));
    const loaderInfo = chain.map(version => loader(version.json)).find(info => info.loader);
    if (loaderInfo) Object.assign(result, loaderInfo);
    for (const version of chain) {
      const java = object(version.json.javaVersion);
      const gamePatch = Array.isArray(version.json.patches) ? version.json.patches.map(object).find(patch => patch.id === "game") : null;
      const runtime = major(java.majorVersion) ? java : object(gamePatch?.javaVersion);
      if (major(runtime.majorVersion)) {
        result.javaVersion = major(runtime.majorVersion); result.javaComponent = string(runtime.component);
        result.javaSource = `${version.path} · javaVersion`; break;
      }
      if (java.majorVersion !== undefined) result.warnings.push("JSON 中的 Java 版本不在当前支持的 Java 7–25 范围内。");
    }
    // Cross-check game identity using an embedded, bounded version.json. Never execute uploaded code.
    for (const version of chain) {
      const jarId = string(version.json.jar) ?? version.id;
      if (jarId.includes("/") || jarId.includes("\\") || jarId === "." || jarId === "..") continue;
      const jarPath = `versions/${jarId}/${jarId}.jar`;
      if (!paths.includes(jarPath)) continue;
      let embedded: Json = {};
      try { embedded = object(await reader.jar(jarPath)); }
      catch (error) { if (!(error instanceof SyntaxError)) throw error; result.warnings.push(`${jarPath} 内的版本元数据无法解析。`); }
      if (string(embedded.id)) hints.push({ value: string(embedded.id)!, source: `${jarPath}!version.json · id` });
      const jarJava = major(embedded.java_version);
      if (jarJava && result.javaVersion && jarJava > result.javaVersion) {
        result.warnings.push(`JSON 声明 Java ${result.javaVersion}，游戏 JAR 至少需要 Java ${jarJava}，已采用 Java ${jarJava}。`);
        result.javaVersion = jarJava; result.javaSource = `${jarPath}!version.json · java_version`;
      } else if (jarJava && !result.javaVersion) { result.javaVersion = jarJava; result.javaSource = `${jarPath}!version.json · java_version`; }
      if (!result.javaComponent) result.javaComponent = string(embedded.java_component);
      if (embedded.id) break;
    }
    if (new Set(hints.map(hint => hint.value)).size > 1) {
      result.warnings.push(`Minecraft 版本信息冲突：${[...new Set(hints.map(hint => hint.value))].join(" / ")}，请手动确认。`);
      result.javaVersion = null; result.javaComponent = null; result.javaSource = null;
    } else if (hints[0]) { result.minecraftVersion = hints[0].value; result.minecraftSource = hints[0].source; }
    const known = result.minecraftVersion ? minecraftJava(result.minecraftVersion) : null;
    if (known && (!result.javaVersion || result.javaVersion < known.javaVersion)) {
      if (result.javaVersion) result.warnings.push(`Java 声明低于该 Minecraft 版本的默认要求，已采用 Java ${known.javaVersion}。`);
      if (known.javaVersion <= 25) { result.javaVersion = known.javaVersion; result.javaComponent = known.javaComponent; result.javaSource = known.source; }
    }
    if (!result.minecraftVersion) result.warnings.push("未能确定 Minecraft 版本，请手动填写。");
    if (!result.javaVersion) result.warnings.push("未能确定 Java 环境，请手动选择。");
    candidates.push(result);
  }
  const selected = candidates.find(candidate => candidate.instanceId === selectedInstanceId) ?? (candidates.length === 1 ? candidates[0] : empty(null));
  if (!candidates.length) warnings.push("包内未找到版本 JSON，MC 与 Java 需要手动填写。");
  const requiresSelection = candidates.length > 1 && !selectedInstanceId;
  return { ...selected, warnings: [...warnings, ...selected.warnings], schemaVersion: 1, requiresSelection, candidates };
}
