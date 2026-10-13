import { z } from "zod";
import { recipeFileSchema } from "./recipe-inventory";

const bytes = z.number().int().nonnegative();
export const recipeDistributionSchema = z.object({
  formatVersion: z.literal(2),
  base: z.object({ releaseId: z.string().uuid(), version: z.string(), manifestSha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict().nullable(),
  localFiles: bytes, localBytes: bytes, remoteFiles: bytes, remoteDeclaredBytes: bytes, optionalFiles: bytes,
  localPayloadBytes: bytes, remoteDownloadBytes: bytes,
  fullPackageBytes: bytes.nullable(), updatePackageBytes: bytes.nullable(), selectedPackageBytes: bytes.nullable(),
  knownNetworkBytes: bytes.nullable(), environmentBytes: z.null(),
  runtimeChanged: z.boolean().nullable(), launchChanged: z.boolean().nullable(),
  changes: z.array(z.object({ path: z.string(), kinds: z.array(z.enum(["added", "modified", "removed", "policy", "source"])), before: recipeFileSchema.nullable(), after: recipeFileSchema.nullable() }).strict()),
}).strict();
export type RecipeDistributionStatistics = z.infer<typeof recipeDistributionSchema>;

const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
type File = z.infer<typeof recipeFileSchema>;
const contentEqual = (a: File, b: File) => a.size === b.size && a.source.type === b.source.type &&
  (a.source.type === "remote" && b.source.type === "remote" ? "sha512" in a.hashes && "sha512" in b.hashes && a.hashes.sha512 === b.hashes.sha512 : a.hashes.sha256 === b.hashes.sha256);

// Forecast assumes a complete baseline and all optional files selected, without a player cache.
// ZIP bytes and remote content bytes are separate; environment sizes are deliberately unknown.
export function recipeDistribution(files: File[], base: { files: File[]; reference: NonNullable<RecipeDistributionStatistics["base"]> } | null,
  packages: { full: number | null; update: number | null } = { full: null, update: null }): RecipeDistributionStatistics {
  const previous = new Map((base?.files ?? []).map(file => [file.path, file]));
  const current = new Set(files.map(file => file.path));
  const changes: RecipeDistributionStatistics["changes"] = [];
  const localPayload = new Map<string, File>(), remoteDownloads = new Map<string, number>();
  for (const file of files) {
    const old = previous.get(file.path), kinds: RecipeDistributionStatistics["changes"][number]["kinds"] = [];
    if (!old) kinds.push("added");
    else {
      if (old.source.type !== file.source.type || !equal(old.hashes, file.hashes) || old.size !== file.size || old.executable !== file.executable) kinds.push("modified");
      if (old.policy !== file.policy || old.optional !== file.optional) kinds.push("policy");
      if (!kinds.includes("modified") && old.source.type === "remote" && file.source.type === "remote" && !equal(old.source.downloads, file.source.downloads)) kinds.push("source");
    }
    if (kinds.length) changes.push({ path: file.path, kinds, before: old ?? null, after: file });
    if (file.source.type === "local" && (!base || kinds.some(kind => ["added", "modified", "policy"].includes(kind)))) localPayload.set(file.path, file);
    if (file.source.type === "remote" && (!base || !old || !contentEqual(old, file))) {
      const hash = "sha512" in file.hashes ? file.hashes.sha512 : "";
      remoteDownloads.set(hash, file.size);
    }
  }
  for (const old of base?.files ?? []) if (!current.has(old.path)) changes.push({ path: old.path, kinds: ["removed"], before: old, after: null });
  const local = files.filter(file => file.source.type === "local"), remote = files.filter(file => file.source.type === "remote");
  const remoteDownloadBytes = [...remoteDownloads.values()].reduce((sum, size) => sum + size, 0);
  const selectedPackageBytes = base ? packages.update : packages.full;
  return { formatVersion: 2, base: base?.reference ?? null, localFiles: local.length, localBytes: local.reduce((sum, file) => sum + file.size, 0),
    remoteFiles: remote.length, remoteDeclaredBytes: remote.reduce((sum, file) => sum + file.size, 0), optionalFiles: files.filter(file => file.optional).length,
    localPayloadBytes: [...localPayload.values()].reduce((sum, file) => sum + file.size, 0), remoteDownloadBytes,
    fullPackageBytes: packages.full, updatePackageBytes: packages.update, selectedPackageBytes,
    knownNetworkBytes: selectedPackageBytes === null ? null : selectedPackageBytes + remoteDownloadBytes,
    environmentBytes: null, runtimeChanged: null, launchChanged: null, changes };
}
