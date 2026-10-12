import "server-only";
import type { Db } from "./auth";
import { AppError, invariant } from "./errors";
import { readObject, casBucket, casKey, signedDownload, signedDownloadInfo } from "./storage";
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
  if (value === null) return [1];
  invariant(/^(?:1|2)(?:,(?:1|2))?$/.test(value) && new Set(value.split(",")).size === value.split(",").length, 400, "acceptedFormatVersions 必须为 1、2 或 1,2");
  return value.split(",").map(Number);
}
export async function publicManifest(db: Db, serverId: string, acceptedFormats: string | null = null, releaseId: string | null = null) {
  const accepted = acceptedPackageFormats(acceptedFormats);
  if (releaseId !== null) uuid(releaseId);
  const server = await db.server.findFirst({ where: { serverId, isListed: true, archivedAt: null,
    organization: { archivedAt: null }, publication: { client: { archivedAt: null, deletedAt: null }, release: { archivedAt: null } } },
    include: { publication: { include: { release: true } } } });
  const current = server?.publication?.release; invariant(current, 404, "此服务器没有可分发的客户端");
  const release = releaseId === null || releaseId === current.id ? current : await db.clientRelease.findUnique({ where: { id: releaseId } });
  invariant(release && release.clientId === current.clientId && !release.archivedAt, 404, "此发布版本已下架或不属于服务器当前绑定的客户端");
  invariant(accepted.includes(release.packageFormatVersion), 415, `当前客户端需要 muapack v${release.packageFormatVersion}，请使用支持该协议的 Launcher`);
  const bytes = await checkedManifestBytes(release.manifestObjectKey, release.manifestSha256);
  if (release.packageFormatVersion === 2) {
    const manifest = publishedDocument(() => readRecipeManifest(bytes));
    invariant(manifest.release.organizationId === server!.organizationId && manifest.release.clientId === release.clientId && manifest.release.releaseId === release.id && manifest.release.version === release.versionLabel, 503, "v2 发布清单与服务器绑定不一致");
    return { bytes, release };
  }
  const manifest = publishedDocument(() => JSON.parse(bytes.toString("utf8")) as ReleaseManifest);
  invariant(manifest && manifest.version === release.versionLabel && manifest.organizationId === server!.organizationId &&
    (manifest.schemaVersion === 2 ? manifest.clientId === release.clientId : manifest.schemaVersion === 1 && manifest.serverId === serverId),
    503, "发布清单与服务器绑定不一致");
  return { bytes, release };
}
export async function publicFile(db: Db, serverId: string, sha256: string) {
  invariant(/^[0-9a-f]{64}$/.test(sha256), 404, "文件不存在");
  const { bytes } = await publicManifest(db, serverId); const manifest = JSON.parse(bytes.toString("utf8")) as ReleaseManifest;
  invariant(manifest.files.some(file => file.sha256 === sha256), 404, "文件不属于当前发布版本");
  return { url: await signedDownload(casKey(sha256), casBucket()), expiresIn: 300 };
}
/** Same resolver for latest discovery and fixed-release URL renewal. Never accept an OSS key from the caller. */
export async function publicPackage(db: Db, serverId: string, platformInput: string | null, baseReleaseId: string | null, acceptedFormats: string | null = null, baseManifestSha256: string | null = null, releaseId: string | null = null, packageSha256: string | null = null) {
  const platform = muaPlatformSchema.safeParse(platformInput);
  invariant(platformInput === null || platformInput === "universal" || platform.success, 400, "platform 无效");
  if (baseReleaseId !== null) uuid(baseReleaseId);
  invariant(baseManifestSha256 === null || !!baseReleaseId && /^[a-f0-9]{64}$/.test(baseManifestSha256), 400, "基准清单摘要无效或缺少基准发布 ID");
  invariant(packageSha256 === null || /^[a-f0-9]{64}$/.test(packageSha256), 400, "下载包摘要无效");
  const { release, bytes } = await publicManifest(db, serverId, acceptedFormats, releaseId);
  if (release.packageFormatVersion === 2) {
    const target = publishedDocument(() => readRecipeManifest(bytes));
    invariant(!platform.success || target.supportedPlatforms.includes(platform.data), 404, "当前 v2 发布不支持此平台");
    const draft = await db.clientDraft.findUniqueOrThrow({ where: { id: release.sourceDraftId } });
    const build = await db.packageBuild.findUnique({ where: { draftId_platform_revision: { draftId: draft.id, platform: "universal", revision: draft.packageRevision } } });
    invariant(build?.required && build.status === "READY" && build.targetSha256 === release.manifestSha256 && build.targetObjectKey === release.manifestObjectKey, 404, "v2 完整包尚未提供");
    const artifacts = publishedDocument(() => packageArtifactsSchema.parse(build.artifacts)), full = artifacts.full;
    let update = artifacts.update?.baseReleaseId === baseReleaseId ? artifacts.update : null;
    if (update) {
      const upload = await db.clientUpload.findUnique({ where: { draftId: draft.id } });
      invariant(upload?.baseReleaseId === update.baseReleaseId, 503, "v2 更新包基准与发布来源不一致");
      const base = await recipeUpdateBase(db, target, update.baseReleaseId).catch(() => { throw new AppError(503, "v2 更新基准校验失败"); });
      if (!base) update = null;
      else {
        invariant(update.baseManifestSha256 === base.release.manifestSha256, 503, "v2 更新包基准摘要不一致");
        const covered = platform.success ? base.target.supportedPlatforms.includes(platform.data) : target.supportedPlatforms.every(value => base.target.supportedPlatforms.includes(value));
        if (!covered || baseManifestSha256 !== null && baseManifestSha256 !== base.release.manifestSha256) update = null;
      }
    }
    const download = await packageLinks(serverId, release.id, 2, platform.success ? platform.data : null, full, update, update?.baseManifestSha256 ?? null, packageSha256);
    return { format: "muapack", formatVersion: 2, minimumLauncherProtocol: 2, releaseId: release.id, version: release.versionLabel,
      platform: platform.success ? platform.data : "universal", supportedPlatforms: target.supportedPlatforms, runtime: target.runtime,
      ...download, targetManifestSha256: release.manifestSha256, signingKeyId: artifacts.signingKeyId,
      mods: target.files.filter(file => /^mods\/.+\.jar$/i.test(file.path)).map(file => ({ path: file.path, name: null, version: null, optional: file.optional, source: file.source.type, hashes: file.hashes })),
    };
  }
  invariant(platform.success, 400, "v1 请提供有效 platform");
  const build = await db.packageBuild.findUnique({ where: { draftId_platform_revision: { draftId: release.sourceDraftId, platform: platform.data, revision: 1 } } });
  invariant(build?.required && build.status === "READY" && build.targetSha256 && build.targetObjectKey, 404, "当前发布未提供此平台的 muapack");
  const targetBytes = await checkedManifestBytes(build.targetObjectKey, build.targetSha256);
  const target = publishedDocument(() => readMuaPlatformManifest(targetBytes));
  const legacy = publishedDocument(() => JSON.parse(bytes.toString("utf8")) as ReleaseManifest);
  invariant(target.release.releaseId === release.id && target.release.clientId === release.clientId && target.release.organizationId === legacy.organizationId && target.release.version === release.versionLabel && target.platform === platform.data, 503, "平台清单与当前发布不一致");
  const artifacts = publishedDocument(() => packageArtifactsSchema.parse(build.artifacts));
  let update = artifacts.update?.baseReleaseId === baseReleaseId ? artifacts.update : null;
  if (update) {
    const upload = await db.clientUpload.findUnique({ where: { draftId: release.sourceDraftId } });
    invariant(upload?.baseReleaseId === update.baseReleaseId, 503, "v1 更新包基准与发布来源不一致");
    const baseRelease = await db.clientRelease.findUnique({ where: { id: update.baseReleaseId } });
    invariant(baseRelease?.clientId === release.clientId, 503, "v1 更新基准不属于当前客户端");
    if (baseRelease.packageFormatVersion !== 1 || baseRelease.archivedAt) update = null;
    else {
      const base = await db.packageBuild.findUnique({ where: { draftId_platform_revision: { draftId: baseRelease.sourceDraftId, platform: platform.data, revision: 1 } } });
      invariant(base?.required && base.status === "READY" && base.targetObjectKey && base.targetSha256, 503, "v1 更新基准平台清单缺失");
      const baseBytes = await checkedManifestBytes(base.targetObjectKey, base.targetSha256);
      const manifest = publishedDocument(() => readMuaPlatformManifest(baseBytes));
      invariant(manifest.release.organizationId === target.release.organizationId && manifest.release.clientId === release.clientId && manifest.release.releaseId === baseRelease.id && manifest.release.version === baseRelease.versionLabel && manifest.platform === platform.data, 503, "v1 更新基准身份不一致");
      // Old READY records omitted this digest. Derive it from sealed bytes without editing their records or signatures.
      invariant(update.baseManifestSha256 === undefined || update.baseManifestSha256 === base.targetSha256, 503, "v1 更新包基准摘要不一致");
      update = baseManifestSha256 !== null && baseManifestSha256 !== base.targetSha256 ? null : { ...update, baseManifestSha256: base.targetSha256 };
    }
  }
  const download = await packageLinks(serverId, release.id, 1, platform.data, artifacts.full, update, update?.baseManifestSha256 ?? null, packageSha256);
  return { format: "muapack", formatVersion: 1, releaseId: release.id, version: release.versionLabel, platform: platform.data,
    ...download, targetManifestSha256: build.targetSha256, signingKeyId: artifacts.signingKeyId,
    mods: target.mods.map(mod => ({ ...mod, optional: mod.optional ?? false })) };
}

async function packageLinks(serverId: string, releaseId: string, format: number, platform: string | null, full: PackageArtifacts["full"], update: PackageArtifacts["update"], baseManifestSha256: string | null, expectedSha256: string | null) {
  const selected = update ?? full;
  invariant(expectedSha256 === null || expectedSha256 === selected.sha256, 409, "固定下载包已不可提供，请重新选择完整包，不能续传到其他文件");
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
  const found = await storedHead(packagesBucket(), artifact.key).catch(() => { throw new AppError(503, "无法校验分发产物"); });
  invariant(found?.ContentLength === artifact.size && found.Metadata?.sha256 === artifact.sha256, 503, "分发产物缺失或校验失败");
  return found;
}

async function checkedManifestBytes(key: string, sha256: string) {
  const bytes = await readObject(key).catch(() => { throw new AppError(503, "已发布清单缺失或不可读取"); });
  invariant(muaDigest(bytes) === sha256, 503, "已发布清单摘要不匹配");
  return bytes;
}
function publishedDocument<T>(read: () => T): T {
  try { return read(); } catch { throw new AppError(503, "已发布清单或产物记录无效"); }
}
