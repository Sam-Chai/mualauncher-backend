import { diagnosticText } from "@/lib/diagnostics";
import "server-only";
import type { Db } from "./auth";
import { AppError, invariant } from "./errors";
import { readObject, signedDownloadInfo } from "./storage";
import type { ReleaseManifest } from "./client-contract";
import { muaPlatformSchema } from "./muapack-contract";
import { packageArtifactsSchema, type PackageArtifacts } from "./package-contract";
import { readMuaPlatformManifest, muaDigest } from "./muapack-protocol";
import { readRecipeManifest } from "./muapack-v2-protocol";
import { recipeUpdateBase } from "./recipe-package-service";
import { storedHead } from "./package-storage";
import { packagesBucket } from "./storage";
import { uuid } from "./input";
export function acceptedPackageFormats(value: string | null): number[] {
  invariant(value !== null, 400, diagnosticText("diagnostics.clientDownload.acceptedformatversionsIsRequired"));
  invariant(/^(?:1|2)(?:,(?:1|2))?$/.test(value) && new Set(value.split(",")).size === value.split(",").length, 400, diagnosticText("diagnostics.clientDownload.acceptedformatversionsMustBe12Or12"));
  return value.split(",").map(Number);
}
export async function publicManifest(db: Db, serverId: string, acceptedFormats: string | null = null, releaseId: string | null = null) {
  const accepted = acceptedPackageFormats(acceptedFormats);
  if (releaseId !== null) uuid(releaseId);
  const server = await db.server.findFirst({ where: { serverId, isListed: true, archivedAt: null,
    organization: { archivedAt: null }, publication: { client: { archivedAt: null, deletedAt: null }, release: { archivedAt: null } } },
    include: { publication: { include: { release: true } } } });
  const current = server?.publication?.release; invariant(current, 404, diagnosticText("diagnostics.clientDownload.thisServerHasNoDistributableClient"));
  const release = releaseId === null || releaseId === current.id ? current : await db.clientRelease.findUnique({ where: { id: releaseId } });
  invariant(release && release.clientId === current.clientId && !release.archivedAt, 404, diagnosticText("diagnostics.clientDownload.thisReleaseIsUnavailableOrDoesNotBelongToThe"));
  invariant(accepted.includes(release.packageFormatVersion), 415, diagnosticText("diagnostics.clientDownload.thisClientRequiresMuapackV0UseALauncherThat", { arg0: release.packageFormatVersion }));
  const bytes = await checkedManifestBytes(release.manifestObjectKey, release.manifestSha256);
  if (release.packageFormatVersion === 2) {
    const manifest = publishedDocument(() => readRecipeManifest(bytes));
    invariant(manifest.release.organizationId === server!.organizationId && manifest.release.clientId === release.clientId && manifest.release.releaseId === release.id && manifest.release.version === release.versionLabel, 503, diagnosticText("diagnostics.clientDownload.theV2ReleaseManifestDoesNotMatchTheServerBinding"));
    return { bytes, release };
  }
  const manifest = publishedDocument(() => JSON.parse(bytes.toString("utf8")) as ReleaseManifest);
  invariant(manifest && manifest.version === release.versionLabel && manifest.organizationId === server!.organizationId &&
    manifest.schemaVersion === 2 && manifest.clientId === release.clientId,
    503, diagnosticText("diagnostics.clientDownload.theReleaseManifestDoesNotMatchTheServerBinding"));
  return { bytes, release };
}
/** Same resolver for latest discovery and fixed-release URL renewal. Never accept an OSS key from the caller. */
export async function publicPackage(db: Db, serverId: string, platformInput: string | null, baseReleaseId: string | null, acceptedFormats: string | null = null, baseManifestSha256: string | null = null, releaseId: string | null = null, packageSha256: string | null = null) {
  const platform = muaPlatformSchema.safeParse(platformInput);
  if (baseReleaseId !== null) uuid(baseReleaseId);
  invariant(baseManifestSha256 === null || !!baseReleaseId && /^[a-f0-9]{64}$/.test(baseManifestSha256), 400, diagnosticText("diagnostics.clientDownload.invalidBaselineManifestDigestOrMissingBaselineReleaseId"));
  invariant(packageSha256 === null || /^[a-f0-9]{64}$/.test(packageSha256), 400, diagnosticText("diagnostics.clientDownload.invalidPackageDigest"));
  const { release, bytes } = await publicManifest(db, serverId, acceptedFormats, releaseId);
  if (release.packageFormatVersion === 2) {
    const target = publishedDocument(() => readRecipeManifest(bytes));
    const draft = await db.clientDraft.findUniqueOrThrow({ where: { id: release.sourceDraftId } });
    const build = await db.packageBuild.findUnique({ where: { draftId_platform_revision: { draftId: draft.id, platform: "universal", revision: draft.packageRevision } } });
    invariant(build?.required && build.status === "READY" && build.targetSha256 === release.manifestSha256 && build.targetObjectKey === release.manifestObjectKey, 404, diagnosticText("diagnostics.clientDownload.theV2FullPackageIsNotAvailable"));
    const artifacts = publishedDocument(() => packageArtifactsSchema.parse(build.artifacts)), full = artifacts.full;
    let update = artifacts.update?.baseReleaseId === baseReleaseId ? artifacts.update : null;
    if (update) {
      const upload = await db.clientUpload.findUnique({ where: { draftId: draft.id } });
      invariant(upload?.baseReleaseId === update.baseReleaseId, 503, diagnosticText("diagnostics.clientDownload.theV2UpdateBaselineDoesNotMatchTheReleaseSource"));
      const base = await recipeUpdateBase(db, target, update.baseReleaseId).catch(() => { throw new AppError(503, diagnosticText("diagnostics.clientDownload.theV2UpdateBaselineFailedValidation")); });
      if (!base) update = null;
      else {
        invariant(update.baseManifestSha256 === base.release.manifestSha256, 503, diagnosticText("diagnostics.clientDownload.theV2UpdateBaselineDigestDoesNotMatch"));
        if (baseManifestSha256 !== null && baseManifestSha256 !== base.release.manifestSha256) update = null;
      }
    }
    const download = await packageLinks(serverId, release.id, 2, null, full, update, update?.baseManifestSha256 ?? null, packageSha256);
    return { format: "muapack", formatVersion: 2, minimumLauncherProtocol: 2, releaseId: release.id, version: release.versionLabel,
      protocolRevision: target.protocolRevision, runtime: target.runtime,
      ...download, targetManifestSha256: release.manifestSha256, signingKeyId: artifacts.signingKeyId,
      mods: target.files.filter(file => /^mods\/.+\.jar$/i.test(file.path)).map(file => ({ path: file.path, name: null, version: null, optional: file.optional, source: file.source.type, hashes: file.hashes })),
    };
  }
  invariant(platform.success, 400, diagnosticText("diagnostics.clientDownload.aValidPlatformIsRequiredForV1"));
  const build = await db.packageBuild.findUnique({ where: { draftId_platform_revision: { draftId: release.sourceDraftId, platform: platform.data, revision: 1 } } });
  invariant(build?.required && build.status === "READY" && build.targetSha256 && build.targetObjectKey, 404, diagnosticText("diagnostics.clientDownload.theCurrentReleaseHasNoMuapackForThisPlatform"));
  const targetBytes = await checkedManifestBytes(build.targetObjectKey, build.targetSha256);
  const target = publishedDocument(() => readMuaPlatformManifest(targetBytes));
  const manifest = publishedDocument(() => JSON.parse(bytes.toString("utf8")) as ReleaseManifest);
  invariant(target.release.releaseId === release.id && target.release.clientId === release.clientId && target.release.organizationId === manifest.organizationId && target.release.version === release.versionLabel && target.platform === platform.data, 503, diagnosticText("diagnostics.clientDownload.thePlatformManifestDoesNotMatchTheCurrentRelease"));
  const artifacts = publishedDocument(() => packageArtifactsSchema.parse(build.artifacts));
  let update = artifacts.update?.baseReleaseId === baseReleaseId ? artifacts.update : null;
  if (update) {
    const upload = await db.clientUpload.findUnique({ where: { draftId: release.sourceDraftId } });
    invariant(upload?.baseReleaseId === update.baseReleaseId, 503, diagnosticText("diagnostics.clientDownload.theV1UpdateBaselineDoesNotMatchTheReleaseSource"));
    const baseRelease = await db.clientRelease.findUnique({ where: { id: update.baseReleaseId } });
    invariant(baseRelease?.clientId === release.clientId, 503, diagnosticText("diagnostics.clientDownload.theV1UpdateBaselineDoesNotBelongToThisClient"));
    if (baseRelease.packageFormatVersion !== 1 || baseRelease.archivedAt) update = null;
    else {
      const base = await db.packageBuild.findUnique({ where: { draftId_platform_revision: { draftId: baseRelease.sourceDraftId, platform: platform.data, revision: 1 } } });
      invariant(base?.required && base.status === "READY" && base.targetObjectKey && base.targetSha256, 503, diagnosticText("diagnostics.clientDownload.theV1BaselinePlatformManifestIsMissing"));
      const baseBytes = await checkedManifestBytes(base.targetObjectKey, base.targetSha256);
      const manifest = publishedDocument(() => readMuaPlatformManifest(baseBytes));
      invariant(manifest.release.organizationId === target.release.organizationId && manifest.release.clientId === release.clientId && manifest.release.releaseId === baseRelease.id && manifest.release.version === baseRelease.versionLabel && manifest.platform === platform.data, 503, diagnosticText("diagnostics.clientDownload.theV1UpdateBaselineIdentityDoesNotMatch"));
      invariant(update.baseManifestSha256 === base.targetSha256, 503, diagnosticText("diagnostics.clientDownload.theV1UpdateBaselineDigestDoesNotMatch"));
      update = baseManifestSha256 !== null && baseManifestSha256 !== base.targetSha256 ? null : update;
    }
  }
  const download = await packageLinks(serverId, release.id, 1, platform.data, artifacts.full, update, update?.baseManifestSha256 ?? null, packageSha256);
  return { format: "muapack", formatVersion: 1, releaseId: release.id, version: release.versionLabel, platform: platform.data,
    ...download, targetManifestSha256: build.targetSha256, signingKeyId: artifacts.signingKeyId,
    mods: target.mods.map(mod => ({ ...mod, optional: mod.optional ?? false })) };
}

