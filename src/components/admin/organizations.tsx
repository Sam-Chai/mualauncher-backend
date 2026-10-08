"use client";
import { z } from "zod";
import { Building2, Pencil } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { api, useAdmin, type Organization } from "./provider";
import { DataTable } from "./data-table";
import { Heading, Status } from "./common";
import { ArchiveButton, EditorDialog, SchemaForm, nameSchema, textSchema, type Field } from "./form";
const schema = z.object({ displayName: nameSchema, description: textSchema(), avatarObjectKey: textSchema(500) });
const fields: Field[] = [{ name: "displayName", label: "组织别名", placeholder: "NPU" }, { name: "description", label: "简介", type: "textarea" }, { name: "avatarObjectKey", label: "头像对象键", hint: "头像上传将在存储服务接入后开放。" }];
function OrganizationEditor({ org }: { org?: Organization }) {
  const { busy, run } = useAdmin();
  return <EditorDialog title={org ? "编辑组织" : "新建组织"} disabled={busy}
    trigger={org ? <Button variant="outline" size="sm" disabled={busy || !!org.archivedAt}><Pencil className="size-3.5" />编辑</Button> : undefined}>
    {close => <SchemaForm schema={schema} fields={fields} defaults={{ displayName: org?.displayName ?? "", description: org?.description ?? "", avatarObjectKey: org?.avatarObjectKey ?? "" }} disabled={busy}
      onSubmit={async values => { const ok = await run(() => api(`/api/admin/organizations${org ? "/" + org.id : ""}`, org ? "PATCH" : "POST", values)); if (ok) close(); return ok; }} />}
  </EditorDialog>;
}
export function OrganizationsPage() {
  const { state, organizations } = useAdmin();
  const columns: ColumnDef<Organization>[] = [
    { accessorKey: "displayName", header: "组织", cell: ({ row }) => <div className="flex items-center gap-3"><Avatar className="size-9 rounded-lg"><AvatarFallback className="rounded-lg"><Building2 className="size-4" /></AvatarFallback></Avatar><div><p className="font-medium">{row.original.displayName}</p><p className="max-w-xs truncate text-xs text-muted-foreground">{row.original.description || "暂无简介"}</p></div></div> },
    { accessorKey: "id", header: "内部 ID", cell: ({ getValue }) => <code className="text-xs text-muted-foreground">{String(getValue())}</code> },
    { id: "servers", header: "可访问服务器", accessorFn: org => org.servers.length },
    { id: "status", header: "状态", accessorFn: org => org.archivedAt ? "已归档" : "启用中", cell: ({ row }) => <Status archived={row.original.archivedAt} /> },
    { id: "actions", header: "操作", enableHiding: false, cell: ({ row }) => <div className="flex gap-2">{row.original.permissions.includes("ORG_EDIT") && <OrganizationEditor org={row.original} />}{state.actor.isSuperAdmin && <ArchiveButton kind="organizations" id={row.original.id} archived={!!row.original.archivedAt} />}</div> },
  ];
  return <><Heading title="组织" description="组织拥有成员、服务器和专用客户端；内部 ID 保持稳定，对外使用别名。" action={state.actor.isSuperAdmin && <OrganizationEditor />} /><DataTable data={organizations} columns={columns} empty="暂无组织。先创建组织，再登记服务器。" /></>;
}
