import { z } from "zod";

export const SERVER_MOTTO_RATIO = 61 / 23;
export const SERVER_MOTTO_RATIO_LABEL = "61:23（约 2.65:1）";
export const SERVER_MOTTO_FADE = "linear-gradient(to right, transparent 61.8034%, white 100%)";
export const MAX_MOTTO_UPLOAD_BYTES = 8 * 1024 * 1024;
export const MAX_MOTTO_PIXELS = 16_000_000;
export const mottoCropSchema = z.object({
  left: z.number().finite().min(0).max(1), top: z.number().finite().min(0).max(1),
  width: z.number().finite().positive().max(1), height: z.number().finite().positive().max(1),
}).strict();
export type MottoCrop = z.infer<typeof mottoCropSchema>;
export const mottoMetadataSchema = z.object({
  version: z.literal(1), width: z.number().int().positive(), height: z.number().int().positive(),
  crop: mottoCropSchema, sourceSha256: z.string().regex(/^[a-f0-9]{64}$/), imageSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type MottoMetadata = z.infer<typeof mottoMetadataSchema>;

export function mottoCrop(width: number, height: number, scale = 1, center = { x: 0.5, y: 0.5 }): MottoCrop {
  const selectedWidth = Math.min(width, height * SERVER_MOTTO_RATIO) * Math.min(1, Math.max(0.1, scale)) / width;
  const selectedHeight = Math.min(1, selectedWidth * width / SERVER_MOTTO_RATIO / height);
  return { left: Math.max(0, Math.min(1 - selectedWidth, center.x - selectedWidth / 2)),
    top: Math.max(0, Math.min(1 - selectedHeight, center.y - selectedHeight / 2)), width: selectedWidth, height: selectedHeight };
}

export function validMottoCrop(crop: MottoCrop, width: number, height: number) {
  return crop.left + crop.width <= 1 + 1e-8 && crop.top + crop.height <= 1 + 1e-8 &&
    Math.abs(crop.width * width / (crop.height * height) - SERVER_MOTTO_RATIO) < 0.001;
}

export function isServerMottoKey(key: string | null, organizationId: string, serverId: string): key is string {
  const prefix = `server-mottos/${organizationId}/${serverId}/`;
  return !!key?.startsWith(prefix) && /^[a-f0-9-]{36}\/image\.webp$/.test(key.slice(prefix.length));
}
export function serverMottoUrl(key: string | null, organizationId: string, serverId: string) {
  return isServerMottoKey(key, organizationId, serverId)
    ? `/api/admin/servers/${serverId}/motto-image?version=${key.split("/").at(-2)}` : null;
}
