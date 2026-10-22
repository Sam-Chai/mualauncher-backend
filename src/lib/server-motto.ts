import { diagnosticText } from "@/lib/diagnostics";
import "server-only";
import sharp from "sharp";
import { randomUUID } from "node:crypto";

import type { Actor, Db } from "./auth";
import { AppError, invariant } from "./errors";
import { requireServer } from "./rbac";
import { audit } from "./management";
import { digest, packagesBucket, readObject, storageClient } from "./storage";
import { MAX_MOTTO_UPLOAD_BYTES, MAX_MOTTO_PIXELS, isServerMottoKey, mottoCropSchema, mottoMetadataSchema, validMottoCrop, type MottoMetadata } from "./server-motto-contract";

export async function prepareMottoImage(bytes: Buffer, rawCrop: unknown, existingSource = false) {
  invariant(bytes.length > 0 && bytes.length <= (existingSource ? 64 * 1024 * 1024 : MAX_MOTTO_UPLOAD_BYTES), 413, diagnosticText("diagnostics.organizationAvatar.theImageMustNotExceed8Mib"));
  const parsedCrop = mottoCropSchema.safeParse(rawCrop);
  invariant(parsedCrop.success, 400, diagnosticText("diagnostics.organizationAvatar.invalidImageCrop"));
  const crop = parsedCrop.data;
  let source: Buffer; let width: number; let height: number;
  try {
    const metadata = await sharp(bytes, { limitInputPixels: MAX_MOTTO_PIXELS, failOn: "warning" }).metadata();
    invariant(["jpeg", "png", "webp"].includes(metadata.format ?? "") && (metadata.pages ?? 1) === 1, 415, diagnosticText("diagnostics.organizationAvatar.uploadAStaticPngJpegOrWebpImage"));
    const normalized = await sharp(bytes, { limitInputPixels: MAX_MOTTO_PIXELS, failOn: "warning" }).autoOrient().webp({ lossless: true }).toBuffer({ resolveWithObject: true });
    source = normalized.data; width = normalized.info.width; height = normalized.info.height;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(422, diagnosticText("diagnostics.organizationAvatar.theImageCannotBeDecodedOrExceedsThePixelLimit"));
  }
  invariant(validMottoCrop(crop, width, height), 400, diagnosticText("diagnostics.serverMotto.theCropMustStayInsideTheImageAndKeepA"));
  const left = Math.min(width - 1, Math.round(crop.left * width)), top = Math.min(height - 1, Math.round(crop.top * height));
  const extractWidth = Math.max(1, Math.min(width - left, Math.round(crop.width * width)));
  const extractHeight = Math.max(1, Math.min(height - top, Math.round(crop.height * height)));
  const image = await sharp(source).extract({ left, top, width: extractWidth, height: extractHeight }).resize(1410, 600, { fit: "fill" }).webp({ quality: 88 }).toBuffer();
  const metadata: MottoMetadata = { version: 1, width, height, crop, sourceSha256: digest(source), imageSha256: digest(image) };
  return { source, image, metadata };
}

export async function storeMottoImage(organizationId: string, serverId: string, prepared: Awaited<ReturnType<typeof prepareMottoImage>>) {
  const directory = `server-mottos/${organizationId}/${serverId}/${randomUUID()}`;
  // Separate immutable versions preserve the source for re-cropping and avoid overwriting a concurrent editor.
  for (const [file, bytes, contentType] of [["source.webp", prepared.source, "image/webp"], ["image.webp", prepared.image, "image/webp"],
    ["metadata.json", Buffer.from(JSON.stringify(prepared.metadata)), "application/json"]] as const) {
    await storageClient().putObject({ Bucket: packagesBucket(), Key: `${directory}/${file}`, Body: bytes, ContentType: contentType,
      Metadata: { sha256: digest(bytes) }, ChecksumSHA256: Buffer.from(digest(bytes), "hex").toString("base64"), IfNoneMatch: "*" });
  }
  return { key: `${directory}/image.webp`, metadata: prepared.metadata };
}

export async function saveServerMotto(db: Db, actor: Actor, serverId: string, expectedKey: string | null, stored: Awaited<ReturnType<typeof storeMottoImage>> | null) {
  const { server } = await requireServer(db, actor, serverId, "SERVER_EDIT");
  invariant(server.iconObjectKey === expectedKey, 409, diagnosticText("diagnostics.serverMotto.theServerMottoWasModifiedByAnotherUserRefreshAnd"));
  invariant(!stored || isServerMottoKey(stored.key, server.organizationId, serverId), 400, diagnosticText("diagnostics.serverMotto.theImageDoesNotBelongToThisServer"));
  const result = await db.server.updateMany({ where: { serverId, iconObjectKey: expectedKey }, data: { iconObjectKey: stored?.key ?? null } });
  invariant(result.count === 1, 409, diagnosticText("diagnostics.serverMotto.theServerMottoHasChangedRefreshAndRetry"));
  await audit(db, actor, stored ? "SERVER_MOTTO_UPLOAD" : "SERVER_MOTTO_REMOVE", "Server", serverId, server.organizationId, serverId,
    { previousKey: expectedKey, key: stored?.key ?? null, ...(stored ? { crop: stored.metadata.crop, sha256: stored.metadata.imageSha256 } : {}) });
  return { ok: true, iconObjectKey: stored?.key ?? null };
}

export async function readServerMotto(key: string | null, organizationId: string, serverId: string, variant: "image" | "source" | "metadata") {
  invariant(isServerMottoKey(key, organizationId, serverId), 404, diagnosticText("diagnostics.serverMotto.thisServerHasNoMottoImage"));
  const directory = key.slice(0, -"image.webp".length);
  const metadata = mottoMetadataSchema.parse(JSON.parse((await readObject(`${directory}metadata.json`, packagesBucket(), 4096)).toString("utf8")));
  if (variant === "metadata") return { metadata, bytes: null };
  const bytes = await readObject(`${directory}${variant === "source" ? "source.webp" : "image.webp"}`, packagesBucket());
  invariant(digest(bytes) === (variant === "source" ? metadata.sourceSha256 : metadata.imageSha256), 503, diagnosticText("diagnostics.serverMotto.serverMottoImageValidationFailed"));
  return { metadata, bytes };
}
