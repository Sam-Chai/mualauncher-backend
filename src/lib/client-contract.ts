import { z } from "zod";
import { selectedPlatformsSchema } from "./muapack-contract";
import type { RecipeImportStatistics } from "./recipe-inventory";
export const MAX_MODS = 2000;
export const packageFormatVersionSchema = z.union([z.literal(1), z.literal(2)]);
export type PackageFormatVersion = z.infer<typeof packageFormatVersionSchema>;

export const clientMetadataSchema = z.object({
  versionLabel: z.string().trim().min(1, "请填写新的客户端版本").max(100),
  name: z.string().trim().min(1, "请填写客户端名称").max(200),
  minecraftVersion: z.string().trim().min(1, "请填写 MC 版本").max(100),
  javaVersion: z.number().int().min(7).max(25),
  mods: z.array(z.string().trim().min(1).max(1000)).max(MAX_MODS),
  modDetails: z.array(z.object({ path: z.string().min(1).max(1000), optional: z.boolean() }).strict()).max(MAX_MODS).optional(),
  summary: z.string().trim().min(1, "请填写 Summary").max(200),
  description: z.string().max(20000),
}).strict();
export type ClientMetadata = z.infer<typeof clientMetadataSchema>;
export const clientSubmissionSchema = clientMetadataSchema.omit({ mods: true, modDetails: true }).extend({
  minecraftVersion: clientMetadataSchema.shape.minecraftVersion.optional(), javaVersion: clientMetadataSchema.shape.javaVersion.optional(), platforms: selectedPlatformsSchema.optional() });
export type PackFile = { path: string; sha256: string; size: number; policy: "managed" | "preserve"; optional?: boolean };
export type ImportFile = { path: string; source: "local" | "remote"; optional: boolean; size: number;
  downloads: string[]; hashes?: { sha1?: string; sha512?: string; sha256?: string };
  status: "PENDING" | "DECLARED" | "DOWNLOADING" | "VERIFIED" | "FAILED"; downloadedBytes: number; error: string | null };
export type UpdateStatistics = {
  previousVersion: string | null; addedFiles: number; modifiedFiles: number; deletedFiles: number;
  fullSize: number; newDataSize: number; estimatedDownloadSize: number; casReusePercent: number;
  fileCount: number; sourceSize: number;
};
export type FileInventory = { schemaVersion: 1; files: PackFile[] };
export type DetectedRuntime = {
  instanceId: string | null; minecraftVersion: string | null; javaVersion: number | null;
  javaComponent: string | null; loader: string | null; loaderVersion: string | null;
  minecraftSource: string | null; javaSource: string | null; warnings: string[];
};
export type ClientInspection = DetectedRuntime & {
  schemaVersion: 1; requiresSelection: boolean; candidates: DetectedRuntime[];
  pack?: { format: "modrinth"; wrapper: "pcl" | null; name: string; version: string; summary: string | null };
  importFiles?: ImportFile[];
};
export type UploadPhase = "FETCHING" | "INSPECTING" | "SELECT_INSTANCE" | "DOWNLOADING" | "CAS";
export function runtimeAutofill(info: DetectedRuntime, current: Pick<ClientMetadata, "minecraftVersion" | "javaVersion">,
  baseline: Pick<ClientMetadata, "minecraftVersion" | "javaVersion">) {
  return {
    ...(current.minecraftVersion === baseline.minecraftVersion ? { minecraftVersion: info.minecraftVersion ?? "" } : {}),
    ...(current.javaVersion === baseline.javaVersion ? { javaVersion: info.javaVersion ?? 0 } : {}),
  };
}
export type ReleaseManifest = {
  schemaVersion: 2; format: "mua-client-manifest"; clientId: string; organizationId: string;
  version: string; name: string; runtime: { minecraft: string; java: number };
  mods: string[]; summary: string; description: string; sourceSha256: string;
  modDetails?: { path: string; optional: boolean }[];
  files: PackFile[]; update: UpdateStatistics;
};
export type UploadView = {
  id: string; clientId: string; fileName: string; size: number; partSize: number;
  packageFormatVersion: PackageFormatVersion;
  status: string; progress: number; error: string | null; draftId: string | null;
  statistics: UpdateStatistics | null; detectedMods: string[]; warnings: string[];
  recipeStatistics?: RecipeImportStatistics | null;
  comparisonDraftId?: string | null; comparisonStatistics?: UpdateStatistics | null;
  processingPhase: UploadPhase | null; detectedInfo: ClientInspection | null; selectedInstanceId: string | null;
  baseReleaseId: string | null; basePublicationRevision: number; createdAt: string;
};
export function uploadProcessingLabel(upload: Pick<UploadView, "status" | "processingPhase" | "progress"> & Partial<Pick<UploadView, "packageFormatVersion">>) {
  if (upload.packageFormatVersion === 2 && upload.status === "READY") return "v2 识别完成 · 待提交";
  if (upload.processingPhase === "SELECT_INSTANCE") return "请选择要发布的客户端实例";
  if (upload.status === "QUEUED") return "等待 Worker 处理";
  if (upload.processingPhase === "FETCHING") return "正在读取上传的整合包";
  if (upload.processingPhase === "INSPECTING") return "正在识别客户端信息";
  if (upload.processingPhase === "DOWNLOADING") return `客户端信息已识别 · 正在下载整合包文件 ${upload.progress}%`;
  if (upload.processingPhase === "CAS") return `客户端信息识别完成 · 正在校验与去重 ${upload.progress}%`;
  return `正在处理客户端 ${upload.progress}%`;
}
export function formatBytes(value: number) {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const power = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** power).toFixed(power ? 2 : 0)} ${units[power]}`;
}
