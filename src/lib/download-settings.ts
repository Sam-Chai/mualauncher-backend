import "server-only";
import { z } from "zod";
import type { Db, Actor } from "./auth";
import { superOnly } from "./rbac";
import { invariant } from "./errors";
import { audit } from "./management";
import { DEFAULT_ENVIRONMENT_DOWNLOAD_SETTINGS } from "./download-sources";

export const DEFAULT_REMOTE_HOSTS = ["cdn.modrinth.com", "github.com", "raw.githubusercontent.com", "release-assets.githubusercontent.com",
  "objects.githubusercontent.com", "gitlab.com", "edge.forgecdn.net", "mediafilez.forgecdn.net"];
const host = z.string().trim().toLowerCase().max(253).regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/, "请填写完整域名，不包含协议、路径或通配符");
export const downloadSettingsSchema = z.object({ remoteSourceWhitelistEnabled: z.boolean(), remoteSourceHosts: z.array(host).max(100),
  downloadProxyEnabled: z.boolean(), downloadProxyUrl: z.string().trim().max(2000).refine(value => {
    if (!value) return true;
    try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash; }
    catch { return false; }
  }, "代理地址应为 http(s)://主机:端口，不含账号、密码或路径"),
  minecraftDownloadSources: z.array(z.enum(["bmclapi", "ustc", "nju"])).max(3).refine(value => new Set(value).size === value.length, "镜像源不能重复").default([...DEFAULT_ENVIRONMENT_DOWNLOAD_SETTINGS.minecraftDownloadSources]),
  javaDownloadSources: z.array(z.enum(["tuna"])).max(1).default(["tuna"]),
  mirrorProxyEnabled: z.boolean().default(false), javaImageType: z.enum(["jre", "jdk"]).default("jre"),
  }).strict()
  .refine(value => !value.downloadProxyEnabled || !!value.downloadProxyUrl, "启用代理时请填写地址");
export type DownloadSettings = z.infer<typeof downloadSettingsSchema>;
export async function workerDownloadSettings(db: Db): Promise<DownloadSettings> {
  const row = await db.platformSettings.findUnique({ where: { id: "platform" } });
  return row ? downloadSettingsSchema.parse({ remoteSourceWhitelistEnabled: row.remoteSourceWhitelistEnabled, remoteSourceHosts: row.remoteSourceHosts,
      downloadProxyEnabled: row.downloadProxyEnabled, downloadProxyUrl: row.downloadProxyUrl,
      minecraftDownloadSources: row.minecraftDownloadSources, javaDownloadSources: row.javaDownloadSources, mirrorProxyEnabled: row.mirrorProxyEnabled, javaImageType: row.javaImageType }) :
    { remoteSourceWhitelistEnabled: false, remoteSourceHosts: DEFAULT_REMOTE_HOSTS, downloadProxyEnabled: false, downloadProxyUrl: "", ...DEFAULT_ENVIRONMENT_DOWNLOAD_SETTINGS };
}
export async function downloadSettings(db: Db, actor: Actor) { superOnly(actor); return workerDownloadSettings(db); }
export async function updateDownloadSettings(db: Db, actor: Actor, raw: unknown) {
  superOnly(actor);
  // Older callers may omit the newly added fields. Preserve configured mirrors
  // rather than resetting them when they update the existing proxy/host settings.
  const current = await workerDownloadSettings(db);
  const result = downloadSettingsSchema.safeParse(raw && typeof raw === "object" && !Array.isArray(raw) ? {
    minecraftDownloadSources: current.minecraftDownloadSources, javaDownloadSources: current.javaDownloadSources,
    mirrorProxyEnabled: current.mirrorProxyEnabled, javaImageType: current.javaImageType, ...raw,
  } : raw);
  invariant(result.success, 400, result.success ? "" : result.error.issues[0]?.message ?? "下载设置无效");
  const data = { ...result.data, remoteSourceHosts: [...new Set(result.data.remoteSourceHosts)].sort() };
  await db.platformSettings.upsert({ where: { id: "platform" }, create: { id: "platform", ...data }, update: data });
  await audit(db, actor, "DOWNLOAD_SETTINGS_UPDATE", "PlatformSettings", "platform", undefined, undefined,
    { remoteSourceWhitelistEnabled: data.remoteSourceWhitelistEnabled, remoteSourceHosts: data.remoteSourceHosts, downloadProxyEnabled: data.downloadProxyEnabled,
      minecraftDownloadSources: data.minecraftDownloadSources, javaDownloadSources: data.javaDownloadSources, mirrorProxyEnabled: data.mirrorProxyEnabled, javaImageType: data.javaImageType });
  return data;
}
