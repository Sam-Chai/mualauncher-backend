import { z } from "zod";
import { safePackPath } from "./pack-path";

export const MUA_PLATFORMS = ["windows-amd64", "windows-aarch64", "linux-amd64", "linux-aarch64", "macos-amd64", "macos-aarch64"] as const;
export const muaPlatformSchema = z.enum(MUA_PLATFORMS);
export type MuaPlatform = z.infer<typeof muaPlatformSchema>;
export const selectedPlatformsSchema = z.array(muaPlatformSchema).min(1).max(6)
  .refine(values => new Set(values).size === values.length, "平台不能重复");
export function defaultMuaPlatforms(): MuaPlatform[] { return MUA_PLATFORMS.filter(platform => platform !== "linux-aarch64"); }
export function normalizeMuaPlatform(os: string, arch: string): MuaPlatform {
  const systems: Record<string, string> = { windows: "windows", win32: "windows", linux: "linux", macos: "macos", darwin: "macos" };
  const architectures: Record<string, string> = { amd64: "amd64", x64: "amd64", x86_64: "amd64", aarch64: "aarch64", arm64: "aarch64" };
  return muaPlatformSchema.parse(`${systems[os.toLowerCase()]}-${architectures[arch.toLowerCase()]}`);
}

export const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const text = z.string().min(1).max(200).refine(value => !/[\x00-\x1f\x7f]/.test(value), "标识含控制字符");
const sizeSchema = z.number().int().min(0).max(2 * 1024 ** 3);
export const muaPathSchema = z.string().min(1).max(1000).refine(value => {
  try { return safePackPath(value) === value; } catch { return false; }
}, "路径必须是安全的 NFC 相对路径");
export const muaFileSchema = z.object({ root: z.enum(["instance", "java"]), path: muaPathSchema,
  sha256: sha256Schema, size: sizeSchema, policy: z.enum(["managed", "preserve"]), executable: z.boolean(), optional: z.boolean().optional() }).strict();
export type MuaFile = z.infer<typeof muaFileSchema>;
export function muaFileKey(file: Pick<MuaFile, "root" | "path">) { return `${file.root}/${file.path}`; }
export function sameMuaFile(a: MuaFile, b: MuaFile) {
  return a.root === b.root && a.path === b.path && a.sha256 === b.sha256 && a.size === b.size && a.policy === b.policy && a.executable === b.executable && !!a.optional === !!b.optional;
}
function validateFiles(files: MuaFile[], ctx: z.RefinementCtx) {
  const paths = new Set<string>(); const sizes = new Map<string, number>(); let total = 0;
  for (const file of files) {
    const key = muaFileKey(file).toLowerCase();
    if (paths.has(key)) ctx.addIssue({ code: "custom", message: `重复或大小写冲突路径：${key}` });
    paths.add(key); total += file.size;
    if (sizes.has(file.sha256) && sizes.get(file.sha256) !== file.size) ctx.addIssue({ code: "custom", message: "同一摘要的大小不一致" });
    sizes.set(file.sha256, file.size);
    if (file.root === "java" && file.policy !== "managed") ctx.addIssue({ code: "custom", message: "Java 文件必须为 managed" });
    if (file.root === "java" && file.optional) ctx.addIssue({ code: "custom", message: "Java 环境不能为 optional" });
    if (file.root === "instance" && /^(?:\.mua(?:\/|$)|launcher_accounts\.json$|launcher_profiles\.json$)/i.test(file.path)) {
      ctx.addIssue({ code: "custom", message: "不能分发 Launcher 内部记录或账号文件" });
    }
  }
  if (total > 40 * 1024 ** 3) ctx.addIssue({ code: "custom", message: "清单展开大小超过 40 GiB" });
  // A file may not also be a parent directory, including on case-insensitive systems.
  for (const key of paths) {
    const segments = key.split("/");
    for (let i = 2; i < segments.length; i++) if (paths.has(segments.slice(0, i).join("/"))) {
      ctx.addIssue({ code: "custom", message: `文件与目录冲突：${key}` }); break;
    }
  }
}
export const muaFilesSchema = z.array(muaFileSchema).max(100000).superRefine(validateFiles);
const environmentRefSchema = z.object({ kind: z.enum(["minecraft", "loader", "java"]), sha256: sha256Schema }).strict();
const loaderSchema = z.object({ type: z.enum(["fabric", "quilt", "forge", "neoforge"]), version: text }).strict();
const javaSchema = z.object({ major: z.number().int().min(7).max(Number.MAX_SAFE_INTEGER), vendor: text, version: text, build: text,
  imageType: z.enum(["jre", "jdk"]).optional(),
  manifestSha256: sha256Schema, executable: muaPathSchema }).strict();
