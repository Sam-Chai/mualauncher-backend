import { diagnosticText } from "@/lib/diagnostics";
import "server-only";
import type { Db, Actor } from "./auth";
import { invariant } from "./errors";
import { audit } from "./management";
import { requireClient } from "./rbac";
import { compareClientVersions } from "./client-version";

export function assertNewerVersion(version: string, baseline: string | null | undefined) {
  if (!baseline) return;
  const order = compareClientVersions(version, baseline);
  invariant(version !== baseline && (order === null || order > 0), 409, diagnosticText("diagnostics.draftLifecycle.theNewVersionMustBeNewerThanBaseline0Activate", { arg0: baseline }));
}
export async function comparisonDraft(db: Db, clientId: string, draftId: string) {
  const draft = await db.clientDraft.findUnique({ where: { id: draftId }, include: { upload: true, release: true } });
  invariant(draft?.clientId === clientId, 404, diagnosticText("diagnostics.draftLifecycle.theComparisonDraftDoesNotExist"));
  invariant(!draft.archivedAt && draft.status !== "RELEASED" && !draft.release && draft.upload?.filesObjectKey && draft.upload.filesSha256,
    409, diagnosticText("diagnostics.draftLifecycle.selectAProcessedUnpublishedUnarchivedDraft"));
  return draft;
}
async function cancelDraftBuilds(db: Db, draftId: string) {
  // READY artifacts stay immutable and readable from history; active leases are
  // invalidated so an in-flight worker cannot attach results after archival.
  await db.packageBuild.updateMany({ where: { draftId, status: { in: ["QUEUED", "PROCESSING", "PREPARED"] } },
    data: { status: "FAILED", phase: diagnosticText("diagnostics.draftLifecycle.draftArchivedTaskCancelled"), error: diagnosticText("diagnostics.draftLifecycle.theDraftIsArchived"), attempts: 3, leaseToken: null, leaseUntil: null } });
}
export async function archiveUnpublishedDraft(db: Db, actor: Actor, clientId: string, draftId: string, revision: { contentRevision: number; packageRevision: number }) {
  const scope = await requireClient(db, actor, clientId, "DRAFT_ARCHIVE", true);
  const draft = await db.clientDraft.findUnique({ where: { id: draftId }, include: { release: true } });
  invariant(draft?.clientId === clientId, 404, diagnosticText("diagnostics.draftLifecycle.theDraftDoesNotExist"));
  invariant(draft.status !== "RELEASED" && !draft.release, 409, diagnosticText("diagnostics.draftLifecycle.aPublishedVersionCannotBeWithdrawnByArchivingItsDraft"));
  invariant(draft.contentRevision === revision.contentRevision && draft.packageRevision === revision.packageRevision, 409, diagnosticText("diagnostics.draftLifecycle.theDraftHasChangedRefreshAndRetry"));
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
    invariant(!visited.has(previousId) && visited.size < 1000, 409, diagnosticText("diagnostics.draftLifecycle.invalidDraftReplacementRelationship")); visited.add(previousId);
    const previous = await db.clientDraft.findUnique({ where: { id: previousId }, include: { release: true } });
    invariant(previous?.clientId === clientId && previous.versionSequence < published.versionSequence, 409, diagnosticText("diagnostics.draftLifecycle.draftReplacementsMustBelongToTheSameClientAndFollow"));
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
