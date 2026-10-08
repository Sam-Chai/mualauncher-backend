"use client";
import { z } from "zod";
import type { ColumnDef } from "@tanstack/react-table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api, formatDate, useAdmin, type State } from "./provider";
import { DataTable } from "./data-table";
import { Heading, NoPermission } from "./common";
import { SchemaForm, passwordSchema } from "./form";
import { navigateAfterAuthChange } from "@/lib/auth-navigation";
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
    <Card><CardHeader><CardTitle>平台接入</CardTitle><CardDescription>当前为白名单登录与应用层 RBAC。</CardDescription></CardHeader><CardContent className="space-y-4 text-sm">{[["身份认证", "本地白名单 · 已启用"], ["MUA OIDC / Auth.js", "待接入"], ["PostgreSQL RLS", "规划中 · 当前使用 RBAC"], ["对象存储", "S3 API / MinIO · 待接入"], ["任务处理", "Redis / Worker · 待接入"]].map(([label, value]) => <div key={label} className="flex justify-between gap-4 border-b pb-3 last:border-0"><span className="text-muted-foreground">{label}</span><span className="text-right">{value}</span></div>)}</CardContent></Card>
  </div></>;
}
