import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { Actor, Db } from "./auth";
import { invariant } from "./errors";
import { displayScheduleSchema } from "./server-display";
import * as input from "./input";
import { hashPassword } from "./password";
import { enabledPackageFormats } from "./package-format-settings";
import { maxUploadSizeMb } from "./upload-size-settings";
import { accountDirectory, credentialCreate, credentialUpdate, revokeAccountSessions, serverSummaries, securityFunction } from "./database-security";
import { serverMottoUrl } from "./server-motto-contract";
import { expandRoles, organizationScope, requireOrganization, requireClient, requireServer, reservedRoles, rolePermissions, superOnly } from "./rbac";

const accountSelect = { id: true, displayName: true, status: true, isSuperAdmin: true } as const;
const accountDto = (account: { id: string; displayName: string; status: string; isSuperAdmin: boolean }, username = "") =>
  ({ id: account.id, displayName: account.displayName, status: account.status, isSuperAdmin: account.isSuperAdmin, username });

export async function audit(db: Db, actor: Actor, action: string, targetType: string, targetId: string,
  organizationId?: string, serverId?: string, details: Prisma.InputJsonObject = {}) {
  await db.auditEvent.createMany({ data: [{ actorId: actor.id, action, targetType, targetId, organizationId, serverId, details }] });
}

