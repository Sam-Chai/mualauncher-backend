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
const fields: Field[] = [{ name: "displayName", label: "organizations.organizationAlias", placeholder: "NPU" }, { name: "description", label: "organizations.description", type: "textarea", hint: "organizations.descriptionsSyncTheSkinSiteNameByDefaultEditing" }];
function OrganizationEditor({ org }: { org?: Organization }) {
  const { t } = useI18n();
  const { busy, run } = useAdmin();
  return <EditorDialog title={org ? t("organizations.editOrganization") : t("organizations.createOrganization")} disabled={busy}
    trigger={org ? <Button variant="outline" size="sm" disabled={busy || !!org.archivedAt}><Pencil className="size-3.5" />{t("clientUpload.edit")}</Button> : undefined}>
    {close => <div className="space-y-6">{org && <><OrganizationAvatarField organization={org} /><OrganizationSkinSiteField id={org.id} sites={org.skinSites} /></>}<SchemaForm schema={schema} fields={fields} defaults={{ displayName: org?.displayName ?? "", description: org?.description ?? "" }} disabled={busy}
      onSubmit={async values => {
        const data = org && values.description === org.description ? { displayName: values.displayName } : values;
        const ok = await run(() => api(`/api/admin/organizations${org ? "/" + org.id : ""}`, org ? "PATCH" : "POST", data)); if (ok) close(); return ok;
      }} /></div>}
  </EditorDialog>;
}
export function OrganizationsPage() {
  const { t } = useI18n();
  const { state, organizations } = useAdmin();
  const columns = useMemo<ColumnDef<Organization>[]>(() => [
    { accessorKey: "displayName", header: t("dashboard.organization"), cell: ({ row }) => <div className="flex items-center gap-3"><Avatar className="size-9 rounded-lg"><AvatarImage src={organizationAvatarUrl(row.original.avatarObjectKey, row.original.id) ?? undefined} alt={row.original.displayName} className="object-cover" /><AvatarFallback className="rounded-lg"><Building2 className="size-4" /></AvatarFallback></Avatar><div><p className="font-medium">{row.original.displayName}</p><p className="max-w-xs truncate text-xs text-muted-foreground">{row.original.description || t("organizations.noDescription")}</p></div></div> },
    { accessorKey: "id", header: t("organizations.internalId"), cell: ({ getValue }) => <code className="text-xs text-muted-foreground">{String(getValue())}</code> },
    { id: "skinSites", header: t("organizationAccess.skinSiteUrl"), accessorFn: org => org.skinSites?.map(site=>site.url).join(" ") ?? "", cell: ({row}) => row.original.skinSites?.length ? <div className="max-w-56 space-y-1">{row.original.skinSites.map(site=><p key={`${site.code}:${site.url}`} title={site.url} className="truncate text-xs text-muted-foreground">{site.url}</p>)}</div> : <span className="text-xs text-muted-foreground">{t("organizationSkinSites.noSkinSiteAddress")}</span> },
    { id: "servers", header: t("organizations.accessibleServers"), accessorFn: org => org.servers.length },
    { id: "status", header: t("clients.status"), accessorFn: org => org.archivedAt ? t("clients.archived") : t("common.active"), cell: ({ row }) => <Status archived={row.original.archivedAt} /> },
    { id: "actions", header: t("clients.actions"), enableHiding: false, cell: ({ row }) => <div className="flex flex-wrap gap-2"><AddOrganizationMember org={row.original} />{row.original.permissions.includes("ORG_EDIT") && <OrganizationEditor org={row.original} />}{state.actor.isSuperAdmin && <ArchiveButton kind="organizations" id={row.original.id} archived={!!row.original.archivedAt} />}<VisitSkinSite sites={row.original.skinSites} /></div> },
  ], [t, state.actor.isSuperAdmin]);
  return <><Heading title={t("dashboard.organization")} description={t("organizations.organizationsOwnMembersServersAndDedicatedClientsInternalIds")} action={state.actor.isSuperAdmin && <OrganizationEditor />} /><DataTable data={organizations} columns={columns} getRowId={org => org.id} empty={t("organizations.noOrganizationsCreateOneBeforeRegisteringServers")} /></>;
}
