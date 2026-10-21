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
import { roleLabels, rolePermissions, reservedRoles } from "@/lib/roles";
import type { Role } from "@/generated/prisma/client";
import type { Translate } from "@/lib/i18n";
import { AccountIdentity } from "./account-identity";
const roles = Object.keys(roleLabels) as Role[];
const statuses = [{ value: "ACTIVE", label: "启用" }, { value: "DISABLED", label: "停用" }];
const memberSchema = z.object({ roles: z.array(z.enum(roles as [Role, ...Role[]])), status: z.enum(["ACTIVE", "DISABLED"]) });
function roleField(superAdmin: boolean, t: Translate, server = false): Field {
  return { name: "roles", label: server ? "单服角色" : "组织角色", type: "roles",
    hint: server ? "只对指定服务器生效；清空角色即可移除该服授权。" : "组织角色覆盖当前与未来服务器；角色权限按并集叠加。",
    options: roles.filter(role => !server || (role !== "ORG_ADMIN" && role !== "PLAYER")).map(role => ({ value: role, label: t(roleLabels[role]) + (reservedRoles.includes(role) ? " · MUA" : ""), disabled: !superAdmin && reservedRoles.includes(role) })) };
}
function MemberEditor({ org, member }: { org: Organization; member: Organization["members"][number] }) {
  const { t } = useI18n();
  const { state, busy, run } = useAdmin();
  const disabled = busy || !!org.archivedAt || !org.permissions.includes("ORG_MEMBERS_MANAGE") || (!state.actor.isSuperAdmin && member.protected);
  return <EditorDialog title={t("成员授权")} disabled={disabled} trigger={<Button size="sm" variant="outline" disabled={disabled}>{t("授权")}</Button>} description={t("组织角色与单服角色叠加。MUA 保留角色仅能由超级管理员授予或撤销。")}>
    {close => <div className="space-y-6"><SchemaForm schema={memberSchema} fields={[roleField(state.actor.isSuperAdmin, t), { name: "status", label: t("成员状态"), type: "select", options: statuses }]} defaults={{ roles: member.roles, status: member.status }} disabled={disabled}
      onSubmit={async values => { const ok = await run(() => api(`/api/admin/organizations/${org.id}/members/${member.account.id}`, "PUT", values)); if (ok) close(); return ok; }} />
      <div className="space-y-3 border-t pt-5"><h3 className="text-sm font-semibold">{t("单服授权")}</h3>{org.servers.map(server => <EditorDialog key={server.serverId} title={t("单服授权 · {0}", { "0": server.displayName })} trigger={<Button className="mr-2 mb-2" variant="outline" size="sm" disabled={disabled || !!server.archivedAt}>{server.displayName} ({server.serverId})</Button>}>
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
    { id: "member", header: t("成员"), accessorFn: row => [row.member.account.displayName, row.member.account.username, row.member.account.unionSubject].filter(Boolean).join(" "), cell: ({ row }) => <div><p className="font-medium">{row.original.member.account.displayName}</p><AccountIdentity {...row.original.member.account} /></div> },
    { id: "organization", header: t("组织"), accessorFn: row => row.org.displayName },
    { id: "roles", header: t("组织角色"), accessorFn: row => row.member.roles.map(role => t(roleLabels[role])).join(" · "), cell: ({ row }) => <div className="flex max-w-xs flex-wrap gap-1">{row.original.member.roles.map(role => <Badge variant="secondary" key={role}>{t(roleLabels[role])}</Badge>)}{!row.original.member.roles.length && <span className="text-muted-foreground">{t("未分配")}</span>}</div> },
    { id: "grants", header: t("单服授权"), accessorFn: row => row.member.grants.filter(grant => grant.roles.length).map(grant => grant.serverId).join(", "), cell: ({ row }) => <span className="text-xs">{row.original.member.grants.filter(grant => grant.roles.length).map(grant => `${grant.serverId}: ${grant.roles.map(role => t(roleLabels[role])).join(" / ")}`).join("; ") || t("无")}</span> },
    { id: "status", header: t("状态"), accessorFn: row => row.member.status, cell: ({ row }) => <Badge variant="outline">{row.original.member.status === "ACTIVE" ? t("启用") : t("停用")}{row.original.member.protected ? t(" · MUA 授权") : ""}</Badge> },
    { id: "actions", header: t("操作"), enableHiding: false, cell: ({ row }) => <MemberEditor org={row.original.org} member={row.original.member} /> },
  ];
  return <DataTable data={data} columns={columns} empty={t("暂无组织成员。添加已有白名单账号后分配角色。")} />;
}
function AccountEditor({ account }: { account?: Account }) {
  const { t } = useI18n();
  const { busy, run } = useAdmin();
  const baseSchema = z.object({ displayName: nameSchema, isSuperAdmin: z.boolean(), password: account ? passwordSchema.or(z.literal("")) : passwordSchema });
  const schema = account ? baseSchema.extend({ status: z.enum(["ACTIVE", "DISABLED"]) })
    : baseSchema.extend({ username: z.string().trim().regex(/^[A-Za-z0-9_.-]{3,64}$/, t("用户名为 3–64 位字母、数字或 _ . -")) });
  const fields: Field[] = [{ name: "displayName", label: t("显示名称") }, ...(account ? [{ name: "status", label: t("状态"), type: "select" as const, options: statuses }] : [{ name: "username", label: t("用户名"), autoComplete: "off" }]),
    { name: "password", label: account ? t("重置密码") : t("初始密码"), type: "password", autoComplete: "new-password", hint: account ? t("留空保留现有密码。重置会撤销此账号全部会话。") : t("至少 12 个字符。") },
    { name: "isSuperAdmin", label: t("MUA 超级管理员"), type: "checkbox" }];
  return <EditorDialog title={account ? t("编辑账号") : t("创建白名单账号")} disabled={busy} trigger={account ? <Button size="sm" variant="outline" disabled={busy}>{t("编辑")}</Button> : undefined}>
    {close => <SchemaForm schema={schema} fields={fields} defaults={{ displayName: account?.displayName ?? "", password: "", isSuperAdmin: account?.isSuperAdmin ?? false, ...(account ? { status: account.status } : { username: "" }) }} disabled={busy}
      onSubmit={async values => { const payload = { ...values }; if (account && payload.password === "") delete payload.password; const ok = await run(() => api(`/api/admin/accounts${account ? "/" + account.id : ""}`, account ? "PATCH" : "POST", payload)); if (ok) close(); return ok; }} />}
  </EditorDialog>;
}
function WhitelistAccounts() {
  const { t } = useI18n();
  const { state } = useAdmin();
  const columns: ColumnDef<Account>[] = [{ accessorKey: "displayName", header: t("显示名称") }, { id: "identity", header: t("登录身份"), accessorFn: account => [account.username, account.unionSubject].filter(Boolean).join(" "), cell: ({ row }) => <AccountIdentity {...row.original} /> }, { accessorKey: "status", header: t("状态"), cell: ({ row }) => <Badge variant="outline">{row.original.status === "ACTIVE" ? t("启用") : t("停用")}</Badge> }, { accessorKey: "isSuperAdmin", header: t("平台角色"), cell: ({ row }) => row.original.isSuperAdmin ? t("MUA 超级管理员") : row.original.unionSubject ? t("Union 账号") : t("白名单成员") }, { id: "actions", header: t("操作"), enableHiding: false, cell: ({ row }) => <AccountEditor account={row.original} /> }];
  return <div className="space-y-5"><AccountEditor /><DataTable data={state.accounts} columns={columns} /></div>;
}
export function MembersPage() {
  const { t } = useI18n();
  const { state } = useAdmin();
  return <><Heading title={t("成员")} description={t("白名单账号是登录身份；组织成员关系与单服授权决定可访问范围。")} />
    {state.actor.isSuperAdmin ? <Tabs defaultValue="members"><TabsList><TabsTrigger value="members">{t("组织成员")}</TabsTrigger><TabsTrigger value="accounts">{t("白名单账号")}</TabsTrigger></TabsList><TabsContent value="members" className="mt-5"><OrganizationMembers /></TabsContent><TabsContent value="accounts" className="mt-5"><WhitelistAccounts /></TabsContent></Tabs> : <OrganizationMembers />}</>;
}
export function PermissionsPage() {
  const { t } = useI18n();
  const { state } = useAdmin();
  const columns: ColumnDef<{ role: Role }>[] = [
    { accessorKey: "role", header: t("角色"), cell: ({ row }) => <div><p className="font-medium">{t(roleLabels[row.original.role])}</p><code className="text-xs text-muted-foreground">{row.original.role}</code></div> },
    { id: "assignment", header: t("授权管理"), accessorFn: row => reservedRoles.includes(row.role) ? t("仅 MUA 超级管理员") : t("MUA / 组织管理员") },
    { id: "scope", header: t("作用范围"), accessorFn: row => row.role === "ORG_ADMIN" || row.role === "PLAYER" ? t("组织") : t("组织或单服") },
    { id: "permissions", header: t("权限"), accessorFn: row => row.role === "PLAYER" ? t("仅可访问获准的已发布资源，无后台管理权限。") : rolePermissions[row.role].join(", "), cell: ({ row }) => row.original.role === "PLAYER" ? <span className="text-sm text-muted-foreground">{t("仅可访问获准的已发布资源，无后台管理权限。")}</span> : <div className="flex max-w-2xl flex-wrap gap-1">{rolePermissions[row.original.role].map(permission => <Badge key={permission} variant="outline" className="text-xs">{permission}</Badge>)}</div> },
  ];
  return <><Heading title={t("权限")} description={t("当前使用 RBAC。组织角色和单服角色取并集，审核、发布、版本切换分别授权。")} /><div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">{t("MUA 超级管理员拥有全部权限。组织管理员可以管理所属组织的所有服务器，但审核、发布和版本切换仍需单独分配角色。")}{!state.actor.isSuperAdmin && t(" 如需调整 MUA 保留角色，请联系平台管理员。")} {" " + t("PostgreSQL RLS 已作为第二层安全保护，服务端仍逐请求校验权限。")}</div><DataTable data={roles.map(role => ({ role }))} columns={columns} searchPlaceholder={t("搜索角色或权限…")} /></>;
}