export async function getState(db: Db, actor: Actor) {
  const packageFormats = await enabledPackageFormats(db);
  const uploadSizeLimit = await maxUploadSizeMb(db);
  const organizations = await db.organization.findMany({
    where: actor.isSuperAdmin ? {} : { members: { some: { accountId: actor.id, status: "ACTIVE" } } },
    orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { displayName: "asc" }],
    include: { servers: { orderBy: [{ sortOrder: "asc" }, { serverId: "asc" }], include: { publication: { include: { client: true } } } },
      clients: { where: { deletedAt: null }, select: { archivedAt: true, scopeServerId: true, binding: { select: { serverId: true } } } },
      members: { where: { accountId: actor.id }, include: { serverGrants: true } } },
  });
  const directory = await accountDirectory(db);
  const names = new Map(directory.map(account => [account.id, account.username ?? ""]));
  const releaseStates = await serverSummaries(db, organizations.flatMap(org => org.servers.map(server => server.serverId)));
  const organizationDtos = [];
  for (const organization of organizations) {
    const member = organization.members[0];
    const permissions = actor.isSuperAdmin ? Object.values(rolePermissions).flat() : expandRoles(member?.roles ?? []);
    const servers = organization.servers.flatMap(server => {
      const grant = member?.serverGrants.find(grant => grant.serverId === server.serverId);
      const rights = actor.isSuperAdmin ? Object.values(rolePermissions).flat() : expandRoles([...(member?.roles ?? []), ...(grant?.roles ?? [])]);
      if (!rights.includes("SERVER_READ")) return [];
      return [{ serverId: server.serverId, organizationId: organization.id, displayName: server.displayName, description: server.description,
        gameAddress: server.gameAddress, iconObjectKey: server.iconObjectKey, sortOrder: server.sortOrder, themeColor: server.themeColor,
        mottoImageUrl: serverMottoUrl(server.iconObjectKey, organization.id, server.serverId),
        displayMode: server.displayMode, displayStartsAt: server.displayStartsAt, displayEndsAt: server.displayEndsAt,
        isListed: server.isListed, archivedAt: server.archivedAt, clientArchivedAt: server.publication?.client?.archivedAt ?? null,
        currentReleaseId: server.publication?.releaseId ?? null, currentReleaseActive: releaseStates.get(server.serverId) ?? false,
        publicationRevision: server.publication?.revision ?? 0, boundClientId: server.publication?.clientId ?? null, boundClientName: server.publication?.client?.name ?? null, permissions: [...new Set(rights)] }];
    });
    const members = permissions.includes("ORG_MEMBERS_READ") ? (await db.organizationMember.findMany({
      where: { organizationId: organization.id }, orderBy: { createdAt: "asc" }, include: { account: { select: accountSelect }, serverGrants: true },
    })).map(member => ({ account: accountDto(member.account, names.get(member.account.id)), status: member.status, roles: member.roles,
      grants: member.serverGrants.map(grant => ({ serverId: grant.serverId, roles: grant.roles })),
      protected: member.account.isSuperAdmin || member.roles.some(role => reservedRoles.includes(role)) || member.serverGrants.some(grant => grant.roles.some(role => reservedRoles.includes(role))) })) : [];
    const clientCount = organization.clients.filter(client => {
      const serverId = client.binding?.serverId ?? client.scopeServerId;
      const grant = member?.serverGrants.find(grant => grant.serverId === serverId);
      const rights = actor.isSuperAdmin ? Object.values(rolePermissions).flat() : expandRoles([...(member?.roles ?? []), ...(grant?.roles ?? [])]);
      return !organization.archivedAt && !client.archivedAt && (rights.includes("DRAFT_READ") || rights.includes("RELEASE_READ"));
    }).length;
    organizationDtos.push({ id: organization.id, displayName: organization.displayName, description: organization.description, clientCount,
      avatarObjectKey: organization.avatarObjectKey, archivedAt: organization.archivedAt, permissions: [...new Set(permissions)], servers, members });
  }
  const accounts = actor.isSuperAdmin ? directory.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).map(account => accountDto(account, account.username ?? "")) : [];
  const events = actor.isSuperAdmin ? await db.auditEvent.findMany({ take: 50, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, action: true, targetType: true, targetId: true, organizationId: true, serverId: true, details: true, createdAt: true, actor: { select: { displayName: true } } } }) : [];
  // Aggregate the entire window, rather than treating the last 50 events as complete statistics.
  const auditActivity = actor.isSuperAdmin ? await db.$queryRaw<{ date: string; count: number }[]>`
    WITH days AS (
      SELECT generate_series(
        (now() AT TIME ZONE 'Asia/Shanghai')::date - 13,
        (now() AT TIME ZONE 'Asia/Shanghai')::date, interval '1 day'
      )::date AS day
    ), counts AS (
      SELECT ("createdAt" AT TIME ZONE 'Asia/Shanghai')::date AS day, count(*)::int AS count
      FROM "AuditEvent"
      WHERE "createdAt" >= (((now() AT TIME ZONE 'Asia/Shanghai')::date - 13)::timestamp AT TIME ZONE 'Asia/Shanghai')
        AND "createdAt" < (((now() AT TIME ZONE 'Asia/Shanghai')::date + 1)::timestamp AT TIME ZONE 'Asia/Shanghai')
      GROUP BY 1
    )
    SELECT to_char(days.day, 'YYYY-MM-DD') AS date, coalesce(counts.count, 0)::int AS count
    FROM days LEFT JOIN counts USING (day) ORDER BY days.day
  ` : [];
  return { actor, organizations: organizationDtos, accounts, events, auditActivity, enabledPackageFormats: packageFormats, maxUploadSizeMb: uploadSizeLimit };
}

export async function createOrganization(db: Db, actor: Actor, raw: unknown) {
  superOnly(actor);
  const data = input.fields(raw, ["displayName", "description", "avatarObjectKey"]);
  const organization = await db.organization.create({ data: { displayName: input.text(data, "displayName"),
    description: data.description === undefined ? "" : input.text(data, "description", 5000, false),
    avatarObjectKey: data.avatarObjectKey === undefined ? null : input.optionalText(data, "avatarObjectKey") } });
  await audit(db, actor, "ORGANIZATION_CREATE", "Organization", organization.id, organization.id);
  return { id: organization.id };
}

export async function updateOrganization(db: Db, actor: Actor, id: string, raw: unknown) {
  await requireOrganization(db, actor, id, "ORG_EDIT");
  const data = input.fields(raw, ["displayName", "description", "avatarObjectKey"]);
  const update: Prisma.OrganizationUpdateInput = {};
  if ("displayName" in data) update.displayName = input.text(data, "displayName");
  if ("description" in data) update.description = input.text(data, "description", 5000, false);
  if ("avatarObjectKey" in data) update.avatarObjectKey = input.optionalText(data, "avatarObjectKey");
  await db.organization.update({ where: { id }, data: update });
  await audit(db, actor, "ORGANIZATION_EDIT", "Organization", id, id, undefined, { fields: Object.keys(data) });
  return { ok: true };
}

