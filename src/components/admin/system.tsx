"use client";
import { useI18n } from "@/components/preferences";
import { useEffect, useState } from "react";
import { z } from "zod";
import type { ColumnDef } from "@tanstack/react-table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api, useAdmin, type State } from "./provider";
import { DataTable } from "./data-table";
import { Heading, NoPermission } from "./common";
import { SchemaForm, passwordSchema } from "./form";
import { navigateAfterAuthChange } from "@/lib/auth-navigation";
import { ApiTokens } from "./api-tokens";
import type { DownloadSettings } from "@/lib/download-settings";
import { MINECRAFT_SOURCES, JAVA_SOURCES } from "@/lib/download-sources";
import { PackageFormatSettingsCard } from "./package-format-settings";
import { UploadSizeSettingsCard } from "./upload-size-settings";
import { UnionSyncSettings } from "./union-sync-settings";
export function AuditPage() {
  const { t, formatDate } = useI18n();
  const { state } = useAdmin();
  if (!state.actor.isSuperAdmin) return <NoPermission />;
  const columns: ColumnDef<State["events"][number]>[] = [
    { accessorKey: "createdAt", header: t("时间"), cell: ({ row }) => <span className="whitespace-nowrap text-xs">{formatDate(row.original.createdAt)}</span> },
    { id: "actor", header: t("操作人"), accessorFn: event => event.actor.displayName },
    { accessorKey: "action", header: t("动作"), cell: ({ getValue }) => <code className="text-xs">{String(getValue())}</code> },
    { accessorKey: "targetType", header: t("对象类型") },
    { accessorKey: "targetId", header: t("对象 ID"), cell: ({ getValue }) => <code className="text-xs">{String(getValue())}</code> },
    { id: "scope", header: t("范围"), accessorFn: event => event.serverId || event.organizationId || t("全局") },
  ];
  return <><Heading title="Audit Log" description={t("最近 50 条操作记录，按时间倒序排列。审计记录只读并保留历史。")} /><DataTable data={state.events} columns={columns} searchPlaceholder={t("搜索动作、对象或操作人…")} /></>;
}
export function SettingsPage() {
  const { t } = useI18n();
  const { state, busy, run } = useAdmin();
  return <><Heading title="Settings" description={t("账号安全与平台接入状态。")} /><div className="space-y-6"><div className="grid items-stretch gap-6 xl:grid-cols-2">
    <Card><CardHeader><CardTitle>{t("账号安全")}</CardTitle><CardDescription>{state.actor.displayName} {" " + t("· 修改密码后全部会话失效，需要重新登录。")}</CardDescription></CardHeader><CardContent><SchemaForm schema={z.object({ currentPassword: z.string().min(1, t("请输入当前密码")).max(128), newPassword: passwordSchema })} fields={[{ name: "currentPassword", label: t("当前密码"), type: "password", autoComplete: "current-password" }, { name: "newPassword", label: t("新密码"), type: "password", autoComplete: "new-password" }]} defaults={{ currentPassword: "", newPassword: "" }} disabled={busy} label={t("修改密码并退出登录")}
      onSubmit={values => run(async () => { await api("/api/auth/password", "POST", values); navigateAfterAuthChange("/login"); }, "", false)} /></CardContent></Card>
    <Card><CardHeader><CardTitle>{t("平台接入")}</CardTitle><CardDescription>{t("已启用白名单登录、应用层 RBAC 与 PostgreSQL RLS。")}</CardDescription></CardHeader><CardContent className="space-y-4 text-sm">{[[t("身份认证"), t("本地白名单 · 已启用")], ["Union OAuth", t("来源皮肤站 · 普通成员登录")], ["PostgreSQL RLS", t("已接入 · 保留应用层 RBAC")], [t("对象存储"), t("对象存储适配器 · 已接入")], [t("任务处理"), t("独立 Worker · PostgreSQL 持久任务")]].map(([label, value]) => <div key={label} className="flex justify-between gap-4 border-b pb-3 last:border-0"><span className="text-muted-foreground">{label}</span><span className="text-right">{value}</span></div>)}</CardContent></Card>
  </div><div className="grid items-stretch gap-6 xl:grid-cols-2">
    <ApiTokens />
    {state.actor.isSuperAdmin && <RecycleSettings />}
  </div>
    {state.actor.isSuperAdmin && <DownloadSettingsCards />}
    {state.actor.isSuperAdmin && <UnionSyncSettings />}
  </div></>;
}
function DownloadSettingsCards() {
  const { t } = useI18n();
  const { busy, run } = useAdmin(); const [settings, setSettings] = useState<DownloadSettings | null>(null), [error, setError] = useState("");
  useEffect(() => { let active = true; void api<DownloadSettings>("/api/admin/download-settings").then(value => { if (active) setSettings(value); }).catch(error => { if (active) setError(error instanceof Error ? error.message : t("读取下载设置失败")); }); return () => { active = false; }; }, [t]);
  const status = error ? <p role="alert" className="text-sm text-destructive">{t(error)}</p> : <p role="status" className="text-sm text-muted-foreground">{t("读取下载设置…")}</p>;
  return <div className="grid items-stretch gap-6 xl:grid-cols-2"><Card className="min-w-0"><CardHeader><CardTitle>{t("Worker 下载源")}</CardTitle><CardDescription>{t("环境先使用所选国内镜像，失败后回退官方；已缓存环境直接复用。仅 MUA 超级管理员可配置。")}</CardDescription></CardHeader><CardContent className="space-y-5">
    {!settings ? status : <SchemaForm key={JSON.stringify([settings.remoteSourceWhitelistEnabled, settings.remoteSourceHosts, settings.minecraftDownloadSources, settings.javaDownloadSources, settings.javaImageType])}
      schema={z.object({ whitelist: z.boolean(), hosts: z.string().max(30000),
        mirrors: z.array(z.enum(["bmclapi", "ustc", "nju"])), javaMirrors: z.array(z.enum(["tuna"])), javaType: z.enum(["jre", "jdk"]) })}
      fields={[{ name: "mirrors", label: t("Minecraft 与加载器下载源"), type: "roles", options: MINECRAFT_SOURCES.map(source => ({ value: source.value, label: source.label })),
        hint: t("按 BMCLAPI → 中科大 → 南大顺序尝试所选源，最后回退官方。中科大／南大主要覆盖 Maven 库；不提供 BMCLAPI 元数据接口。全部取消即仅用官方。") },
        { name: "javaMirrors", label: t("Java 下载源"), type: "roles", options: JAVA_SOURCES.map(source => ({ value: source.value, label: source.label })), hint: t("Java 压缩包优先走清华，缺失或校验失败时回退官方。版本及 SHA-256 从 Adoptium 官方 API 获取。") },
        { name: "javaType", label: t("集成的 Java 环境"), type: "select", options: [{ value: "jre", label: t("JRE（默认，运行游戏）") }, { value: "jdk", label: t("JDK（兼容需要开发工具的客户端）") }], hint: t("部分 Java／平台组合无 JRE（例如目前 Java 25 Windows ARM64），任务会明确提示调整平台或改用 JDK。旧发布不受此设置影响。") },
        { name: "whitelist", label: t("开启整合包远程来源白名单"), type: "checkbox", hint: t("只控制整合包远程文件，不控制内置环境源。默认关闭；HTTPS、公开地址、重定向和哈希保护始终启用。") },
        { name: "hosts", label: t("允许的远程来源"), type: "textarea", hint: t("每行一个完整域名。不填写协议、路径或通配符；无需包含 Minecraft 官方环境来源。") },
        ]}
      defaults={{ whitelist: settings.remoteSourceWhitelistEnabled, hosts: settings.remoteSourceHosts.join("\n"),
        mirrors: settings.minecraftDownloadSources, javaMirrors: settings.javaDownloadSources, javaType: settings.javaImageType }} disabled={busy} label={t("保存下载设置")}
      onSubmit={values => run(async () => { const next = await api<DownloadSettings>("/api/admin/download-settings", "PATCH", { ...settings, remoteSourceWhitelistEnabled: values.whitelist,
        remoteSourceHosts: String(values.hosts).split(/[\s,]+/).filter(Boolean),
        minecraftDownloadSources: MINECRAFT_SOURCES.filter(source => Array.isArray(values.mirrors) && values.mirrors.includes(source.value)).map(source => source.value),
        javaDownloadSources: values.javaMirrors, javaImageType: values.javaType }); setSettings(next); }, t("下载设置已保存"))} />}
    <div className="space-y-1 border-t pt-4 text-xs text-muted-foreground"><p>{t("环境镜像来源：")}</p>{[...MINECRAFT_SOURCES, ...JAVA_SOURCES].map(source => <p key={source.value}><a className="underline" href={"documentation" in source ? source.documentation : source.url + "/"} target="_blank" rel="noreferrer">{t(source.label)}</a> · {source.url}</p>)}</div>
  </CardContent></Card><div className="grid min-w-0 grid-rows-[auto_auto_1fr] gap-6">
    <Card><CardHeader><CardTitle>{t("Worker 代理设置")}</CardTitle><CardDescription>{t("配置官方环境与整合包远程文件的下载代理。对象存储上传不经过代理。仅 MUA 超级管理员可配置。")}</CardDescription></CardHeader><CardContent>
      {!settings ? status : <SchemaForm key={JSON.stringify([settings.downloadProxyEnabled, settings.downloadProxyUrl, settings.mirrorProxyEnabled])}
        schema={z.object({ proxy: z.boolean(), proxyUrl: z.string().trim().max(2000), mirrorProxy: z.boolean() }).refine(values => !values.proxy || !!values.proxyUrl, { message: t("启用代理时请填写地址"), path: ["proxyUrl"] })}
        fields={[
          { name: "proxy", label: t("通过代理下载官方环境与整合包远程文件"), type: "checkbox" },
          { name: "proxyUrl", label: t("HTTP／HTTPS 代理地址"), placeholder: "http://127.0.0.1:7890", hint: t("支持 CONNECT 代理，不含账号密码。作用于官方环境来源及整合包远程文件。") },
          { name: "mirrorProxy", label: t("镜像源下载也通过代理"), type: "checkbox", hint: t("默认关闭：镜像及其 CDN 直连。仅在上面的代理开关启用后生效；官方回退仍使用代理。") },
        ]}
        defaults={{ proxy: settings.downloadProxyEnabled, proxyUrl: settings.downloadProxyUrl, mirrorProxy: settings.mirrorProxyEnabled }} disabled={busy} label={t("保存代理设置")}
        onSubmit={values => run(async () => { const next = await api<DownloadSettings>("/api/admin/download-settings", "PATCH", { ...settings,
          downloadProxyEnabled: values.proxy, downloadProxyUrl: values.proxyUrl, mirrorProxyEnabled: values.mirrorProxy }); setSettings(next); }, t("代理设置已保存"))} />}
    </CardContent></Card>
    <UploadSizeSettingsCard />
    <PackageFormatSettingsCard />
  </div></div>;
}
function RecycleSettings() {
  const { t } = useI18n();
  const { busy, run } = useAdmin(); const [days, setDays] = useState<number | null>(null); const [error, setError] = useState("");
  useEffect(() => { let active = true; void api<{ recycleRetentionDays: number }>("/api/admin/recycle-settings").then(data => { if (active) setDays(data.recycleRetentionDays); }).catch(error => { if (active) setError(error instanceof Error ? error.message : t("读取回收站设置失败")); }); return () => { active = false; }; }, [t]);
  return <Card><CardHeader><CardTitle>{t("OSS 回收站")}</CardTitle><CardDescription>{t("仅 MUA 超级管理员可调整。默认保留 7 天；Worker 每分钟检查，清理已达到保留期的回收文件。共享文件与已发布客户端不受影响。")}</CardDescription></CardHeader><CardContent>{error ? <p role="alert" className="text-sm text-destructive">{t(error)}</p> : days === null ? <p role="status" className="text-sm text-muted-foreground">{t("读取回收站设置…")}</p> : <SchemaForm key={days} schema={z.object({ days: z.string().regex(/^\d+$/, t("请输入整数天数")).refine(value => Number(value) >= 1 && Number(value) <= 365, t("保留期为 1–365 天")) })} fields={[{ name: "days", label: t("文件保留期（天）"), type: "number", hint: t("缩短保留期后，已到期文件将在下一次清理时永久移除。") }]} defaults={{ days: String(days) }} disabled={busy} label={t("保存回收站设置")} onSubmit={values => run(async () => { const next = await api<{ recycleRetentionDays: number }>("/api/admin/recycle-settings", "PATCH", { recycleRetentionDays: Number(values.days) }); setDays(next.recycleRetentionDays); }, t("回收站设置已保存"))} />}</CardContent></Card>;
}
