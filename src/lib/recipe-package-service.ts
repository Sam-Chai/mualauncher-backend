import "server-only";
import type { Db } from "./auth";
import { invariant } from "./errors";
import { readObject, digest } from "./storage";
import { encodeMuaJson } from "./muapack-protocol";
import { recipeTarget, readRecipeManifest } from "./muapack-v2-protocol";
import type { ClientDraft } from "@/generated/prisma/client";
import type { RecipeManifest } from "./muapack-v2-contract";
import { packageArtifactsSchema } from "./package-contract";

/** A sealed, published v2 baseline; never infer it from an unpublished draft or version label. */
export async function recipeUpdateBase(db: Db, target: RecipeManifest, releaseId: string | null) {
  if (!releaseId) return null;
  const release = await db.clientRelease.findUnique({ where: { id: releaseId } });
  invariant(release?.clientId === target.release.clientId, 422, "v2 更新基准不属于当前客户端");
  if (release.packageFormatVersion !== 2 || release.archivedAt) return null;
  const bytes = await readObject(release.manifestObjectKey);
  invariant(digest(bytes) === release.manifestSha256, 422, "v2 更新基准清单摘要不匹配");
  const base = readRecipeManifest(bytes);
  invariant(base.release.organizationId === target.release.organizationId && base.release.clientId === release.clientId &&
    base.release.releaseId === release.id && base.release.version === release.versionLabel, 422, "v2 更新基准身份不一致");
  return { release, bytes, target: base };
}
export async function recipeDraftTarget(db: Db, draft: ClientDraft) {
  invariant(draft.packageFormatVersion === 2 && draft.candidateManifestKey && draft.candidateManifestSha256, 409, "v2 草稿缺少配方内容");
  const content = await readObject(draft.candidateManifestKey); invariant(digest(content) === draft.candidateManifestSha256, 422, "v2 草稿配方摘要不匹配");
  const target = recipeTarget(content);
  const client = await db.client.findUniqueOrThrow({ where: { id: draft.clientId } });
  invariant(target.release.releaseId === draft.id && target.release.clientId === draft.clientId && target.release.organizationId === client.organizationId &&
    target.release.version === draft.versionLabel && target.release.name === draft.name && target.release.contentRevision === draft.contentRevision, 422, "v2 配方与草稿身份不匹配");
  return target;
}
export async function recipeReleaseTarget(db: Db, draft: ClientDraft) {
  const build = await db.packageBuild.findUnique({ where: { draftId_platform_revision: { draftId: draft.id, platform: "universal", revision: draft.packageRevision } } });
  invariant(build?.required && build.status === "READY" && build.targetObjectKey && build.targetSha256, 409, "v2 完整包尚未生成");
  const bytes = await readObject(build.targetObjectKey); invariant(digest(bytes) === build.targetSha256, 422, "v2 目标清单摘要不匹配");
  const target = readRecipeManifest(bytes), expected = await recipeDraftTarget(db, draft);
  invariant(encodeMuaJson(expected).equals(bytes), 422, "v2 产物不是当前审核的平台和内容");
  const artifacts = packageArtifactsSchema.parse(build.artifacts);
  if (artifacts.update) {
    const upload = await db.clientUpload.findUniqueOrThrow({ where: { draftId: draft.id } });
    invariant(artifacts.update.baseReleaseId === upload.baseReleaseId, 422, "v2 更新包不是上传时固定的发布基准");
    const base = await recipeUpdateBase(db, target, upload.baseReleaseId);
    invariant(base && artifacts.update.baseManifestSha256 === base.release.manifestSha256, 422, "v2 更新包基准摘要不一致");
  }
  return { build, bytes, target };
}
