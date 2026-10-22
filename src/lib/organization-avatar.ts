import { diagnosticText } from "@/lib/diagnostics";
import "server-only";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import type { Actor, Db } from "./auth";
import { audit } from "./management";
import { requireOrganization } from "./rbac";
import { AppError, invariant } from "./errors";
import { digest, packagesBucket, readObject, storageClient } from "./storage";
import { mottoCropSchema, mottoMetadataSchema, MAX_MOTTO_PIXELS } from "./server-motto-contract";
import { AVATAR_SIZE, MAX_AVATAR_BYTES, avatarCrop, isOrganizationAvatarKey } from "./organization-avatar-contract";

export async function prepareOrganizationAvatar(bytes: Buffer, rawCrop?: unknown, existingSource = false) {
  invariant(bytes.length > 0 && bytes.length <= (existingSource ? 64 * 1024 * 1024 : MAX_AVATAR_BYTES), 413, diagnosticText("diagnostics.organizationAvatar.theImageMustNotExceed8Mib"));
  let source: Buffer, width: number, height: number;
  try {
    const meta = await sharp(bytes, { limitInputPixels: MAX_MOTTO_PIXELS, failOn: "warning" }).metadata();
    invariant(["png", "jpeg", "webp"].includes(meta.format ?? "") && (meta.pages ?? 1) === 1, 415, diagnosticText("diagnostics.organizationAvatar.uploadAStaticPngJpegOrWebpImage"));
    const normalized = await sharp(bytes, { limitInputPixels: MAX_MOTTO_PIXELS, failOn: "warning" }).autoOrient().webp({ lossless: true }).toBuffer({ resolveWithObject: true });
    source = normalized.data; width = normalized.info.width; height = normalized.info.height;
  } catch (e) { if (e instanceof AppError) throw e; throw new AppError(422, diagnosticText("diagnostics.organizationAvatar.theImageCannotBeDecodedOrExceedsThePixelLimit")); }
  const parsed = mottoCropSchema.safeParse(rawCrop ?? avatarCrop(width, height));
  invariant(parsed.success, 400, diagnosticText("diagnostics.organizationAvatar.invalidImageCrop"));
  const crop = parsed.data;
  invariant(crop.left + crop.width <= 1 + 1e-8 && crop.top + crop.height <= 1 + 1e-8 && Math.abs(crop.width * width / (crop.height * height) - 1) < .001, 400, diagnosticText("diagnostics.organizationAvatar.theCropMustStayInsideTheImageAndHaveA"));
  const left = Math.min(width - 1, Math.round(crop.left * width)), top = Math.min(height - 1, Math.round(crop.top * height));
  const image = await sharp(source).extract({ left, top, width: Math.max(1, Math.min(width - left, Math.round(crop.width * width))),
    height: Math.max(1, Math.min(height - top, Math.round(crop.height * height))) }).resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "fill" }).webp({ quality: 90 }).toBuffer();
  return { source, image, metadata: { version: 1 as const, width, height, crop, sourceSha256: digest(source), imageSha256: digest(image) } };
}
export async function storeOrganizationAvatar(id: string, prepared: Awaited<ReturnType<typeof prepareOrganizationAvatar>>) {
  const directory = `organization-avatars/${id}/${randomUUID()}`;
  for (const [name, data, type] of [["image.webp", prepared.image, "image/webp"], ["source.webp", prepared.source, "image/webp"], ["metadata.json", Buffer.from(JSON.stringify(prepared.metadata)), "application/json"]] as const) {
    await storageClient().putObject({ Bucket: packagesBucket(), Key: `${directory}/${name}`, Body: data, ContentType: type, IfNoneMatch: "*",
      Metadata: { sha256: digest(data) }, ChecksumSHA256: Buffer.from(digest(data), "hex").toString("base64") });
  }
  return `${directory}/image.webp`;
}
export async function readOrganizationAvatar(key: string | null, id: string, variant: "image" | "source" | "metadata") {
  invariant(isOrganizationAvatarKey(key, id), 404, diagnosticText("diagnostics.organizationAvatar.thisOrganizationHasNoAvatar"));
  const directory = key.slice(0, -10);
  const metadata = mottoMetadataSchema.parse(JSON.parse((await readObject(`${directory}metadata.json`, packagesBucket(), 4096)).toString("utf8")));
  if (variant === "metadata") return { metadata, bytes: null };
  const bytes = await readObject(`${directory}${variant}.webp`, packagesBucket(), 64 * 1024 * 1024);
  invariant(digest(bytes) === (variant === "image" ? metadata.imageSha256 : metadata.sourceSha256), 503, diagnosticText("diagnostics.organizationAvatar.organizationAvatarVerificationFailed"));
  return { metadata, bytes };
}
export async function saveOrganizationAvatar(db: Db, actor: Actor, id: string, revision: number, key: string | null) {
  await requireOrganization(db, actor, id, "ORG_EDIT");
  invariant(key === null || isOrganizationAvatarKey(key, id), 400, diagnosticText("diagnostics.organizationAvatar.theImageDoesNotBelongToThisOrganization"));
  const changed = await db.organization.updateMany({ where: { id, avatarRevision: revision }, data: { avatarObjectKey: key, avatarMode: "MANUAL", avatarRevision: { increment: 1 } } });
  invariant(changed.count === 1, 409, diagnosticText("diagnostics.organizationAvatar.theOrganizationAvatarChangedRefreshAndTryAgain"));
  await audit(db, actor, key ? "ORGANIZATION_AVATAR_UPLOAD" : "ORGANIZATION_AVATAR_REMOVE", "Organization", id, id, undefined, { revision: revision + 1, key });
  return { ok: true as const, revision: revision + 1 };
}
export async function boundedAvatarForm(request: Request) {
  invariant(request.headers.get("content-type")?.startsWith("multipart/form-data;") && request.body, 415, diagnosticText("diagnostics.organizationAvatar.useTheImageUploadForm"));
  const reader = request.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  for (;;) { const item = await reader.read(); if (item.done) break; size += item.value.byteLength;
    if (size > MAX_AVATAR_BYTES + 65536) { await reader.cancel(); throw new AppError(413, diagnosticText("diagnostics.organizationAvatar.theImageMustNotExceed8Mib")); } chunks.push(item.value); }
  try { return await new Request(request.url, { method: "POST", headers: { "Content-Type": request.headers.get("content-type")! }, body: Buffer.concat(chunks) }).formData(); }
  catch { throw new AppError(400, diagnosticText("diagnostics.organizationAvatar.invalidImageUploadForm")); }
}
