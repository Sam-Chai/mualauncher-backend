import "server-only";
import { invariant } from "./errors";
import { MAX_MODS, type PackFile } from "./client-contract";
import { inspectMinecraftRuntime, type MetadataReader } from "./minecraft-inspection";
import { inspectModrinthIndex } from "./modrinth-inspection";

export type PackFormat = "minecraft-zip" | "curseforge" | "modrinth" | "pcl" | "multimc";
type PackAdapter = {
  format: PackFormat;
  matches: (paths: readonly string[]) => boolean;
  rootPrefix?: (paths: readonly string[]) => string;
  mods?: (files: readonly PackFile[], instanceId?: string | null) => string[];
  runtime?: typeof inspectMinecraftRuntime;
};
function hasMarker(paths: readonly string[], marker: string) {
  return paths.some(path => {
    const parts = path.split("/");
    return parts.length <= 2 && !parts.includes(".minecraft") && parts.at(-1) === marker;
  });
}
function minecraftRoot(paths: readonly string[]) {
  const roots = new Set(paths.flatMap(path => {
    const parts = path.split("/"); const at = parts.indexOf(".minecraft");
    return at >= 0 ? [parts.slice(0, at + 1).join("/") + "/"] : [];
  }));
  invariant(roots.size <= 1, 422, "ZIP 中包含多个 .minecraft 目录，请只上传一个完整客户端");
  if (roots.size) return [...roots][0];
  const recognizable = /^(mods|config|versions|libraries|assets|resourcepacks|shaderpacks|saves)\//;
  if (paths.some(path => recognizable.test(path))) return "";
  const first = paths[0]?.split("/")[0];
  if (first && paths.every(path => path.startsWith(first + "/")) && paths.some(path => recognizable.test(path.slice(first.length + 1)))) return first + "/";
  invariant(false, 422, "未找到 .minecraft 客户端目录；可压缩 .minecraft 目录或其内部文件");
}
function minecraftMods(files: readonly PackFile[], instanceId?: string | null) {
  // Paths are relative to the normalized game root and have already passed ZIP validation.
  // Keep subdirectory paths to distinguish different JARs with the same basename.
  const instancePrefix = instanceId ? `versions/${instanceId}/` : null;
  const isolated = instancePrefix && files.some(file => file.path.startsWith(instancePrefix) && /^(mods\/|config\/|resourcepacks\/|shaderpacks\/|saves\/|options.*\.txt$)/i.test(file.path.slice(instancePrefix.length)));
  const mods = files.filter(file => isolated ? file.path.startsWith(instancePrefix + "mods/") && /\.jar$/i.test(file.path) : /^mods\/.+\.jar$/i.test(file.path))
    .map(file => isolated ? file.path : file.path.slice(5))
    .sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  invariant(mods.length <= MAX_MODS, 422, `模组数量超过 ${MAX_MODS}，请精简客户端后重新上传`);
  return mods;
}
// A format's detection, game-root normalization and mod inspection live in one adapter.
// Unsupported formats keep detection here; Modrinth/PCL share the normalized import pipeline.
const adapters: readonly PackAdapter[] = [
  { format: "modrinth", matches: paths => hasMarker(paths, "modrinth.index.json"), rootPrefix: paths => {
    invariant(paths.includes("modrinth.index.json"), 422, "modrinth.index.json 必须位于包根目录"); return "";
  }, mods: minecraftMods, runtime: async (_paths, reader) => inspectModrinthIndex(await reader.json("modrinth.index.json")).info },
  { format: "pcl", matches: paths => paths.some(path => /\.mrpack$/i.test(path)) && paths.includes("PCL/Setup.ini"), rootPrefix: () => "", mods: minecraftMods },
  { format: "curseforge", matches: paths => hasMarker(paths, "manifest.json") },
  { format: "multimc", matches: paths => hasMarker(paths, "mmc-pack.json") },
  { format: "minecraft-zip", matches: () => true, rootPrefix: minecraftRoot, mods: minecraftMods, runtime: inspectMinecraftRuntime },
];
export function detectPackFormat(paths: readonly string[]): PackFormat {
  const marked = adapters.filter(adapter => adapter.format !== "minecraft-zip" && adapter.matches(paths));
  invariant(marked.length <= 1, 422, "ZIP 中包含多个整合包类型标记，请上传单一整合包");
  return (marked[0] ?? adapters[adapters.length - 1]).format;
}
export function inspectPackLayout(paths: readonly string[]) {
  const format = detectPackFormat(paths); const adapter = adapters.find(adapter => adapter.format === format)!;
  invariant(adapter.rootPrefix && adapter.mods, 422, "当前支持 .minecraft ZIP、Modrinth 和 PCL 封装；CurseForge 和 MultiMC 尚未接入");
  return { format, rootPrefix: adapter.rootPrefix(paths) };
}
export function inspectPackMods(format: PackFormat, files: readonly PackFile[], instanceId?: string | null) {
  const adapter = adapters.find(adapter => adapter.format === format);
  invariant(adapter?.mods, 422, "此整合包格式尚未接入模组识别");
  return adapter.mods(files, instanceId);
}
export function inspectPackRuntime(format: PackFormat, paths: readonly string[], reader: MetadataReader, selectedInstanceId?: string | null) {
  const adapter = adapters.find(adapter => adapter.format === format);
  invariant(adapter?.runtime, 422, "此整合包格式尚未接入运行环境识别");
  return adapter.runtime(paths, reader, selectedInstanceId);
}
