"use client";
import { serializeError } from "@/lib/diagnostics";
import { formatMessage } from "@/lib/diagnostics";

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
    { accessorKey: "displayName", header: t("clients.server") }, { id: "organization", header: t("dashboard.organization"), accessorFn: row => row.organization.displayName },
    { id: "client", header: t("clients.client"), accessorFn: row => row.currentRelease.name }, { id: "version", header: t("clients.version"), accessorFn: row => row.currentRelease.versionLabel },
    { id: "download", header: t("clients.actions"), cell: ({ row }) => <Button disabled={busy} variant="outline" size="sm" onClick={async () => {
      setBusy(true); setError(""); try { const result = await api<{ full: { url: string } }>(`/api/v1/servers/${row.original.serverId}/packages?acceptedFormatVersions=1,2&platform=${platform}`); window.location.assign(result.full.url); }
      catch (e) { setError(e instanceof Error ? serializeError(e) : "clientShared.requestFailed"); } finally { setBusy(false); }
    }}>{t("clients.downloadFullPackage")}</Button> },
  ];
  return <main className="mx-auto max-w-6xl space-y-6 p-6"><header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold">Union Link</h1><p className="text-sm text-muted-foreground">{state.actor.displayName} · {t("memberDirectory.memberDirectory")}</p></div><div className="flex items-center gap-2"><PreferenceControls />{state.actor.canManage && <Button variant="outline" asChild><Link href="/admin">{t("memberDirectory.administration")}</Link></Button>}<Button variant="outline" disabled={busy} onClick={async () => { await api("/api/auth/logout", "POST", {}); navigateAfterAuthChange("/login"); }}>{t("shell.signOut")}</Button></div></header>
    {error && <Alert variant="destructive"><AlertDescription>{formatMessage(t, error)}</AlertDescription></Alert>}
    <Card><CardHeader><CardTitle>{t("memberDirectory.accessibleServers")}</CardTitle><p className="text-sm text-muted-foreground">{t("memberDirectory.homeOrganizationAndApprovedExternalResourcesOnlyAvailableServers")}</p></CardHeader><CardContent className="space-y-4"><div className="flex flex-wrap items-center gap-3"><label className="text-sm">{t("memberDirectory.downloadPlatform")} <select className="rounded-md border bg-background p-2" value={platform} onChange={e => setPlatform(e.target.value)}>{["windows-amd64", "windows-aarch64", "linux-amd64", "linux-aarch64", "macos-amd64", "macos-aarch64"].map(p => <option key={p}>{p}</option>)}</select></label><Button disabled={busy} variant="outline" onClick={async () => { setBusy(true); try { setState(await api("/api/member")); setError(""); } catch(e){setError(e instanceof Error?serializeError(e):"clientShared.requestFailed");}finally{setBusy(false);} }}>{t("organizationAccess.refresh")}</Button></div><DataTable columns={columns} data={state.servers} empty={t("memberDirectory.noPublishedServersAreCurrentlyAccessible")} /></CardContent></Card>
  </main>;
}
