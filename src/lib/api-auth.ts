import "server-only";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { actorFromToken, locked, tokenDigest, type Db, type Actor } from "./auth";
import { prisma } from "./prisma";
import { sameOrigin } from "./http";
import { invariant } from "./errors";
import { rolePermissions, type Permission } from "./roles";
import { requireServer } from "./rbac";
import { audit } from "./management";

export async function apiActor(db: Db, request: Request, cookie: string | undefined): Promise<Actor> {
  const header = request.headers.get("authorization");
  if (!header) return actorFromToken(db, cookie);
  invariant(/^Bearer mua_[0-9a-f]{64}$/.test(header), 401, "无效的 API Token");
  const record = await db.apiToken.findUnique({ where: { tokenHash: tokenDigest(header.slice(7)) }, include: { account: true } });
  invariant(record && !record.revokedAt && record.expiresAt > new Date() && record.account.status === "ACTIVE", 401, "API Token 已失效");
  return { id: record.accountId, displayName: record.account.displayName, isSuperAdmin: record.account.isSuperAdmin,
    apiScope: { permissions: record.permissions as Permission[], serverIds: record.serverIds } };
}
export function authorizeApi<T>(request: Request, cookie: string | undefined, write: boolean, work: (db: Db, actor: Actor) => Promise<T>) {
  if (write && !request.headers.has("authorization")) sameOrigin(request);
  const run = async (db: Db) => work(db, await apiActor(db, request, cookie));
  return write ? locked(run) : prisma.$transaction(run);
}
export const tokenSelect = { id: true, name: true, permissions: true, serverIds: true, expiresAt: true, revokedAt: true, createdAt: true } as const;
export async function createApiToken(db: Db, actor: Actor, raw: unknown) {
  invariant(!actor.apiScope, 403, "API Token 不能创建其他 Token");
  const parsed = z.object({ name: z.string().trim().min(1).max(100), serverIds: z.array(z.string().regex(/^[A-Za-z]{3,5}$/)).min(1).max(100),
    permissions: z.array(z.string()).min(1).max(20), expiresInDays: z.number().int().min(1).max(90) }).strict().safeParse(raw);
  invariant(parsed.success, 400, "Token 参数无效，必须指定服务器、权限和 1–90 天有效期");
  const data = parsed.data; const known = new Set<Permission>(Object.values(rolePermissions).flat());
  for (const permission of data.permissions) {
    invariant(known.has(permission as Permission) && !permission.startsWith("ORG_") && permission !== "SERVER_EDIT", 400, "Token 权限无效");
    for (const serverId of data.serverIds) await requireServer(db, actor, serverId, permission as Permission);
  }
  invariant(data.permissions.includes("SERVER_READ"), 400, "Token 必须包含 SERVER_READ");
  const token = `mua_${randomBytes(32).toString("hex")}`;
  const record = await db.apiToken.create({ data: { accountId: actor.id, name: data.name, tokenHash: tokenDigest(token),
    permissions: [...new Set(data.permissions)], serverIds: [...new Set(data.serverIds)], expiresAt: new Date(Date.now() + data.expiresInDays * 86400000) }, select: tokenSelect });
  await audit(db, actor, "API_TOKEN_CREATE", "ApiToken", record.id, undefined, undefined, { serverIds: data.serverIds, permissions: data.permissions });
  return { ...record, token };
}
export async function revokeApiToken(db: Db, actor: Actor, id: string) {
  const record = await db.apiToken.findFirst({ where: { id, accountId: actor.id } });
  invariant(record && !actor.apiScope, 404, "Token 不存在");
  await db.apiToken.update({ where: { id }, data: { revokedAt: new Date() } });
  await audit(db, actor, "API_TOKEN_REVOKE", "ApiToken", id); return { ok: true };
}
