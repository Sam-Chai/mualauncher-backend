import { z } from "zod";
import { mottoCropSchema, type MottoCrop } from "./server-motto-contract";
export const AVATAR_SIZE = 512;
export const MAX_AVATAR_BYTES = 8 * 1024 * 1024;
export const avatarRevisionInput = z.object({ expectedRevision: z.number().int().nonnegative() }).strict();
export const avatarMetadataSchema = z.object({ revision: z.number().int().nonnegative(), mode: z.enum(["AUTO", "MANUAL"]),
  metadata: z.object({ version: z.literal(1), width: z.number().int().positive(), height: z.number().int().positive(), crop: mottoCropSchema,
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/), imageSha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict().nullable() }).strict();
export function avatarCrop(width: number, height: number, scale = 1, center = { x: .5, y: .5 }): MottoCrop {
  const side = Math.min(width, height) * Math.max(.1, Math.min(1, scale));
  return { left: Math.max(0, Math.min(1 - side / width, center.x - side / width / 2)),
    top: Math.max(0, Math.min(1 - side / height, center.y - side / height / 2)), width: side / width, height: side / height };
}
export function isOrganizationAvatarKey(key: string | null, organizationId: string): key is string {
  return !!key && new RegExp(`^organization-avatars/${organizationId}/[a-f0-9-]{36}/image[.]webp$`).test(key);
}
export function organizationAvatarUrl(key: string | null, organizationId: string) {
  return isOrganizationAvatarKey(key, organizationId) ? `/api/admin/organizations/${organizationId}/avatar-image?version=${key.split("/").at(-2)}` : null;
}
