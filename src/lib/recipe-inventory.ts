import { z } from "zod";
import { invariant } from "./errors";
import { safePackPath } from "./pack-path";

const common = { path: z.string(), size: z.number().int().min(0).max(2 * 1024 ** 3),
  policy: z.enum(["managed", "preserve"]), optional: z.boolean(), executable: z.boolean() };
export const recipeFileSchema = z.union([
  z.object({ ...common, hashes: z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
    source: z.object({ type: z.literal("local"), entry: z.string() }).strict() }).strict(),
  z.object({ ...common, hashes: z.object({ sha1: z.string().regex(/^[a-f0-9]{40}$/), sha512: z.string().regex(/^[a-f0-9]{128}$/),
    sha256: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict(),
    source: z.object({ type: z.literal("remote"), downloads: z.array(z.string().max(4000)).min(1).max(10) }).strict() }).strict(),
]);
export type RecipeFile = z.infer<typeof recipeFileSchema>;
export const recipeInventorySchema = z.object({ schemaVersion: z.literal(2), format: z.literal("mua-import-recipe"),
  runtime: z.object({ minecraft: z.string().min(1).max(100),
    loader: z.object({ type: z.enum(["fabric", "quilt", "forge", "neoforge"]), version: z.string().min(1).max(100) }).strict().nullable(),
    javaMajor: z.number().int().min(7).max(25).nullable() }).strict(),
  files: z.array(recipeFileSchema).min(1).max(100000) }).strict();
export type RecipeInventory = z.infer<typeof recipeInventorySchema>;
export type RecipeImportStatistics = { localFiles: number; remoteFiles: number; optionalFiles: number;
  localSize: number; remoteDeclaredSize: number; newLocalDataSize: number; localCasReusePercent: number; sourceSize: number };

export function recipePath(path: string) {
  const normalized = safePackPath(path);
  invariant(!/^(?:versions|libraries|assets|natives|runtime|\.mua|\.launcher|\.hmcl|PCL)(?:\/|$)|^(?:launcher_accounts|launcher_profiles|accounts|usercache|usernamecache)\.json$/i.test(normalized),
    422, "v2 文件不能覆盖运行环境、账号或启动器状态");
  return normalized;
}
export function parseRecipeInventory(raw: unknown): RecipeInventory {
  const result = recipeInventorySchema.safeParse(raw); invariant(result.success, 422, "v2 导入索引格式不正确");
  const inventory = result.data; const paths = new Set<string>(); const sizes = new Map<string, number>(); let total = 0;
  for (const file of inventory.files) {
    invariant(recipePath(file.path) === file.path, 422, "v2 路径必须为 NFC");
    const folded = file.path.toLowerCase(); invariant(!paths.has(folded), 422, "v2 路径重复或大小写冲突"); paths.add(folded);
    if (file.source.type === "local") invariant(file.source.entry === `overrides/${file.path}`, 422, "v2 本地载荷路径不匹配");
    const identity = "sha512" in file.hashes ? `remote:${file.hashes.sha512}` : `local:${file.hashes.sha256}`;
    invariant(!sizes.has(identity) || sizes.get(identity) === file.size, 422, "v2 相同内容的大小声明冲突"); sizes.set(identity, file.size);
    total += file.size;
  }
  invariant(total <= 40 * 1024 ** 3, 422, "v2 目标文件超过 40 GiB");
  for (const path of paths) { const parts = path.split("/"); for (let i = 1; i < parts.length; i++) invariant(!paths.has(parts.slice(0, i).join("/")), 422, "v2 文件与目录冲突"); }
  invariant(Buffer.byteLength(JSON.stringify(inventory), "utf8") <= 16 * 1024 ** 2, 422, "v2 导入索引超过 16 MiB");
  return inventory;
}
