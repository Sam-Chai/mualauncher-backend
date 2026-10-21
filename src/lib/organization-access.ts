import "server-only";
import type { Actor, Db } from "./auth";
import { securityFunction } from "./database-security";
import { invariant } from "./errors";
import { audit } from "./management";
import { superOnly } from "./rbac";
import { accessDecisionInput, accessRequestInput, accessRevokeInput, unionSiteInput } from "./union-contract";

export async function saveUnionSite(db: Db, actor: Actor, raw: unknown) {
  superOnly(actor); const parsed = unionSiteInput.safeParse(raw); invariant(parsed.success, 400, "皮肤站映射参数无效"); const data = parsed.data;
  const org = await db.organization.findUnique({ where: { id: data.organizationId } }); invariant(org && !org.archivedAt, 409, "组织不存在或已归档");
  const old = await db.unionSkinSite.findUnique({ where: { code: data.code } });
  invariant((old?.revision ?? 0) === data.revision, 409, "皮肤站映射已改变，请刷新后重试");
  invariant(!old || old.organizationId === data.organizationId, 409, "已有皮肤站映射不能直接转移组织");
  const saved = await db.unionSkinSite.upsert({ where: { code: data.code }, create: { ...data, revision: 1 }, update: { bsRoot: data.bsRoot, ...(old?.bsRoot !== data.bsRoot ? { bsRootAliases: [] } : {}), enabled: data.enabled, managedBySync: false, revision: { increment: 1 } } });
  await audit(db, actor, "UNION_SITE_SET", "UnionSkinSite", data.code, data.organizationId, undefined, { enabled: data.enabled, revision: saved.revision });
  return {code:saved.code,organizationId:saved.organizationId,bsRoot:saved.bsRoot,enabled:saved.enabled,revision:saved.revision,updatedAt:saved.updatedAt};
}
export async function accessCandidates(db: Db, source: string, target: string | null) {
  const rows = await db.$queryRaw<{ value: unknown }[]>`SELECT ${securityFunction("access_candidates")}(${source}::uuid,${target}::uuid) AS value`; return rows[0].value;
}
export async function submitAccess(db: Db, raw: unknown) {
  const parsed = accessRequestInput.safeParse(raw); invariant(parsed.success, 400, "访问申请参数无效"); const d = parsed.data;
  const rows = await db.$queryRaw<{ id: string }[]>`SELECT ${securityFunction("access_submit")}(${d.sourceOrganizationId}::uuid,${d.targetOrganizationId}::uuid,${d.accountId}::uuid,${d.serverIds}::text[],${d.autoIncludeNewServers},${d.reason}) AS id`; return { id: rows[0].id };
}
export async function decideAccess(db: Db, id: string, raw: unknown) {
  const parsed = accessDecisionInput.safeParse(raw); invariant(parsed.success, 400, "审批参数无效"); const d = parsed.data;
  await db.$executeRaw`SELECT ${securityFunction("access_decide")}(${id}::uuid,${d.revision},${d.decision},${d.note})`; return { ok: true };
}
export async function revokeAccess(db: Db, id: string, raw: unknown) {
  const parsed = accessRevokeInput.safeParse(raw); invariant(parsed.success, 400, "撤销参数无效");
  await db.$executeRaw`SELECT ${securityFunction("access_revoke")}(${id}::uuid,${parsed.data.reason})`; return { ok: true };
}
export async function accessState(db: Db) {
  const rows = await db.$queryRaw<{ value: { requests: AccessRequestRow[]; grants: AccessGrantRow[] } }[]>`SELECT ${securityFunction("access_state")}() AS value`;
  return rows[0].value;
}
export type AccessRequestRow = { id: string; sourceOrganizationId: string; targetOrganizationId: string; accountId: string; sourceName: string; targetName: string; memberName: string; serverIds: string[]; autoIncludeNewServers: boolean; reason: string; status: string; revision: number; note: string };
export type AccessGrantRow = { id: string; sourceOrganizationId: string; targetOrganizationId: string; accountId: string; memberName: string; sourceName: string; targetName: string; serverIds: string[]; autoIncludeNewServers: boolean; approvedAt: string; revokedAt: string | null };
