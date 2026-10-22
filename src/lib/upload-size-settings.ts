import { diagnosticText } from "@/lib/diagnostics";
import "server-only";
import { z } from "zod";
import type { Actor, Db } from "./auth";
import { invariant } from "./errors";
import { superOnly } from "./rbac";
import { audit } from "./management";
import { DEFAULT_MAX_UPLOAD_SIZE_MB, MAX_UPLOAD_SIZE_MB, maxUploadSizeMbSchema } from "./upload-size-policy";
import { uploadOptions } from "./database-security";

export async function maxUploadSizeMb(db: Db) {
  const row = await uploadOptions(db);
  return maxUploadSizeMbSchema.parse(row?.maxUploadSizeMb ?? DEFAULT_MAX_UPLOAD_SIZE_MB);
}

export async function uploadSizeSettings(db: Db, actor: Actor) {
  superOnly(actor);
  return { maxUploadSizeMb: await maxUploadSizeMb(db) };
}

export async function updateUploadSizeSettings(db: Db, actor: Actor, raw: unknown) {
  superOnly(actor);
  const result = z.object({ maxUploadSizeMb: maxUploadSizeMbSchema }).strict().safeParse(raw);
  invariant(result.success, 400, diagnosticText("diagnostics.uploadSizeSettings.theMaximumUploadSizeMustBeAnIntegerFrom1", { arg0: MAX_UPLOAD_SIZE_MB }));
  const previous = await maxUploadSizeMb(db);
  const value = result.data.maxUploadSizeMb;
  await db.platformSettings.upsert({ where: { id: "platform" }, create: { id: "platform", maxUploadSizeMb: value }, update: { maxUploadSizeMb: value } });
  await audit(db, actor, "UPLOAD_SIZE_SETTINGS_UPDATE", "PlatformSettings", "platform", undefined, undefined, { previousMaxUploadSizeMb: previous, maxUploadSizeMb: value });
  return { maxUploadSizeMb: value };
}
