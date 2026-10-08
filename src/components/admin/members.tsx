"use client";
import { useState } from "react";
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
const roles = Object.keys(roleLabels) as Role[];
const statuses = [{ value: "ACTIVE", label: "启用" }, { value: "DISABLED", label: "停用" }];
const memberSchema = z.object({ roles: z.array(z.enum(roles as [Role, ...Role[]])), status: z.enum(["ACTIVE", "DISABLED"]) });
function roleField(superAdmin: boolean, server = false): Field {
  return { name: "roles", label: server ? "单服角色" : "组织角色", type: "roles",
    hint: server ? "只对指定服务器生效；清空角色即可移除该服授权。" : "组织角色覆盖当前与未来服务器；角色权限按并集叠加。",
    options: roles.filter(role => !server || role !== "ORG_ADMIN").map(role => ({ value: role, label: roleLabels[role] + (reservedRoles.includes(role) ? " · MUA" : ""), disabled: !superAdmin && reservedRoles.includes(role) })) };
}
function MemberEditor({ org, member }: { org: Organization; member: Organization["members"][number] }) {
  const { state, busy, run } = useAdmin();
  const disabled = busy || !!org.archivedAt || !org.permissions.includes("ORG_MEMBERS_MANAGE") || (!state.actor.isSuperAdmin && member.protected);
  return <EditorDialog title="成员授权" disabled={disabled} trigger={<Button size="sm" variant="outline" disabled={disabled}>授权</Button>} description="组织角色与单服角色叠加。MUA 保留角色仅能由超级管理员授予或撤销。">
    {close => <div className="space-y-6"><SchemaForm schema={memberSchema} fields={[roleField(state.actor.isSuperAdmin), { name: "status", label: "成员状态", type: "select", options: statuses }]} defaults={{ roles: member.roles, status: member.status }} disabled={disabled}
      onSubmit={async values => { const ok = await run(() => api(`/api/admin/organizations/${org.id}/members/${member.account.id}`, "PUT", values)); if (ok) close(); return ok; }} />
      <div className="space-y-3 border-t pt-5"><h3 className="text-sm font-semibold">单服授权</h3>{org.servers.map(server => <EditorDialog key={server.serverId} title={`单服授权 · ${server.displayName}`} trigger={<Button className="mr-2 mb-2" variant="outline" size="sm" disabled={disabled || !!server.archivedAt}>{server.displayName} ({server.serverId})</Button>}>
        {closeGrant => <SchemaForm schema={z.object({ roles: z.array(z.enum(roles as [Role, ...Role[]])) })} fields={[roleField(state.actor.isSuperAdmin, true)]} defaults={{ roles: member.grants.find(grant => grant.serverId === server.serverId)?.roles ?? [] }} disabled={disabled || !!server.archivedAt}
          onSubmit={async values => { const ok = await run(() => api(`/api/admin/organizations/${org.id}/members/${member.account.id}/servers/${server.serverId}`, "PUT", values)); if (ok) { closeGrant(); close(); } return ok; }} />}
      </EditorDialog>)}</div></div>}
  </EditorDialog>;
}
function AddMember({ org }: { org: Organization }) {
  const { state, busy, run } = useAdmin();
  const [candidates, setCandidates] = useState<Account[] | null>(null);
  return <EditorDialog title="添加成员" disabled={busy || !!org.archivedAt} description="搜索已有白名单账号，加入组织后再分配角色。">
    {close => <div className="space-y-4"><SchemaForm schema={z.object({ query: z.string().trim().min(3, "至少输入 3 个字符").max(64) })} fields={[{ name: "query", label: "用户名或显示名称" }]} defaults={{ query: "" }} disabled={busy} label="搜索账号"
      onSubmit={values => run(async () => { setCandidates(await api<Account[]>(`/api/admin/organizations/${org.id}/account-search?q=${encodeURIComponent(String(values.query))}`)); }, "", false)} />
      {candidates?.length === 0 && <p className="text-sm text-muted-foreground">没有匹配的启用账号。</p>}
      {candidates?.map(account => <div key={account.id} className="flex items-center justify-between gap-3 rounded-lg border p-3"><div className="text-sm"><p className="font-medium">{account.displayName}</p><p className="text-muted-foreground">@{account.username}</p></div><Button size="sm" disabled={busy || (!state.actor.isSuperAdmin && account.isSuperAdmin) || org.members.some(member => member.account.id === account.id)} onClick={async () => { if (await run(() => api(`/api/admin/organizations/${org.id}/members/${account.id}`, "PUT", { roles: [], status: "ACTIVE" }), "已加入组织，请继续分配角色")) { setCandidates(null); close(); } }}>{org.members.some(member => member.account.id === account.id) ? "已加入" : "加入组织"}</Button></div>)}</div>}
  </EditorDialog>;
}
type MemberRow = { org: Organization; member: Organization["members"][number] };
function OrganizationMembers() {
  const { organizations } = useAdmin();
  const readable = organizations.filter(org => org.permissions.includes("ORG_MEMBERS_READ"));
  if (!readable.length && organizations.length) return <NoPermission />;
  const data = readable.flatMap(org => org.members.map(member => ({ org, member })));
  const columns: ColumnDef<MemberRow>[] = [
    { id: "member", header: "成员", accessorFn: row => row.member.account.displayName, cell: ({ row }) => <div><p className="font-medium">{row.original.member.account.displayName}</p><p className="text-xs text-muted-foreground">@{row.original.member.account.username}</p></div> },
    { id: "organization", header: "组织", accessorFn: row => row.org.displayName },
    { id: "roles", header: "组织角色", accessorFn: row => row.member.roles.map(role => roleLabels[role]).join(" · "), cell: ({ row }) => <div className="flex max-w-xs flex-wrap gap-1">{row.original.member.roles.map(role => <Badge variant="secondary" key={role}>{roleLabels[role]}</Badge>)}{!row.original.member.roles.length && <span className="text-muted-foreground">未分配</span>}</div> },
    { id: "grants", header: "单服授权", accessorFn: row => row.member.grants.filter(grant => grant.roles.length).map(grant => grant.serverId).join(", "), cell: ({ row }) => <span className="text-xs">{row.original.member.grants.filter(grant => grant.roles.length).map(grant => `${grant.serverId}: ${grant.roles.map(role => roleLabels[role]).join(" / ")}`).join("; ") || "无"}</span> },
    { id: "status", header: "状态", accessorFn: row => row.member.status, cell: ({ row }) => <Badge variant="outline">{row.original.member.status === "ACTIVE" ? "启用" : "停用"}{row.original.member.protected ? " · MUA 授权" : ""}</Badge> },
    { id: "actions", header: "操作", enableHiding: false, cell: ({ row }) => <MemberEditor org={row.original.org} member={row.original.member} /> },
  ];
  return <div className="space-y-5"><div className="flex flex-wrap gap-2">{readable.filter(org => org.permissions.includes("ORG_MEMBERS_MANAGE")).map(org => <div key={org.id} className="flex items-center gap-2"><span className="text-sm text-muted-foreground">{org.displayName}</span><AddMember org={org} /></div>)}</div><DataTable data={data} columns={columns} empty="暂无组织成员。添加已有白名单账号后分配角色。" /></div>;
}
function AccountEditor({ account }: { account?: Account }) {
  const { busy, run } = useAdmin();
  const baseSchema = z.object({ displayName: nameSchema, isSuperAdmin: z.boolean(), password: account ? passwordSchema.or(z.literal("")) : passwordSchema });
  const schema = account ? baseSchema.extend({ status: z.enum(["ACTIVE", "DISABLED"]) })
    : baseSchema.extend({ username: z.string().trim().regex(/^[A-Za-z0-9_.-]{3,64}$/, "用户名为 3–64 位字母、数字或 _ . -") });
  const fields: Field[] = [{ name: "displayName", label: "显示名称" }, ...(account ? [{ name: "status", label: "状态", type: "select" as const, options: statuses }] : [{ name: "username", label: "用户名", autoComplete: "off" }]),
    { name: "password", label: account ? "重置密码" : "初始密码", type: "password", autoComplete: "new-password", hint: account ? "留空保留现有密码。重置会撤销此账号全部会话。" : "至少 12 个字符。" },
    { name: "isSuperAdmin", label: "MUA 超级管理员", type: "checkbox" }];
  return <EditorDialog title={account ? "编辑账号" : "创建白名单账号"} disabled={busy} trigger={account ? <Button size="sm" variant="outline" disabled={busy}>编辑</Button> : undefined}>
    {close => <SchemaForm schema={schema} fields={fields} defaults={{ displayName: account?.displayName ?? "", password: "", isSuperAdmin: account?.isSuperAdmin ?? false, ...(account ? { status: account.status } : { username: "" }) }} disabled={busy}
      onSubmit={async values => { const payload = { ...values }; if (account && payload.password === "") delete payload.password; const ok = await run(() => api(`/api/admin/accounts${account ? "/" + account.id : ""}`, account ? "PATCH" : "POST", payload)); if (ok) close(); return ok; }} />}
  </EditorDialog>;
}
function WhitelistAccounts() {
  const { state } = useAdmin();
  const columns: ColumnDef<Account>[] = [{ accessorKey: "displayName", header: "显示名称" }, { accessorKey: "username", header: "用户名" }, { accessorKey: "status", header: "状态", cell: ({ row }) => <Badge variant="outline">{row.original.status === "ACTIVE" ? "启用" : "停用"}</Badge> }, { accessorKey: "isSuperAdmin", header: "平台角色", cell: ({ row }) => row.original.isSuperAdmin ? "MUA 超级管理员" : "白名单成员" }, { id: "actions", header: "操作", enableHiding: false, cell: ({ row }) => <AccountEditor account={row.original} /> }];
  return <div className="space-y-5"><AccountEditor /><DataTable data={state.accounts} columns={columns} /></div>;
}
export function MembersPage() {
  const { state } = useAdmin();
  return <><Heading title="成员" description="白名单账号是登录身份；组织成员关系与单服授权决定可访问范围。" />
    {state.actor.isSuperAdmin ? <Tabs defaultValue="members"><TabsList><TabsTrigger value="members">组织成员</TabsTrigger><TabsTrigger value="accounts">白名单账号</TabsTrigger></TabsList><TabsContent value="members" className="mt-5"><OrganizationMembers /></TabsContent><TabsContent value="accounts" className="mt-5"><WhitelistAccounts /></TabsContent></Tabs> : <OrganizationMembers />}</>;
}
export function PermissionsPage() {
  const { state } = useAdmin();
  const columns: ColumnDef<{ role: Role }>[] = [
    { accessorKey: "role", header: "角色", cell: ({ row }) => <div><p className="font-medium">{roleLabels[row.original.role]}</p><code className="text-xs text-muted-foreground">{row.original.role}</code></div> },
    { id: "assignment", header: "授权管理", accessorFn: row => reservedRoles.includes(row.role) ? "仅 MUA 超级管理员" : "MUA / 组织管理员" },
    { id: "scope", header: "作用范围", accessorFn: row => row.role === "ORG_ADMIN" ? "组织" : "组织或单服" },
    { id: "permissions", header: "权限", accessorFn: row => rolePermissions[row.role].join(", "), cell: ({ row }) => <div className="flex max-w-2xl flex-wrap gap-1">{rolePermissions[row.original.role].map(permission => <Badge key={permission} variant="outline" className="text-xs">{permission}</Badge>)}</div> },
  ];
  return <><Heading title="权限" description="当前使用 RBAC。组织角色和单服角色取并集，审核、发布、版本切换分别授权。" /><div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">MUA 超级管理员拥有全部权限。组织管理员可以管理所属组织的所有服务器，但审核、发布和版本切换仍需单独分配角色。{!state.actor.isSuperAdmin && " 如需调整 MUA 保留角色，请联系平台管理员。"} PostgreSQL RLS 将在后续作为第二层安全。</div><DataTable data={roles.map(role => ({ role }))} columns={columns} searchPlaceholder="搜索角色或权限…" /></>;
}
