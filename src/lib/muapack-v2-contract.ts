import { z } from "zod";
import { recipeFileSchema, parseRecipeInventory, recipePath } from "./recipe-inventory";
import { MUA_PLATFORMS, selectedPlatformsSchema, sha256Schema, muaPathSchema } from "./muapack-contract";

const text = z.string().min(1).max(200).refine(value => !/[\x00-\x1f\x7f]/.test(value));
const argument = z.string().max(4000).refine(value => !/[\x00\r\n]|\$\{/.test(value));
const location = z.object({ root: z.literal("instance"), path: muaPathSchema }).strict();
const launch = z.object({ jvmArgs: z.array(argument).max(256).refine(args => args.every(arg => !/^-Xm[sx]|^-cp$|^-classpath$|^--class-path|^--module-path|^-p$|^-jar$/i.test(arg))),
  gameArgs: z.array(argument).max(256).refine(args => args.every(arg => !/^--(?:username|uuid|accessToken|gameDir|assetsDir|assetIndex|version)(?:=|$)/i.test(arg))),
  memory: z.object({ mode: z.literal("auto"), minimumMiB: z.number().int().min(256).max(1048576), recommendedMiB: z.number().int().min(256).max(1048576) }).strict()
    .refine(value => value.recommendedMiB >= value.minimumMiB),
  preLaunch: z.array(z.discriminatedUnion("type", [
    z.object({ type: z.literal("mkdir"), path: muaPathSchema }).strict(),
    z.object({ type: z.literal("copy"), from: location, to: muaPathSchema, ifMissing: z.literal(true) }).strict(),
    z.object({ type: z.literal("exec"), executable: location, args: z.array(argument).max(256), workingDirectory: muaPathSchema.nullable(),
      requiresConsent: z.literal(true), timeoutSeconds: z.number().int().min(1).max(300), onFailure: z.enum(["abort", "continue"]) }).strict(),
  ])).max(32) }).strict();
const contentShape = { release: z.object({ organizationId: z.string().uuid(), clientId: text, releaseId: z.string().uuid(), version: text, name: text,
  summary: z.string().min(1).max(200), description: z.string().max(20000), sourceSha256: sha256Schema, contentRevision: z.number().int().positive() }).strict(),
  runtime: z.object({ minecraft: text, loader: z.object({ type: z.enum(["fabric", "quilt", "forge", "neoforge"]), version: text }).strict().nullable(),
    java: z.object({ major: z.number().int().min(7).max(25), vendor: z.literal("adoptium"), imageType: z.enum(["jre", "jdk"]) }).strict(), resolverVersion: z.literal("mua-runtime-resolver-1") }).strict(),
  launch, files: z.array(recipeFileSchema).min(1).max(100000) };
function validateContent(value: { runtime: z.infer<typeof contentShape.runtime>; files: z.infer<typeof contentShape.files>; launch: z.infer<typeof launch> }, ctx: z.RefinementCtx) {
  try {
    parseRecipeInventory({ schemaVersion: 2, format: "mua-import-recipe", runtime: { minecraft: value.runtime.minecraft, loader: value.runtime.loader, javaMajor: value.runtime.java.major }, files: value.files });
    if (value.files.some((file, i) => i > 0 && value.files[i - 1].path >= file.path)) throw Error("v2 文件必须按路径排序");
    for (const file of value.files) if (file.source.type === "remote") for (const raw of file.source.downloads) {
      const url = new URL(raw);
      if (url.protocol !== "https:" || url.username || url.password || url.hash || url.port && url.port !== "443" || /[\x00-\x20\x7f]/.test(raw) ||
        [...url.searchParams.keys()].some(key => /signature|token|credential|expires|x-amz-|x-goog-/i.test(key))) throw Error("v2 远程下载地址必须持久、无凭据且使用 HTTPS");
    }
    for (const task of value.launch.preLaunch) {
      if (task.type !== "mkdir") {
        const source = task.type === "copy" ? task.from : task.executable; const file = value.files.find(file => file.path === source.path);
        if (!file || file.source.type !== "local" || file.policy !== "managed" || file.optional || task.type === "exec" && !file.executable) throw Error("启动前操作只能引用必需的本地 managed 文件");
      }
      if (task.type !== "exec") {
        const path = task.type === "mkdir" ? task.path : task.to; recipePath(path);
        const file = value.files.find(file => file.path === path);
        if (file && (task.type === "mkdir" || file.policy === "managed")) throw Error("启动前操作不能覆盖 managed 文件");
      } else if (task.workingDirectory) recipePath(task.workingDirectory);
    }
  } catch (error) { ctx.addIssue({ code: "custom", message: error instanceof Error ? error.message : "v2 配方无效" }); }
}
export const recipeContentSchema = z.object({ format: z.literal("mua-recipe-content"), formatVersion: z.literal(2), ...contentShape }).strict().superRefine(validateContent);
export const RECIPE_PROTOCOL_REVISION = 2;
const manifestShape = { format: z.literal("mua-recipe-manifest"), formatVersion: z.literal(2), ...contentShape };
const legacyRecipeManifestSchema = z.object({ ...manifestShape,
  supportedPlatforms: selectedPlatformsSchema.refine(values => values.every((value, i) => i === 0 || MUA_PLATFORMS.indexOf(values[i - 1]) < MUA_PLATFORMS.indexOf(value)), "v2 平台必须按规范顺序排列") }).strict();
// Keep the original signed shape readable; never strip fields or normalize signed bytes.
export const recipeManifestSchema = z.union([
  z.object({ ...manifestShape, protocolRevision: z.literal(RECIPE_PROTOCOL_REVISION) }).strict(),
  legacyRecipeManifestSchema,
]).superRefine(validateContent);
export type RecipeContent = z.infer<typeof recipeContentSchema>;
export type RecipeManifest = z.infer<typeof recipeManifestSchema>;
export const recipeReleaseRefSchema = z.object({ organizationId: z.string().uuid(), clientId: text, releaseId: z.string().uuid(), version: text, manifestSha256: sha256Schema }).strict();
const pair = z.object({ before: recipeFileSchema, after: recipeFileSchema }).strict();
const changesShape = { added: z.array(recipeFileSchema), modified: z.array(pair), removed: z.array(recipeFileSchema), policyChanged: z.array(pair), sourceChanged: z.array(pair),
    runtimeChanged: z.object({ before: contentShape.runtime, after: contentShape.runtime }).strict().nullable(),
    launchChanged: z.object({ before: launch, after: launch }).strict().nullable() };
const metadataShape = { format: z.literal("muapack"), formatVersion: z.literal(2), packageType: z.enum(["full", "update"]),
  target: recipeReleaseRefSchema, base: recipeReleaseRefSchema.nullable(), indexSha256: sha256Schema,
  payload: z.array(z.object({ entry: muaPathSchema, sha256: sha256Schema, size: z.number().int().min(0).max(2 * 1024 ** 3) }).strict()).max(100000),
  removalPolicy: z.enum(["retain", "backup-managed"]), minimumLauncherProtocol: z.literal(2) };
export const recipePackMetadataSchema = z.union([
  z.object({ ...metadataShape, protocolRevision: z.literal(RECIPE_PROTOCOL_REVISION), changes: z.object(changesShape).strict() }).strict(),
  z.object({ ...metadataShape, changes: z.object({ ...changesShape,
    platformsChanged: z.object({ before: selectedPlatformsSchema, after: selectedPlatformsSchema }).strict().nullable() }).strict() }).strict(),
]);
export type RecipePackMetadata = z.infer<typeof recipePackMetadataSchema>;
export const recipeSignatureSchema = z.object({ format: z.literal("mua-pack-signature"), formatVersion: z.literal(2), algorithm: z.literal("Ed25519"),
  keyId: z.string().regex(/^[a-f0-9]{24}$/), metadataSha256: sha256Schema, signature: z.string().regex(/^[A-Za-z0-9+/]{86}==$/) }).strict();
