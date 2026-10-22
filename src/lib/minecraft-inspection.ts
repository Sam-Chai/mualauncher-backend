import { diagnosticText } from "@/lib/diagnostics";
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
  invariant(metadataPaths.length <= 64, 422, diagnosticText("diagnostics.minecraftInspection.theClientContainsMoreThan64VersionsRemoveUnusedVersions"));
  for (const path of metadataPaths) {
    const id = path.split("/")[1];
    try { versions.set(id, { path, json: object(await reader.json(path)) }); }
    catch (error) { if (!(error instanceof SyntaxError)) throw error; versions.set(id, { path, json: {} }); warnings.push(diagnosticText("diagnostics.minecraftInspection.unableToParse0ConfirmTheRuntimeManually", { arg0: path })); }
  }
  const parents = new Set([...versions.values()].map(version => string(version.json.inheritsFrom)).filter(Boolean));
  let ids = [...versions.keys()].filter(id => !parents.has(id));
  if (!ids.length && versions.size) { ids = [...versions.keys()]; warnings.push(diagnosticText("diagnostics.minecraftInspection.versionInheritanceContainsACycleCheckTheClient")); }
  invariant(!selectedInstanceId || ids.includes(selectedInstanceId), 422, diagnosticText("diagnostics.minecraftInspection.theSelectedInstanceIsNotAnAvailableInstanceInThis"));
  const candidates: DetectedRuntime[] = [];
  for (const id of ids) {
    const result = empty(id); const seen = new Set<string>(); const chain: { path: string; json: Json; id: string }[] = [];
    let next: string | null = id;
    while (next) {
      if (seen.has(next) || seen.size >= 16) { result.warnings.push(diagnosticText("diagnostics.minecraftInspection.versionInheritanceIsCyclicOrTooDeepConfirmTheRuntime")); break; }
      seen.add(next); const version = versions.get(next);
      if (!version) {
        const known = minecraftJava(next);
        if (known) { chain.push({ id: next, path: diagnosticText("diagnostics.minecraftInspection.parentVersion0", { arg0: next }), json: { id: next } }); }
        result.warnings.push(diagnosticText("diagnostics.minecraftInspection.parentVersion0IsMissingFromThePackCheckThat", { arg0: next })); break;
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
      if (java.majorVersion !== undefined) result.warnings.push(diagnosticText("diagnostics.minecraftInspection.theJavaVersionInJsonIsOutsideTheSupportedJava"));
    }
    // Cross-check game identity using an embedded, bounded version.json. Never execute uploaded code.
    for (const version of chain) {
      const jarId = string(version.json.jar) ?? version.id;
      if (jarId.includes("/") || jarId.includes("\\") || jarId === "." || jarId === "..") continue;
      const jarPath = `versions/${jarId}/${jarId}.jar`;
      if (!paths.includes(jarPath)) continue;
      let embedded: Json = {};
      try { embedded = object(await reader.jar(jarPath)); }
      catch (error) { if (!(error instanceof SyntaxError)) throw error; result.warnings.push(diagnosticText("diagnostics.minecraftInspection.unableToParseVersionMetadataIn0", { arg0: jarPath })); }
      if (string(embedded.id)) hints.push({ value: string(embedded.id)!, source: `${jarPath}!version.json · id` });
      const jarJava = major(embedded.java_version);
      if (jarJava && result.javaVersion && jarJava > result.javaVersion) {
        result.warnings.push(diagnosticText("diagnostics.minecraftInspection.jsonDeclaresJava0ButTheGameJarRequiresAt", { arg0: result.javaVersion, arg1: jarJava, arg2: jarJava }));
        result.javaVersion = jarJava; result.javaSource = `${jarPath}!version.json · java_version`;
      } else if (jarJava && !result.javaVersion) { result.javaVersion = jarJava; result.javaSource = `${jarPath}!version.json · java_version`; }
      if (!result.javaComponent) result.javaComponent = string(embedded.java_component);
      if (embedded.id) break;
    }
    if (new Set(hints.map(hint => hint.value)).size > 1) {
      result.warnings.push(diagnosticText("diagnostics.minecraftInspection.conflictingMinecraftVersions0ConfirmTheVersionManually", { arg0: [...new Set(hints.map(hint => hint.value))].join(" / ") }));
      result.javaVersion = null; result.javaComponent = null; result.javaSource = null;
    } else if (hints[0]) { result.minecraftVersion = hints[0].value; result.minecraftSource = hints[0].source; }
    const known = result.minecraftVersion ? minecraftJava(result.minecraftVersion) : null;
    if (known && (!result.javaVersion || result.javaVersion < known.javaVersion)) {
      if (result.javaVersion) result.warnings.push(diagnosticText("diagnostics.minecraftInspection.theDeclaredJavaVersionIsBelowTheDefaultMinecraftRequirement", { arg0: known.javaVersion }));
      if (known.javaVersion <= 25) { result.javaVersion = known.javaVersion; result.javaComponent = known.javaComponent; result.javaSource = known.source; }
    }
    if (!result.minecraftVersion) result.warnings.push(diagnosticText("diagnostics.minecraftInspection.theMinecraftVersionCouldNotBeDeterminedEnterItManually"));
    if (!result.javaVersion) result.warnings.push(diagnosticText("diagnostics.minecraftInspection.theJavaRuntimeCouldNotBeDeterminedSelectItManually"));
    candidates.push(result);
  }
  const selected = candidates.find(candidate => candidate.instanceId === selectedInstanceId) ?? (candidates.length === 1 ? candidates[0] : empty(null));
  if (!candidates.length) warnings.push(diagnosticText("diagnostics.minecraftInspection.noVersionJsonWasFoundInThePackEnterMinecraft"));
  const requiresSelection = candidates.length > 1 && !selectedInstanceId;
  return { ...selected, warnings: [...warnings, ...selected.warnings], schemaVersion: 1, requiresSelection, candidates };
}
