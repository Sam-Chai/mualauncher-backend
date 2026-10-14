"use client";
import { useI18n } from "@/components/preferences";
import Link from "next/link";
import { Building2, Server, Boxes, Radio, ArrowUpRight, Globe } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AreaChart } from "@/components/charts/area-chart";
import { Heading } from "./common";
import { DataTable } from "./data-table";
import { useAdmin, type Server as ServerRow } from "./provider";
import { ServerStatusLight } from "./server-status";
export function DashboardPage() {
  const { t } = useI18n();
  const { state, organizations, servers, organizationId } = useAdmin();
  const active = servers.filter(server => !server.archivedAt && !organizations.find(org => org.id === server.organizationId)?.archivedAt);
  const distributing = active.filter(server => server.isListed && server.currentReleaseActive && !server.clientArchivedAt);
  const cards = [
    { label: t("可访问组织"), value: organizations.length, hint: t("包含归档记录"), icon: Building2, href: "/admin/organizations" },
    { label: t("启用服务器"), value: active.length, hint: t("所属组织与服务器均启用"), icon: Server, href: "/admin/servers" },
    { label: t("客户端"), value: organizations.reduce((total, org) => total + org.clientCount, 0), hint: t("可访问的启用客户端，包含未绑定客户端"), icon: Boxes, href: "/admin/clients" },
    { label: t("公开分发"), value: distributing.length, hint: t("上架且有有效当前发布"), icon: Radio, href: "/admin/servers" },
  ];
  const columns: ColumnDef<ServerRow>[] = [{ accessorKey: "displayName", header: t("服务器"), cell: ({ row }) => <div className="flex items-center gap-2"><ServerStatusLight serverId={row.original.serverId} address={row.original.gameAddress} archived={!!row.original.archivedAt || !!organizations.find(org => org.id === row.original.organizationId)?.archivedAt} />{row.original.permissions.includes("DRAFT_READ") || row.original.permissions.includes("RELEASE_READ") ? <Link href={row.original.boundClientId ? `/admin/clients/${row.original.boundClientId}` : "/admin/clients"} className="font-medium hover:underline">{row.original.displayName}</Link> : <span className="font-medium">{row.original.displayName}</span>}</div> }, { accessorKey: "serverId", header: "MUA ID" }, { id: "organization", header: t("组织"), accessorFn: server => organizations.find(org => org.id === server.organizationId)?.displayName }, { id: "status", header: t("状态"), accessorFn: server => server.archivedAt ? t("已归档") : server.currentReleaseId ? t("已绑定发布") : t("待发布"), cell: ({ getValue }) => <Badge variant="outline">{String(getValue())}</Badge> }];
  return <><Heading title={t("总览")} description={t("从组织到服务器，再到客户端版本，统一管理联盟的分发入口。")} />
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{cards.map(card => <Card key={card.label} className="@container/card bg-gradient-to-t from-primary/5 to-card"><CardHeader className="flex flex-row items-start justify-between space-y-0"><CardDescription>{card.label}</CardDescription><card.icon className="size-4 text-muted-foreground" /></CardHeader><CardContent className="space-y-3"><p className="text-3xl font-semibold tabular-nums">{card.value}</p><div className="flex items-center justify-between gap-2"><span className="text-xs text-muted-foreground">{card.hint}</span><Link href={card.href} aria-label={t("查看{0}", { "0": card.label })}><ArrowUpRight className="size-4" /></Link></div></CardContent></Card>)}</div>
    <div className="grid items-start gap-6 xl:grid-cols-[2fr_1fr]"><Card><CardHeader><CardTitle>{state.actor.isSuperAdmin ? t("平台操作趋势") : t("组织资源分布")}</CardTitle><CardDescription>{state.actor.isSuperAdmin ? t("近 14 天完整审计记录 · 按上海时区逐日统计 · 全平台，不随组织筛选变化") : t("当前可访问组织的服务器数量，包含归档记录")}</CardDescription></CardHeader><CardContent>
      {state.actor.isSuperAdmin ? <AreaChart className="h-64" data={state.auditActivity.map(point => ({ date: point.date.slice(5), 操作次数: point.count }))} index="date" categories={[t("操作次数")]} colors={["blue"]} allowDecimals={false} showLegend={false} valueFormatter={value => t("{0} 次", { "0": value })} /> : organizations.length ? <AreaChart className="h-64" data={organizations.map(org => ({ organization: org.displayName, 服务器: org.servers.length }))} index="organization" categories={[t("服务器")]} colors={["blue"]} allowDecimals={false} showLegend={false} /> : <p className="flex h-64 items-center justify-center text-sm text-muted-foreground">{t("暂无组织资源数据")}</p>}
    </CardContent></Card><Card><CardHeader><Globe className="mb-2 size-6 text-muted-foreground" /><CardTitle>{t("CDN 与存储流量")}</CardTitle><CardDescription>{t("遥测尚未接入")}</CardDescription></CardHeader><CardContent className="space-y-5"><p className="text-sm text-muted-foreground">{t("接入对象存储和 CDN 指标后，此处将展示下载流量、缓存命中与存储用量。")}</p><Badge variant="secondary">{t("等待数据源")}</Badge><div><Button asChild variant="outline"><Link href="/admin/system/storage">{t("查看 Storage")}<ArrowUpRight className="size-4" /></Link></Button></div></CardContent></Card></div>
    <Card><CardHeader><CardTitle>{t("服务器目录")}</CardTitle><CardDescription>{organizationId === "all" ? t("全部可访问组织") : organizations[0]?.displayName || t("当前组织")} {" " + t("· 按已配置顺序显示")}</CardDescription></CardHeader><CardContent><DataTable data={servers} columns={columns} empty={t("尚未登记服务器。先创建组织，再添加服务器与客户端版本。")} /></CardContent></Card>
  </>;
}
