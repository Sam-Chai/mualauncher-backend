import "server-only";
import { z } from "zod";
import type { Db, Actor } from "./auth";
import { requireClient } from "./rbac";
import { invariant } from "./errors";
import { audit } from "./management";
import { defaultMuaPlatforms, muaPlatformSchema } from "./muapack-contract";
import { readMuaPlatformManifest } from "./muapack-protocol";
import { encodeMuaJson } from "./muapack-protocol";
import { packageSelectionSchema, packageArtifactsSchema } from "./package-contract";
import { packagesBucket, readObject, digest, signedDownload } from "./storage";
import { storedHead } from "./package-storage";
import { recipeDraftTarget, recipeReleaseTarget } from "./recipe-package-service";
import { releaseDetails } from "./database-security";

export async function queuePackageBuilds(db: Db, draftId: string, platforms = defaultMuaPlatforms()) {
  const draft = await db.clientDraft.findUnique({ where: { id: draftId } });
  invariant(draft, 404, "草稿不存在");
  await db.packageBuild.createMany({ data: draft.packageFormatVersion === 2 ? [{ draftId, platform: "universal", revision: draft.packageRevision, phase: "等待 v2 配方准备" }] : platforms.map(platform => ({ draftId, platform })) });
}
export async function configurePackages(db: Db, actor: Actor, clientId: string, draftId: string, raw: unknown) {
  const data = packageSelectionSchema.safeParse(raw); invariant(data.success, 400, "请至少选择一个有效平台");
  const scope = await requireClient(db, actor, clientId, "DRAFT_CREATE", true);
  await requireClient(db, actor, clientId, "DRAFT_SUBMIT", true);
  const draft = await db.clientDraft.findUnique({ where: { id: draftId }, include: { packageBuilds: true, upload: true } });
  invariant(draft?.clientId === clientId && draft.upload && ["SUBMITTED", "APPROVED"].includes(draft.status) && !draft.archivedAt, 409, "此版本不能调整平台");
  if (draft.upload.baseReleaseId) await requireClient(db, actor, clientId, "DRAFT_EDIT", true);
  invariant(draft.packageFormatVersion === 1, 409, "v2 使用通用配方包，不支持选择组包架构");
  const selected = draft.packageBuilds.filter(build => build.required).map(build => build.platform).sort();
  if (JSON.stringify(selected) === JSON.stringify([...data.data.platforms].sort())) return { ok: true };
  await db.clientDraft.update({ where: { id: draftId }, data: { status: "SUBMITTED", packageRevision: { increment: 1 }, reviewedById: null, reviewedRevision: null, reviewedPackageRevision: null, reviewedAt: null, reviewNote: null } });
  for (const build of draft.packageBuilds) {
    const required = data.data.platforms.includes(build.platform as z.infer<typeof packageSelectionSchema>["platforms"][number]);
    if (build.required !== required) await db.packageBuild.update({ where: { id: build.id }, data: { required,
      ...(!required && build.status === "PROCESSING" ? { status: "FAILED", phase: "已取消此平台", error: "发布平台已取消", leaseToken: null, leaseUntil: null } : {}),
      ...(required && build.status === "FAILED" ? { status: "QUEUED", phase: "等待环境准备", error: null, attempts: 0, progress: 0, leaseToken: null, leaseUntil: null } : {}) } });
  }
  const existing = new Set(draft.packageBuilds.map(build => build.platform));
  await db.packageBuild.createMany({ data: data.data.platforms.filter(platform => !existing.has(platform)).map(platform => ({ draftId, platform })) });
  await audit(db, actor, "PACKAGE_PLATFORMS_SET", "ClientDraft", draftId, scope.client.organizationId, undefined, { platforms: data.data.platforms, packageRevision: draft.packageRevision + 1 });
  return { ok: true };
}
export async function retryPackages(db: Db, actor: Actor, clientId: string, draftId: string) {
  const scope = await requireClient(db, actor, clientId, "DRAFT_CREATE", true);
  await requireClient(db, actor, clientId, "DRAFT_SUBMIT", true);
  const draft = await db.clientDraft.findUnique({ where: { id: draftId }, include: { upload: true } });
  invariant(draft?.clientId === clientId && draft.upload && !draft.archivedAt && ["SUBMITTED", "APPROVED"].includes(draft.status), 409, "此版本不能重新组包");
  if (draft.upload.baseReleaseId) await requireClient(db, actor, clientId, "DRAFT_EDIT", true);
  await db.packageBuild.updateMany({ where: { draftId, required: true, status: "FAILED" }, data: { status: "QUEUED", phase: "等待重试", progress: 0, attempts: 0, leaseToken: null, leaseUntil: null, error: null } });
  await audit(db, actor, "PACKAGE_RETRY", "ClientDraft", draftId, scope.client.organizationId); return { ok: true };
}
export async function assertPackagesReady(db: Db, draftId: string) {
  const draft = await db.clientDraft.findUniqueOrThrow({ where: { id: draftId } });
  const builds = await db.packageBuild.findMany({ where: { draftId, required: true } });
  invariant(builds.length > 0 && builds.every(build => build.status === "READY"), 409, "必需的 .muapack 尚未全部生成，请查看组包进度");
  if (draft.packageFormatVersion === 2) { invariant(builds.length === 1, 409, "v2 必须使用单一跨平台配方包"); await recipeReleaseTarget(db, draft); }
  for (const build of builds) {
    const parsed = packageArtifactsSchema.safeParse(build.artifacts); invariant(parsed.success && build.targetObjectKey && build.targetSha256, 409, "组包产物不完整");
    const bytes = await readObject(build.targetObjectKey); invariant(digest(bytes) === build.targetSha256, 422, "平台清单校验失败");
    for (const artifact of [parsed.data.full, parsed.data.update].filter(value => value !== null)) {
      const found = await storedHead(packagesBucket(), artifact.key);
      invariant(found?.ContentLength === artifact.size && found.Metadata?.sha256 === artifact.sha256, 422, "组包产物缺失或校验失败，不能发布");
    }
  }
}
export async function draftPlatformManifest(db: Db, actor: Actor, clientId: string, draftId: string, platformInput: string | null) {
  await requireClient(db, actor, clientId, "DRAFT_READ", false);
  const draft = await db.clientDraft.findUnique({ where: { id: draftId } }); invariant(draft?.clientId === clientId, 404, "草稿不存在");
  if (draft.packageFormatVersion === 2) {
    invariant(!draft.supportedPlatforms.length || platformInput === null || platformInput === "universal" || draft.supportedPlatforms.includes(platformInput), 400, "此 v2 配方不支持该平台");
    const build = await db.packageBuild.findUnique({ where: { draftId_platform_revision: { draftId, platform: "universal", revision: draft.packageRevision } } });
    invariant(build?.required && build.targetObjectKey && build.targetSha256, 404, "v2 清单尚未准备完成");
    const bytes = await readObject(build.targetObjectKey); invariant(digest(bytes) === build.targetSha256, 422, "v2 清单摘要不匹配");
    const target = await recipeDraftTarget(db, draft); invariant(encodeMuaJson(target).equals(bytes), 422, "v2 清单与当前方案不一致"); return target;
  }
  const platform = muaPlatformSchema.safeParse(platformInput); invariant(platform.success, 400, "平台参数无效");
  const build = await db.packageBuild.findUnique({ where: { draftId_platform_revision: { draftId, platform: platform.data, revision: 1 } }, include: { draft: true } });
  invariant(build?.draft.clientId === clientId && build.required && build.targetObjectKey && build.targetSha256, 404, "平台清单尚未准备完成");
  const bytes = await readObject(build.targetObjectKey); invariant(digest(bytes) === build.targetSha256, 422, "平台清单校验失败");
  return readMuaPlatformManifest(bytes);
}