const argumentSchema = z.string().max(4000).refine(value => !/[\x00\r\n]/.test(value), "参数不能含 NUL 或换行");
const fileLocationSchema = z.object({ root: z.enum(["instance", "java"]), path: muaPathSchema }).strict();
const preLaunchTaskSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("mkdir"), path: muaPathSchema }).strict(),
  z.object({ type: z.literal("copy"), from: fileLocationSchema, to: muaPathSchema, ifMissing: z.literal(true) }).strict(),
  z.object({ type: z.literal("exec"), executable: fileLocationSchema, args: z.array(argumentSchema).max(256),
    workingDirectory: muaPathSchema.nullable(), requiresConsent: z.literal(true), timeoutSeconds: z.number().int().min(1).max(300),
    onFailure: z.enum(["abort", "continue"]) }).strict(),
]);
export const muaLaunchSchema = z.object({
  mainClass: z.string().regex(/^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)+$/),
  classpath: z.array(muaPathSchema).min(1).max(10000),
  jvmArgs: z.array(argumentSchema).max(256).refine(args => args.every(arg => !/^-Xm[sx]/i.test(arg)), "内存参数由 memory 统一生成"),
  gameArgs: z.array(argumentSchema).max(256),
  memory: z.object({ mode: z.literal("auto"), minimumMiB: z.number().int().min(256).max(1048576),
    recommendedMiB: z.number().int().min(256).max(1048576) }).strict()
    .refine(value => value.recommendedMiB >= value.minimumMiB, "推荐内存不能低于最低内存"),
  preLaunch: z.array(preLaunchTaskSchema).max(32),
}).strict();
const releaseIdentitySchema = z.object({ organizationId: z.string().uuid(), clientId: text, releaseId: z.string().uuid(),
  version: text, name: text, summary: z.string().min(1).max(200), description: z.string().max(20000),
  sourceSha256: sha256Schema, contentRevision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER) }).strict();
