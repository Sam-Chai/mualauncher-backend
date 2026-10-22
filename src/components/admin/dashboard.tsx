"use client";
import { useI18n } from "@/components/preferences";
import Link from "next/link";
import { Building2, Server, Boxes, Radio, ArrowUpRight } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AreaChart } from "@/components/charts/area-chart";
import { Heading } from "./common";
import { DataTable } from "./data-table";
import { useAdmin, type Server as ServerRow } from "./provider";
import { ServerStatusLight } from "./server-status";
import { StorageTelemetryCard } from "./storage-telemetry";
export function DashboardPage() {
  const { t } = useI18n();
  const { state, organizations, servers, organizationId } = useAdmin();
  const active = servers.filter(server => !server.archivedAt && !organizations.find(org => org.id === server.organizationId)?.archivedAt);
  const distributing = active.filter(server => server.isListed && server.currentReleaseActive && !server.clientArchivedAt);
  const cards = [
    { label: t("dashboard.accessibleOrganizations"), value: organizations.length, hint: t("dashboard.includesArchivedRecords"), icon: Building2, href: "/admin/organizations" },
    { label: t("dashboard.activeServers"), value: active.length, hint: t("dashboard.organizationAndServerAreActive"), icon: Server, href: "/admin/servers" },
    { label: t("clients.client"), value: organizations.reduce((total, org) => total + org.clientCount, 0), hint: t("dashboard.accessibleActiveClientsIncludingUnboundClients"), icon: Boxes, href: "/admin/clients" },
    { label: t("dashboard.publicDistribution"), value: distributing.length, hint: t("dashboard.listedWithAValidCurrentRelease"), icon: Radio, href: "/admin/servers" },
  ];
  const columns: ColumnDef<ServerRow>[] = [{ accessorKey: "displayName", header: t("clients.server"), cell: ({ row }) => <div className="flex items-center gap-2"><ServerStatusLight serverId={row.original.serverId} address={row.original.gameAddress} archived={!!row.original.archivedAt || !!organizations.find(org => org.id === row.original.organizationId)?.archivedAt} />{row.original.permissions.includes("DRAFT_READ") || row.original.permissions.includes("RELEASE_READ") ? <Link href={row.original.boundClientId ? `/admin/clients/${row.original.boundClientId}` : "/admin/clients"} className="font-medium hover:underline">{row.original.displayName}</Link> : <span className="font-medium">{row.original.displayName}</span>}</div> }, { accessorKey: "serverId", header: "MUA ID" }, { id: "organization", header: t("dashboard.organization"), accessorFn: server => organizations.find(org => org.id === server.organizationId)?.displayName }, { id: "status", header: t("clients.status"), accessorFn: server => server.archivedAt ? t("clients.archived") : server.currentReleaseId ? t("dashboard.boundRelease") : t("dashboard.awaitingPublication"), cell: ({ getValue }) => <Badge variant="outline">{String(getValue())}</Badge> }];
  return <><Heading title={t("dashboard.overview")} description={t("dashboard.manageAllianceDistributionFromOrganizationsToServersAndClient")} />
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{cards.map(card => <Card key={card.label} className="@container/card bg-gradient-to-t from-primary/5 to-card"><CardHeader className="flex flex-row items-start justify-between space-y-0"><CardDescription>{card.label}</CardDescription><card.icon className="size-4 text-muted-foreground" /></CardHeader><CardContent className="space-y-3"><p className="text-3xl font-semibold tabular-nums">{card.value}</p><div className="flex items-center justify-between gap-2"><span className="text-xs text-muted-foreground">{card.hint}</span><Link href={card.href} aria-label={t("dashboard.viewResource", { "resource": card.label })}><ArrowUpRight className="size-4" /></Link></div></CardContent></Card>)}</div>
    <div className={state.actor.isSuperAdmin ? "grid items-start gap-6 xl:grid-cols-[2fr_1fr]" : "grid gap-6"}><Card><CardHeader><CardTitle>{state.actor.isSuperAdmin ? t("dashboard.platformActivity") : t("dashboard.organizationResources")}</CardTitle><CardDescription>{state.actor.isSuperAdmin ? t("dashboard.completeAuditRecordsOver14DaysDailyInShanghai") : t("dashboard.serverCountsForAccessibleOrganizationsIncludingArchivedRecords")}</CardDescription></CardHeader><CardContent>
      {state.actor.isSuperAdmin ? <AreaChart className="h-64" data={state.auditActivity.map(point => ({ date: point.date.slice(5), 操作次数: point.count }))} index="date" categories={[t("dashboard.actions")]} colors={["blue"]} allowDecimals={false} showLegend={false} valueFormatter={value => t("dashboard.actionCount", { "count": value })} /> : organizations.length ? <AreaChart className="h-64" data={organizations.map(org => ({ organization: org.displayName, 服务器: org.servers.length }))} index="organization" categories={[t("clients.server")]} colors={["blue"]} allowDecimals={false} showLegend={false} /> : <p className="flex h-64 items-center justify-center text-sm text-muted-foreground">{t("dashboard.noOrganizationResourceData")}</p>}
    </CardContent></Card><StorageTelemetryCard /></div>
    <Card><CardHeader><CardTitle>{t("dashboard.serverDirectory")}</CardTitle><CardDescription>{organizationId === "all" ? t("dashboard.allAccessibleOrganizations") : organizations[0]?.displayName || t("dashboard.currentOrganization")} {" " + t("dashboard.inConfiguredOrder")}</CardDescription></CardHeader><CardContent><DataTable data={servers} columns={columns} empty={t("dashboard.noServersRegisteredCreateAnOrganizationThenAddServers")} /></CardContent></Card>
  </>;
}
