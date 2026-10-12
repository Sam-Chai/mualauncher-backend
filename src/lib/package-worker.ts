import "server-only";
import { randomUUID, createPublicKey } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { ZipFile } from "yazl";
import type { PrismaClient, PackageBuild } from "@/generated/prisma/client";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./prisma";
import { locked, type Db } from "./auth";
import { requireClient } from "./rbac";
import { AppError, invariant } from "./errors";
import { clientMetadataSchema, type ClientInspection, type FileInventory } from "./client-contract";
import { muaPlatformSchema, muaPlatformManifestSchema, type MuaFile } from "./muapack-contract";
import { encodeMuaJson, muaDigest, readMuaPlatformManifest, createMuaPackMetadata, signMuaPackMetadata, validateMuaEnvironments } from "./muapack-protocol";
import { validateMuaPackArchive } from "./muapack-archive";
import { resolveEnvironment, readEnvironmentDocuments, type EnvironmentResolver } from "./environment-resolver";
import { readObject, packagesBucket, environmentsBucket, casBucket, casKey } from "./storage";
import { putImmutableBytes, downloadStoredFile, uploadPackageFile } from "./package-storage";
import { signingIdentity } from "./signing";
import { packageArtifactsSchema } from "./package-contract";
import { runRecipePackageBuild } from "./recipe-package-worker";