export async function managementFullPackage(db: Db, actor: Actor, clientId: string, kind: "drafts" | "releases", versionId: string, platformInput: string | null) {
  await requireClient(db, actor, clientId, kind === "drafts" ? "DRAFT_READ" : "RELEASE_READ", false);
  const version = kind === "drafts" ? await db.clientDraft.findUnique({ where: { id: versionId } }) : await db.clientRelease.findUnique({ where: { id: versionId } });
  invariant(version?.clientId === clientId, 404, "客户端版本不存在");
  const draftId = "sourceDraftId" in version ? version.sourceDraftId : version.id;
  const published = kind === "releases" ? await releaseDetails(db, versionId) : null;
  const draft = kind === "drafts" ? await db.clientDraft.findUniqueOrThrow({ where: { id: draftId } }) : published;
  invariant(draft, 404, "版本组包信息不存在");
  const parsedPlatform = muaPlatformSchema.safeParse(platformInput);
  invariant(version.packageFormatVersion === 2 ? !draft.supportedPlatforms.length || platformInput === null || platformInput === "universal" || draft.supportedPlatforms.includes(platformInput) : parsedPlatform.success, 400, "平台参数无效");
  const platform = version.packageFormatVersion === 2 ? "universal" : parsedPlatform.data!;
  const revision = version.packageFormatVersion === 2 ? draft.packageRevision : 1;
  const build = kind === "releases" ? published?.packageBuilds.find(build => build.platform === platform && build.revision === revision) : await db.packageBuild.findUnique({ where: { draftId_platform_revision: { draftId, platform, revision } } });
  invariant(build?.required, 404, "此版本未选择该平台");
  const artifacts = packageArtifactsSchema.safeParse(build.artifacts);
  invariant(build.status === "READY" && artifacts.success, 409, "该平台的完整 .muapack 尚未生成完毕");
  const full = artifacts.data.full; const head = await storedHead(packagesBucket(), full.key);
  invariant(head?.ContentLength === full.size && head.Metadata?.sha256 === full.sha256, 422, "完整包缺失或校验失败");
  const fileName = `${version.name}-${version.versionLabel}-${platform}`.normalize("NFKC").replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, "_").slice(0, 180) + ".muapack";
  return { packageType: "full" as const, packageFormatVersion: version.packageFormatVersion, platform, versionLabel: version.versionLabel, fileName,
    sha256: full.sha256, size: full.size, expiresIn: 300, url: await signedDownload(full.key, packagesBucket(), fileName) };
}