export const muaPlatformManifestSchema = z.object({ format: z.literal("mua-platform-manifest"), formatVersion: z.literal(1),
  release: releaseIdentitySchema, platform: muaPlatformSchema,
  runtime: z.object({ minecraft: text, loader: loaderSchema.nullable(), java: javaSchema }).strict(),
  environments: z.array(environmentRefSchema).min(2).max(3), launch: muaLaunchSchema,
  mods: z.array(z.object({ path: muaPathSchema, name: text.nullable(), version: text.nullable(), optional: z.boolean().optional() }).strict()).max(2000),
  files: muaFilesSchema,
}).strict().superRefine((manifest, ctx) => {
  const kinds = manifest.environments.map(ref => ref.kind);
  if (new Set(kinds).size !== kinds.length || !kinds.includes("minecraft") || !kinds.includes("java") ||
    kinds.includes("loader") !== (manifest.runtime.loader !== null)) ctx.addIssue({ code: "custom", message: "环境引用必须与运行环境一致" });
  if (manifest.environments.find(ref => ref.kind === "java")?.sha256 !== manifest.runtime.java.manifestSha256) {
    ctx.addIssue({ code: "custom", message: "Java 环境摘要不一致" });
  }
  const files = new Map(manifest.files.map(file => [muaFileKey(file), file]));
  const required = [files.get(`java/${manifest.runtime.java.executable}`), ...manifest.launch.classpath.map(path => files.get(`instance/${path}`))];
  if (required.some(file => !file || file.policy !== "managed" || file.optional)) ctx.addIssue({ code: "custom", message: "Java 可执行文件和 classpath 必须指向必需的 managed 文件" });
  if (!required[0]?.executable) ctx.addIssue({ code: "custom", message: "Java 可执行文件必须标记 executable" });
  const modPaths = new Set<string>();
  for (const mod of manifest.mods) {
    if (modPaths.has(mod.path.toLowerCase()) || !/\.jar$/i.test(mod.path) || !files.has(`instance/${mod.path}`) || !!mod.optional !== !!files.get(`instance/${mod.path}`)?.optional) {
      ctx.addIssue({ code: "custom", message: "模组必须唯一并对应清单中的 JAR 文件" });
    }
    modPaths.add(mod.path.toLowerCase());
  }
  for (const task of manifest.launch.preLaunch) if (task.type !== "mkdir") {
    const location = task.type === "copy" ? task.from : task.executable;
    if (files.get(muaFileKey(location))?.policy !== "managed") ctx.addIssue({ code: "custom", message: "启动前操作只能引用清单中的 managed 文件" });
    if (task.type === "exec" && !files.get(muaFileKey(location))?.executable) ctx.addIssue({ code: "custom", message: "启动前命令必须引用标记 executable 的文件" });
  }
  for (const task of manifest.launch.preLaunch) if (task.type !== "exec") {
    const path = task.type === "mkdir" ? task.path : task.to;
    const destination = files.get(`instance/${path}`);
    if (/^(?:\.mua(?:\/|$)|launcher_accounts\.json$|launcher_profiles\.json$)/i.test(path) ||
      destination && (task.type === "mkdir" || destination.policy === "managed")) {
      ctx.addIssue({ code: "custom", message: "启动前操作不能覆盖内部状态或 managed 文件" });
    }
  }
});
export type MuaPlatformManifest = z.infer<typeof muaPlatformManifestSchema>;

const environmentCommon = { format: z.literal("mua-environment-manifest"), formatVersion: z.literal(1),
  resolverVersion: text, files: muaFilesSchema };
export const muaEnvironmentManifestSchema = z.discriminatedUnion("kind", [
  z.object({ ...environmentCommon, kind: z.literal("minecraft"), platform: muaPlatformSchema,
    minecraft: text, sourceMetadataSha256: sha256Schema }).strict(),
  z.object({ ...environmentCommon, kind: z.literal("loader"), platform: muaPlatformSchema,
    minecraft: text, loader: loaderSchema, sourceMetadataSha256: sha256Schema }).strict(),
  z.object({ ...environmentCommon, kind: z.literal("java"), platform: muaPlatformSchema,
    java: z.object({ major: z.number().int().min(7).max(Number.MAX_SAFE_INTEGER), vendor: text, version: text, build: text,
      imageType: z.enum(["jre", "jdk"]).optional(),
      executable: muaPathSchema, archiveSha256: sha256Schema }).strict() }).strict(),
]).superRefine((manifest, ctx) => {
  if (!manifest.files.length || manifest.files.some(file => file.root !== (manifest.kind === "java" ? "java" : "instance") || file.policy !== "managed" || file.optional)) {
    ctx.addIssue({ code: "custom", message: "环境必须包含所属根目录下的 managed 文件" });
  }
  if (manifest.kind === "java" && !manifest.files.some(file => file.path === manifest.java.executable)) {
    ctx.addIssue({ code: "custom", message: "Java 环境缺少可执行文件" });
  }
  if (manifest.kind === "java" && !manifest.files.find(file => file.path === manifest.java.executable)?.executable) {
    ctx.addIssue({ code: "custom", message: "Java 可执行文件必须标记 executable" });
  }
});
export type MuaEnvironmentManifest = z.infer<typeof muaEnvironmentManifestSchema>;

const changePairSchema = z.object({ before: muaFileSchema, after: muaFileSchema }).strict()
  .refine(pair => muaFileKey(pair.before) === muaFileKey(pair.after), "变化前后路径必须相同");
