"use client";
import { useI18n } from "@/components/preferences";
import { useMemo } from "react";
import { z } from "zod";
import { Building2, Pencil } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api, useAdmin, type Organization } from "./provider";
import { DataTable } from "./data-table";
import { Heading, Status } from "./common";
import { ArchiveButton, EditorDialog, SchemaForm, nameSchema, textSchema, type Field } from "./form";
import { OrganizationAvatarField } from "./organization-avatar";
import { organizationAvatarUrl } from "@/lib/organization-avatar-contract";
import { OrganizationSkinSiteField, VisitSkinSite } from "./organization-skin-sites";
import { AddOrganizationMember } from "./organization-member-add";
const fields: Field[] = [{ name: "displayName", label: "organizations.organizationAlias", placeholder: "NPU" }, { name: "description", label: "organizations.description", type: "textarea", hint: "organizations.descriptionsSyncTheSkinSiteNameByDefaultEditing" },
  { name: "launcherLoginEnabled", label: "organizations.allowLauncherLogin", type: "checkbox", hint: "organizations.launcherAuthorizationHint" }];
function OrganizationEditor({ org }: { org?: Organization }) {
  const { t } = useI18n();
  const { busy, run } = useAdmin();
  const sites = org?.skinSites ?? [];
  const authorizationFields: Field[] = sites.length ? sites.map((site, index) => ({ name: `launcherSite${index}`,
    label: sites.length > 1 ? "organizations.allowLauncherLoginForSite" : "organizations.allowLauncherLogin",
    labelValues: sites.length > 1 ? { site: site.url } : undefined, type: "checkbox", hint: index === sites.length - 1 ? "organizations.launcherAuthorizationHint" : undefined })) : [fields[2]];
  const schema = z.object({ displayName: nameSchema, description: textSchema(),
    ...Object.fromEntries(authorizationFields.map(field => [field.name, z.boolean()])) });
  const defaults = { displayName: org?.displayName ?? "", description: org?.description ?? "",
    ...Object.fromEntries(sites.length ? sites.map((site, index) => [`launcherSite${index}`, site.launcherLoginEnabled]) : [["launcherLoginEnabled", org?.launcherLoginEnabled ?? false]]) };
  return <EditorDialog title={org ? t("organizations.editOrganization") : t("organizations.createOrganization")} disabled={busy}
    trigger={org ? <Button variant="outline" size="sm" disabled={busy || !!org.archivedAt}><Pencil className="size-3.5" />{t("clientUpload.edit")}</Button> : undefined}>
    {close => <div className="space-y-6">{org && <><OrganizationAvatarField organization={org} /><OrganizationSkinSiteField id={org.id} sites={org.skinSites} /></>}<SchemaForm schema={schema} fields={[...fields.slice(0, 2), ...(org ? authorizationFields : [])]} defaults={defaults} disabled={busy}
      onSubmit={async values => {
        const changes = sites.flatMap((site, index) => values[`launcherSite${index}`] === site.launcherLoginEnabled ? [] : [{ code: site.code, url: site.url, enabled: values[`launcherSite${index}`] }]);
        const data = { displayName: values.displayName, ...(!org || values.description !== org.description ? { description: values.description } : {}),
          ...(org && sites.length && changes.length ? { skinSiteAuthorizations: changes, launcherLoginRevision: org.launcherLoginRevision } : {}),
          ...(org && !sites.length && values.launcherLoginEnabled !== org.launcherLoginEnabled ? { launcherLoginEnabled: values.launcherLoginEnabled, launcherLoginRevision: org.launcherLoginRevision } : {}) };
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
    { id: "skinSites", header: t("organizationAccess.skinSiteUrl"), accessorFn: org => org.skinSites?.map(site=>site.url).join(" ") ?? "", cell: ({row}) => row.original.skinSites?.length ? <div className="max-w-56 space-y-1">{row.original.skinSites.map(site=><p key={`${site.code}:${site.url}`} title={site.url} className="flex min-h-6 items-center truncate text-xs text-muted-foreground">{site.url}</p>)}</div> : <span className="text-xs text-muted-foreground">{t("organizationSkinSites.noSkinSiteAddress")}</span> },
    { id: "servers", header: t("organizations.accessibleServers"), accessorFn: org => org.servers.length },
    { id: "launcherLoginEnabled", accessorFn: org => org.skinSites?.filter(site => site.launcherLoginEnabled).length ?? Number(org.launcherLoginEnabled), header: t("organizations.authorization"), cell: ({ row }) => <div className="space-y-1">{(row.original.skinSites?.length ? row.original.skinSites : [{ code: "", url: "", launcherLoginEnabled: row.original.launcherLoginEnabled }]).map(site => <div key={`${site.code}:${site.url}`} title={site.url || undefined} className="flex min-h-6 items-center"><Badge variant={site.launcherLoginEnabled ? "secondary" : "outline"}>{t(site.launcherLoginEnabled ? "organizations.authorized" : "organizations.notAuthorized")}</Badge></div>)}</div> },
    { id: "status", header: t("clients.status"), accessorFn: org => org.archivedAt ? t("clients.archived") : t("common.active"), cell: ({ row }) => <Status archived={row.original.archivedAt} /> },
    { id: "actions", header: t("clients.actions"), enableHiding: false, cell: ({ row }) => <div className="flex flex-wrap gap-2"><AddOrganizationMember org={row.original} />{row.original.permissions.includes("ORG_EDIT") && <OrganizationEditor org={row.original} />}{state.actor.isSuperAdmin && <ArchiveButton kind="organizations" id={row.original.id} archived={!!row.original.archivedAt} />}<VisitSkinSite sites={row.original.skinSites} /></div> },
  ], [t, state.actor.isSuperAdmin]);
  return <><Heading title={t("dashboard.organization")} description={t("organizations.organizationsOwnMembersServersAndDedicatedClientsInternalIds")} action={state.actor.isSuperAdmin && <OrganizationEditor />} /><DataTable data={organizations} columns={columns} getRowId={org => org.id} empty={t("organizations.noOrganizationsCreateOneBeforeRegisteringServers")} /></>;
}
