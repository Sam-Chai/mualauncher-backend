import "server-only";
import type { Db, Actor } from "./auth";
import { invariant } from "./errors";
import { requireClient } from "./rbac";
import { readRecipeInventory } from "./pack-inventory";
import { readRecipeManifest } from "./muapack-v2-protocol";
import { recipeDraftTarget, recipeUpdateBase } from "./recipe-package-service";
import { readObject, digest } from "./storage";
import { recipeDistribution } from "./recipe-distribution-contract";
import { packageArtifactsSchema } from "./package-contract";
import type { RecipeManifest } from "./muapack-v2-contract";
import { releaseDetails } from "./database-security";

export async function recipeDistributionStats(db: Db, actor: Actor, kind: "uploads" | "drafts" | "releases", id: string, clientId?: string) {
  const permission = kind === "releases" ? "RELEASE_READ" : "DRAFT_READ";
  const upload = kind === "uploads" ? await db.clientUpload.findUnique({ where: { id } }) : null;
  if (kind === "uploads") invariant(upload, 404, "上传任务不存在");
  const owner = upload?.clientId ?? clientId!;
  const scope = await requireClient(db, actor, owner, permission, false);
  const draft = kind === "drafts" ? await db.clientDraft.findUnique({ where: { id } }) : null;
  const release = kind === "releases" ? await db.clientRelease.findUnique({ where: { id } }) : null;
  invariant(kind === "uploads" || (draft ?? release)?.clientId === owner, 404, "版本不存在");
  invariant((upload ?? draft ?? release)?.packageFormatVersion === 2, 409, "此统计仅适用于 muapack v2");
  let target: RecipeManifest | null = null;
  if (draft) target = await recipeDraftTarget(db, draft);
  if (release) {
    const bytes = await readObject(release.manifestObjectKey);
    invariant(digest(bytes) === release.manifestSha256, 422, "发布清单校验失败");
    target = readRecipeManifest(bytes);
    invariant(target.release.releaseId === release.id && target.release.clientId === owner && target.release.organizationId === scope.client.organizationId, 422, "发布清单身份不匹配");
  }
  const sourceUpload = upload ?? (draft ? await db.clientUpload.findUnique({ where: { draftId: id } }) : null);
  if (!target) invariant(sourceUpload?.filesObjectKey && sourceUpload.filesSha256, 409, "配方文件统计尚未准备完成");
  const inventory = target ? null : await readRecipeInventory(sourceUpload!.filesObjectKey!, sourceUpload!.filesSha256!);
  const files = target?.files ?? inventory!.files;
  const details = release ? await releaseDetails(db, release.id) : null;
  const build = release ? details?.packageBuilds.find(build => build.platform === "universal" && build.required && build.revision === details.packageRevision && build.status === "READY")
    : draft ? await db.packageBuild.findFirst({ where: { draftId: id, platform: "universal", required: true, revision: draft.packageRevision } }) : null;
  const artifacts = build?.status === "READY" ? packageArtifactsSchema.safeParse(build.artifacts) : null;
  const packages = artifacts?.success ? artifacts.data : null;
  // READY records fix the actual selected baseline. Before packaging use the upload's fixed base.
  const baseId = packages ? packages.update?.baseReleaseId ?? null : sourceUpload?.baseReleaseId ?? null;
  let base: { target: RecipeManifest; release: { id: string; versionLabel: string; manifestSha256: string } } | null = null;
  if (baseId) {
    if (target && !packages) base = await recipeUpdateBase(db, target, baseId);
    else {
      const record = await db.clientRelease.findUnique({ where: { id: baseId } });
      invariant(record?.clientId === owner, 422, "v2 更新基准不属于当前客户端");
      if (record.packageFormatVersion === 2 && (packages || !record.archivedAt)) {
        const bytes = await readObject(record.manifestObjectKey); invariant(digest(bytes) === record.manifestSha256, 422, "v2 更新基准清单摘要不匹配");
        const manifest = readRecipeManifest(bytes);
        invariant(manifest.release.clientId === owner && manifest.release.organizationId === scope.client.organizationId && manifest.release.releaseId === record.id, 422, "v2 更新基准身份不一致");
        base = { target: manifest, release: record };
      }
    }
  }
  if (packages?.update) invariant(base && packages.update.baseManifestSha256 === base.release.manifestSha256, 422, "v2 更新包基准摘要不一致");
  const result = recipeDistribution(files, base ? { files: base.target.files, reference: { releaseId: base.release.id, version: base.release.versionLabel, manifestSha256: base.release.manifestSha256 } } : null,
    { full: packages?.full.size ?? null, update: packages?.update?.size ?? null });
  if (target && base) { result.runtimeChanged = JSON.stringify(target.runtime) !== JSON.stringify(base.target.runtime); result.launchChanged = JSON.stringify(target.launch) !== JSON.stringify(base.target.launch); }
  return result;
}
