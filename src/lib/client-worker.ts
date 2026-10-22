import { serializeError } from "@/lib/diagnostics";
import { diagnosticText } from "@/lib/diagnostics";
import "server-only";
import { putTrackedCas } from "./recycle-storage";
import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";

import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { workerPrisma as prisma } from "./prisma";
import { locked, type Db } from "./auth";
import { AppError, invariant } from "./errors";
import { requireClient } from "./rbac";
import { digest, packagesBucket, readObject, putJson, storageClient, abortMultipart } from "./storage";
import { parseClientPack, compareFiles } from "./pack-parser";
import { readInventory } from "./pack-inventory";
import { comparisonDraft } from "./draft-lifecycle";
import { audit } from "./management";
import type { ClientInspection, PackFile, ReleaseManifest } from "./client-contract";
import { workerDownloadSettings } from "./download-settings";

async function authorizedOwner(db: Db, upload: { createdById: string; clientId: string; baseReleaseId: string | null; comparisonDraftId: string | null }) {
  const account = await db.account.findUnique({ where: { id: upload.createdById } });
  invariant(account?.status === "ACTIVE", 403, diagnosticText("diagnostics.clientWorker.theUploadAccountIsDisabled"));
  const actor = { id: account.id, displayName: account.displayName, isSuperAdmin: account.isSuperAdmin };
  const scope = await requireClient(db, actor, upload.clientId, "DRAFT_CREATE", true);
  if (upload.baseReleaseId) await requireClient(db, actor, upload.clientId, "DRAFT_EDIT", true);
  if (upload.comparisonDraftId) await requireClient(db, actor, upload.clientId, "DRAFT_ARCHIVE", true);
  return { actor, scope };
}
export async function claimUpload(client: PrismaClient = prisma) {
  return locked(async db => {
    await db.clientUpload.updateMany({ where: { status: "PROCESSING", leaseUntil: { lt: new Date() }, attempts: { gte: 3 } }, data: { status: "FAILED", error: diagnosticText("diagnostics.clientWorker.theWorkerWasInterruptedRepeatedlyRetryTheTask"), leaseToken: null, leaseUntil: null } });
    const ids = await db.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "ClientUpload"
      WHERE "packageFormatVersion" IN (1,2) AND (("status" = 'QUEUED' AND "processingPhase" IS DISTINCT FROM 'SELECT_INSTANCE') OR ("status" = 'PROCESSING' AND "leaseUntil" < now())) AND "attempts" < 3
      ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1
    `;
    if (!ids[0]) return null;
    return db.clientUpload.update({ where: { id: ids[0].id }, data: { status: "PROCESSING", attempts: { increment: 1 },
      leaseToken: randomUUID(), leaseUntil: new Date(Date.now() + 120000), error: null, progress: 0, processingPhase: "FETCHING",
      detectedInfo: Prisma.JsonNull, detectedMods: [], warnings: [] } });
  }, client);
}
export async function runUploadWorker(client: PrismaClient = prisma) {
  const upload = await claimUpload(client); if (!upload) return false;
  const temp = await mkdtemp(join(tmpdir(), "mua-client-worker-"));
  const abort = new AbortController(); let progress = 0; let renewing = false;
  const owner = { id: upload.id, status: "PROCESSING" as const, leaseToken: upload.leaseToken };
  const renew = setInterval(() => {
    if (renewing) return; renewing = true;
    void client.clientUpload.updateMany({ where: owner, data: { leaseUntil: new Date(Date.now() + 120000), progress } })
      .then(result => { if (!result.count) abort.abort(new Error(diagnosticText("diagnostics.clientWorker.theWorkerLeaseIsNoLongerValid"))); })
      .catch(() => abort.abort(new Error(diagnosticText("diagnostics.clientWorker.theWorkerCannotRenewItsLease")))).finally(() => { renewing = false; });
  }, 10000);
  const deadline = setTimeout(() => abort.abort(new Error(diagnosticText("diagnostics.clientWorker.processingExceededTwoHours"))), 2 * 60 * 60 * 1000);
  try {
    await client.$transaction(db => authorizedOwner(db, upload));
    let previous: PackFile[] = []; let previousVersion: string | null = null;
    if (upload.baseReleaseId && upload.packageFormatVersion === 1) {
      const release = await client.clientRelease.findUnique({ where: { id: upload.baseReleaseId } }); invariant(release, 409, diagnosticText("diagnostics.clientWorker.theBaselineReleaseDoesNotExist"));
      if (release.packageFormatVersion === 1) {
      const bytes = await readObject(release.manifestObjectKey); invariant(digest(bytes) === release.manifestSha256, 422, diagnosticText("diagnostics.clientWorker.theBaselineManifestDigestDoesNotMatch"));
      const manifest = JSON.parse(bytes.toString("utf8")) as ReleaseManifest; invariant(manifest.format === "mua-client-manifest" && manifest.schemaVersion === 2 && manifest.clientId === upload.clientId && Array.isArray(manifest.files), 422, diagnosticText("diagnostics.clientWorker.theBaselineManifestFormatIsIncompatible"));
      previous = manifest.files; previousVersion = release.versionLabel;
      }
    }
    const source = await storageClient().getObject({ Bucket: packagesBucket(), Key: upload.sourceObjectKey });
    invariant(source.Body && source.ContentLength === Number(upload.size), 422, diagnosticText("diagnostics.clientWorker.theSourceZipIsMissingOrItsSizeDoesNot"));
    const hash = createHash("sha256"); let sourceBytes = 0;
    const meter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      sourceBytes += chunk.length; if (sourceBytes > Number(upload.size)) { callback(new Error(diagnosticText("diagnostics.clientWorker.theSourceZipExceedsItsDeclaredSize"))); return; }
      hash.update(chunk); callback(null, chunk);
    } });
    const local = join(temp, "source.zip");
    await pipeline(source.Body as NodeJS.ReadableStream, meter, createWriteStream(local), { signal: abort.signal });
    invariant(sourceBytes === Number(upload.size), 422, diagnosticText("diagnostics.clientWorker.theSourceZipDownloadIsIncomplete")); const sourceSha256 = hash.digest("hex");
    const checkpoint = (data: Prisma.ClientUploadUpdateInput) => locked(async db => {
      const fresh = await db.clientUpload.findUnique({ where: { id: upload.id } });
      invariant(fresh?.status === "PROCESSING" && fresh.leaseToken === upload.leaseToken && fresh.leaseUntil && fresh.leaseUntil > new Date(), 409, diagnosticText("diagnostics.clientWorker.theWorkerLeaseIsNoLongerValid"));
      const { scope } = await authorizedOwner(db, fresh);
      invariant(scope.client.currentReleaseId === fresh.baseReleaseId && scope.client.revision === fresh.basePublicationRevision, 409, diagnosticText("diagnostics.clientWorker.theCurrentVersionHasChangedUploadTheLatestCompleteClient"));
      await db.clientUpload.update({ where: { id: upload.id }, data });
    }, client);
    const parsed = await parseClientPack(local, temp, previous, previousVersion, Number(upload.size), value => { progress = value; }, abort.signal, {
      selectedInstanceId: upload.selectedInstanceId,
      packageFormatVersion: upload.packageFormatVersion === 2 ? 2 : 1,
      downloadSettings: await workerDownloadSettings(client),
      onInspecting: () => checkpoint({ processingPhase: "INSPECTING" }),
      storeCas: (sha, path, size) => putTrackedCas(upload.clientId, sha, path, size, client),
      onInspected: (info: ClientInspection, mods: string[]) => checkpoint({
        detectedInfo: info as unknown as Prisma.InputJsonObject, detectedMods: mods, warnings: info.warnings,
        ...(info.requiresSelection ? { status: "QUEUED", processingPhase: "SELECT_INSTANCE", leaseToken: null, leaseUntil: null } :
          { processingPhase: upload.packageFormatVersion === 1 && info.importFiles?.some(file => file.source === "remote") ? "DOWNLOADING" : "CAS", selectedInstanceId: info.instanceId }),
      }),
      onDownloading: info => checkpoint({ processingPhase: "DOWNLOADING", detectedInfo: info as unknown as Prisma.InputJsonObject, progress }),
      onCas: info => checkpoint({ processingPhase: "CAS", detectedInfo: info as unknown as Prisma.InputJsonObject, progress }),
    });
    if (!parsed) return true;
    let comparisonStatistics = null;
    if (upload.comparisonDraftId && parsed.statistics) {
      const previousDraft = await comparisonDraft(client, upload.clientId, upload.comparisonDraftId);
      if (previousDraft.packageFormatVersion === 1) {
      const previousInventory = await readInventory(previousDraft.upload!.filesObjectKey!, previousDraft.upload!.filesSha256!);
      comparisonStatistics = compareFiles(parsed.files, previousInventory.files, parsed.statistics.newDataSize, previousDraft.versionLabel, Number(upload.size));
      }
    }
    const key = `inventories/${upload.id}/${upload.leaseToken}.json`;
    const recipe = "recipeInventory" in parsed ? parsed.recipeInventory : null;
    const statistics = "recipeStatistics" in parsed ? parsed.recipeStatistics : parsed.statistics;
    invariant((upload.packageFormatVersion === 2) === !!recipe, 422, diagnosticText("diagnostics.clientWorker.theProcessingResultDoesNotMatchTheUploadFormat"));
    const stored = await putJson(key, recipe ?? { schemaVersion: 1, files: parsed.files });
    await locked(async db => {
      const fresh = await db.clientUpload.findUnique({ where: { id: upload.id } });
      invariant(fresh?.status === "PROCESSING" && fresh.leaseToken === upload.leaseToken && fresh.leaseUntil && fresh.leaseUntil > new Date(), 409, diagnosticText("diagnostics.clientWorker.theWorkerLeaseIsNoLongerValid"));
      const { actor, scope } = await authorizedOwner(db, fresh);
      invariant(scope.client.currentReleaseId === fresh.baseReleaseId && scope.client.revision === fresh.basePublicationRevision, 409, diagnosticText("diagnostics.clientWorker.theCurrentVersionHasChangedUploadTheLatestCompleteClient"));
      await db.clientUpload.update({ where: { id: upload.id }, data: { status: "READY", progress: 100, leaseUntil: null, leaseToken: null,
        sourceSha256, filesObjectKey: key, filesSha256: stored.sha256, statistics: statistics as unknown as Prisma.InputJsonObject,
        comparisonStatistics: comparisonStatistics ? comparisonStatistics as unknown as Prisma.InputJsonObject : Prisma.JsonNull,
        detectedMods: parsed.detectedMods, detectedInfo: parsed.detectedInfo as unknown as Prisma.InputJsonObject, processingPhase: "CAS", warnings: parsed.warnings } });
      await audit(db, actor, "CLIENT_UPLOAD_READY", "ClientUpload", upload.id, scope.client.organizationId, undefined, { packageFormatVersion: upload.packageFormatVersion, fileCount: recipe?.files.length ?? parsed.files.length, sourceSha256 });
    }, client);
  } catch (error) {
    const message = error instanceof AppError ? serializeError(error) : diagnosticText("diagnostics.clientWorker.zipParsingStorageOrWorkerProcessingFailedCheckThePack");
    await client.clientUpload.updateMany({ where: owner, data: { status: "FAILED", error: message, leaseUntil: null, leaseToken: null } });
    console.error("MUA client processing failed", { uploadId: upload.id, name: error instanceof Error ? error.name : "Error", message: error instanceof Error ? error.message : "unknown" });
  } finally {
    clearInterval(renew); clearTimeout(deadline);
    // mkdtemp returned this exact job directory; never clean a derived pack path.
    invariant(resolve(temp).startsWith(resolve(tmpdir()) + requireSeparator()), 500, diagnosticText("diagnostics.clientWorker.theWorkerTemporaryDirectoryIsOutsideItsExpectedLocation"));
    await rm(temp, { recursive: true, force: true });
  }
  return true;
}
function requireSeparator() { return process.platform === "win32" ? "\\" : "/"; }
export async function expireIncompleteUploads(client: PrismaClient = prisma) {
  const cutoff = new Date(Date.now() - 15 * 60000);
  const expired = await client.clientUpload.findMany({ where: { status: "UPLOADING", expiresAt: { lt: cutoff } }, take: 20 });
  for (const upload of expired) {
    await abortMultipart(upload.sourceObjectKey, upload.multipartId);
    await locked(db => db.clientUpload.updateMany({ where: { id: upload.id, status: "UPLOADING", expiresAt: { lt: cutoff } }, data: { status: "CANCELLED" } }), client);
  }
}
