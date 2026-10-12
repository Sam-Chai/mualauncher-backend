import "server-only";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import type { Db, Actor } from "./auth";
import { AppError, invariant } from "./errors";
import { requireClient, clientScope, requireServer, requireOrganization } from "./rbac";
import { audit, getState, archiveResource } from "./management";
import { beginMultipart, signPart, completeMultipart, abortMultipart, readObject, putJson, digest } from "./storage";
import { signManifest } from "./signing";
import { clientMetadataSchema, clientSubmissionSchema, packageFormatVersionSchema, type ClientInspection, type UploadPhase, type ClientMetadata, type ReleaseManifest, type UploadView, type UpdateStatistics } from "./client-contract";
import { readInventory, readRecipeInventory } from "./pack-inventory";
export { readInventory } from "./pack-inventory";
import { comparisonDraft, assertNewerVersion, archiveReplacedDrafts, archiveUnpublishedDraft } from "./draft-lifecycle";
import { orderClientVersions } from "./client-version";
import { queuePackageBuilds, assertPackagesReady } from "./package-build-service";
import type { RecipeImportStatistics } from "./recipe-inventory";
import { packageArtifactsSchema } from "./package-contract";
import { recipeDraftTarget, recipeReleaseTarget } from "./recipe-package-service";
import { recipeContentSchema, type RecipeContent } from "./muapack-v2-contract";
import { encodeMuaJson } from "./muapack-protocol";
import { putImmutableBytes } from "./package-storage";
import { packagesBucket } from "./storage";
import { enabledPackageFormats } from "./package-format-settings";
import { clientSummary, securityFunction, uploadOptions, releaseDetails } from "./database-security";
import { maxUploadSizeMb } from "./upload-size-settings";
import { UPLOAD_MB, MAX_UPLOAD_SIZE_MB } from "./upload-size-policy";

export const PART_SIZE = 64 * 1024 * 1024;
const uploadInput = z.object({ clientId: z.string().min(1).max(100), fileName: z.string().min(1).max(255).regex(/\.(zip|mrpack)$/i),
  size: z.number().int().positive().max(MAX_UPLOAD_SIZE_MB * UPLOAD_MB), baseReleaseId: z.string().uuid().nullable(), basePublicationRevision: z.number().int().nonnegative(),
  comparisonDraftId: z.string().uuid().nullable().optional(), packageFormatVersion: packageFormatVersionSchema.default(1) }).strict();
