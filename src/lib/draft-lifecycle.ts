import "server-only";
import type { Db, Actor } from "./auth";
import { invariant } from "./errors";
import { audit } from "./management";
import { requireClient } from "./rbac";
import { compareClientVersions } from "./client-version";

export function assertNewerVersion(version: string, baseline: string | null | undefined) {
  if (!baseline) return;
  const order = compareClientVersions(version, baseline);
  invariant(version !== baseline && (order === null || order > 0), 409, `新版本必须高于基准版本 ${baseline}；回退请启用已有发布版本`);
}
export async function comparisonDraft(db: Db, clientId: string, draftId: string) {
  const draft = await db.clientDraft.findUnique({ where: { id: draftId }, include: { upload: true, release: true } });
  invariant(draft?.clientId === clientId, 404, "对比草稿不存在");
  invariant(!draft.archivedAt && draft.status !== "RELEASED" && !draft.release && draft.upload?.filesObjectKey && draft.upload.filesSha256,
    409, "请选择已完成解析、未发布且未归档的草稿");
  return draft;
}
async function cancelDraftBuilds(db: Db, draftId: string) {
  // READY artifacts stay immutable and readable from history; active leases are
  // invalidated so an in-flight worker cannot attach results after archival.
  await db.packageBuild.updateMany({ where: { draftId, status: { in: ["QUEUED", "PROCESSING", "PREPARED"] } },
    data: { status: "FAILED", phase: "草稿已归档 · 任务取消", error: "草稿已归档", attempts: 3, leaseToken: null, leaseUntil: null } });
}
export async function archiveUnpublishedDraft(db: Db, actor: Actor, clientId: string, draftId: string, revision: { contentRevision: number; packageRevision: number }) {
  const scope = await requireClient(db, actor, clientId, "DRAFT_ARCHIVE", true);
  const draft = await db.clientDraft.findUnique({ where: { id: draftId }, include: { release: true } });
  invariant(draft?.clientId === clientId, 404, "草稿不存在");
  invariant(draft.status !== "RELEASED" && !draft.release, 409, "已发布版本不能通过草稿归档操作撤回");
  invariant(draft.contentRevision === revision.contentRevision && draft.packageRevision === revision.packageRevision, 409, "草稿已改变，请刷新后重试");
  if (draft.archivedAt) return { ok: true };
  await cancelDraftBuilds(db, draft.id);
  await db.clientDraft.update({ where: { id: draft.id }, data: { archivedAt: new Date(), archiveReason: "MANUAL" } });
  await audit(db, actor, "DRAFT_ARCHIVE", "ClientDraft", draft.id, scope.client.organizationId, undefined, { versionLabel: draft.versionLabel });
  return { ok: true };
}
export async function archiveReplacedDrafts(db: Db, actor: Actor, clientId: string, organizationId: string, publishedDraftId: string) {
  const published = await db.clientDraft.findUniqueOrThrow({ where: { id: publishedDraftId } });
  let previousId = published.replacesDraftId; const visited = new Set([published.id]); const archived: string[] = [];
  while (previousId) {
    invariant(!visited.has(previousId) && visited.size < 1000, 409, "草稿替代关系无效"); visited.add(previousId);
    const previous = await db.clientDraft.findUnique({ where: { id: previousId }, include: { release: true } });
    invariant(previous?.clientId === clientId && previous.versionSequence < published.versionSequence, 409, "草稿替代关系跨客户端或顺序无效");
    if (previous.release || previous.status === "RELEASED") break;
    if (!previous.archivedAt) {
      await cancelDraftBuilds(db, previous.id);
      await db.clientDraft.update({ where: { id: previous.id }, data: { archivedAt: new Date(), archiveReason: "SUPERSEDED", supersededByDraftId: published.id } });
      await audit(db, actor, "DRAFT_SUPERSEDED", "ClientDraft", previous.id, organizationId, undefined, { publishedDraftId, versionLabel: previous.versionLabel });
      archived.push(previous.id);
    }
    previousId = previous.replacesDraftId;
  }
  return archived;
}
