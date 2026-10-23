import { diagnosticText } from "@/lib/diagnostics";
import "server-only";
import { createPublicKey } from "node:crypto";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { join } from "node:path";
import { ZipFile } from "yazl";
import { Prisma, type PrismaClient, type ClientDraft, type ClientUpload, type Client, type PackageBuild } from "@/generated/prisma/client";
import { locked, type Db } from "./auth";
import { invariant } from "./errors";
import { packagesBucket, casBucket, casKey, readObject, digest } from "./storage";
import { putImmutableBytes, downloadStoredFile, uploadPackageFile } from "./package-storage";
import { encodeMuaJson } from "./muapack-protocol";
import { recipeDraftTarget, recipeUpdateBase } from "./recipe-package-service";
import { createRecipePackMetadata, recipeModrinthIndex, signRecipePackMetadata } from "./muapack-v2-protocol";
import { validateRecipePackArchive } from "./muapack-v2-archive";
import { signingIdentity } from "./signing";
import { packageArtifactsSchema } from "./package-contract";
import { assertDistributableFiles } from "./pack-file-policy";

type Context = { draft: ClientDraft; upload: ClientUpload; client: Client };
export async function runRecipePackageBuild(db: PrismaClient, build: PackageBuild, directory: string, signal: AbortSignal,
  checkpoint: (phase: string, progress: number) => Promise<Context>, authorize: (db: Db) => Promise<Context>) {
  let context = await checkpoint(diagnosticText("diagnostics.recipePackageWorker.preparingTheCompleteV2Recipe"), 10);
  invariant(build.platform === "universal" && build.revision === context.draft.packageRevision, 409, diagnosticText("diagnostics.recipePackageWorker.theV2BuildPlanHasChanged"));
  const target = await recipeDraftTarget(db, context.draft), targetBytes = encodeMuaJson(target);
  assertDistributableFiles(target.files);
  const targetObjectKey = `muapacks/${context.client.id}/${build.draftId}/universal/r${build.revision}/targets/${digest(targetBytes)}.json`;
  if (build.targetObjectKey) {
    const stored = await readObject(build.targetObjectKey);
    invariant(build.targetObjectKey === targetObjectKey && digest(stored) === build.targetSha256 && stored.equals(targetBytes), 422, diagnosticText("diagnostics.recipePackageWorker.thePreparedV2ManifestDoesNotMatchTheCurrentPlan"));
  } else {
    await putImmutableBytes(packagesBucket(), targetObjectKey, targetBytes); await checkpoint(diagnosticText("diagnostics.recipePackageWorker.recipePrepared"), 40);
    await locked(async tx => {
      const current = await tx.packageBuild.findUniqueOrThrow({ where: { id: build.id } });
      invariant(current.status === "PROCESSING" && current.required && current.leaseToken === build.leaseToken, 409, diagnosticText("diagnostics.recipePackageWorker.theV2BuildLeaseIsNoLongerValid"));
      await authorize(tx); await tx.packageBuild.update({ where: { id: build.id }, data: { targetObjectKey, targetSha256: digest(targetBytes) } });
    }, db);
  }
  context = await checkpoint(diagnosticText("diagnostics.packageWorker.awaitingReviewAndSignature"), 40);
  if (context.draft.status !== "APPROVED") {
    await locked(async tx => { const current = await tx.packageBuild.findUniqueOrThrow({ where: { id: build.id } });
      invariant(current.status === "PROCESSING" && current.required && current.leaseToken === build.leaseToken, 409, diagnosticText("diagnostics.recipePackageWorker.theV2BuildLeaseIsNoLongerValid")); await authorize(tx);
      await tx.packageBuild.update({ where: { id: build.id }, data: { status: "PREPARED", phase: diagnosticText("diagnostics.recipePackageWorker.recipePreparedAwaitingReviewAndSignature"), progress: 40, attempts: 0, leaseToken: null, leaseUntil: null } });
    }, db); return;
  }
  invariant(context.draft.reviewedRevision === context.draft.contentRevision && context.draft.reviewedPackageRevision === context.draft.packageRevision, 409, diagnosticText("diagnostics.recipePackageWorker.v2SigningRequiresAValidApproval"));
  const metadata = createRecipePackMetadata(targetBytes), identity = await signingIdentity();
  const base = await recipeUpdateBase(db, target, context.upload.baseReleaseId);
  const localFiles = new Map<string, string>(); let count = 0;
  for (const file of metadata.payload) {
    signal.throwIfAborted();
    if (!localFiles.has(file.sha256)) { const path = join(directory, `local-${file.sha256}`); await downloadStoredFile(casBucket(), casKey(file.sha256), path, file.sha256, file.size, signal); localFiles.set(file.sha256, path); }
    await checkpoint(diagnosticText("diagnostics.recipePackageWorker.readingVerifiedLocalOverrides"), 40 + Math.floor(++count / metadata.payload.length * 35));
  }
  async function assemble(baseBytes: Buffer | null) {
    const metadata = createRecipePackMetadata(targetBytes, baseBytes), bytes = encodeMuaJson(metadata), signature = signRecipePackMetadata(bytes, identity.privateKey);
    const label = baseBytes ? diagnosticText("diagnostics.recipePackageWorker.updatePackage") : diagnosticText("diagnostics.recipePackageWorker.fullPackage"), progress = baseBytes ? 90 : 80;
    await checkpoint(diagnosticText("diagnostics.recipePackageWorker.generatingV20", { arg0: label }), progress);
    const zip = new ZipFile(), path = join(directory, `${metadata.packageType}-v2.muapack`), options = { mtime: new Date("1980-01-01T00:00:00Z"), mode: 0o100644, compress: true };
    zip.addBuffer(bytes, "mua-pack.json", options); zip.addBuffer(targetBytes, "metadata/target-manifest.json", options);
    if (baseBytes) zip.addBuffer(baseBytes, "metadata/base-manifest.json", options);
    zip.addBuffer(encodeMuaJson(recipeModrinthIndex(target)), "modrinth.index.json", options); zip.addBuffer(signature, "metadata/signature.json", options);
    for (const file of metadata.payload) zip.addFile(localFiles.get(file.sha256)!, file.entry, { ...options, compress: false });
    zip.on("error", error => (zip.outputStream as NodeJS.ReadableStream & { destroy(error: Error): void }).destroy(error));
    const done = pipeline(zip.outputStream, createWriteStream(path, { flags: "wx" }), { signal }); zip.end({ forceZip64Format: true, comment: "" }); await done;
    await checkpoint(diagnosticText("diagnostics.recipePackageWorker.validatingV20AndSignature", { arg0: label }), progress + 4); await validateRecipePackArchive(path, createPublicKey(identity.privateKey), { signal });
    await checkpoint(diagnosticText("diagnostics.recipePackageWorker.savingV20", { arg0: label }), progress + 6);
    return uploadPackageFile(`muapacks/${context.client.id}/${build.draftId}/universal/r${build.revision}/${build.leaseToken}/${metadata.packageType}.muapack`, path, signal);
  }
  const full = await assemble(null), update = base ? { ...await assemble(base.bytes), baseReleaseId: base.release.id, baseManifestSha256: base.release.manifestSha256 } : null;
  const artifacts = packageArtifactsSchema.parse({ full, update, signingKeyId: identity.keyId }); await checkpoint(diagnosticText("diagnostics.packageWorker.generatedAndVerified"), 100);
  await locked(async tx => {
    const current = await tx.packageBuild.findUniqueOrThrow({ where: { id: build.id } });
    invariant(current.status === "PROCESSING" && current.required && current.leaseToken === build.leaseToken && current.leaseUntil && current.leaseUntil > new Date(), 409, diagnosticText("diagnostics.recipePackageWorker.theV2BuildLeaseIsNoLongerValid"));
    const final = await authorize(tx);
    invariant(final.draft.status === "APPROVED" && final.draft.packageRevision === build.revision && final.draft.reviewedPackageRevision === build.revision && final.draft.reviewedRevision === final.draft.contentRevision, 409, diagnosticText("diagnostics.recipePackageWorker.theV2ReviewOrPlatformPlanHasChanged"));
    await tx.packageBuild.update({ where: { id: build.id }, data: { status: "READY", phase: update ? diagnosticText("diagnostics.recipePackageWorker.v2FullAndUpdatePackagesGeneratedAndVerified") : diagnosticText("diagnostics.recipePackageWorker.v2FullPackageGeneratedAndVerified"), progress: 100, artifacts: artifacts as Prisma.InputJsonObject,
      error: null, leaseToken: null, leaseUntil: null } });
  }, db);
}
