"use client";
import { useEffect, useState } from "react";
import { z } from "zod";
import type { ColumnDef } from "@tanstack/react-table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api, formatDate, useAdmin, type State } from "./provider";
import { DataTable } from "./data-table";
import { Heading, NoPermission } from "./common";
import { SchemaForm, passwordSchema } from "./form";
import { navigateAfterAuthChange } from "@/lib/auth-navigation";
import { ApiTokens } from "./api-tokens";
import type { DownloadSettings } from "@/lib/download-settings";
import { MINECRAFT_SOURCES, JAVA_SOURCES } from "@/lib/download-sources";
import { PackageFormatSettingsCard } from "./package-format-settings";
export function AuditPage() {
  const { state } = useAdmin();
  if (!state.actor.isSuperAdmin) return <NoPermission />;
  const columns: ColumnDef<State["events"][number]>[] = [
    { accessorKey: "createdAt", header: "时间", cell: ({ row }) => <span className="whitespace-nowrap text-xs">{formatDate(row.original.createdAt)}</span> },
    { id: "actor", header: "操作人", accessorFn: event => event.actor.displayName },
    { accessorKey: "action", header: "动作", cell: ({ getValue }) => <code className="text-xs">{String(getValue())}</code> },
    { accessorKey: "targetType", header: "对象类型" },
    { accessorKey: "targetId", header: "对象 ID", cell: ({ getValue }) => <code className="text-xs">{String(getValue())}</code> },
    { id: "scope", header: "范围", accessorFn: event => event.serverId || event.organizationId || "全局" },
  ];
  return <><Heading title="Audit Log" description="最近 50 条操作记录，按时间倒序排列。审计记录只读并保留历史。" /><DataTable data={state.events} columns={columns} searchPlaceholder="搜索动作、对象或操作人…" /></>;
}
export function SettingsPage() {
  const { state, busy, run } = useAdmin();
  return <><Heading title="Settings" description="账号安全与平台接入状态。" /><div className="grid items-start gap-6 xl:grid-cols-2">
    <Card><CardHeader><CardTitle>账号安全</CardTitle><CardDescription>{state.actor.displayName} · 修改密码后全部会话失效，需要重新登录。</CardDescription></CardHeader><CardContent><SchemaForm schema={z.object({ currentPassword: z.string().min(1, "请输入当前密码").max(128), newPassword: passwordSchema })} fields={[{ name: "currentPassword", label: "当前密码", type: "password", autoComplete: "current-password" }, { name: "newPassword", label: "新密码", type: "password", autoComplete: "new-password" }]} defaults={{ currentPassword: "", newPassword: "" }} disabled={busy} label="修改密码并退出登录"
      onSubmit={values => run(async () => { await api("/api/auth/password", "POST", values); navigateAfterAuthChange("/login"); }, "", false)} /></CardContent></Card>
    <Card><CardHeader><CardTitle>平台接入</CardTitle><CardDescription>当前为白名单登录与应用层 RBAC。</CardDescription></CardHeader><CardContent className="space-y-4 text-sm">{[["身份认证", "本地白名单 · 已启用"], ["MUA OIDC / Auth.js", "待接入"], ["PostgreSQL RLS", "规划中 · 当前使用 RBAC"], ["对象存储", "S3 API / MinIO · 已接入"], ["任务处理", "独立 Worker · PostgreSQL 持久任务"]].map(([label, value]) => <div key={label} className="flex justify-between gap-4 border-b pb-3 last:border-0"><span className="text-muted-foreground">{label}</span><span className="text-right">{value}</span></div>)}</CardContent></Card>
    <ApiTokens />
    {state.actor.isSuperAdmin && <RecycleSettings />}
    {state.actor.isSuperAdmin && <DownloadSettingsCard />}
    {state.actor.isSuperAdmin && <PackageFormatSettingsCard />}
  </div></>;
}
function DownloadSettingsCard() {
  const { busy, run } = useAdmin(); const [settings, setSettings] = useState<DownloadSettings | null>(null), [error, setError] = useState("");
  useEffect(() => { let active = true; void api<DownloadSettings>("/api/admin/download-settings").then(value => { if (active) setSettings(value); }).catch(error => { if (active) setError(error instanceof Error ? error.message : "读取下载设置失败"); }); return () => { active = false; }; }, []);
  return <Card><CardHeader><CardTitle>Worker 下载源与代理</CardTitle><CardDescription>仅 MUA 超级管理员可配置。环境先使用所选国内镜像，失败后回退官方；已缓存环境直接复用。上传 MinIO 不经过代理。</CardDescription></CardHeader><CardContent className="space-y-5">
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : !settings ? <p role="status">读取下载设置…</p> : <SchemaForm key={JSON.stringify(settings)}
      schema={z.object({ whitelist: z.boolean(), hosts: z.string().max(30000), proxy: z.boolean(), proxyUrl: z.string().trim().max(2000),
        mirrors: z.array(z.enum(["bmclapi", "ustc", "nju"])), javaMirrors: z.array(z.enum(["tuna"])), mirrorProxy: z.boolean(), javaType: z.enum(["jre", "jdk"]) })}
      fields={[{ name: "mirrors", label: "Minecraft 与加载器下载源", type: "roles", options: MINECRAFT_SOURCES.map(source => ({ value: source.value, label: source.label })),
        hint: "按 BMCLAPI → 中科大 → 南大顺序尝试所选源，最后回退官方。中科大／南大主要覆盖 Maven 库；不提供 BMCLAPI 元数据接口。全部取消即仅用官方。" },
        { name: "javaMirrors", label: "Java 下载源", type: "roles", options: JAVA_SOURCES.map(source => ({ value: source.value, label: source.label })), hint: "Java 压缩包优先走清华，缺失或校验失败时回退官方。版本及 SHA-256 从 Adoptium 官方 API 获取。" },
        { name: "javaType", label: "集成的 Java 环境", type: "select", options: [{ value: "jre", label: "JRE（默认，运行游戏）" }, { value: "jdk", label: "JDK（兼容需要开发工具的客户端）" }], hint: "部分 Java／平台组合无 JRE（例如目前 Java 25 Windows ARM64），任务会明确提示调整平台或改用 JDK。旧发布不受此设置影响。" },
        { name: "proxy", label: "通过代理下载官方环境与整合包远程文件", type: "checkbox" },
        { name: "proxyUrl", label: "HTTP／HTTPS 代理地址", placeholder: "http://127.0.0.1:7890", hint: "支持 CONNECT 代理，不含账号密码。作用于官方环境来源及整合包远程文件。" },
        { name: "mirrorProxy", label: "镜像源下载也通过代理", type: "checkbox", hint: "默认关闭：镜像及其 CDN 直连。仅在上面的代理开关启用后生效；官方回退仍使用代理。" },
        { name: "whitelist", label: "开启整合包远程来源白名单", type: "checkbox", hint: "只控制整合包远程文件，不控制内置环境源。默认关闭；HTTPS、公开地址、重定向和哈希保护始终启用。" },
        { name: "hosts", label: "允许的远程来源", type: "textarea", hint: "每行一个完整域名。不填写协议、路径或通配符；无需包含 Minecraft 官方环境来源。" },
        ]}
      defaults={{ whitelist: settings.remoteSourceWhitelistEnabled, hosts: settings.remoteSourceHosts.join("\n"), proxy: settings.downloadProxyEnabled, proxyUrl: settings.downloadProxyUrl,
        mirrors: settings.minecraftDownloadSources, javaMirrors: settings.javaDownloadSources, mirrorProxy: settings.mirrorProxyEnabled, javaType: settings.javaImageType }} disabled={busy} label="保存下载设置"
      onSubmit={values => run(async () => { const next = await api<DownloadSettings>("/api/admin/download-settings", "PATCH", { remoteSourceWhitelistEnabled: values.whitelist,
        remoteSourceHosts: String(values.hosts).split(/[\s,]+/).filter(Boolean), downloadProxyEnabled: values.proxy, downloadProxyUrl: values.proxyUrl,
        minecraftDownloadSources: MINECRAFT_SOURCES.filter(source => Array.isArray(values.mirrors) && values.mirrors.includes(source.value)).map(source => source.value),
        javaDownloadSources: values.javaMirrors, mirrorProxyEnabled: values.mirrorProxy, javaImageType: values.javaType }); setSettings(next); }, "下载设置已保存")} />}
    <div className="space-y-1 border-t pt-4 text-xs text-muted-foreground"><p>环境镜像来源：</p>{[...MINECRAFT_SOURCES, ...JAVA_SOURCES].map(source => <p key={source.value}><a className="underline" href={"documentation" in source ? source.documentation : source.url + "/"} target="_blank" rel="noreferrer">{source.label}</a> · {source.url}</p>)}</div>
  </CardContent></Card>;
}
function RecycleSettings() {
  const { busy, run } = useAdmin(); const [days, setDays] = useState<number | null>(null); const [error, setError] = useState("");
  useEffect(() => { let active = true; void api<{ recycleRetentionDays: number }>("/api/admin/recycle-settings").then(data => { if (active) setDays(data.recycleRetentionDays); }).catch(error => { if (active) setError(error instanceof Error ? error.message : "读取回收站设置失败"); }); return () => { active = false; }; }, []);
  return <Card><CardHeader><CardTitle>OSS 回收站</CardTitle><CardDescription>仅 MUA 超级管理员可调整。默认保留 7 天；Worker 每分钟检查，清理已达到保留期的回收文件。共享文件与已发布客户端不受影响。</CardDescription></CardHeader><CardContent>{error ? <p role="alert" className="text-sm text-destructive">{error}</p> : days === null ? <p role="status" className="text-sm text-muted-foreground">读取回收站设置…</p> : <SchemaForm key={days} schema={z.object({ days: z.string().regex(/^\d+$/, "请输入整数天数").refine(value => Number(value) >= 1 && Number(value) <= 365, "保留期为 1–365 天") })} fields={[{ name: "days", label: "文件保留期（天）", type: "number", hint: "缩短保留期后，已到期文件将在下一次清理时永久移除。" }]} defaults={{ days: String(days) }} disabled={busy} label="保存回收站设置" onSubmit={values => run(async () => { const next = await api<{ recycleRetentionDays: number }>("/api/admin/recycle-settings", "PATCH", { recycleRetentionDays: Number(values.days) }); setDays(next.recycleRetentionDays); }, "回收站设置已保存")} />}</CardContent></Card>;
}
