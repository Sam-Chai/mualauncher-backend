"use client";
import { useState } from "react";
import Link from "next/link";
import { useI18n, PreferenceControls } from "@/components/preferences";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { DataTable } from "@/components/admin/data-table";
import { api } from "@/components/admin/provider";
import { navigateAfterAuthChange } from "@/lib/auth-navigation";
import type { memberState } from "@/lib/member-access";
import type { MemberServer } from "@/lib/union-contract";
import type { ColumnDef } from "@tanstack/react-table";

export function MemberDirectory({ initial }: { initial: Awaited<ReturnType<typeof memberState>> }) {
  const { t } = useI18n(); const [state, setState] = useState(initial), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [platform, setPlatform] = useState("windows-amd64");
  const columns: ColumnDef<MemberServer>[] = [
    { accessorKey: "displayName", header: t("服务器") }, { id: "organization", header: t("组织"), accessorFn: row => row.organization.displayName },
    { id: "client", header: t("客户端"), accessorFn: row => row.currentRelease.name }, { id: "version", header: t("版本"), accessorFn: row => row.currentRelease.versionLabel },
    { id: "download", header: t("操作"), cell: ({ row }) => <Button disabled={busy} variant="outline" size="sm" onClick={async () => {
      setBusy(true); setError(""); try { const result = await api<{ full: { url: string } }>(`/api/v1/servers/${row.original.serverId}/packages?acceptedFormatVersions=1,2&platform=${platform}`); window.location.assign(result.full.url); }
      catch (e) { setError(e instanceof Error ? e.message : "请求失败"); } finally { setBusy(false); }
    }}>{t("下载完整包")}</Button> },
  ];
  return <main className="mx-auto max-w-6xl space-y-6 p-6"><header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold">Union Link</h1><p className="text-sm text-muted-foreground">{state.actor.displayName} · {t("成员目录")}</p></div><div className="flex items-center gap-2"><PreferenceControls />{state.actor.canManage && <Button variant="outline" asChild><Link href="/admin">{t("管理后台")}</Link></Button>}<Button variant="outline" disabled={busy} onClick={async () => { await api("/api/auth/logout", "POST", {}); navigateAfterAuthChange("/login"); }}>{t("退出登录")}</Button></div></header>
    {error && <Alert variant="destructive"><AlertDescription>{t(error)}</AlertDescription></Alert>}
    <Card><CardHeader><CardTitle>{t("可访问的服务器")}</CardTitle><p className="text-sm text-muted-foreground">{t("本组织资源与经审批的外部资源；只显示已开放的服务器和当前客户端。")}</p></CardHeader><CardContent className="space-y-4"><div className="flex flex-wrap items-center gap-3"><label className="text-sm">{t("下载平台")} <select className="rounded-md border bg-background p-2" value={platform} onChange={e => setPlatform(e.target.value)}>{["windows-amd64", "windows-aarch64", "linux-amd64", "linux-aarch64", "macos-amd64", "macos-aarch64"].map(p => <option key={p}>{p}</option>)}</select></label><Button disabled={busy} variant="outline" onClick={async () => { setBusy(true); try { setState(await api("/api/member")); setError(""); } catch(e){setError(e instanceof Error?e.message:"请求失败");}finally{setBusy(false);} }}>{t("刷新")}</Button></div><DataTable columns={columns} data={state.servers} empty={t("暂无可访问的已发布服务器。")} /></CardContent></Card>
  </main>;
}
