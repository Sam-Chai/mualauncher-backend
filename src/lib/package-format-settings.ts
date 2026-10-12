import "server-only";
import { z } from "zod";
import type { Db, Actor } from "./auth";
import { superOnly } from "./rbac";
import { invariant } from "./errors";
import { audit } from "./management";
import { DEFAULT_PACKAGE_FORMATS, enabledPackageFormatsSchema } from "./package-format-policy";

export async function enabledPackageFormats(db: Db) {
  const row = await db.platformSettings.findUnique({ where: { id: "platform" }, select: { enabledPackageFormats: true } });
  return enabledPackageFormatsSchema.parse(row?.enabledPackageFormats ?? DEFAULT_PACKAGE_FORMATS);
}
export async function packageFormatSettings(db: Db, actor: Actor) {
  superOnly(actor);
  return { enabledPackageFormats: await enabledPackageFormats(db) };
}
export async function updatePackageFormatSettings(db: Db, actor: Actor, raw: unknown) {
  superOnly(actor);
  const result = z.object({ enabledPackageFormats: enabledPackageFormatsSchema }).strict().safeParse(raw);
  invariant(result.success, 400, result.success ? "" : result.error.issues[0]?.message ?? "muapack 格式设置无效");
  const formats = [...result.data.enabledPackageFormats].sort();
  await db.platformSettings.upsert({ where: { id: "platform" }, create: { id: "platform", enabledPackageFormats: formats }, update: { enabledPackageFormats: formats } });
  await audit(db, actor, "PACKAGE_FORMAT_SETTINGS_UPDATE", "PlatformSettings", "platform", undefined, undefined, { enabledPackageFormats: formats });
  return { enabledPackageFormats: formats };
}