export async function createServer(db: Db, actor: Actor, raw: unknown) {
  superOnly(actor);
  const data = input.fields(raw, ["organizationId", "serverId", "displayName", "description", "gameAddress", "displayMode", "displayStartsAt", "displayEndsAt"]);
  const organizationId = input.uuid(input.text(data, "organizationId"));
  await requireOrganization(db, actor, organizationId, "ORG_EDIT");
  const id = input.serverId(input.text(data, "serverId"));
  const schedule = displayScheduleSchema.safeParse({ displayMode: "displayMode" in data ? data.displayMode : "PERMANENT", displayStartsAt: data.displayStartsAt ?? null, displayEndsAt: data.displayEndsAt ?? null });
  invariant(schedule.success, 400, schedule.error?.issues[0]?.message ?? "展示配置无效");
  await db.server.create({ data: { serverId: id, organizationId, displayName: input.text(data, "displayName"),
    ...schedule.data,
    description: data.description === undefined ? "" : input.text(data, "description", 5000, false),
    gameAddress: data.gameAddress === undefined ? null : input.optionalText(data, "gameAddress", 255) } });
  await db.serverPublication.create({ data: { serverId: id, changedById: actor.id } });
  await audit(db, actor, "SERVER_CREATE", "Server", id, organizationId, id);
  return { serverId: id };
}

