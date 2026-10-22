import { diagnosticText } from "@/lib/diagnostics";
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
  invariant(release?.clientId === target.release.clientId, 422, diagnosticText("diagnostics.recipeDistribution.theV2UpdateBaselineDoesNotBelongToThisClient"));
  if (release.packageFormatVersion !== 2 || release.archivedAt) return null;
  const bytes = await readObject(release.manifestObjectKey);
  invariant(digest(bytes) === release.manifestSha256, 422, diagnosticText("diagnostics.recipeDistribution.theV2UpdateBaselineManifestDigestDoesNotMatch"));
  const base = readRecipeManifest(bytes);
  invariant(base.release.organizationId === target.release.organizationId && base.release.clientId === release.clientId &&
    base.release.releaseId === release.id && base.release.version === release.versionLabel, 422, diagnosticText("diagnostics.recipeDistribution.theV2UpdateBaselineIdentityDoesNotMatch"));
  return { release, bytes, target: base };
}
export async function recipeDraftTarget(db: Db, draft: ClientDraft) {
  invariant(draft.packageFormatVersion === 2 && draft.candidateManifestKey && draft.candidateManifestSha256, 409, diagnosticText("diagnostics.recipePackageService.theV2DraftHasNoRecipeContent"));
  const content = await readObject(draft.candidateManifestKey); invariant(digest(content) === draft.candidateManifestSha256, 422, diagnosticText("diagnostics.recipePackageService.theV2DraftRecipeDigestDoesNotMatch"));
  const target = recipeTarget(content);
  const client = await db.client.findUniqueOrThrow({ where: { id: draft.clientId } });
  invariant(target.release.releaseId === draft.id && target.release.clientId === draft.clientId && target.release.organizationId === client.organizationId &&
    target.release.version === draft.versionLabel && target.release.name === draft.name && target.release.contentRevision === draft.contentRevision, 422, diagnosticText("diagnostics.recipePackageService.theV2RecipeDoesNotMatchTheDraftIdentity"));
  return target;
}
export async function recipeReleaseTarget(db: Db, draft: ClientDraft) {
  const build = await db.packageBuild.findUnique({ where: { draftId_platform_revision: { draftId: draft.id, platform: "universal", revision: draft.packageRevision } } });
  invariant(build?.required && build.status === "READY" && build.targetObjectKey && build.targetSha256, 409, diagnosticText("diagnostics.recipePackageService.theV2FullPackageHasNotBeenGenerated"));
  const bytes = await readObject(build.targetObjectKey); invariant(digest(bytes) === build.targetSha256, 422, diagnosticText("diagnostics.recipePackageService.theV2TargetManifestDigestDoesNotMatch"));
  const target = readRecipeManifest(bytes), expected = await recipeDraftTarget(db, draft);
  invariant(encodeMuaJson(expected).equals(bytes), 422, diagnosticText("diagnostics.recipePackageService.theV2ArtifactsDoNotMatchTheApprovedPlatformsAnd"));
  const artifacts = packageArtifactsSchema.parse(build.artifacts);
  if (artifacts.update) {
    const upload = await db.clientUpload.findUniqueOrThrow({ where: { draftId: draft.id } });
    invariant(artifacts.update.baseReleaseId === upload.baseReleaseId, 422, diagnosticText("diagnostics.recipePackageService.theV2UpdatePackageDoesNotUseTheReleaseBaseline"));
    const base = await recipeUpdateBase(db, target, upload.baseReleaseId);
    invariant(base && artifacts.update.baseManifestSha256 === base.release.manifestSha256, 422, diagnosticText("diagnostics.clientDownload.theV2UpdateBaselineDigestDoesNotMatch"));
  }
  return { build, bytes, target };
}
