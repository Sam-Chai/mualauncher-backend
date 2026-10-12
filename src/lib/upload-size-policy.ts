import { z } from "zod";

export const UPLOAD_MB = 1024 * 1024;
export const DEFAULT_MAX_UPLOAD_SIZE_MB = 1024;
// 320 parts of 64 MB, matching the upload API and database's absolute ceiling.
export const MAX_UPLOAD_SIZE_MB = 20480;
export const maxUploadSizeMbSchema = z.number().int().min(1).max(MAX_UPLOAD_SIZE_MB);

export function uploadFileError(fileName: string, size: number, maxUploadSizeMb: number): string | null {
  if (!/\.(zip|mrpack)$/i.test(fileName) || !Number.isSafeInteger(size) || size <= 0) return "请选择完整的 ZIP 或 mrpack 文件";
  if (size > maxUploadSizeMb * UPLOAD_MB) return `上传文件超过允许的最大大小（${maxUploadSizeMb} MB）`;
  return null;
}