function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw); invariant(result.success, 400, result.success ? "" : result.error.issues[0]?.message ?? "参数无效"); return result.data;
}
export function uploadView(upload: Awaited<ReturnType<typeof findUpload>>): UploadView {
  return { id: upload.id, clientId: upload.clientId, fileName: upload.fileName, size: Number(upload.size), partSize: upload.partSize,
    packageFormatVersion: packageFormatVersionSchema.parse(upload.packageFormatVersion),
    status: upload.status, progress: upload.progress, error: upload.error, draftId: upload.draftId,
    statistics: upload.packageFormatVersion === 1 ? upload.statistics as UpdateStatistics | null : null,
    recipeStatistics: upload.packageFormatVersion === 2 ? upload.statistics as RecipeImportStatistics | null : null, detectedMods: upload.detectedMods, warnings: upload.warnings,
    comparisonDraftId: upload.comparisonDraftId, comparisonStatistics: upload.comparisonStatistics as UpdateStatistics | null,
    processingPhase: upload.processingPhase as UploadPhase | null, detectedInfo: upload.detectedInfo as ClientInspection | null, selectedInstanceId: upload.selectedInstanceId,
    baseReleaseId: upload.baseReleaseId, basePublicationRevision: upload.basePublicationRevision, createdAt: upload.createdAt.toISOString() };
}
export async function findUpload(db: Db, actor: Actor, id: string, edit = false) {
  const upload = await db.clientUpload.findUnique({ where: { id } }); invariant(upload, 404, "上传任务不存在");
  await requireClient(db, actor, upload.clientId, edit ? "DRAFT_CREATE" : "DRAFT_READ", edit);
  if (edit) {
    invariant(actor.isSuperAdmin || upload.createdById === actor.id, 403, "此上传任务属于其他账号，请新建上传任务");
    if (upload.baseReleaseId) await requireClient(db, actor, upload.clientId, "DRAFT_EDIT", true);
  }
  return upload;
}
function assertBaseline(upload: { baseReleaseId: string | null; basePublicationRevision: number }, publication: { releaseId: string | null; revision: number } | null) {
  invariant(upload.baseReleaseId === (publication?.releaseId ?? null) && upload.basePublicationRevision === (publication?.revision ?? 0), 409,
    "当前客户端版本已改变，请刷新并基于最新版本重新上传；旧版本仍保留");
}
export async function createUpload(db: Db, actor: Actor, raw: unknown) {
  const data = parse(uploadInput, raw);
  const scope = await requireClient(db, actor, data.clientId, "DRAFT_CREATE", true);
  const format = data.packageFormatVersion ?? 1;
  invariant((await enabledPackageFormats(db)).includes(format), 409, `muapack v${format} 当前未开放新上传，请选择开放的格式`);
  const limit = await maxUploadSizeMb(db);
  invariant(data.size <= limit * UPLOAD_MB, 413, `上传文件超过允许的最大大小（${limit} MB）`);
  assertBaseline(data, ({ releaseId: scope.client.currentReleaseId, revision: scope.client.revision }));
  if (data.baseReleaseId) await requireClient(db, actor, data.clientId, "DRAFT_EDIT", true);
  if (data.comparisonDraftId) {
    await requireClient(db, actor, data.clientId, "DRAFT_ARCHIVE", true);
    await comparisonDraft(db, data.clientId, data.comparisonDraftId);
  }
  invariant(await db.clientUpload.count({ where: { createdById: actor.id,
    client: { archivedAt: null, organization: { archivedAt: null } },
    OR: [{ status: "UPLOADING", expiresAt: { gt: new Date() } }, { status: { in: ["WAITING_PROCESSOR", "QUEUED", "PROCESSING", "READY"] } }] } }) < 20,
  429, "请先完成已有上传任务（最多 20 个）");
  const id = randomUUID(); const key = `uploads/${id}/source.zip`; const multipartId = await beginMultipart(key);
  const upload = await db.clientUpload.create({ data: { id, clientId: data.clientId, createdById: actor.id, fileName: data.fileName, size: BigInt(data.size),
    packageFormatVersion: data.packageFormatVersion,
    partSize: PART_SIZE, multipartId, sourceObjectKey: key, baseReleaseId: data.baseReleaseId, basePublicationRevision: data.basePublicationRevision,
    comparisonDraftId: data.comparisonDraftId ?? null, expiresAt: new Date(Date.now() + 86400000) } });
  await audit(db, actor, "CLIENT_UPLOAD_CREATE", "ClientUpload", id, scope.client.organizationId, undefined, { size: data.size, fileName: data.fileName, comparisonDraftId: data.comparisonDraftId ?? null, packageFormatVersion: data.packageFormatVersion });
  return uploadView(upload);
}
export async function uploadPartUrl(db: Db, actor: Actor, id: string, raw: unknown) {
  const { partNumber } = parse(z.object({ partNumber: z.number().int().min(1).max(320) }).strict(), raw);
  const upload = await findUpload(db, actor, id, true);
  invariant(upload.status === "UPLOADING" && upload.expiresAt > new Date(), 409, "上传会话已关闭或过期");
  invariant(partNumber <= Math.ceil(Number(upload.size) / upload.partSize), 400, "分片编号无效");
  return { url: await signPart(upload.sourceObjectKey, upload.multipartId, partNumber), expiresIn: 600 };
}
export async function prepareCompletion(db: Db, actor: Actor, id: string, raw: unknown) {
  const { parts } = parse(z.object({ parts: z.array(z.object({ partNumber: z.number().int().positive(), etag: z.string().min(1).max(200) }).strict()).min(1).max(320) }).strict(), raw);
  const upload = await findUpload(db, actor, id, true);
  if (upload.status !== "UPLOADING") {
    invariant(["WAITING_PROCESSOR", "QUEUED", "PROCESSING", "READY", "SUBMITTED"].includes(upload.status), 409, "上传任务不能完成"); return { upload, parts, alreadyCompleted: true };
  }
  invariant(upload.expiresAt > new Date(), 409, "上传会话已过期，请重新上传");
  return { upload, parts, alreadyCompleted: false };
}
export async function transferCompletion(prepared: Awaited<ReturnType<typeof prepareCompletion>>) {
  if (prepared.alreadyCompleted) return;
  const { upload, parts } = prepared;
  await completeMultipart(upload.sourceObjectKey, upload.multipartId, Number(upload.size), upload.partSize, parts);
}
export async function queueCompletedUpload(db: Db, actor: Actor, id: string) {
  const upload = await findUpload(db, actor, id, true);
  if (upload.status !== "UPLOADING") {
    invariant(["WAITING_PROCESSOR", "QUEUED", "PROCESSING", "READY", "SUBMITTED"].includes(upload.status), 409, "上传任务已关闭"); return uploadView(upload);
  }
  return uploadView(await db.clientUpload.update({ where: { id }, data: { status: "QUEUED" } }));
}
export async function cancelUpload(db: Db, actor: Actor, id: string) {
  const upload = await findUpload(db, actor, id, true);
  invariant(["UPLOADING", "WAITING_PROCESSOR", "QUEUED", "READY", "FAILED"].includes(upload.status), 409, "正在处理或已提交的任务不能取消");
  if (upload.status === "UPLOADING") await abortMultipart(upload.sourceObjectKey, upload.multipartId);
  return uploadView(await db.clientUpload.update({ where: { id }, data: { status: "CANCELLED" } }));
}
export async function retryUpload(db: Db, actor: Actor, id: string) {
  const upload = await findUpload(db, actor, id, true); invariant(upload.status === "FAILED", 409, "只有失败的任务可以重试");
  return uploadView(await db.clientUpload.update({ where: { id }, data: { status: "QUEUED", attempts: 0, error: null, progress: 0, leaseToken: null, leaseUntil: null,
    processingPhase: null, detectedInfo: Prisma.JsonNull, detectedMods: [], warnings: [] } }));
}
export async function selectUploadInstance(db: Db, actor: Actor, id: string, raw: unknown) {
  const { instanceId } = parse(z.object({ instanceId: z.string().min(1).max(100) }).strict(), raw);
  const upload = await findUpload(db, actor, id, true);
  invariant(upload.status === "QUEUED" && upload.processingPhase === "SELECT_INSTANCE", 409, "当前任务不在等待实例选择状态");
  const info = upload.detectedInfo as ClientInspection | null;
  invariant(info?.requiresSelection && info.candidates.some(candidate => candidate.instanceId === instanceId), 400, "请选择整合包内的有效实例");
  const scope = await requireClient(db, actor, upload.clientId, "DRAFT_CREATE", true);
  assertBaseline(upload, { releaseId: scope.client.currentReleaseId, revision: scope.client.revision });
  await audit(db, actor, "CLIENT_UPLOAD_SELECT_INSTANCE", "ClientUpload", id, scope.client.organizationId, undefined, { instanceId });
  return uploadView(await db.clientUpload.update({ where: { id }, data: { selectedInstanceId: instanceId, processingPhase: null,
    detectedInfo: Prisma.JsonNull, detectedMods: [], warnings: [], attempts: 0, progress: 0 } }));
}
export async function submitUpload(db: Db, actor: Actor, id: string, raw: unknown) {
  const submitted = parse(clientSubmissionSchema, raw); const upload = await findUpload(db, actor, id, true);
  const { platforms, modDetails: _untrustedModDetails, ...submittedMetadata } = submitted;
  void _untrustedModDetails;
  const info = upload.detectedInfo as ClientInspection | null;
  const metadata: ClientMetadata = parse(clientMetadataSchema, { ...submittedMetadata, mods: upload.detectedMods,
    ...(info?.importFiles ? { modDetails: info.importFiles.filter(file => /^mods\/.+\.jar$/i.test(file.path)).map(file => ({ path: file.path, optional: file.optional })) } : {}),
    minecraftVersion: submitted.minecraftVersion ?? info?.minecraftVersion ?? "", javaVersion: submitted.javaVersion ?? info?.javaVersion ?? 0 });
  const scope = await requireClient(db, actor, upload.clientId, "DRAFT_SUBMIT", true);
  const rename = normalizeName(metadata.name) !== scope.client.nameKey;
  if (rename) {
    invariant(!upload.baseReleaseId && !upload.draftId && await db.clientRelease.count({ where: { clientId: upload.clientId } }) === 0 &&
      await db.clientDraft.count({ where: { clientId: upload.clientId } }) === 0 &&
      await db.clientUpload.count({ where: { clientId: upload.clientId, id: { not: upload.id }, status: { in: ["UPLOADING", "WAITING_PROCESSOR", "QUEUED", "PROCESSING", "READY", "SUBMITTED"] } } }) === 0,
    409, "已有版本或其他上传的客户端不能改名；更新必须使用原客户端名称");
    invariant(!await db.client.findFirst({ where: { organizationId: scope.client.organizationId, nameKey: normalizeName(metadata.name), deletedAt: null, id: { not: upload.clientId } } }),
      409, "客户端名称已存在，请使用该客户端的“更新”功能提交新版本");
  } else metadata.name = scope.client.name;
  if (upload.draftId) {
    const existing = await db.clientDraft.findUnique({ where: { id: upload.draftId } });
    invariant(existing?.candidateMetadata && isDeepStrictEqual(existing.candidateMetadata, metadata), 409, "此上传已提交，修改内容需要上传新版本");
    return { draftId: upload.draftId };
  }
  invariant(upload.status === "READY" && upload.filesObjectKey && upload.filesSha256 && upload.sourceSha256, 409, "请等待整合包解析成功");
  assertBaseline(upload, ({ releaseId: scope.client.currentReleaseId, revision: scope.client.revision }));
  const base = upload.baseReleaseId ? await db.clientRelease.findUnique({ where: { id: upload.baseReleaseId } }) : null;
  assertNewerVersion(metadata.versionLabel, base?.versionLabel);
  if (upload.comparisonDraftId) {
    await requireClient(db, actor, upload.clientId, "DRAFT_ARCHIVE", true);
    const previous = await comparisonDraft(db, upload.clientId, upload.comparisonDraftId);
    assertNewerVersion(metadata.versionLabel, previous.versionLabel);
  }
  invariant(!await db.clientRelease.findFirst({ where: { clientId: upload.clientId, versionLabel: metadata.versionLabel } }), 409, "此版本号已发布，归档版本号也不能重复使用");
  invariant(!await db.clientDraft.findFirst({ where: { clientId: upload.clientId, versionLabel: metadata.versionLabel, archivedAt: null, status: { in: ["DRAFT", "SUBMITTED", "APPROVED"] } } }), 409, "此版本号已有待处理记录");
  const draftId = randomUUID(); let manifest: ReleaseManifest | RecipeContent;
  if (upload.packageFormatVersion === 2) {
    const inventory = await readRecipeInventory(upload.filesObjectKey, upload.filesSha256);
    const settings = await uploadOptions(db);
    manifest = recipeContentSchema.parse({ format: "mua-recipe-content", formatVersion: 2,
      release: { organizationId: scope.client.organizationId, clientId: upload.clientId, releaseId: draftId, version: metadata.versionLabel,
        name: metadata.name, summary: metadata.summary, description: metadata.description, sourceSha256: upload.sourceSha256, contentRevision: 1 },
      runtime: { minecraft: metadata.minecraftVersion, loader: inventory.runtime.loader, java: { major: metadata.javaVersion, vendor: "adoptium", imageType: settings?.javaImageType ?? "jre" }, resolverVersion: "mua-runtime-resolver-1" },
      launch: { jvmArgs: [], gameArgs: [], memory: { mode: "auto", minimumMiB: 2048, recommendedMiB: 4096 }, preLaunch: [] }, files: inventory.files });
  } else {
    const inventory = await readInventory(upload.filesObjectKey, upload.filesSha256);
    manifest = { schemaVersion: 2, format: "mua-client-manifest", clientId: upload.clientId, organizationId: scope.client.organizationId,
    version: metadata.versionLabel, name: metadata.name, runtime: { minecraft: metadata.minecraftVersion, java: metadata.javaVersion },
    mods: metadata.mods, summary: metadata.summary, description: metadata.description, sourceSha256: upload.sourceSha256,
    files: inventory.files, update: upload.statistics as UpdateStatistics };
    if (metadata.modDetails) manifest.modDetails = metadata.modDetails;
  }
  if (rename) {
    await db.client.update({ where: { id: upload.clientId }, data: { name: metadata.name, nameKey: normalizeName(metadata.name) } });
    await audit(db, actor, "CLIENT_NAME_CONFIRM", "Client", upload.clientId, scope.client.organizationId, undefined, { previousName: scope.client.name, name: metadata.name });
  }
  const manifestKey = `manifests/${upload.clientId}/${draftId}.json`;
  const sha256 = upload.packageFormatVersion === 2 ? await putImmutableBytes(packagesBucket(), manifestKey, encodeMuaJson(manifest)) : (await putJson(manifestKey, manifest)).sha256;
  await db.clientDraft.create({ data: { id: draftId, clientId: upload.clientId, versionLabel: metadata.versionLabel, name: metadata.name,
    packageFormatVersion: upload.packageFormatVersion,
    summary: metadata.summary, description: metadata.description, changelog: metadata.summary, candidateMetadata: metadata,
    sourceObjectKey: upload.sourceObjectKey, candidateManifestKey: manifestKey, candidateManifestSha256: sha256,
    replacesDraftId: upload.comparisonDraftId, status: "SUBMITTED", createdById: actor.id } });
  await db.clientUpload.update({ where: { id }, data: { status: "SUBMITTED", draftId } });
  await queuePackageBuilds(db, draftId, platforms);
  await audit(db, actor, "CLIENT_SUBMIT", "ClientDraft", draftId, scope.client.organizationId, undefined, { versionLabel: metadata.versionLabel, uploadId: id, manifestSha256: sha256 });
  return { draftId };
}
export async function reviewClient(db: Db, actor: Actor, clientId: string, draftId: string, raw: unknown) {
  const data = parse(z.object({ decision: z.enum(["approve", "reject"]), note: z.string().max(5000), contentRevision: z.number().int().positive(), packageRevision: z.number().int().positive().default(1) }).strict(), raw);
  const scope = await requireClient(db, actor, clientId, "DRAFT_REVIEW", true);
  invariant(data.decision !== "reject" || data.note.trim().length > 0, 400, "驳回时请填写审核说明");
  const draft = await db.clientDraft.findUnique({ where: { id: draftId }, include: { upload: true } });
  invariant(draft?.clientId === clientId && draft.upload, 404, "上传版本不存在");
  invariant(draft.status === "SUBMITTED" && !draft.archivedAt && draft.contentRevision === data.contentRevision, 409, "此版本已审核或修订已改变");
  invariant(draft.packageRevision === data.packageRevision, 409, "发布平台已改变，请刷新并重新审核");
  assertBaseline(draft.upload, ({ releaseId: scope.client.currentReleaseId, revision: scope.client.revision }));
  invariant(draft.candidateManifestKey && draft.candidateManifestSha256, 409, "版本缺少 Manifest");
  const bytes = await readObject(draft.candidateManifestKey); invariant(digest(bytes) === draft.candidateManifestSha256, 422, "待审核 Manifest 校验失败");
  if (draft.packageFormatVersion === 2) await recipeDraftTarget(db, draft);
  await db.clientDraft.update({ where: { id: draftId }, data: { status: data.decision === "approve" ? "APPROVED" : "REJECTED",
    reviewedById: actor.id, reviewedRevision: draft.contentRevision, reviewedPackageRevision: draft.packageRevision, reviewedAt: new Date(), reviewNote: data.note } });
  await audit(db, actor, data.decision === "approve" ? "CLIENT_APPROVE" : "CLIENT_REJECT", "ClientDraft", draftId, scope.client.organizationId, undefined, { contentRevision: draft.contentRevision, packageRevision: draft.packageRevision, note: data.note });
  return { ok: true };
}
export async function publishClient(db: Db, actor: Actor, clientId: string, draftId: string, raw: unknown) {
  const { activate, replacesDraftId, contentRevision, packageRevision } = parse(z.object({ activate: z.boolean(),
    replacesDraftId: z.string().uuid().nullable().optional(), contentRevision: z.number().int().positive().optional(), packageRevision: z.number().int().positive().optional() }).strict(), raw);
  const scope = await requireClient(db, actor, clientId, "RELEASE_PUBLISH", true);
  if (activate) await requireClient(db, actor, clientId, "RELEASE_ACTIVATE", true);
  const draft = await db.clientDraft.findUnique({ where: { id: draftId }, include: { upload: true, release: true } });
  invariant(draft?.clientId === clientId && draft.upload, 404, "上传版本不存在");
  if (draft.release) return { releaseId: draft.release.id, versionLabel: draft.release.versionLabel };
  invariant((contentRevision === undefined || contentRevision === draft.contentRevision) && (packageRevision === undefined || packageRevision === draft.packageRevision), 409, "草稿修订已改变，请刷新后发布");
  invariant(draft.status === "APPROVED" && !draft.archivedAt && draft.reviewedRevision === draft.contentRevision && draft.reviewedById &&
    draft.candidateManifestKey && draft.candidateManifestSha256 && draft.name && draft.versionLabel && draft.candidateMetadata, 409, "此版本尚未审核通过");
  invariant(draft.reviewedPackageRevision === draft.packageRevision, 409, "发布平台尚未审核通过");
  assertBaseline(draft.upload, ({ releaseId: scope.client.currentReleaseId, revision: scope.client.revision }));
  let bytes = await readObject(draft.candidateManifestKey); invariant(digest(bytes) === draft.candidateManifestSha256, 422, "Manifest 摘要不匹配，不能发布");
  await assertPackagesReady(db, draftId);
  let manifestObjectKey = draft.candidateManifestKey, manifestSha256 = draft.candidateManifestSha256;
  const recipe = draft.packageFormatVersion === 2 ? await recipeReleaseTarget(db, draft) : null;
  if (recipe) { bytes = recipe.bytes; manifestObjectKey = recipe.build.targetObjectKey!; manifestSha256 = recipe.build.targetSha256!; }
  if (replacesDraftId !== undefined && replacesDraftId !== draft.replacesDraftId) {
    await requireClient(db, actor, clientId, "DRAFT_ARCHIVE", true);
    invariant(contentRevision === draft.contentRevision && packageRevision === draft.packageRevision, 409, "调整替代关系时必须提交当前草稿修订");
    if (replacesDraftId) {
      const previous = await comparisonDraft(db, clientId, replacesDraftId);
      invariant(previous.versionSequence < draft.versionSequence, 409, "只能替代更早提交的未发布版本");
      assertNewerVersion(draft.versionLabel, previous.versionLabel);
    }
    await db.clientDraft.update({ where: { id: draft.id }, data: { replacesDraftId } });
    await audit(db, actor, "DRAFT_REPLACEMENT_SET", "ClientDraft", draft.id, scope.client.organizationId, undefined, { replacesDraftId });
  }
  const signed = await signManifest(bytes);
  if (recipe) invariant(packageArtifactsSchema.parse(recipe.build.artifacts).signingKeyId === signed.keyId, 409, "v2 组包与当前签名密钥不一致，请使用新版本重新签名");
  const release = await db.clientRelease.create({ data: { id: draftId, clientId, sourceDraftId: draftId, versionLabel: draft.versionLabel, name: draft.name,
    packageFormatVersion: draft.packageFormatVersion,
    summary: draft.summary, description: draft.description, changelog: draft.changelog, environmentSnapshot: draft.candidateMetadata as Prisma.InputJsonObject,
    manifestObjectKey, manifestSha256,
    signingKeyId: signed.keyId, signature: signed.signature, approvedById: draft.reviewedById, publishedById: actor.id } });
  await db.clientDraft.update({ where: { id: draftId }, data: { status: "RELEASED" } });
  if (activate) await setCurrentRelease(db, actor, clientId, release.id);
  const archivedDraftIds = await archiveReplacedDrafts(db, actor, clientId, scope.client.organizationId, draft.id);
  await audit(db, actor, "CLIENT_PUBLISH", "ClientRelease", release.id, scope.client.organizationId, undefined, { versionLabel: release.versionLabel, previousReleaseId: draft.upload.baseReleaseId });
  return { releaseId: release.id, versionLabel: release.versionLabel, activated: activate, archivedDraftIds };
}
export async function archiveClientDraft(db: Db, actor: Actor, clientId: string, draftId: string, raw: unknown) {
  const revision = parse(z.object({ contentRevision: z.number().int().positive(), packageRevision: z.number().int().positive() }).strict(), raw);
  return archiveUnpublishedDraft(db, actor, clientId, draftId, revision);
}
export async function activateClient(db: Db, actor: Actor, clientId: string, releaseId: string, raw: unknown) {
  const { publicationRevision } = parse(z.object({ publicationRevision: z.number().int().nonnegative() }).strict(), raw);
  const scope = await requireClient(db, actor, clientId, "RELEASE_ACTIVATE", true);
  const release = await db.clientRelease.findUnique({ where: { id: releaseId } });
  invariant(release?.clientId === clientId && !release.archivedAt, 404, "可用发布版本不存在");
  invariant(({ releaseId: scope.client.currentReleaseId, revision: scope.client.revision })?.revision === publicationRevision, 409, "当前绑定已改变，请刷新后重试");
  await setCurrentRelease(db, actor, clientId, releaseId);
  await audit(db, actor, "CLIENT_ACTIVATE", "ClientRelease", releaseId, scope.client.organizationId, undefined);
  return { ok: true };
}
export async function clientList(db: Db, actor: Actor) {
  const state = await getState(db, actor); const rows = [];
  const records = await db.client.findMany({ where: { deletedAt: null, organizationId: { in: state.organizations.map(org => org.id) } }, orderBy: { createdAt: "desc" },
    include: { _count: { select: { uploads: { where: { status: "PROCESSING" } } } } } });
  for (const client of records) {
    let scope;
    try { scope = await clientScope(db, actor, client.id); } catch (error) { if (error instanceof AppError && error.status === 404) continue; throw error; }
    if (!scope.permissions.includes("DRAFT_READ") && !scope.permissions.includes("RELEASE_READ")) continue;
    const drafts = scope.permissions.includes("DRAFT_READ") ? await db.clientDraft.findMany({ where: { clientId: client.id }, orderBy: { createdAt: "desc" },
      select: { id: true, packageFormatVersion: true, supportedPlatforms: true, versionLabel: true, versionSequence: true, replacesDraftId: true, archiveReason: true, supersededByDraftId: true, name: true, description: true, changelog: true, summary: true, candidateMetadata: true, reviewNote: true, status: true, contentRevision: true, packageRevision: true, archivedAt: true, createdAt: true, upload: { select: { id: true, statistics: true, comparisonStatistics: true } }, packageBuilds: { where: { required: true }, orderBy: { platform: "asc" }, select: { platform: true, status: true, phase: true, progress: true, error: true, artifacts: true } } } }) : [];
    const releases = scope.permissions.includes("RELEASE_READ") ? await db.clientRelease.findMany({ where: { clientId: client.id }, orderBy: { publishedAt: "desc" },
      select: { id: true, packageFormatVersion: true, versionLabel: true, name: true, description: true, changelog: true, summary: true, environmentSnapshot: true, publishedAt: true, archivedAt: true } }) : [];
    const releaseRows = await Promise.all(releases.map(async release => ({ ...release, sourceDraft: await releaseDetails(db, release.id) })));
    const uploads = scope.permissions.includes("DRAFT_READ") ? await db.clientUpload.findMany({ where: { clientId: client.id, status: { notIn: ["SUBMITTED", "CANCELLED"] } }, orderBy: { createdAt: "desc" }, take: 20 }) : [];
    const summary = await clientSummary(db, client.id);
    const processingPackages = summary.processingPackages;
    rows.push({ clientId: client.id, name: client.name, organizationId: client.organizationId, organizationName: scope.client.organization.displayName,
      serverId: scope.client.binding?.serverId ?? null, serverName: scope.client.binding?.server.displayName ?? "未绑定",
      requestedServerId: client.requestedServerId, scopeServerId: client.scopeServerId, archived: !!client.archivedAt, blocked: !!scope.client.organization.archivedAt,
      displaySchedule: scope.client.binding ? {
        displayMode: scope.client.binding.server.displayMode,
        displayStartsAt: scope.client.binding.server.displayStartsAt,
        displayEndsAt: scope.client.binding.server.displayEndsAt,
      } : null,
      lifecycleStatus: client.archivedAt ? "ARCHIVED" as const : client.currentReleaseId ? "PUBLISHED" as const : "UNPUBLISHED" as const,
      permissions: [...new Set(scope.permissions)], publicationRevision: client.revision, currentReleaseId: client.currentReleaseId,
      initialPackageFormatVersion: summary.initialPackageFormatVersion,
      bindingRevision: scope.client.binding?.revision ?? null, drafts: orderClientVersions(drafts).map(draft => ({ ...draft, packageBuilds: draft.packageBuilds.map(build => ({ ...build, artifacts: packageArtifactsSchema.safeParse(build.artifacts).success ? packageArtifactsSchema.parse(build.artifacts) : null })) })),
      releases: releaseRows.map(release => ({ ...release, packageBuilds: (release.sourceDraft?.packageBuilds ?? []).map(build => ({ ...build, artifacts: packageArtifactsSchema.safeParse(build.artifacts).success ? packageArtifactsSchema.parse(build.artifacts) : null })) })),
      canDelete: scope.permissions.includes("CLIENT_DELETE") && !!client.archivedAt && !scope.client.binding && !client.requestedServerId && client._count.uploads === 0 && processingPackages === 0,
      uploads: uploads.map(upload => ({ ...uploadView(upload), canEdit: actor.isSuperAdmin || upload.createdById === actor.id })) });
  }
  return rows;
}
export async function clientDetails(db: Db, actor: Actor, clientId: string) {
  await requireClient(db, actor, clientId, "SERVER_READ", false);
  const row = (await clientList(db, actor)).find(row => row.clientId === clientId); invariant(row, 404, "客户端不存在"); return row;
}
export async function archiveClient(db: Db, actor: Actor, clientId: string, raw: unknown) {
  return archiveResource(db, actor, "clients", clientId, raw);
}
export async function deleteClient(db: Db, actor: Actor, clientId: string) {
  const scope = await requireClient(db, actor, clientId, "CLIENT_DELETE", false);
  invariant(scope.client.archivedAt, 409, "请先归档客户端，再执行删除");
  invariant(!scope.client.binding && !scope.client.requestedServerId, 409, "已绑定或待绑定服务器的客户端不能删除");
  invariant(await db.clientUpload.count({ where: { clientId, status: "PROCESSING" } }) === 0, 409, "Worker 正在处理此客户端，请稍后再试");
  invariant(await db.packageBuild.count({ where: { draft: { clientId }, status: "PROCESSING" } }) === 0, 409, "Worker 正在组包，请稍后再试");
  await db.clientUpload.updateMany({ where: { clientId, status: { in: ["UPLOADING", "WAITING_PROCESSOR", "QUEUED", "READY", "FAILED"] } }, data: { status: "CANCELLED" } });
  await db.$executeRaw`SELECT ${securityFunction("delete_client")}(${clientId})`;
  await audit(db, actor, "CLIENT_DELETE", "Client", clientId, scope.client.organizationId, undefined, { name: scope.client.name });
  return { ok: true };
}
export async function draftManifest(db: Db, actor: Actor, clientId: string, draftId: string) {
  await requireClient(db, actor, clientId, "DRAFT_READ", false);
  const draft = await db.clientDraft.findUnique({ where: { id: draftId } });
  invariant(draft?.clientId === clientId && draft.candidateManifestKey && draft.candidateManifestSha256, 404, "版本 Manifest 不存在");
  const bytes = await readObject(draft.candidateManifestKey); invariant(digest(bytes) === draft.candidateManifestSha256, 422, "Manifest 校验失败");
  if (draft.packageFormatVersion === 2) return recipeDraftTarget(db, draft);
  return JSON.parse(bytes.toString("utf8")) as ReleaseManifest;
}