export async function updateServer(db: Db, actor: Actor, id: string, raw: unknown) {
  const { server } = await requireServer(db, actor, id, "SERVER_EDIT");
  const data = input.fields(raw, ["displayName", "description", "gameAddress", "sortOrder", "themeColor", "isListed", "displayMode", "displayStartsAt", "displayEndsAt"]);
  if (["sortOrder", "isListed"].some(key => key in data)) superOnly(actor);
  const update: Prisma.ServerUpdateInput = {};
  if ("displayName" in data) update.displayName = input.text(data, "displayName");
  if ("description" in data) update.description = input.text(data, "description", 5000, false);
  if ("gameAddress" in data) update.gameAddress = input.optionalText(data, "gameAddress", 255);
  if ("sortOrder" in data) {
    invariant(Number.isSafeInteger(data.sortOrder) && Math.abs(data.sortOrder as number) <= 2147483647, 400, "排序须为有效整数");
    update.sortOrder = data.sortOrder as number;
  }
  if ("themeColor" in data) {
    const color = input.optionalText(data, "themeColor", 7);
    invariant(color === null || /^#[0-9a-f]{6}$/i.test(color), 400, "颜色须为 #RRGGBB");
    update.themeColor = color;
  }
  if ("isListed" in data) {
    update.isListed = input.bool(data, "isListed");
    invariant(!update.isListed || !server.client?.archivedAt, 409, "客户端已归档，不能上架");
  }
  if (["displayMode", "displayStartsAt", "displayEndsAt"].some(key => key in data)) {
    const schedule = displayScheduleSchema.safeParse({
      displayMode: "displayMode" in data ? data.displayMode : server.displayMode,
      displayStartsAt: "displayStartsAt" in data ? data.displayStartsAt : data.displayMode === "PERMANENT" ? null : server.displayStartsAt?.toISOString() ?? null,
      displayEndsAt: "displayEndsAt" in data ? data.displayEndsAt : data.displayMode === "PERMANENT" ? null : server.displayEndsAt?.toISOString() ?? null,
    });
    invariant(schedule.success, 400, schedule.error?.issues[0]?.message ?? "展示配置无效");
    Object.assign(update, schedule.data);
  }
  await db.server.update({ where: { serverId: id }, data: update });
  await audit(db, actor, "SERVER_EDIT", "Server", id, server.organizationId, id, { fields: Object.keys(data) });
  return { ok: true };
}

export async function archiveResource(db: Db, actor: Actor, kind: "organizations" | "servers" | "clients", id: string, raw: unknown) {
  if (kind !== "clients") superOnly(actor);
  else await requireClient(db, actor, id, "CLIENT_ARCHIVE", false);
  const archived = input.bool(input.fields(raw, ["archived"]), "archived");
  const archivedAt = archived ? new Date() : null;
  let organizationId: string;
  let serverId: string | undefined;
  if (kind === "organizations") {
    organizationId = (await organizationScope(db, actor, id)).organization.id;
    await db.organization.update({ where: { id }, data: { archivedAt } });
    if (archived) {
      await db.server.updateMany({ where: { organizationId }, data: { isListed: false } });
      await db.serverPublication.updateMany({ where: { server: { organizationId } }, data: { clientId: null, releaseId: null, revision: { increment: 1 }, changedById: actor.id } });
    }
  } else if (kind === "clients") {
    const { client } = await requireClient(db, actor, id, "CLIENT_ARCHIVE", false);
    organizationId = client.organizationId; serverId = client.binding?.serverId;
    await db.client.update({ where: { id }, data: { archivedAt, ...(archived ? { requestedServerId: null, requestedRevision: null, expectedClientId: null } : {}) } });
    if (archived && serverId) {
      await db.$executeRaw`SELECT ${securityFunction("archive_binding")}(${id},${serverId},${actor.id}::uuid)`;
    }
  } else {
    const { server } = await requireServer(db, actor, id, "SERVER_READ", false);
    organizationId = server.organizationId;
    serverId = id;
    if (kind === "servers") await db.server.update({ where: { serverId: id }, data: { archivedAt, ...(archived ? { isListed: false } : {}) } });
    if (archived) {
      await db.server.update({ where: { serverId: id }, data: { isListed: false } });
      await db.serverPublication.update({ where: { serverId: id }, data: { clientId: null, releaseId: null, revision: { increment: 1 }, changedById: actor.id } });
    }
  }
  const targetType = kind === "organizations" ? "Organization" : kind === "servers" ? "Server" : "Client";
  await audit(db, actor, `${targetType.toUpperCase()}_${archived ? "ARCHIVE" : "RESTORE"}`, targetType, id, organizationId, serverId);
  return { ok: true };
}

async function checkMemberChange(db: Db, actor: Actor, organizationId: string, accountId: string, roles: ReturnType<typeof input.roles>) {
  await requireOrganization(db, actor, organizationId, "ORG_MEMBERS_MANAGE");
  const account = await db.account.findUnique({ where: { id: accountId } });
  invariant(account, 404, "白名单账号不存在");
  const member = await db.organizationMember.findUnique({ where: { organizationId_accountId: { organizationId, accountId } }, include: { serverGrants: true } });
  if (!actor.isSuperAdmin) {
    invariant(!account.isSuperAdmin && !roles.some(role => reservedRoles.includes(role)) &&
      !member?.roles.some(role => reservedRoles.includes(role)) && !member?.serverGrants.some(grant => grant.roles.some(role => reservedRoles.includes(role))), 403,
      "管理员、审核、发布或切换角色及其成员资格只能由 MUA 超管调整");
  }
  return { account, member };
}

export async function setMember(db: Db, actor: Actor, organizationId: string, accountId: string, raw: unknown) {
  const data = input.fields(raw, ["roles", "status"]);
  const roles = input.roles(data.roles);
  invariant(data.status === "ACTIVE" || data.status === "DISABLED", 400, "成员状态无效");
  const { account, member } = await checkMemberChange(db, actor, organizationId, accountId, roles);
  invariant(member || account.status === "ACTIVE", 409, "不能添加已停用的账号");
  await db.organizationMember.upsert({ where: { organizationId_accountId: { organizationId, accountId } },
    create: { organizationId, accountId, roles, status: data.status, grantedById: actor.id },
    update: { roles, status: data.status, grantedById: actor.id } });
  await audit(db, actor, "MEMBER_SET", "OrganizationMember", accountId, organizationId, undefined, { roles, status: data.status });
  return { ok: true };
}

export async function setGrant(db: Db, actor: Actor, organizationId: string, accountId: string, id: string, raw: unknown) {
  const roles = input.roles(input.fields(raw, ["roles"]).roles);
  invariant(!roles.includes("ORG_ADMIN"), 400, "组织管理员不能按单服授权");
  const { member } = await checkMemberChange(db, actor, organizationId, accountId, roles);
  invariant(member, 404, "请先将该账号加入组织");
  const { server } = await requireServer(db, actor, id, "SERVER_READ");
  invariant(server.organizationId === organizationId, 404, "服务器不属于此组织");
  await db.serverGrant.upsert({ where: { accountId_serverId: { accountId, serverId: id } },
    create: { organizationId, accountId, serverId: id, roles, grantedById: actor.id }, update: { roles, grantedById: actor.id } });
  await audit(db, actor, "SERVER_GRANT_SET", "ServerGrant", accountId, organizationId, id, { roles });
  return { ok: true };
}

export async function searchAccounts(db: Db, actor: Actor, organizationId: string, query: string) {
  await requireOrganization(db, actor, organizationId, "ORG_MEMBERS_READ");
  invariant(query.trim().length >= 3 && query.length <= 64, 400, "请至少输入 3 个字符搜索白名单账号");
  const search = query.trim().toLowerCase();
  return (await accountDirectory(db)).filter(account => account.status === "ACTIVE" && (account.displayName.toLowerCase().includes(search) || account.username?.toLowerCase().includes(search)))
    .sort((a, b) => a.displayName.localeCompare(b.displayName)).slice(0, 10).map(account => accountDto(account, account.username ?? ""));
}

export async function createAccount(db: Db, actor: Actor, raw: unknown) {
  superOnly(actor);
  const data = input.fields(raw, ["displayName", "username", "password", "isSuperAdmin"]);
  const passwordHash = await hashPassword(input.password(data.password));
  const account = await db.account.create({ data: { displayName: input.text(data, "displayName"), isSuperAdmin: data.isSuperAdmin === undefined ? false : input.bool(data, "isSuperAdmin") } });
  await credentialCreate(db, account.id, input.username(input.text(data, "username", 64)), passwordHash);
  await audit(db, actor, "ACCOUNT_CREATE", "Account", account.id, undefined, undefined, { isSuperAdmin: account.isSuperAdmin });
  return { id: account.id };
}

export async function updateAccount(db: Db, actor: Actor, id: string, raw: unknown) {
  superOnly(actor);
  const data = input.fields(raw, ["displayName", "status", "isSuperAdmin", "password"]);
  const existing = await db.account.findUnique({ where: { id } });
  invariant(existing, 404, "账号不存在");
  const status = "status" in data ? data.status : existing.status;
  invariant(status === "ACTIVE" || status === "DISABLED", 400, "账号状态无效");
  const isSuperAdmin = "isSuperAdmin" in data ? input.bool(data, "isSuperAdmin") : existing.isSuperAdmin;
  if (existing.isSuperAdmin && existing.status === "ACTIVE" && (!isSuperAdmin || status === "DISABLED")) {
    invariant(await db.account.count({ where: { isSuperAdmin: true, status: "ACTIVE", id: { not: id } } }) > 0, 409, "至少保留一个启用的 MUA 超管");
  }
  await db.account.update({ where: { id }, data: { status, isSuperAdmin, ...(data.displayName !== undefined ? { displayName: input.text(data, "displayName") } : {}) } });
  if (data.password !== undefined) await credentialUpdate(db, id, await hashPassword(input.password(data.password)));
  if (status === "DISABLED" || existing.isSuperAdmin !== isSuperAdmin || data.password !== undefined) await revokeAccountSessions(db, id);
  await audit(db, actor, "ACCOUNT_EDIT", "Account", id, undefined, undefined, { fields: Object.keys(data), status, isSuperAdmin });
  return { ok: true };
}
