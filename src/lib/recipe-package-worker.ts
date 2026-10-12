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

type Context = { draft: ClientDraft; upload: ClientUpload; client: Client };
export async function runRecipePackageBuild(db: PrismaClient, build: PackageBuild, directory: string, signal: AbortSignal,
  checkpoint: (phase: string, progress: number) => Promise<Context>, authorize: (db: Db) => Promise<Context>) {
  let context = await checkpoint("正在准备 v2 完整配方", 10);
  invariant(build.platform === "universal" && build.revision === context.draft.packageRevision, 409, "v2 组包方案已改变");
  const target = await recipeDraftTarget(db, context.draft), targetBytes = encodeMuaJson(target);
  const targetObjectKey = `muapacks/${context.client.id}/${build.draftId}/universal/r${build.revision}/targets/${digest(targetBytes)}.json`;
  if (build.targetObjectKey) {
    const stored = await readObject(build.targetObjectKey);
    invariant(build.targetObjectKey === targetObjectKey && digest(stored) === build.targetSha256 && stored.equals(targetBytes), 422, "v2 已准备清单与当前方案不一致");
  } else {
    await putImmutableBytes(packagesBucket(), targetObjectKey, targetBytes); await checkpoint("配方已准备", 40);
    await locked(async tx => {
      const current = await tx.packageBuild.findUniqueOrThrow({ where: { id: build.id } });
      invariant(current.status === "PROCESSING" && current.required && current.leaseToken === build.leaseToken, 409, "v2 组包租约失效");
      await authorize(tx); await tx.packageBuild.update({ where: { id: build.id }, data: { targetObjectKey, targetSha256: digest(targetBytes) } });
    }, db);
  }
  context = await checkpoint("等待审核签名", 40);
  if (context.draft.status !== "APPROVED") {
    await locked(async tx => { const current = await tx.packageBuild.findUniqueOrThrow({ where: { id: build.id } });
      invariant(current.status === "PROCESSING" && current.required && current.leaseToken === build.leaseToken, 409, "v2 组包租约失效"); await authorize(tx);
      await tx.packageBuild.update({ where: { id: build.id }, data: { status: "PREPARED", phase: "配方已准备 · 等待审核签名", progress: 40, attempts: 0, leaseToken: null, leaseUntil: null } });
    }, db); return;
  }
  invariant(context.draft.reviewedRevision === context.draft.contentRevision && context.draft.reviewedPackageRevision === context.draft.packageRevision, 409, "v2 签名需要有效审核");
  const metadata = createRecipePackMetadata(targetBytes), identity = await signingIdentity();
  const base = await recipeUpdateBase(db, target, context.upload.baseReleaseId);
  const localFiles = new Map<string, string>(); let count = 0;
  for (const file of metadata.payload) {
    signal.throwIfAborted();
    if (!localFiles.has(file.sha256)) { const path = join(directory, `local-${file.sha256}`); await downloadStoredFile(casBucket(), casKey(file.sha256), path, file.sha256, file.size, signal); localFiles.set(file.sha256, path); }
    await checkpoint("正在读取已校验的本地 overrides", 40 + Math.floor(++count / metadata.payload.length * 35));
  }
  async function assemble(baseBytes: Buffer | null) {
    const metadata = createRecipePackMetadata(targetBytes, baseBytes), bytes = encodeMuaJson(metadata), signature = signRecipePackMetadata(bytes, identity.privateKey);
    const label = baseBytes ? "更新包" : "完整包", progress = baseBytes ? 90 : 80;
    await checkpoint(`正在生成 v2 ${label}`, progress);
    const zip = new ZipFile(), path = join(directory, `${metadata.packageType}-v2.muapack`), options = { mtime: new Date("1980-01-01T00:00:00Z"), mode: 0o100644, compress: true };
    zip.addBuffer(bytes, "mua-pack.json", options); zip.addBuffer(targetBytes, "metadata/target-manifest.json", options);
    if (baseBytes) zip.addBuffer(baseBytes, "metadata/base-manifest.json", options);
    zip.addBuffer(encodeMuaJson(recipeModrinthIndex(target)), "modrinth.index.json", options); zip.addBuffer(signature, "metadata/signature.json", options);
    for (const file of metadata.payload) zip.addFile(localFiles.get(file.sha256)!, file.entry, { ...options, compress: false });
    zip.on("error", error => (zip.outputStream as NodeJS.ReadableStream & { destroy(error: Error): void }).destroy(error));
    const done = pipeline(zip.outputStream, createWriteStream(path, { flags: "wx" }), { signal }); zip.end({ forceZip64Format: true, comment: "" }); await done;
    await checkpoint(`正在校验 v2 ${label}与签名`, progress + 4); await validateRecipePackArchive(path, createPublicKey(identity.privateKey), { signal });
    await checkpoint(`正在保存 v2 ${label}`, progress + 6);
    return uploadPackageFile(`muapacks/${context.client.id}/${build.draftId}/universal/r${build.revision}/${build.leaseToken}/${metadata.packageType}.muapack`, path, signal);
  }
  const full = await assemble(null), update = base ? { ...await assemble(base.bytes), baseReleaseId: base.release.id, baseManifestSha256: base.release.manifestSha256 } : null;
  const artifacts = packageArtifactsSchema.parse({ full, update, signingKeyId: identity.keyId }); await checkpoint("已生成并校验", 100);
  await locked(async tx => {
    const current = await tx.packageBuild.findUniqueOrThrow({ where: { id: build.id } });
    invariant(current.status === "PROCESSING" && current.required && current.leaseToken === build.leaseToken && current.leaseUntil && current.leaseUntil > new Date(), 409, "v2 组包租约失效");
    const final = await authorize(tx);
    invariant(final.draft.status === "APPROVED" && final.draft.packageRevision === build.revision && final.draft.reviewedPackageRevision === build.revision && final.draft.reviewedRevision === final.draft.contentRevision, 409, "v2 审核或平台方案已改变");
    await tx.packageBuild.update({ where: { id: build.id }, data: { status: "READY", phase: update ? "v2 完整包与更新包已生成并校验" : "v2 完整包已生成并校验", progress: 100, artifacts: artifacts as Prisma.InputJsonObject,
      error: null, leaseToken: null, leaseUntil: null } });
  }, db);
}
