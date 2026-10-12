import "server-only";
import { z } from "zod";
import { invariant } from "./errors";
import { safePackPath } from "./pack-path";
import { minecraftJava } from "./minecraft-java";
import { MAX_MODS, type ClientInspection } from "./client-contract";

const text = z.string().trim().min(1).max(200);
const side = z.enum(["required", "optional", "unsupported"]);
const indexSchema = z.object({ formatVersion: z.literal(1), game: z.literal("minecraft"), name: text,
  versionId: text.max(100), summary: z.string().max(20000).optional(),
  dependencies: z.record(z.string().min(1).max(100)), files: z.array(z.object({ path: z.string().min(1).max(1000),
    hashes: z.object({ sha1: z.string().regex(/^[0-9a-fA-F]{40}$/).transform(value => value.toLowerCase()),
      sha512: z.string().regex(/^[0-9a-fA-F]{128}$/).transform(value => value.toLowerCase()),
      sha256: z.string().regex(/^[0-9a-fA-F]{64}$/).transform(value => value.toLowerCase()).optional() }).strict(),
    fileSize: z.number().int().min(0).max(2 * 1024 ** 3), downloads: z.array(z.string().min(1).max(4000)).min(1).max(10),
    env: z.object({ client: side, server: side }).partial().optional() })).max(100000) });
export function inspectModrinthIndex(raw: unknown, wrapper: "pcl" | null = null) {
  const result = indexSchema.safeParse(raw);
  invariant(result.success, 422, result.success ? "" : `Modrinth 索引无效：${result.error.issues[0]?.message}`);
  const index = result.data; invariant(index.dependencies.minecraft, 422, "Modrinth 包缺少 Minecraft 依赖");
  const loaders = [["fabric-loader", "fabric"], ["quilt-loader", "quilt"], ["forge", "forge"], ["neoforge", "neoforge"]] as const;
  const declared = loaders.filter(([key]) => index.dependencies[key]); invariant(declared.length <= 1, 422, "Modrinth 包声明了多个加载器");
  invariant(Object.keys(index.dependencies).every(key => key === "minecraft" || loaders.some(([known]) => known === key)), 422, "Modrinth 包含尚不支持的环境依赖");
  const paths = new Set<string>(); let total = 0;
  for (const file of index.files) {
    file.path = safePackPath(file.path); const folded = file.path.toLowerCase();
    invariant(!paths.has(folded), 422, "Modrinth 索引包含重复或大小写冲突路径"); paths.add(folded);
    total += file.fileSize; invariant(total <= 40 * 1024 ** 3, 422, "Modrinth 文件总大小超过 40 GiB");
  }
  const files = index.files.filter(file => file.env?.client !== "unsupported");
  invariant(files.filter(file => /^mods\/.+\.jar$/i.test(file.path)).length <= MAX_MODS, 422, "Modrinth 模组数量过多");
  const java = minecraftJava(index.dependencies.minecraft);
  const warnings: string[] = [];
  if (!java) warnings.push("此 Minecraft 版本没有已核实 Java 要求，请手动确认。");
  if (files.length !== index.files.length) warnings.push(`已排除 ${index.files.length - files.length} 个客户端不支持的远程文件。`);
  const info: ClientInspection = { schemaVersion: 1, instanceId: null, requiresSelection: false, candidates: [],
    minecraftVersion: index.dependencies.minecraft, javaVersion: java?.javaVersion ?? null, javaComponent: java?.javaComponent ?? null,
    loader: declared[0]?.[1] ?? null, loaderVersion: declared[0] ? index.dependencies[declared[0][0]] : null,
    minecraftSource: "modrinth.index.json dependencies.minecraft", javaSource: java?.source ?? null, warnings,
    pack: { format: "modrinth", wrapper, name: index.name, version: index.versionId, summary: index.summary?.slice(0, 200) ?? null } };
  return { index, files, info };
}
