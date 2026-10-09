import "server-only";
import type { Role } from "@/generated/prisma/client";
import type { Actor, Db } from "./auth";
import { invariant } from "./errors";

import { rolePermissions, type Permission } from "./roles";
export { rolePermissions, reservedRoles } from "./roles";
export type { Permission } from "./roles";
export const expandRoles = (roles: readonly Role[]) => [...new Set(roles.flatMap(role => rolePermissions[role]))];
export const superOnly = (actor: Actor) => invariant(actor.isSuperAdmin && !actor.apiScope, 403, "此操作仅限 MUA 超级管理员");

export async function organizationScope(db: Db, actor: Actor, id: string) {
  const organization = await db.organization.findUnique({ where: { id } });
  const member = await db.organizationMember.findUnique({ where: { organizationId_accountId: { organizationId: id, accountId: actor.id } } });
  invariant(organization && (actor.isSuperAdmin || member?.status === "ACTIVE"), 404, "组织不存在");
  return { organization, member, permissions: actor.isSuperAdmin ? Object.values(rolePermissions).flat() : expandRoles(member!.roles) };
}
export async function requireOrganization(db: Db, actor: Actor, id: string, permission: Permission, active = true) {
  const scope = await organizationScope(db, actor, id);
  invariant(scope.permissions.includes(permission), 403, "没有此组织操作权限");
  invariant(!active || !scope.organization.archivedAt, 409, "组织已归档");
  return scope;
}
export async function serverScope(db: Db, actor: Actor, id: string) {
  const server = await db.server.findUnique({ where: { serverId: id }, include: { organization: true, publication: { include: { client: true } } } });
  invariant(server, 404, "服务器不存在");
  const scope = await organizationScope(db, actor, server.organizationId);
  const grant = await db.serverGrant.findUnique({ where: { accountId_serverId: { accountId: actor.id, serverId: id } } });
  let permissions = actor.isSuperAdmin ? Object.values(rolePermissions).flat() : expandRoles([...scope.member!.roles, ...(grant?.roles ?? [])]);
  if (actor.apiScope) {
    invariant(!actor.apiScope.serverIds.length || actor.apiScope.serverIds.includes(id), 404, "服务器不存在");
    permissions = permissions.filter(permission => actor.apiScope!.permissions.includes(permission));
  }
  invariant(permissions.includes("SERVER_READ"), 404, "服务器不存在");
  return { server: { ...server, client: server.publication?.client ?? null }, permissions };
}
export async function requireServer(db: Db, actor: Actor, id: string, permission: Permission, active = true, client = false) {
  const scope = await serverScope(db, actor, id);
  invariant(scope.permissions.includes(permission), 403, "没有此服务器操作权限");
  invariant(!active || (!scope.server.archivedAt && !scope.server.organization.archivedAt && (!client || !scope.server.client?.archivedAt)), 409, "资源已归档");
  return scope;
}

export async function clientScope(db: Db, actor: Actor, id: string) {
  const client = await db.client.findUnique({ where: { id }, include: { organization: true, binding: { include: { server: true } } } });
  invariant(client && !client.deletedAt, 404, "客户端不存在");
  const scope = await organizationScope(db, actor, client.organizationId);
  const serverId = client.binding?.serverId ?? client.scopeServerId;
  const grant = serverId ? await db.serverGrant.findUnique({ where: { accountId_serverId: { accountId: actor.id, serverId } } }) : null;
  let permissions = actor.isSuperAdmin ? Object.values(rolePermissions).flat() : expandRoles([...scope.member!.roles, ...(grant?.roles ?? [])]);
  if (actor.apiScope) {
    invariant(!actor.apiScope.serverIds.length || (!!serverId && actor.apiScope.serverIds.includes(serverId)), 404, "客户端不存在");
    permissions = permissions.filter(permission => actor.apiScope!.permissions.includes(permission));
  }
  invariant(permissions.includes("SERVER_READ"), 404, "客户端不存在");
  return { client, permissions };
}
export async function requireClient(db: Db, actor: Actor, id: string, permission: Permission, active = true) {
  const scope = await clientScope(db, actor, id);
  invariant(scope.permissions.includes(permission), 403, "没有此客户端操作权限");
  invariant(!active || (!scope.client.archivedAt && !scope.client.organization.archivedAt), 409, "客户端或组织已归档");
  return scope;
}
