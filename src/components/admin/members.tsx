"use client";
import { useI18n } from "@/components/preferences";
import { z } from "zod";
import type { ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, useAdmin, type Account, type Organization } from "./provider";
import { DataTable } from "./data-table";
import { Heading, NoPermission } from "./common";
import { EditorDialog, SchemaForm, nameSchema, passwordSchema, type Field } from "./form";
import { RevokeCredentials } from "@/components/revoke-credentials";
import { roleLabels, rolePermissions, reservedRoles } from "@/lib/roles";
import type { Role } from "@/generated/prisma/client";
import type { Translate } from "@/lib/i18n";
import { AccountIdentity } from "./account-identity";
const roles = Object.keys(roleLabels) as Role[];
const statuses = [{ value: "ACTIVE", label: "apiTokens.enabled" }, { value: "DISABLED", label: "members.disabled" }];
const memberSchema = z.object({ roles: z.array(z.enum(roles as [Role, ...Role[]])), status: z.enum(["ACTIVE", "DISABLED"]) });
function roleField(superAdmin: boolean, t: Translate, server = false): Field {
  return { name: "roles", label: server ? "members.serverRoles" : "members.organizationRoles", type: "roles",
    hint: server ? "members.appliesOnlyToTheSpecifiedServerClearRolesTo" : "members.organizationRolesCoverCurrentAndFutureServersPermissionsAre",
    options: roles.filter(role => !server || (role !== "ORG_ADMIN" && role !== "PLAYER")).map(role => ({ value: role, label: t(roleLabels[role]) + (reservedRoles.includes(role) ? " · MUA" : ""), disabled: !superAdmin && reservedRoles.includes(role) })) };
}
function MemberEditor({ org, member }: { org: Organization; member: Organization["members"][number] }) {
  const { t } = useI18n();
  const { state, busy, run } = useAdmin();
  const disabled = busy || !!org.archivedAt || !org.permissions.includes("ORG_MEMBERS_MANAGE") || (!state.actor.isSuperAdmin && member.protected);
  return <EditorDialog title={t("members.memberGrants")} disabled={disabled} trigger={<Button size="sm" variant="outline" disabled={disabled}>{t("members.grant")}</Button>} description={t("members.organizationAndServerRolesAreCombinedOnlySuperadminsCan")}>
    {close => <div className="space-y-6"><SchemaForm schema={memberSchema} fields={[roleField(state.actor.isSuperAdmin, t), { name: "status", label: t("members.memberStatus"), type: "select", options: statuses }]} defaults={{ roles: member.roles, status: member.status }} disabled={disabled}
      onSubmit={async values => { const ok = await run(() => api(`/api/admin/organizations/${org.id}/members/${member.account.id}`, "PUT", values)); if (ok) close(); return ok; }} />
      <div className="space-y-3 border-t pt-5"><h3 className="text-sm font-semibold">{t("members.serverGrants")}</h3>{org.servers.map(server => <EditorDialog key={server.serverId} title={t("members.serverGrantsTitle", { "member": server.displayName })} trigger={<Button className="mr-2 mb-2" variant="outline" size="sm" disabled={disabled || !!server.archivedAt}>{server.displayName} ({server.serverId})</Button>}>
        {closeGrant => <SchemaForm schema={z.object({ roles: z.array(z.enum(roles as [Role, ...Role[]])) })} fields={[roleField(state.actor.isSuperAdmin, t, true)]} defaults={{ roles: member.grants.find(grant => grant.serverId === server.serverId)?.roles ?? [] }} disabled={disabled || !!server.archivedAt}
          onSubmit={async values => { const ok = await run(() => api(`/api/admin/organizations/${org.id}/members/${member.account.id}/servers/${server.serverId}`, "PUT", values)); if (ok) { closeGrant(); close(); } return ok; }} />}
      </EditorDialog>)}</div></div>}
  </EditorDialog>;
}
type MemberRow = { org: Organization; member: Organization["members"][number] };
function OrganizationMembers() {
  const { t } = useI18n();
  const { organizations } = useAdmin();
  const readable = organizations.filter(org => org.permissions.includes("ORG_MEMBERS_READ"));
  if (!readable.length && organizations.length) return <NoPermission />;
  const data = readable.flatMap(org => org.members.map(member => ({ org, member })));
  const columns: ColumnDef<MemberRow>[] = [
    { id: "member", header: t("members.members"), accessorFn: row => [row.member.account.displayName, row.member.account.username, row.member.account.unionSubject].filter(Boolean).join(" "), cell: ({ row }) => <div><p className="font-medium">{row.original.member.account.displayName}</p><AccountIdentity {...row.original.member.account} /></div> },
    { id: "organization", header: t("dashboard.organization"), accessorFn: row => row.org.displayName },
    { id: "roles", header: t("members.organizationRoles"), accessorFn: row => row.member.roles.map(role => t(roleLabels[role])).join(" · "), cell: ({ row }) => <div className="flex max-w-xs flex-wrap gap-1">{row.original.member.roles.map(role => <Badge variant="secondary" key={role}>{t(roleLabels[role])}</Badge>)}{!row.original.member.roles.length && <span className="text-muted-foreground">{t("members.unassigned")}</span>}</div> },
    { id: "grants", header: t("members.serverGrants"), accessorFn: row => row.member.grants.filter(grant => grant.roles.length).map(grant => grant.serverId).join(", "), cell: ({ row }) => <span className="text-xs">{row.original.member.grants.filter(grant => grant.roles.length).map(grant => `${grant.serverId}: ${grant.roles.map(role => t(roleLabels[role])).join(" / ")}`).join("; ") || t("clientShared.no")}</span> },
    { id: "status", header: t("clients.status"), accessorFn: row => row.member.status, cell: ({ row }) => <Badge variant="outline">{row.original.member.status === "ACTIVE" ? t("apiTokens.enabled") : t("members.disabled")}{row.original.member.protected ? t("members.muaGrants") : ""}</Badge> },
    { id: "actions", header: t("clients.actions"), enableHiding: false, cell: ({ row }) => <MemberEditor org={row.original.org} member={row.original.member} /> },
  ];
  return <DataTable data={data} columns={columns} empty={t("members.noOrganizationMembersAddExistingAllowlistedAccountsAndAssign")} />;
}
function AccountEditor({ account }: { account?: Account }) {
  const { t } = useI18n();
  const { busy, run } = useAdmin();
  const baseSchema = z.object({ displayName: nameSchema, isSuperAdmin: z.boolean(), password: account ? passwordSchema.or(z.literal("")) : passwordSchema });
  const schema = account ? baseSchema.extend({ status: z.enum(["ACTIVE", "DISABLED"]) })
    : baseSchema.extend({ username: z.string().trim().regex(/^[A-Za-z0-9_.-]{3,64}$/, t("members.usernameMustContain364LettersDigitsOr")) });
  const fields: Field[] = [{ name: "displayName", label: t("members.displayName") }, ...(account ? [{ name: "status", label: t("clients.status"), type: "select" as const, options: statuses }] : [{ name: "username", label: t("auth.fields.username"), autoComplete: "off" }]),
    { name: "password", label: account ? t("members.resetPassword") : t("members.initialPassword"), type: "password", autoComplete: "new-password", hint: account ? t("members.leaveBlankToKeepThePasswordResettingRevokesAll") : t("members.atLeast12Characters") },
    { name: "isSuperAdmin", label: t("members.muaSuperadmin"), type: "checkbox" }];
  return <EditorDialog title={account ? t("members.editAccount") : t("members.createAnAllowlistedAccount")} disabled={busy} trigger={account ? <Button size="sm" variant="outline" disabled={busy}>{t("clientUpload.edit")}</Button> : undefined}>
    {close => <SchemaForm schema={schema} fields={fields} defaults={{ displayName: account?.displayName ?? "", password: "", isSuperAdmin: account?.isSuperAdmin ?? false, ...(account ? { status: account.status } : { username: "" }) }} disabled={busy}
      onSubmit={async values => { const payload = { ...values }; if (account && payload.password === "") delete payload.password; const ok = await run(() => api(`/api/admin/accounts${account ? "/" + account.id : ""}`, account ? "PATCH" : "POST", payload)); if (ok) close(); return ok; }} />}
  </EditorDialog>;
}
function WhitelistAccounts() {
  const { t } = useI18n();
  const { state } = useAdmin();
  const columns: ColumnDef<Account>[] = [{ accessorKey: "displayName", header: t("members.displayName") }, { id: "identity", header: t("members.signInIdentity"), accessorFn: account => [account.username, account.unionSubject].filter(Boolean).join(" "), cell: ({ row }) => <AccountIdentity {...row.original} /> }, { accessorKey: "status", header: t("clients.status"), cell: ({ row }) => <Badge variant="outline">{row.original.status === "ACTIVE" ? t("apiTokens.enabled") : t("members.disabled")}</Badge> }, { accessorKey: "isSuperAdmin", header: t("members.platformRole"), cell: ({ row }) => row.original.isSuperAdmin ? t("members.muaSuperadmin") : row.original.unionSubject ? t("members.unionAccount") : t("members.allowlistedMembers") }, { id: "actions", header: t("clients.actions"), enableHiding: false, cell: ({ row }) => <div className="flex gap-2"><AccountEditor account={row.original} /><RevokeCredentials account={row.original} self={row.original.id === state.actor.id} /></div> }];
  return <div className="space-y-5"><AccountEditor /><DataTable data={state.accounts} columns={columns} /></div>;
}
export function MembersPage() {
  const { t } = useI18n();
  const { state } = useAdmin();
  return <><Heading title={t("members.members")} description={t("members.allowlistedAccountsIdentifyUsersOrganizationMembershipsAndServerGrants")} />
    {state.actor.isSuperAdmin ? <Tabs defaultValue="members"><TabsList><TabsTrigger value="members">{t("members.organizationMember")}</TabsTrigger><TabsTrigger value="accounts">{t("members.allowlistedAccount")}</TabsTrigger></TabsList><TabsContent value="members" className="mt-5"><OrganizationMembers /></TabsContent><TabsContent value="accounts" className="mt-5"><WhitelistAccounts /></TabsContent></Tabs> : <OrganizationMembers />}</>;
}
export function PermissionsPage() {
  const { t } = useI18n();
  const { state } = useAdmin();
  const columns: ColumnDef<{ role: Role }>[] = [
    { accessorKey: "role", header: t("members.role"), cell: ({ row }) => <div><p className="font-medium">{t(roleLabels[row.original.role])}</p><code className="text-xs text-muted-foreground">{row.original.role}</code></div> },
    { id: "assignment", header: t("members.grantManagement"), accessorFn: row => reservedRoles.includes(row.role) ? t("members.muaSuperadminOnly") : t("members.muaOrganizationAdministrator") },
    { id: "scope", header: t("members.scope"), accessorFn: row => row.role === "ORG_ADMIN" || row.role === "PLAYER" ? t("dashboard.organization") : t("members.organizationOrServer") },
    { id: "permissions", header: t("members.permission"), accessorFn: row => row.role === "PLAYER" ? t("members.accessToAuthorizedPublishedResourcesOnlyNoManagementPermissions") : rolePermissions[row.role].join(", "), cell: ({ row }) => row.original.role === "PLAYER" ? <span className="text-sm text-muted-foreground">{t("members.accessToAuthorizedPublishedResourcesOnlyNoManagementPermissions")}</span> : <div className="flex max-w-2xl flex-wrap gap-1">{rolePermissions[row.original.role].map(permission => <Badge key={permission} variant="outline" className="text-xs">{permission}</Badge>)}</div> },
  ];
  return <><Heading title={t("members.permission")} description={t("members.rbacIsActiveOrganizationAndServerPermissionsAreCombined")} /><div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">{t("members.muaSuperadminsHaveAllPermissionsOrganizationAdministratorsManageAll")}{!state.actor.isSuperAdmin && t("members.contactAPlatformAdministratorToChangeMuaReservedRoles")} {" " + t("members.postgresqlRlsProvidesASecondSecurityLayerTheServer")}</div><DataTable data={roles.map(role => ({ role }))} columns={columns} searchPlaceholder={t("members.searchRolesOrPermissions")} /></>;
}
