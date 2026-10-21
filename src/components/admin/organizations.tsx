"use client";
import { useI18n } from "@/components/preferences";
import { useMemo } from "react";
import { z } from "zod";
import { Building2, Pencil } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { api, useAdmin, type Organization } from "./provider";
import { DataTable } from "./data-table";
import { Heading, Status } from "./common";
import { ArchiveButton, EditorDialog, SchemaForm, nameSchema, textSchema, type Field } from "./form";
import { OrganizationAvatarField } from "./organization-avatar";
import { organizationAvatarUrl } from "@/lib/organization-avatar-contract";
import { OrganizationSkinSiteField, VisitSkinSite } from "./organization-skin-sites";
import { AddOrganizationMember } from "./organization-member-add";
const schema = z.object({ displayName: nameSchema, description: textSchema() });
const fields: Field[] = [{ name: "displayName", label: "组织别名", placeholder: "NPU" }, { name: "description", label: "简介", type: "textarea" }];
function OrganizationEditor({ org }: { org?: Organization }) {
  const { t } = useI18n();
  const { busy, run } = useAdmin();
  return <EditorDialog title={org ? t("编辑组织") : t("新建组织")} disabled={busy}
    trigger={org ? <Button variant="outline" size="sm" disabled={busy || !!org.archivedAt}><Pencil className="size-3.5" />{t("编辑")}</Button> : undefined}>
    {close => <div className="space-y-6">{org && <><OrganizationAvatarField organization={org} /><OrganizationSkinSiteField id={org.id} sites={org.skinSites} /></>}<SchemaForm schema={schema} fields={fields} defaults={{ displayName: org?.displayName ?? "", description: org?.description ?? "" }} disabled={busy}
      onSubmit={async values => { const ok = await run(() => api(`/api/admin/organizations${org ? "/" + org.id : ""}`, org ? "PATCH" : "POST", values)); if (ok) close(); return ok; }} /></div>}
  </EditorDialog>;
}
export function OrganizationsPage() {
  const { t } = useI18n();
  const { state, organizations } = useAdmin();
  const columns = useMemo<ColumnDef<Organization>[]>(() => [
    { accessorKey: "displayName", header: t("组织"), cell: ({ row }) => <div className="flex items-center gap-3"><Avatar className="size-9 rounded-lg"><AvatarImage src={organizationAvatarUrl(row.original.avatarObjectKey, row.original.id) ?? undefined} alt={row.original.displayName} className="object-cover" /><AvatarFallback className="rounded-lg"><Building2 className="size-4" /></AvatarFallback></Avatar><div><p className="font-medium">{row.original.displayName}</p><p className="max-w-xs truncate text-xs text-muted-foreground">{row.original.description || t("暂无简介")}</p></div></div> },
    { accessorKey: "id", header: t("内部 ID"), cell: ({ getValue }) => <code className="text-xs text-muted-foreground">{String(getValue())}</code> },
    { id: "skinSites", header: t("皮肤站地址"), accessorFn: org => org.skinSites?.map(site=>site.url).join(" ") ?? "", cell: ({row}) => row.original.skinSites?.length ? <div className="max-w-56 space-y-1">{row.original.skinSites.map(site=><p key={`${site.code}:${site.url}`} title={site.url} className="truncate text-xs text-muted-foreground">{site.url}</p>)}</div> : <span className="text-xs text-muted-foreground">{t("暂无皮肤站地址")}</span> },
    { id: "servers", header: t("可访问服务器"), accessorFn: org => org.servers.length },
    { id: "status", header: t("状态"), accessorFn: org => org.archivedAt ? t("已归档") : t("启用中"), cell: ({ row }) => <Status archived={row.original.archivedAt} /> },
    { id: "actions", header: t("操作"), enableHiding: false, cell: ({ row }) => <div className="flex flex-wrap gap-2"><AddOrganizationMember org={row.original} />{row.original.permissions.includes("ORG_EDIT") && <OrganizationEditor org={row.original} />}{state.actor.isSuperAdmin && <ArchiveButton kind="organizations" id={row.original.id} archived={!!row.original.archivedAt} />}<VisitSkinSite sites={row.original.skinSites} /></div> },
  ], [t, state.actor.isSuperAdmin]);
  return <><Heading title={t("组织")} description={t("组织拥有成员、服务器和专用客户端；内部 ID 保持稳定，对外使用别名。")} action={state.actor.isSuperAdmin && <OrganizationEditor />} /><DataTable data={organizations} columns={columns} getRowId={org => org.id} empty={t("暂无组织。先创建组织，再登记服务器。")} /></>;
}
