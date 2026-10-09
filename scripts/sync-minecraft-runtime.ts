import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";

const manifestUrl = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
type Version = { id: string; type: string; url: string; sha1: string };
async function main() {
  const response = await fetch(manifestUrl, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error("Mojang version catalogue request failed");
  const manifest = await response.json() as { versions: Version[] };
  const queue = manifest.versions.filter(version => version.type === "release" || process.argv.includes("--snapshots") && version.type === "snapshot");
  const versions: Record<string, { javaVersion: number; javaComponent: string; type: string; sourceUrl: string; sha1: string; sourceKind: string }> = {};
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (;;) {
      const version = queue.shift(); if (!version) return;
      const url = new URL(version.url);
      if (url.protocol !== "https:" || url.hostname !== "piston-meta.mojang.com" || !url.pathname.startsWith("/v1/packages/")) throw new Error("Unexpected Mojang metadata URL");
      const reply = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!reply.ok) throw new Error("Mojang metadata request failed: " + version.id);
      const bytes = Buffer.from(await reply.arrayBuffer());
      if (bytes.length > 2 * 1024 ** 2 || createHash("sha1").update(bytes).digest("hex") !== version.sha1) throw new Error("Mojang metadata integrity check failed: " + version.id);
      const data = JSON.parse(bytes.toString("utf8"));
      if (data.id !== version.id) throw new Error("Mojang version identity mismatch: " + version.id);
      const explicit = Number.isInteger(data.javaVersion?.majorVersion);
      const legacy = /^1\.(\d+)(?:\.\d+)?$/.exec(version.id);
      if (!explicit && !(legacy && Number(legacy[1]) <= 16)) throw new Error("Mojang runtime metadata missing: " + version.id);
      versions[version.id] = { javaVersion: explicit ? data.javaVersion.majorVersion : 8, javaComponent: explicit ? data.javaVersion.component : "jre-legacy",
        type: version.type, sourceUrl: version.url, sha1: version.sha1, sourceKind: explicit ? "mojang-javaVersion" : "legacy-default" };
    }
  }));
  const sorted = Object.fromEntries(Object.entries(versions).sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(new URL("../src/data/minecraft-runtimes.json", import.meta.url), JSON.stringify({ schemaVersion: 1, updatedAt: new Date().toISOString(), versions: sorted }, null, 2) + "\n");
  console.log(`Verified ${Object.keys(versions).length} Minecraft runtime records`);
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Runtime sync failed"); process.exitCode = 1; });
