import { serializeError } from "@/lib/diagnostics";
import { diagnosticText } from "@/lib/diagnostics";
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
import { workerPrisma as prisma } from "./prisma";
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
import { assertDistributableFiles } from "./pack-file-policy";
import { ExecutionError } from "./execution-policy";
import { workerExecutionMode } from "./execution-settings";
import { executionContext } from "./execution-management";

async function owner(db: Db, build: PackageBuild) {
  const draft = await db.clientDraft.findUnique({ where: { id: build.draftId }, include: { upload: true } });
  invariant(draft?.upload && !draft.archivedAt && ["SUBMITTED", "APPROVED"].includes(draft.status), 409, diagnosticText("diagnostics.packageWorker.theDraftNoLongerAllowsPackageBuilds"));
  invariant(draft.packageFormatVersion === draft.upload.packageFormatVersion, 409, diagnosticText("diagnostics.packageWorker.thePackageFormatDoesNotMatchTheUpload"));
  invariant(draft.packageFormatVersion === 1 ? build.revision === 1 && build.platform !== "universal" : build.platform === "universal" && build.revision === draft.packageRevision, 409, diagnosticText("diagnostics.packageWorker.theBuildPlanHasChanged"));
  const account = await db.account.findUnique({ where: { id: draft.createdById } }); invariant(account?.status === "ACTIVE", 403, diagnosticText("diagnostics.clientWorker.theUploadAccountIsDisabled"));
  const scope = await requireClient(db, account, draft.clientId, "DRAFT_SUBMIT", true);
  await requireClient(db, account, draft.clientId, "DRAFT_CREATE", true);
  if (draft.upload.baseReleaseId) await requireClient(db, account, draft.clientId, "DRAFT_EDIT", true);
  invariant(scope.client.currentReleaseId === draft.upload.baseReleaseId && scope.client.revision === draft.upload.basePublicationRevision, 409, diagnosticText("diagnostics.packageWorker.theCurrentVersionHasChangedUploadAgainUsingTheLatest"));
  return { draft, upload: draft.upload, client: scope.client };
}
async function claim(client: PrismaClient) {
  return locked(async db => {
    await db.packageBuild.updateMany({ where: { status: "PROCESSING", leaseUntil: { lt: new Date() }, attempts: { gte: 3 } },
      data: { status: "FAILED", phase: diagnosticText("diagnostics.packageWorker.theTaskWasInterrupted"), error: diagnosticText("diagnostics.packageWorker.theBuildWasInterruptedRepeatedlyRetryIt"), leaseToken: null, leaseUntil: null } });
    const rows = await db.$queryRaw<{ id: string; format: number }[]>`SELECT b."id",d."packageFormatVersion" AS "format" FROM "PackageBuild" b JOIN "ClientDraft" d ON d."id"=b."draftId"
      JOIN "Client" c ON c."id"=d."clientId" JOIN "Organization" o ON o."id"=c."organizationId"
      WHERE b."required" AND c."deletedAt" IS NULL AND c."archivedAt" IS NULL AND o."archivedAt" IS NULL AND d."archivedAt" IS NULL
      AND d."packageFormatVersion" IN (1,2) AND d."status" IN ('SUBMITTED','APPROVED') AND b."attempts"<3
      AND (b."status"='QUEUED' AND (b."leaseUntil" IS NULL OR b."leaseUntil"<NOW()) OR b."status"='PROCESSING' AND b."leaseUntil"<NOW() OR b."status"='PREPARED' AND d."status"='APPROVED')
      ORDER BY CASE WHEN b."status"='PREPARED' THEN 0 ELSE 1 END,b."createdAt",b."platform" FOR UPDATE OF b SKIP LOCKED LIMIT 1`;
    if (!rows[0]) return null;
    return db.packageBuild.update({ where: { id: rows[0].id }, data: { status: "PROCESSING", phase: rows[0].format === 2 ? diagnosticText("diagnostics.packageWorker.preparingV2Recipe") : diagnosticText("diagnostics.packageWorker.preparingEnvironment"), error: null,
      attempts: { increment: 1 }, leaseToken: randomUUID(), leaseUntil: new Date(Date.now() + 120000) } });
  }, client);
}
export async function runPackageWorker(client: PrismaClient = prisma, resolver: EnvironmentResolver = resolveEnvironment, shutdown?: AbortSignal, workerId = `worker-${process.pid}`) {
  if (shutdown?.aborted) return false;
  const build = await claim(client); if (!build) return false;
  const directory = await mkdtemp(join(tmpdir(), "mua-package-worker-")); const controller = new AbortController();
  const stop = () => controller.abort(new ExecutionError("unavailable", true, "worker-stopping"));
  shutdown?.addEventListener("abort", stop, { once: true }); if (shutdown?.aborted) stop();
  const { signal } = controller; let phase = build.platform === "universal" ? diagnosticText("diagnostics.packageWorker.preparingV2Recipe") : diagnosticText("diagnostics.packageWorker.preparingEnvironment"), progress = 1, renewing = false;
  const checkpoint = async () => locked(async db => {
    const current = await db.packageBuild.findUnique({ where: { id: build.id } });
    invariant(current?.status === "PROCESSING" && current.required && current.leaseToken === build.leaseToken && current.leaseUntil && current.leaseUntil > new Date(), 409, diagnosticText("diagnostics.packageWorker.theBuildLeaseIsNoLongerValid"));
    const context = await owner(db, build);
    await db.packageBuild.update({ where: { id: build.id }, data: { phase, progress, leaseUntil: new Date(Date.now() + 120000) } }); return context;
  }, client);
  const timer = setInterval(() => { if (renewing) return; renewing = true;
    void checkpoint().catch(error => controller.abort(error)).finally(() => { renewing = false; }); }, 10000);
  const deadline = setTimeout(() => controller.abort(new Error(diagnosticText("diagnostics.packageWorker.theBuildExceededTwoHours"))), 2 * 60 * 60 * 1000);
  try {
    const context = await checkpoint();
    if (context.draft.packageFormatVersion === 2) {
      await runRecipePackageBuild(client, build, directory, signal, async (message, value) => { phase = message; progress = value; return checkpoint(); }, db => owner(db, build));
      return true;
    }
    const metadata = clientMetadataSchema.parse(context.draft.candidateMetadata);
    const platform = muaPlatformSchema.parse(build.platform); let targetBytes: Buffer;
    const inspection = context.upload.detectedInfo as ClientInspection | null;
    const execution = ["forge", "neoforge"].includes(inspection?.loader ?? "") ? await executionContext(await workerExecutionMode(client), workerId, build.id) : undefined;
    const executionRevision = execution ? `${execution.mode}-${execution.profile}` : null;
    if (build.targetObjectKey && build.targetSha256 && (!executionRevision || build.targetObjectKey.includes(`/${executionRevision}/`))) {
      targetBytes = await readObject(build.targetObjectKey); invariant(muaDigest(targetBytes) === build.targetSha256, 422, diagnosticText("diagnostics.packageWorker.thePreparedManifestFailedValidation"));
    } else {
      const info = inspection;
      invariant(!info?.loader || info.loaderVersion, 422, diagnosticText("diagnostics.packageWorker.theLoaderVersionCouldNotBeDetectedALaunchablePackage"));
      const loader = info?.loader ? { type: zLoader(info.loader), version: info.loaderVersion! } : null;
      const environment = await resolver({ minecraft: metadata.minecraftVersion, javaMajor: metadata.javaVersion, loader, platform, execution }, directory, signal,
        async message => { phase = message; progress = 15; signal.throwIfAborted(); await checkpoint(); });
      const filesBytes = await readObject(context.upload.filesObjectKey!); invariant(muaDigest(filesBytes) === context.upload.filesSha256, 422, diagnosticText("diagnostics.packageWorker.theUploadFileIndexFailedValidation"));
      const inventory = JSON.parse(filesBytes.toString("utf8")) as FileInventory;
      assertDistributableFiles(inventory.files);
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
      const targetObjectKey = `muapacks/${context.client.id}/${build.draftId}/${platform}/targets/${executionRevision ? executionRevision + "/" : ""}${muaDigest(targetBytes)}.json`;
      await putImmutableBytes(packagesBucket(), targetObjectKey, targetBytes); await checkpoint();
      await locked(async db => {
        const current = await db.packageBuild.findUniqueOrThrow({ where: { id: build.id } }); invariant(current.leaseToken === build.leaseToken && current.status === "PROCESSING", 409, diagnosticText("diagnostics.packageWorker.theBuildLeaseIsNoLongerValid"));
        await owner(db, build); await db.packageBuild.update({ where: { id: build.id }, data: { targetObjectKey, targetSha256: muaDigest(targetBytes) } });
      }, client);
    }
    const target = readMuaPlatformManifest(targetBytes); assertDistributableFiles(target.files);
    const documents = await readEnvironmentDocuments(target); validateMuaEnvironments(target, documents);
    const fresh = await checkpoint();
    if (fresh.draft.status !== "APPROVED") {
      await locked(async db => { const current = await db.packageBuild.findUniqueOrThrow({ where: { id: build.id } }); invariant(current.leaseToken === build.leaseToken, 409, diagnosticText("diagnostics.packageWorker.theBuildLeaseIsNoLongerValid"));
        await owner(db, build); await db.packageBuild.update({ where: { id: build.id }, data: { status: "PREPARED", phase: diagnosticText("diagnostics.packageWorker.awaitingReviewAndSignature"), progress: 40, attempts: 0, leaseToken: null, leaseUntil: null } }); }, client);
      return true;
    }
    invariant(fresh.draft.reviewedRevision === fresh.draft.contentRevision && fresh.draft.reviewedPackageRevision === fresh.draft.packageRevision, 409, diagnosticText("diagnostics.packageWorker.theReviewRevisionDoesNotMatch"));
    let baseBytes: Buffer | null = null;
    if (fresh.upload.baseReleaseId) {
      const release = await client.clientRelease.findUniqueOrThrow({ where: { id: fresh.upload.baseReleaseId } });
      const base = await client.packageBuild.findUnique({ where: { draftId_platform_revision: { draftId: release.sourceDraftId, platform, revision: 1 } } });
      if (release.packageFormatVersion === 1 && base?.status === "READY" && base.required && base.targetObjectKey && base.targetSha256) {
        baseBytes = await readObject(base.targetObjectKey); invariant(muaDigest(baseBytes) === base.targetSha256, 422, diagnosticText("diagnostics.packageWorker.theUpdateBaselineManifestFailedValidation"));
      }
    }
    const environmentHashes = new Set([...documents.values()].flatMap(bytes => (JSON.parse(bytes.toString("utf8")) as { files: MuaFile[] }).files.map(file => file.sha256)));
    const identity = await signingIdentity(); const options = { mtime: new Date("1980-01-01T00:00:00Z"), mode: 0o100644, compress: true };
    const { draftId, leaseToken } = build;
    const fullMetadata = createMuaPackMetadata(targetBytes, null, "retain"); const objectPaths = new Map<string, string>(); let done = 0;
    phase = diagnosticText("diagnostics.packageWorker.readingPackageFiles");
    for (const object of fullMetadata.payload) {
      signal.throwIfAborted(); const local = join(directory, `object-${object.sha256}`); const bucket = environmentHashes.has(object.sha256) ? environmentsBucket() : casBucket();
      await downloadStoredFile(bucket, casKey(object.sha256), local, object.sha256, object.size, signal); objectPaths.set(object.sha256, local);
      progress = 40 + Math.floor(++done / fullMetadata.payload.length * 40);
    }
    async function assemble(base: Buffer | null) {
      phase = base ? diagnosticText("diagnostics.packageWorker.generatingUpdatePackage") : diagnosticText("diagnostics.packageWorker.generatingFullPackage"); progress = 85; await checkpoint();
      const metadata = createMuaPackMetadata(targetBytes, base, "retain"), bytes = encodeMuaJson(metadata), signature = signMuaPackMetadata(bytes, identity.privateKey);
      const zip = new ZipFile(); const path = join(directory, `${metadata.packageType}.muapack`);
      zip.addBuffer(bytes, "mua-pack.json", options); zip.addBuffer(targetBytes, "metadata/target-manifest.json", options);
      if (base) zip.addBuffer(base, "metadata/base-manifest.json", options);
      zip.addBuffer(signature, "metadata/signature.json", options);
      for (const [sha, bytes] of documents) zip.addBuffer(bytes, `metadata/environments/${sha}.json`, options);
      for (const object of metadata.payload) zip.addFile(objectPaths.get(object.sha256)!, `objects/sha256/${object.sha256}`, { ...options, compress: false });
      zip.on("error", error => (zip.outputStream as NodeJS.ReadableStream & { destroy(error: Error): void }).destroy(error));
      const completion = pipeline(zip.outputStream, createWriteStream(path, { flags: "wx" }), { signal }); zip.end({ forceZip64Format: true, comment: "" }); await completion;
      phase = diagnosticText("diagnostics.packageWorker.validatingPackageAndSignature"); progress = 92; await checkpoint(); await validateMuaPackArchive(path, createPublicKey(identity.privateKey), { signal });
      phase = diagnosticText("diagnostics.packageWorker.savingToObjectStorage"); progress = 95; await checkpoint();
      return uploadPackageFile(`muapacks/${fresh.client.id}/${draftId}/${platform}/${leaseToken}/${metadata.packageType}.muapack`, path, signal);
    }
    const full = await assemble(null), update = baseBytes ? { ...await assemble(baseBytes), baseReleaseId: fresh.upload.baseReleaseId!, baseManifestSha256: muaDigest(baseBytes) } : null;
    const artifacts = packageArtifactsSchema.parse({ full, update, signingKeyId: identity.keyId }); await checkpoint();
    await locked(async db => {
      const current = await db.packageBuild.findUniqueOrThrow({ where: { id: build.id } }); invariant(current.leaseToken === build.leaseToken && current.status === "PROCESSING", 409, diagnosticText("diagnostics.packageWorker.theBuildLeaseIsNoLongerValid"));
      const final = await owner(db, build);
      if (final.draft.status !== "APPROVED") {
        await db.packageBuild.update({ where: { id: build.id }, data: { status: "PREPARED", phase: diagnosticText("diagnostics.packageWorker.awaitingAnotherReviewAndSignature"), progress: 40, attempts: 0, leaseToken: null, leaseUntil: null } }); return;
      }
      invariant(final.draft.reviewedRevision === final.draft.contentRevision && final.draft.reviewedPackageRevision === final.draft.packageRevision, 409, diagnosticText("diagnostics.packageWorker.signingRequiresAValidApproval"));
      await db.packageBuild.update({ where: { id: build.id }, data: { status: "READY", phase: diagnosticText("diagnostics.packageWorker.generatedAndVerified"), progress: 100, artifacts: artifacts as Prisma.InputJsonObject, error: null, leaseToken: null, leaseUntil: null } });
    }, client); return true;
  } catch (error) {
    const message = error instanceof AppError || error instanceof Error ? serializeError(error) : diagnosticText("diagnostics.packageWorker.packageBuildFailed");
    await locked(async db => { const current = await db.packageBuild.findUnique({ where: { id: build.id } });
      if (current?.status === "PROCESSING" && current.required && current.leaseToken === build.leaseToken) {
        const retry = shutdown?.aborted || error instanceof ExecutionError && (error.retryable || error.reason === "configuration");
        await db.packageBuild.update({ where: { id: build.id }, data: retry ? {
          status: "QUEUED", phase: diagnosticText(shutdown?.aborted ? "diagnostics.execution.stopping" : "diagnostics.execution.retrying"), error: message,
          attempts: Math.max(0, current.attempts - 1), leaseToken: null, leaseUntil: new Date(Date.now() + (shutdown?.aborted ? 0 : 30000)),
        } : { status: "FAILED", phase: diagnosticText("diagnostics.packageContract.generationFailed"), error: message, leaseToken: null, leaseUntil: null } });
      } }, client).catch(() => {});
    console.error(`Package build ${build.id}: ${message}`); return true;
  } finally { clearInterval(timer); clearTimeout(deadline); shutdown?.removeEventListener("abort", stop); controller.abort();
    const root = resolve(tmpdir()) + sep; invariant(resolve(directory).startsWith(root), 500, diagnosticText("diagnostics.packageWorker.unsafeTemporaryBuildDirectory")); await rm(directory, { recursive: true, force: true }); }
}
function zLoader(loader: string) {
  invariant(["fabric", "quilt", "forge", "neoforge"].includes(loader), 422, diagnosticText("diagnostics.packageWorker.unknownLoaderType"));
  return loader as "fabric" | "quilt" | "forge" | "neoforge";
}