export const normalizeName = (name: string) => name.trim().normalize("NFKC").toLowerCase();
export async function createClient(db: Db, actor: Actor, raw: unknown) {
  const data = parse(z.object({ organizationId: z.string().uuid(), name: z.string().trim().min(1).max(200),
    serverId: z.string().regex(/^[A-Za-z]{3,5}$/).nullable().optional(), publicationRevision: z.number().int().nonnegative().optional(),
    expectedClientId: z.string().nullable().optional(), replaceConfirmed: z.boolean().optional() }).strict(), raw);
  if (data.serverId) {
    const scope = await requireServer(db, actor, data.serverId, "DRAFT_CREATE");
    invariant(scope.server.organizationId === data.organizationId, 409, "服务器与客户端必须属于同一组织");
    await requireServer(db, actor, data.serverId, "DRAFT_SUBMIT");
    await requireServer(db, actor, data.serverId, "CLIENT_BIND");
  } else {
    invariant(!actor.apiScope, 403, "此 Token 仅授权服务器范围，请选择授权服务器");
    await requireOrganization(db, actor, data.organizationId, "DRAFT_CREATE");
    await requireOrganization(db, actor, data.organizationId, "DRAFT_SUBMIT");
  }
  const nameKey = normalizeName(data.name);
  invariant(!await db.client.findFirst({ where: { organizationId: data.organizationId, nameKey, deletedAt: null } }), 409, "客户端名称已存在，请使用该客户端的“更新”功能提交新版本");
  const client = await db.client.create({ data: { organizationId: data.organizationId, name: data.name, nameKey, scopeServerId: data.serverId ?? null } });
  if (data.serverId) await bindClient(db, actor, client.id, { serverId: data.serverId, publicationRevision: data.publicationRevision,
    expectedClientId: data.expectedClientId, replaceConfirmed: data.replaceConfirmed ?? false });
  await audit(db, actor, "CLIENT_CREATE", "Client", client.id, client.organizationId, undefined, { name: client.name });
  return { clientId: client.id, name: client.name, currentReleaseId: null, publicationRevision: 0 };
}
async function checkLegacyBinding(db: Db, releaseId: string | null, serverId: string) {
  if (!releaseId) return;
  const release = await db.clientRelease.findUniqueOrThrow({ where: { id: releaseId } });
  const bytes = await readObject(release.manifestObjectKey); invariant(digest(bytes) === release.manifestSha256, 422, "发布清单校验失败");
  const manifest = JSON.parse(bytes.toString("utf8")) as ReleaseManifest;
  invariant(manifest.schemaVersion !== 1 || manifest.serverId === serverId, 409, "此旧版 Manifest 固定原服务器，请先更新客户端后再绑定其他服务器");
}
export async function bindClient(db: Db, actor: Actor, clientId: string, raw: unknown) {
  const data = parse(z.object({ serverId: z.string().regex(/^[A-Za-z]{3,5}$/), publicationRevision: z.number().int().nonnegative(),
    expectedClientId: z.string().nullable(), replaceConfirmed: z.boolean() }).strict(), raw);
  const { client } = await requireClient(db, actor, clientId, "CLIENT_BIND");
  const scope = await requireServer(db, actor, data.serverId, "CLIENT_BIND");
  invariant(scope.server.organizationId === client.organizationId, 409, "只能绑定同组织服务器");
  invariant(!client.binding || client.binding.serverId === data.serverId, 409, "请先解绑客户端原有服务器");
  const publication = scope.server.publication!;
  invariant(publication.revision === data.publicationRevision && publication.clientId === data.expectedClientId, 409, "服务器绑定已改变，请刷新后重新确认");
  if (publication.clientId === clientId) return { ok: true, pending: false };
  invariant(!publication.clientId || data.replaceConfirmed, 409, "服务器已有客户端，请确认是否重新绑定到新客户端");
  if (publication.clientId) await requireClient(db, actor, publication.clientId, "CLIENT_BIND");
  await checkLegacyBinding(db, client.currentReleaseId, data.serverId);
  if (!client.currentReleaseId && publication.clientId) {
    await db.client.update({ where: { id: clientId }, data: { requestedServerId: data.serverId, requestedRevision: publication.revision, expectedClientId: publication.clientId } });
    await audit(db, actor, "CLIENT_BIND_REQUEST", "Client", clientId, client.organizationId, data.serverId, { previousClientId: publication.clientId, revision: publication.revision });
    return { ok: true, pending: true };
  }
  await db.serverPublication.update({ where: { serverId: data.serverId }, data: { clientId, releaseId: client.currentReleaseId, revision: { increment: 1 }, changedById: actor.id } });
  await db.client.update({ where: { id: clientId }, data: { requestedServerId: null, requestedRevision: null, expectedClientId: null } });
  await audit(db, actor, "CLIENT_BIND", "Client", clientId, client.organizationId, data.serverId, { previousClientId: publication.clientId });
  return { ok: true, pending: false };
}
export async function unbindClient(db: Db, actor: Actor, clientId: string, raw: unknown) {
  const data = parse(z.object({ serverId: z.string().nullable(), publicationRevision: z.number().int().nonnegative().nullable() }).strict(), raw);
  const { client } = await requireClient(db, actor, clientId, "CLIENT_BIND", false);
  invariant((client.binding?.serverId ?? null) === data.serverId && (client.binding?.revision ?? null) === data.publicationRevision, 409, "绑定已改变，请刷新");
  if (client.binding) {
    await requireServer(db, actor, client.binding.serverId, "CLIENT_BIND", false);
    await db.serverPublication.update({ where: { serverId: client.binding.serverId }, data: { clientId: null, releaseId: null, revision: { increment: 1 }, changedById: actor.id } });
  }
  await db.client.update({ where: { id: clientId }, data: { requestedServerId: null, requestedRevision: null, expectedClientId: null } });
  await audit(db, actor, "CLIENT_UNBIND", "Client", clientId, client.organizationId, client.binding?.serverId);
  return { ok: true };
}
async function setCurrentRelease(db: Db, actor: Actor, clientId: string, releaseId: string) {
  const { client, permissions } = await requireClient(db, actor, clientId, "RELEASE_ACTIVATE");
  await db.client.update({ where: { id: clientId }, data: { currentReleaseId: releaseId, revision: { increment: 1 } } });
  if (client.binding) {
    await requireServer(db, actor, client.binding.serverId, "RELEASE_ACTIVATE");
    await checkLegacyBinding(db, releaseId, client.binding.serverId);
    await db.serverPublication.update({ where: { serverId: client.binding.serverId }, data: { releaseId, revision: { increment: 1 }, changedById: actor.id } });
  } else if (client.requestedServerId && permissions.includes("CLIENT_BIND")) {
    await bindClient(db, actor, clientId, { serverId: client.requestedServerId, publicationRevision: client.requestedRevision,
      expectedClientId: client.expectedClientId, replaceConfirmed: true });
  }
}