export const muaChangesSchema = z.object({ added: muaFilesSchema, modified: z.array(changePairSchema).max(100000),
  removed: muaFilesSchema, policyChanged: z.array(changePairSchema).max(100000) }).strict();
export type MuaChanges = z.infer<typeof muaChangesSchema>;
const releaseRefSchema = z.object({ organizationId: z.string().uuid(), clientId: text, releaseId: z.string().uuid(),
  version: text, manifestSha256: sha256Schema }).strict();
export const muaObjectSchema = z.object({ sha256: sha256Schema, size: sizeSchema }).strict();
export const muaPackMetadataSchema = z.object({ format: z.literal("muapack"), formatVersion: z.literal(1),
  packageType: z.enum(["full", "update"]), platform: muaPlatformSchema, base: releaseRefSchema.nullable(),
  target: releaseRefSchema, changes: muaChangesSchema,
  payload: z.array(muaObjectSchema).max(100000), removalPolicy: z.enum(["backup-managed", "retain"]),
}).strict().superRefine((pack, ctx) => {
  if ((pack.packageType === "full") !== (pack.base === null)) ctx.addIssue({ code: "custom", message: "整包不能有基准，更新包必须有基准" });
  if (pack.base && (pack.base.organizationId !== pack.target.organizationId || pack.base.clientId !== pack.target.clientId || pack.base.releaseId === pack.target.releaseId || pack.base.version === pack.target.version)) {
    ctx.addIssue({ code: "custom", message: "更新包必须属于同一客户端的两个不同发布" });
  }
  if (pack.packageType === "full" && Object.values(pack.changes).some(values => values.length)) {
    ctx.addIssue({ code: "custom", message: "整包不包含差异列表" });
  }
  if (new Set(pack.payload.map(object => object.sha256)).size !== pack.payload.length) ctx.addIssue({ code: "custom", message: "载荷对象不能重复" });
  if (pack.payload.reduce((sum, object) => sum + object.size, 0) > 40 * 1024 ** 3) ctx.addIssue({ code: "custom", message: "载荷超过 40 GiB" });
});
export type MuaPackMetadata = z.infer<typeof muaPackMetadataSchema>;

/** Changes are derived from complete inventories; content and policy changes may overlap. */
export function diffMuaFiles(base: MuaFile[], target: MuaFile[]): MuaChanges {
  muaFilesSchema.parse(base); muaFilesSchema.parse(target);
  const before = new Map(base.map(file => [muaFileKey(file), file])); const after = new Map(target.map(file => [muaFileKey(file), file]));
  const changes: MuaChanges = { added: [], modified: [], removed: [], policyChanged: [] };
  for (const file of target) {
    const old = before.get(muaFileKey(file));
    if (!old) changes.added.push(file);
    else {
      if (old.sha256 !== file.sha256 || old.size !== file.size || old.executable !== file.executable) changes.modified.push({ before: old, after: file });
      if (old.policy !== file.policy || !!old.optional !== !!file.optional) changes.policyChanged.push({ before: old, after: file });
    }
  }
  changes.removed = base.filter(file => !after.has(muaFileKey(file)));
  changes.added.sort(fileOrder); changes.removed.sort(fileOrder);
  changes.modified.sort((a, b) => fileOrder(a.after, b.after)); changes.policyChanged.sort((a, b) => fileOrder(a.after, b.after));
  return changes;
}
function fileOrder(a: MuaFile, b: MuaFile) { return muaFileKey(a) < muaFileKey(b) ? -1 : muaFileKey(a) > muaFileKey(b) ? 1 : 0; }
export function requiredMuaObjects(target: MuaPlatformManifest, changes: MuaChanges | null) {
  const files = changes ? [...changes.added, ...changes.modified.map(pair => pair.after), ...changes.policyChanged.map(pair => pair.after)] : target.files;
  const objects = new Map<string, number>();
  for (const file of files) objects.set(file.sha256, file.size);
  return [...objects].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([sha256, size]) => ({ sha256, size }));
}