async function packageLinks(serverId: string, releaseId: string, format: number, platform: string | null, full: PackageArtifacts["full"], update: PackageArtifacts["update"], baseManifestSha256: string | null, expectedSha256: string | null) {
  const selected = update ?? full;
  invariant(expectedSha256 === null || expectedSha256 === selected.sha256, 409, diagnosticText("diagnostics.clientDownload.thisFixedPackageIsUnavailableSelectAFullPackageAgain"));
  const head = await checkedArtifact(full);
  const selectedHead = update ? await checkedArtifact(update) : head;
  function refreshUrl(artifact: PackageArtifacts["full"], baseId: string | null, baseSha: string | null) {
    const query = new URLSearchParams({ acceptedFormatVersions: String(format), packageSha256: artifact.sha256 });
    if (platform) query.set("platform", platform);
    if (baseId) query.set("baseReleaseId", baseId);
    if (baseSha) query.set("baseManifestSha256", baseSha);
    return `/api/v1/servers/${encodeURIComponent(serverId)}/releases/${releaseId}/packages?${query}`;
  }
  const fullLink = { sha256: full.sha256, size: full.size, etag: head.ETag ?? null, ...await signedDownloadInfo(full.key), refreshUrl: refreshUrl(full, null, null) };
  return { packageType: update ? "update" : "full", baseReleaseId: update?.baseReleaseId ?? null, baseManifestSha256,
    sha256: selected.sha256, size: selected.size, etag: selectedHead.ETag ?? null,
    ...(update ? await signedDownloadInfo(update.key) : { url: fullLink.url, expiresIn: fullLink.expiresIn, expiresAt: fullLink.expiresAt }),
    refreshUrl: refreshUrl(selected, update?.baseReleaseId ?? null, baseManifestSha256), full: fullLink };
}

async function checkedArtifact(artifact: PackageArtifacts["full"]) {
  const found = await storedHead(packagesBucket(), artifact.key).catch(() => { throw new AppError(503, diagnosticText("diagnostics.clientDownload.unableToValidateDistributionArtifacts")); });
  invariant(found?.ContentLength === artifact.size && found.Metadata?.sha256 === artifact.sha256, 503, diagnosticText("diagnostics.clientDownload.distributionArtifactsAreMissingOrFailedValidation"));
  return found;
}

async function checkedManifestBytes(key: string, sha256: string) {
  const bytes = await readObject(key).catch(() => { throw new AppError(503, diagnosticText("diagnostics.clientDownload.thePublishedManifestIsMissingOrUnreadable")); });
  invariant(muaDigest(bytes) === sha256, 503, diagnosticText("diagnostics.clientDownload.thePublishedManifestDigestDoesNotMatch"));
  return bytes;
}
function publishedDocument<T>(read: () => T): T {
  try { return read(); } catch { throw new AppError(503, diagnosticText("diagnostics.clientDownload.invalidPublishedManifestOrArtifactRecord")); }
}
