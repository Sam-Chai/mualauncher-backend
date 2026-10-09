"use client";
import Link from "next/link";
import { z } from "zod";
import { Pencil } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api, useAdmin, type Server } from "./provider";
import { DataTable } from "./data-table";
import { Heading, Status } from "./common";
import { ArchiveButton, EditorDialog, SchemaForm, nameSchema, textSchema, type Field } from "./form";
function ServerEditor({ server, listing = false }: { server?: Server; listing?: boolean }) {
  const { state, organizations, busy, run } = useAdmin();
  const superAdmin = state.actor.isSuperAdmin;
  const base = { displayName: nameSchema, description: textSchema(), gameAddress: textSchema(255), iconObjectKey: textSchema(500) };
  const listingFields = { sortOrder: z.string().refine(value => value.trim() !== "" && Number.isSafeInteger(Number(value)) && Math.abs(Number(value)) <= 2147483647, "请输入有效排序整数"), themeColor: z.string().regex(/^(#[0-9a-fA-F]{6})?$/, "请输入 #RRGGBB 或留空"), isListed: z.boolean() };
  const schema = server ? superAdmin && listing ? z.object(base).extend(listingFields) : z.object(base)
    : z.object(base).extend({ organizationId: z.string().uuid("请选择组织"), serverId: z.string().regex(/^[A-Za-z]{3,5}$/, "ID 须为已有的 3–5 位英文字母") });
  const fields: Field[] = [
    ...(!server ? [{ name: "organizationId", label: "所属组织", type: "select" as const, options: organizations.filter(org => !org.archivedAt).map(org => ({ value: org.id, label: org.displayName })) }, { name: "serverId", label: "MUA server ID", hint: "使用已有 MUA ID，创建后不可更改。", placeholder: "NPUR" }] : []),
    { name: "displayName", label: "显示别名", placeholder: "NPU RELEASE" }, { name: "description", label: "简介", type: "textarea" }, { name: "gameAddress", label: "连接地址", placeholder: "play.example.edu:25565" }, { name: "iconObjectKey", label: "图标对象键" },
    ...(server && superAdmin && listing ? [{ name: "sortOrder", label: "排序", type: "number" as const, hint: "数字越小，在 Launcher 中越靠前。" }, { name: "themeColor", label: "展示颜色", placeholder: "#3b82f6" }, { name: "isListed", label: "标记上架", type: "checkbox" as const, hint: "只有存在有效当前发布且组织、服务器、客户端均启用时，才会出现在公开列表。" }] : []),
  ];
  return <EditorDialog title={server ? listing ? "编辑 Listing" : "编辑服务器" : "登记服务器"} disabled={busy || !organizations.some(org => !org.archivedAt)} trigger={server ? <Button variant="outline" size="sm" disabled={busy || !!server.archivedAt || !!state.organizations.find(org => org.id === server.organizationId)?.archivedAt}><Pencil className="size-3.5" />编辑</Button> : undefined}>
    {close => <SchemaForm schema={schema} fields={fields} disabled={busy} defaults={{ displayName: server?.displayName ?? "", description: server?.description ?? "", gameAddress: server?.gameAddress ?? "", iconObjectKey: server?.iconObjectKey ?? "", ...(server ? { ...(superAdmin && listing ? { sortOrder: String(server.sortOrder), themeColor: server.themeColor ?? "", isListed: server.isListed } : {}) } : { serverId: "", organizationId: organizations.find(org => !org.archivedAt)?.id ?? "" }) }}
      onSubmit={async values => { const payload = { ...values, ...(server && superAdmin && listing ? { sortOrder: Number(values.sortOrder) } : {}) }; const ok = await run(() => api(`/api/admin/servers${server ? "/" + server.serverId : ""}`, server ? "PATCH" : "POST", payload)); if (ok) close(); return ok; }} />}
  </EditorDialog>;
}
export function ServersPage({ mode = "servers" }: { mode?: "servers" | "listings" | "status" }) {
  const { state, servers } = useAdmin();
  const listing = mode === "listings";
  const organizationName = (server: Server) => state.organizations.find(org => org.id === server.organizationId)?.displayName ?? "";
  const eligible = (server: Server) => !server.archivedAt && !server.clientArchivedAt && !state.organizations.find(org => org.id === server.organizationId)?.archivedAt && server.isListed && server.currentReleaseActive;
  const columns: ColumnDef<Server>[] = [
    { accessorKey: "displayName", header: "服务器", cell: ({ row }) => <div className="flex items-center gap-3">{listing && <span aria-label={row.original.themeColor || "默认颜色"} className="size-3 rounded-full border" style={{ backgroundColor: row.original.themeColor || "#737373" }} />}<div>{row.original.permissions.includes("DRAFT_READ") || row.original.permissions.includes("RELEASE_READ") ? <Link className="font-medium hover:underline" href={row.original.boundClientId ? `/admin/clients/${row.original.boundClientId}` : "/admin/clients"}>{row.original.displayName}</Link> : <p className="font-medium">{row.original.displayName}</p>}<p className="text-xs text-muted-foreground">{row.original.serverId}</p></div></div> },
    { id: "organization", header: "组织", accessorFn: organizationName },
    ...(listing ? [{ accessorKey: "sortOrder", header: "排序" }, { accessorKey: "themeColor", header: "颜色", cell: ({ row }: { row: { original: Server } }) => <code>{row.original.themeColor || "默认"}</code> }] as ColumnDef<Server>[] : [{ accessorKey: "gameAddress", header: "连接地址", cell: ({ row }: { row: { original: Server } }) => <code className="text-xs">{row.original.gameAddress || "未设置"}</code> }] as ColumnDef<Server>[]),
    { id: "status", header: listing ? "目录状态" : "状态", accessorFn: server => server.archivedAt ? "已归档" : eligible(server) ? "公开分发" : server.isListed ? "等待有效发布" : "未上架", cell: ({ getValue }) => <Badge variant="outline">{String(getValue())}</Badge> },
    { id: "release", header: "当前客户端", accessorFn: server => server.clientArchivedAt ? "已归档" : server.currentReleaseId ? "已绑定" : "未发布", cell: ({ row }) => <Status archived={row.original.clientArchivedAt} active={row.original.currentReleaseId ? "已绑定当前发布" : "未发布"} /> },
    { id: "actions", header: "操作", enableHiding: false, cell: ({ row }) => <div className="flex gap-2">{(listing ? state.actor.isSuperAdmin : row.original.permissions.includes("SERVER_EDIT")) && <ServerEditor server={row.original} listing={listing} />}{!listing && state.actor.isSuperAdmin && <ArchiveButton kind="servers" id={row.original.serverId} archived={!!row.original.archivedAt} />}</div> },
  ];
  return <><Heading title={listing ? "Listing" : mode === "status" ? "服务器状态" : "Server"} description={listing ? "管理 Launcher 上架标记、顺序与颜色。排序和展示设置仅限 MUA 超级管理员。" : mode === "status" ? "展示数据库中的归档、上架与客户端绑定状态。" : "每个服务器对应一个专用客户端，创建时自动建立客户端与发布绑定记录。"} action={mode === "servers" && state.actor.isSuperAdmin && <ServerEditor />} />
    {mode === "status" && <Alert><AlertDescription>游戏服务器在线检测尚未接入。此处状态表示管理配置，不代表游戏服务在线。</AlertDescription></Alert>}
    <DataTable data={servers} columns={columns} empty="暂无可访问服务器。请先创建组织并登记 MUA server ID。" /></>;
}
