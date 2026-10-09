import catalog from "../data/minecraft-runtimes.json";

type RuntimeEntry = { javaVersion: number; javaComponent: string; type: string; sourceUrl: string; sha1: string; sourceKind?: string };
export function minecraftJava(version: string): { javaVersion: number; javaComponent: string | null; source: string } | null {
  const entry = Object.hasOwn(catalog.versions, version) ? (catalog.versions as Record<string, RuntimeEntry>)[version] : undefined;
  if (entry) return { javaVersion: entry.javaVersion, javaComponent: entry.javaComponent, source: entry.sourceKind === "legacy-default" ? "旧版 Minecraft 推荐 Java 8（元数据未声明）" : "Mojang 官方版本目录" };
  // Bounded, offline defaults only for verified release families. Never guess snapshots or future releases.
  const match = /^1\.(\d+)(?:\.(\d+))?$/.exec(version);
  if (match) {
    const minor = Number(match[1]); const patch = Number(match[2] ?? 0);
    const lastLegacyPatch: Record<number, number> = { 7: 10, 8: 9, 9: 4, 10: 2, 11: 2, 12: 2, 13: 2, 14: 4, 15: 2, 16: 5 };
    const javaVersion = minor >= 7 && minor <= 16 && patch <= lastLegacyPatch[minor] ? 8 : minor === 17 && patch <= 1 ? 16 :
      minor >= 18 && minor <= 19 ? 17 : minor === 20 && patch <= 4 ? 17 :
      minor === 20 && patch <= 6 || minor === 21 && patch <= 11 ? 21 : null;
    if (javaVersion) return { javaVersion, javaComponent: null, source: "已核实版本范围的离线默认值" };
  }
  return version === "26.1" ? { javaVersion: 25, javaComponent: "java-runtime-epsilon", source: "已核实版本的离线默认值" } : null;
}
