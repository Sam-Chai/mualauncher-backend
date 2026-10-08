"use client";
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
export function DashboardPage() {
  const { state, organizations, servers, organizationId } = useAdmin();
  const active = servers.filter(server => !server.archivedAt && !organizations.find(org => org.id === server.organizationId)?.archivedAt);
  const distributing = active.filter(server => server.isListed && server.currentReleaseActive && !server.clientArchivedAt);
  const cards = [
    { label: "可访问组织", value: organizations.length, hint: "包含归档记录", icon: Building2, href: "/admin/organizations" },
    { label: "启用服务器", value: active.length, hint: "所属组织与服务器均启用", icon: Server, href: "/admin/servers" },
    { label: "专用客户端", value: servers.filter(server => !server.clientArchivedAt && !server.archivedAt && !organizations.find(org => org.id === server.organizationId)?.archivedAt && (server.permissions.includes("DRAFT_READ") || server.permissions.includes("RELEASE_READ"))).length, hint: "每服一个客户端", icon: Boxes, href: "/admin/clients" },
    { label: "公开分发", value: distributing.length, hint: "上架且有有效当前发布", icon: Radio, href: "/admin/listings" },
  ];
  const columns: ColumnDef<ServerRow>[] = [{ accessorKey: "displayName", header: "服务器", cell: ({ row }) => row.original.permissions.includes("DRAFT_READ") || row.original.permissions.includes("RELEASE_READ") ? <Link href={`/admin/clients/${row.original.serverId}`} className="font-medium hover:underline">{row.original.displayName}</Link> : <span className="font-medium">{row.original.displayName}</span> }, { accessorKey: "serverId", header: "MUA ID" }, { id: "organization", header: "组织", accessorFn: server => organizations.find(org => org.id === server.organizationId)?.displayName }, { id: "status", header: "状态", accessorFn: server => server.archivedAt ? "已归档" : server.currentReleaseId ? "已绑定发布" : "待发布", cell: ({ getValue }) => <Badge variant="outline">{String(getValue())}</Badge> }];
  return <><Heading title="总览" description="从组织到服务器，再到客户端版本，统一管理联盟的分发入口。" />
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{cards.map(card => <Card key={card.label} className="@container/card bg-gradient-to-t from-primary/5 to-card"><CardHeader className="flex flex-row items-start justify-between space-y-0"><CardDescription>{card.label}</CardDescription><card.icon className="size-4 text-muted-foreground" /></CardHeader><CardContent className="space-y-3"><p className="text-3xl font-semibold tabular-nums">{card.value}</p><div className="flex items-center justify-between gap-2"><span className="text-xs text-muted-foreground">{card.hint}</span><Link href={card.href} aria-label={`查看${card.label}`}><ArrowUpRight className="size-4" /></Link></div></CardContent></Card>)}</div>
    <div className="grid items-start gap-6 xl:grid-cols-[2fr_1fr]"><Card><CardHeader><CardTitle>{state.actor.isSuperAdmin ? "平台操作趋势" : "组织资源分布"}</CardTitle><CardDescription>{state.actor.isSuperAdmin ? "近 14 天完整审计记录 · 按上海时区逐日统计 · 全平台，不随组织筛选变化" : "当前可访问组织的服务器数量，包含归档记录"}</CardDescription></CardHeader><CardContent>
      {state.actor.isSuperAdmin ? <AreaChart className="h-64" data={state.auditActivity.map(point => ({ date: point.date.slice(5), 操作次数: point.count }))} index="date" categories={["操作次数"]} colors={["blue"]} allowDecimals={false} showLegend={false} valueFormatter={value => `${value} 次`} /> : organizations.length ? <AreaChart className="h-64" data={organizations.map(org => ({ organization: org.displayName, 服务器: org.servers.length }))} index="organization" categories={["服务器"]} colors={["blue"]} allowDecimals={false} showLegend={false} /> : <p className="flex h-64 items-center justify-center text-sm text-muted-foreground">暂无组织资源数据</p>}
    </CardContent></Card><Card><CardHeader><Globe className="mb-2 size-6 text-muted-foreground" /><CardTitle>CDN 与存储流量</CardTitle><CardDescription>遥测尚未接入</CardDescription></CardHeader><CardContent className="space-y-5"><p className="text-sm text-muted-foreground">接入 S3 / MinIO 和 CDN 指标后，此处将展示下载流量、缓存命中与存储用量。</p><Badge variant="secondary">等待数据源</Badge><div><Button asChild variant="outline"><Link href="/admin/system/storage">查看 Storage<ArrowUpRight className="size-4" /></Link></Button></div></CardContent></Card></div>
    <Card><CardHeader><CardTitle>服务器目录</CardTitle><CardDescription>{organizationId === "all" ? "全部可访问组织" : organizations[0]?.displayName || "当前组织"} · 按已配置顺序显示</CardDescription></CardHeader><CardContent><DataTable data={servers} columns={columns} empty="尚未登记服务器。先创建组织，再添加服务器与客户端版本。" /></CardContent></Card>
  </>;
}