async function owner(db: Db, build: PackageBuild) {
  const draft = await db.clientDraft.findUnique({ where: { id: build.draftId }, include: { upload: true } });
  invariant(draft?.upload && !draft.archivedAt && ["SUBMITTED", "APPROVED"].includes(draft.status), 409, "草稿不再允许组包");
  invariant(draft.packageFormatVersion === draft.upload.packageFormatVersion, 409, "组包与上传格式不匹配");
  invariant(draft.packageFormatVersion === 1 ? build.revision === 1 && build.platform !== "universal" : build.platform === "universal" && build.revision === draft.packageRevision, 409, "组包方案已改变");
  const account = await db.account.findUnique({ where: { id: draft.createdById } }); invariant(account?.status === "ACTIVE", 403, "上传账号已停用");
  const scope = await requireClient(db, account, draft.clientId, "DRAFT_SUBMIT", true);
  await requireClient(db, account, draft.clientId, "DRAFT_CREATE", true);
  if (draft.upload.baseReleaseId) await requireClient(db, account, draft.clientId, "DRAFT_EDIT", true);
  invariant(scope.client.currentReleaseId === draft.upload.baseReleaseId && scope.client.revision === draft.upload.basePublicationRevision, 409, "当前版本已改变，请基于最新版本重新上传");
  return { draft, upload: draft.upload, client: scope.client };
}
async function claim(client: PrismaClient) {
  return locked(async db => {
    await db.packageBuild.updateMany({ where: { status: "PROCESSING", leaseUntil: { lt: new Date() }, attempts: { gte: 3 } },
      data: { status: "FAILED", phase: "任务中断", error: "组包多次中断，请重试", leaseToken: null, leaseUntil: null } });
    const rows = await db.$queryRaw<{ id: string; format: number }[]>`SELECT b."id",d."packageFormatVersion" AS "format" FROM "PackageBuild" b JOIN "ClientDraft" d ON d."id"=b."draftId"
      JOIN "Client" c ON c."id"=d."clientId" JOIN "Organization" o ON o."id"=c."organizationId"
      WHERE b."required" AND c."deletedAt" IS NULL AND c."archivedAt" IS NULL AND o."archivedAt" IS NULL AND d."archivedAt" IS NULL
      AND d."packageFormatVersion" IN (1,2) AND d."status" IN ('SUBMITTED','APPROVED') AND b."attempts"<3
      AND (b."status"='QUEUED' OR b."status"='PROCESSING' AND b."leaseUntil"<NOW() OR b."status"='PREPARED' AND d."status"='APPROVED')
      ORDER BY CASE WHEN b."status"='PREPARED' THEN 0 ELSE 1 END,b."createdAt",b."platform" FOR UPDATE OF b SKIP LOCKED LIMIT 1`;
    if (!rows[0]) return null;
    return db.packageBuild.update({ where: { id: rows[0].id }, data: { status: "PROCESSING", phase: rows[0].format === 2 ? "正在准备 v2 配方" : "正在准备环境", error: null,
      attempts: { increment: 1 }, leaseToken: randomUUID(), leaseUntil: new Date(Date.now() + 120000) } });
  }, client);
}
export async function runPackageWorker(client: PrismaClient = prisma, resolver: EnvironmentResolver = resolveEnvironment) {
  const build = await claim(client); if (!build) return false;
  const directory = await mkdtemp(join(tmpdir(), "mua-package-worker-")); const controller = new AbortController();
  const { signal } = controller; let phase = build.platform === "universal" ? "正在准备 v2 配方" : "正在准备环境", progress = 1, renewing = false;
  const checkpoint = async () => locked(async db => {
    const current = await db.packageBuild.findUnique({ where: { id: build.id } });
    invariant(current?.status === "PROCESSING" && current.required && current.leaseToken === build.leaseToken && current.leaseUntil && current.leaseUntil > new Date(), 409, "组包租约已失效");
    const context = await owner(db, build);
    await db.packageBuild.update({ where: { id: build.id }, data: { phase, progress, leaseUntil: new Date(Date.now() + 120000) } }); return context;
  }, client);
  const timer = setInterval(() => { if (renewing) return; renewing = true;
    void checkpoint().catch(error => controller.abort(error)).finally(() => { renewing = false; }); }, 10000);
  const deadline = setTimeout(() => controller.abort(new Error("组包超过两小时")), 2 * 60 * 60 * 1000);
  try {
    const context = await checkpoint();
    if (context.draft.packageFormatVersion === 2) {
      await runRecipePackageBuild(client, build, directory, signal, async (message, value) => { phase = message; progress = value; return checkpoint(); }, db => owner(db, build));
      return true;
    }
    const metadata = clientMetadataSchema.parse(context.draft.candidateMetadata);
    const platform = muaPlatformSchema.parse(build.platform); let targetBytes: Buffer;
    if (build.targetObjectKey && build.targetSha256) {
      targetBytes = await readObject(build.targetObjectKey); invariant(muaDigest(targetBytes) === build.targetSha256, 422, "已准备的清单校验失败");
    } else {
      const info = context.upload.detectedInfo as ClientInspection | null;
      invariant(!info?.loader || info.loaderVersion, 422, "无法识别加载器版本，不能生成可启动的包");
      const loader = info?.loader ? { type: zLoader(info.loader), version: info.loaderVersion! } : null;
      const environment = await resolver({ minecraft: metadata.minecraftVersion, javaMajor: metadata.javaVersion, loader, platform }, directory, signal,
        async message => { phase = message; progress = 15; signal.throwIfAborted(); await checkpoint(); });
      const filesBytes = await readObject(context.upload.filesObjectKey!); invariant(muaDigest(filesBytes) === context.upload.filesSha256, 422, "上传文件索引校验失败");
      const inventory = JSON.parse(filesBytes.toString("utf8")) as FileInventory;
      const instance = info?.instanceId; const isolated = !!instance && inventory.files.some(file => file.path.startsWith(`versions/${instance}/mods/`) || file.path.startsWith(`versions/${instance}/config/`));
      const instanceFiles: MuaFile[] = inventory.files.flatMap(file => {
        let path = file.path;
        if (instance && path.startsWith(`versions/${instance}/`)) {
          path = path.slice(`versions/${instance}/`.length); if (!/^(mods\/|config\/|resourcepacks\/|shaderpacks\/|options.*\.txt$|servers\.dat$)/i.test(path)) return [];
        } else if (/^(versions|libraries|assets|natives|runtime)\//i.test(path) || isolated && /^(mods|config|resourcepacks|shaderpacks)\//i.test(path)) return [];
        return [{ ...file, root: "instance" as const, path, executable: false }];
      });
      const target = muaPlatformManifestSchema.parse({ format: "mua-platform-manifest", formatVersion: 1,
        release: { organizationId: context.client.organizationId, clientId: context.client.id, releaseId: build.draftId, version: metadata.versionLabel,
          name: metadata.name, summary: metadata.summary, description: metadata.description, sourceSha256: context.upload.sourceSha256, contentRevision: context.draft.contentRevision },
        platform, runtime: { minecraft: metadata.minecraftVersion, loader, java: environment.java }, environments: environment.environments, launch: environment.launch,
        mods: instanceFiles.filter(file => /^mods\/.+\.jar$/i.test(file.path)).map(file => ({ path: file.path, name: null, version: null, ...(file.optional ? { optional: true } : {}) })), files: [...environment.files, ...instanceFiles] });
      validateMuaEnvironments(target, await readEnvironmentDocuments(environment)); targetBytes = encodeMuaJson(target);
      const targetObjectKey = `muapacks/${context.client.id}/${build.draftId}/${platform}/targets/${muaDigest(targetBytes)}.json`;
      await putImmutableBytes(packagesBucket(), targetObjectKey, targetBytes); await checkpoint();
      await locked(async db => {
        const current = await db.packageBuild.findUniqueOrThrow({ where: { id: build.id } }); invariant(current.leaseToken === build.leaseToken && current.status === "PROCESSING", 409, "组包租约已失效");
        await owner(db, build); await db.packageBuild.update({ where: { id: build.id }, data: { targetObjectKey, targetSha256: muaDigest(targetBytes) } });
      }, client);
    }
    const target = readMuaPlatformManifest(targetBytes); const documents = await readEnvironmentDocuments(target); validateMuaEnvironments(target, documents);
    const fresh = await checkpoint();
    if (fresh.draft.status !== "APPROVED") {
      await locked(async db => { const current = await db.packageBuild.findUniqueOrThrow({ where: { id: build.id } }); invariant(current.leaseToken === build.leaseToken, 409, "组包租约已失效");
        await owner(db, build); await db.packageBuild.update({ where: { id: build.id }, data: { status: "PREPARED", phase: "等待审核签名", progress: 40, attempts: 0, leaseToken: null, leaseUntil: null } }); }, client);
      return true;
    }
    invariant(fresh.draft.reviewedRevision === fresh.draft.contentRevision && fresh.draft.reviewedPackageRevision === fresh.draft.packageRevision, 409, "审核修订不匹配");
    let baseBytes: Buffer | null = null;
    if (fresh.upload.baseReleaseId) {
      const release = await client.clientRelease.findUniqueOrThrow({ where: { id: fresh.upload.baseReleaseId } });
      const base = await client.packageBuild.findUnique({ where: { draftId_platform_revision: { draftId: release.sourceDraftId, platform, revision: 1 } } });
      if (release.packageFormatVersion === 1 && base?.status === "READY" && base.required && base.targetObjectKey && base.targetSha256) {
        baseBytes = await readObject(base.targetObjectKey); invariant(muaDigest(baseBytes) === base.targetSha256, 422, "更新基准清单校验失败");
      }
    }
    const environmentHashes = new Set([...documents.values()].flatMap(bytes => (JSON.parse(bytes.toString("utf8")) as { files: MuaFile[] }).files.map(file => file.sha256)));
    const identity = await signingIdentity(); const options = { mtime: new Date("1980-01-01T00:00:00Z"), mode: 0o100644, compress: true };
    const { draftId, leaseToken } = build;
    const fullMetadata = createMuaPackMetadata(targetBytes, null, "retain"); const objectPaths = new Map<string, string>(); let done = 0;
    phase = "正在读取组包文件";
    for (const object of fullMetadata.payload) {
      signal.throwIfAborted(); const local = join(directory, `object-${object.sha256}`); const bucket = environmentHashes.has(object.sha256) ? environmentsBucket() : casBucket();
      await downloadStoredFile(bucket, casKey(object.sha256), local, object.sha256, object.size, signal); objectPaths.set(object.sha256, local);
      progress = 40 + Math.floor(++done / fullMetadata.payload.length * 40);
    }
    async function assemble(base: Buffer | null) {
      phase = base ? "正在生成更新包" : "正在生成整包"; progress = 85; await checkpoint();
      const metadata = createMuaPackMetadata(targetBytes, base, "retain"), bytes = encodeMuaJson(metadata), signature = signMuaPackMetadata(bytes, identity.privateKey);
      const zip = new ZipFile(); const path = join(directory, `${metadata.packageType}.muapack`);
      zip.addBuffer(bytes, "mua-pack.json", options); zip.addBuffer(targetBytes, "metadata/target-manifest.json", options);
      if (base) zip.addBuffer(base, "metadata/base-manifest.json", options);
      zip.addBuffer(signature, "metadata/signature.json", options);
      for (const [sha, bytes] of documents) zip.addBuffer(bytes, `metadata/environments/${sha}.json`, options);
      for (const object of metadata.payload) zip.addFile(objectPaths.get(object.sha256)!, `objects/sha256/${object.sha256}`, { ...options, compress: false });
      zip.on("error", error => (zip.outputStream as NodeJS.ReadableStream & { destroy(error: Error): void }).destroy(error));
      const completion = pipeline(zip.outputStream, createWriteStream(path, { flags: "wx" }), { signal }); zip.end({ forceZip64Format: true, comment: "" }); await completion;
      phase = "正在校验组包与签名"; progress = 92; await checkpoint(); await validateMuaPackArchive(path, createPublicKey(identity.privateKey), { signal });
      phase = "正在保存到对象存储"; progress = 95; await checkpoint();
      return uploadPackageFile(`muapacks/${fresh.client.id}/${draftId}/${platform}/${leaseToken}/${metadata.packageType}.muapack`, path, signal);
    }
    const full = await assemble(null), update = baseBytes ? { ...await assemble(baseBytes), baseReleaseId: fresh.upload.baseReleaseId!, baseManifestSha256: muaDigest(baseBytes) } : null;
    const artifacts = packageArtifactsSchema.parse({ full, update, signingKeyId: identity.keyId }); await checkpoint();
    await locked(async db => {
      const current = await db.packageBuild.findUniqueOrThrow({ where: { id: build.id } }); invariant(current.leaseToken === build.leaseToken && current.status === "PROCESSING", 409, "组包租约已失效");
      const final = await owner(db, build);
      if (final.draft.status !== "APPROVED") {
        await db.packageBuild.update({ where: { id: build.id }, data: { status: "PREPARED", phase: "等待重新审核签名", progress: 40, attempts: 0, leaseToken: null, leaseUntil: null } }); return;
      }
      invariant(final.draft.reviewedRevision === final.draft.contentRevision && final.draft.reviewedPackageRevision === final.draft.packageRevision, 409, "签名需要有效审核");
      await db.packageBuild.update({ where: { id: build.id }, data: { status: "READY", phase: "已生成并校验", progress: 100, artifacts: artifacts as Prisma.InputJsonObject, error: null, leaseToken: null, leaseUntil: null } });
    }, client); return true;
  } catch (error) {
    const message = error instanceof AppError || error instanceof Error ? error.message : "组包失败";
    await locked(async db => { const current = await db.packageBuild.findUnique({ where: { id: build.id } });
      if (current?.status === "PROCESSING" && current.leaseToken === build.leaseToken) await db.packageBuild.update({ where: { id: build.id }, data: { status: "FAILED", phase: "生成失败", error: message.slice(0, 2000), leaseToken: null, leaseUntil: null } }); }, client).catch(() => {});
    console.error(`Package build ${build.id}: ${message}`); return true;
  } finally { clearInterval(timer); clearTimeout(deadline); controller.abort();
    const root = resolve(tmpdir()) + sep; invariant(resolve(directory).startsWith(root), 500, "临时组包目录不安全"); await rm(directory, { recursive: true, force: true }); }
}
function zLoader(loader: string) {
  invariant(["fabric", "quilt", "forge", "neoforge"].includes(loader), 422, "未知加载器类型");
  return loader as "fabric" | "quilt" | "forge" | "neoforge";
}
