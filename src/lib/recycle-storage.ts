import "server-only";
import { createHash } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import type { Db, Actor } from "./auth";
import { workerPrisma as prisma } from "./prisma";
import { invariant } from "./errors";
import { superOnly } from "./rbac";
import { audit } from "./management";
import { z } from "zod";
import { parseRecipeInventory } from "./recipe-inventory";
import { readRecipeContent, readRecipeManifest } from "./muapack-v2-protocol";
import { storageClient, missingObject, casBucket, packagesBucket, casKey, putCas, readObject, digest, abortMultipart } from "./storage";

const transactionOptions = { maxWait: 10000, timeout: 2 * 60 * 60 * 1000 };
const trashCasKey = (sha: string) => `recycle/cas/${casKey(sha)}`;
async function head(bucket: string, key: string) {
  try { return await storageClient().headObject({ Bucket: bucket, Key: key }); }
  catch (error) { if (missingObject(error)) return null; throw error; }
}
async function remove(bucket: string, key: string) { await storageClient().deleteObject({ Bucket: bucket, Key: key }); }

// Each provider has a different single-copy limit. Preserve metadata and pin the source ETag.
export async function copyStoredObject(bucket: string, source: string, target: string) {
  const found = await head(bucket, source); invariant(found && found.ContentLength !== undefined, 422, "回收文件不存在");
  const s3 = storageClient(); const CopySource = `${encodeURIComponent(bucket)}/${source.split("/").map(encodeURIComponent).join("/")}`;
  if (found.ContentLength <= s3.singleCopyLimitBytes) {
    await s3.copyObject({ Bucket: bucket, Key: target, CopySource, CopySourceIfMatch: found.ETag });
  } else {
    const created = await s3.createMultipartUpload({ Bucket: bucket, Key: target, ContentType: found.ContentType, Metadata: found.Metadata });
    invariant(created.UploadId, 503, "无法创建回收复制任务");
    const identity = { Bucket: bucket, Key: target, UploadId: created.UploadId }; const parts = [];
    try {
      const partSize = 512 * 1024 ** 2;
      for (let start = 0, number = 1; start < found.ContentLength; start += partSize, number++) {
        const copied = await s3.uploadPartCopy({ ...identity, PartNumber: number, CopySource, CopySourceIfMatch: found.ETag,
          CopySourceRange: `bytes=${start}-${Math.min(found.ContentLength - 1, start + partSize - 1)}` });
        invariant(copied.CopyPartResult?.ETag, 503, "回收复制分片失败"); parts.push({ PartNumber: number, ETag: copied.CopyPartResult.ETag });
      }
      await s3.completeMultipartUpload({ ...identity, MultipartUpload: { Parts: parts } });
    } catch (error) { await s3.abortMultipartUpload(identity).catch(() => {}); throw error; }
  }
  const copied = await head(bucket, target);
  invariant(copied?.ContentLength === found.ContentLength, 422, "回收复制大小校验失败");
}
async function verifyCas(key: string, sha: string, size: number) {
  const object = await storageClient().getObject({ Bucket: casBucket(), Key: key });
  const body = object.Body as (AsyncIterable<Uint8Array> & { destroy?: () => void }) | undefined;
  if (!body || object.ContentLength !== size) body?.destroy?.();
  invariant(object.Body && object.ContentLength === size, 422, "回收站 CAS 大小校验失败");
  const hash = createHash("sha256"); let length = 0;
  for await (const chunk of object.Body as AsyncIterable<Uint8Array>) { length += chunk.length; invariant(length <= size, 422, "回收站 CAS 大小校验失败"); hash.update(chunk); }
  invariant(length === size && hash.digest("hex") === sha, 422, "回收站 CAS SHA-256 校验失败");
}
async function hashLock(db: Db, sha: string) {
  const key = Buffer.from(sha.slice(0, 8), "hex").readInt32BE();
  await db.$executeRaw`SELECT pg_advisory_xact_lock(731403, ${key}::integer)`;
}
async function register(db: Db, clientId: string, sha256: string, size: number) {
  const object = await db.casObject.upsert({ where: { sha256 }, create: { sha256, size: BigInt(size) }, update: {} });
  invariant(object.size === BigInt(size), 422, "CAS 文件大小冲突");
  await db.casReference.upsert({ where: { clientId_sha256: { clientId, sha256 } }, create: { clientId, sha256 }, update: {} });
}
export async function putTrackedCas(clientId: string, sha: string, path: string, size: number, client: PrismaClient = prisma) {
  return client.$transaction(async db => {
    await hashLock(db, sha);
    const owner = await db.client.findUnique({ where: { id: clientId } }); invariant(owner && !owner.deletedAt, 409, "客户端已删除");
    await register(db, clientId, sha, size);
    const trashKey = trashCasKey(sha);
    if (await head(casBucket(), trashKey)) {
      await verifyCas(trashKey, sha, size);
      if (!await head(casBucket(), casKey(sha))) await copyStoredObject(casBucket(), trashKey, casKey(sha));
      await verifyCas(casKey(sha), sha, size);
      await remove(casBucket(), trashKey);
    }
    const added = await putCas(sha, path, size);
    await db.casObject.update({ where: { sha256: sha }, data: { trashedAt: null, purgedAt: null } });
    return added;
  }, transactionOptions);
}

const fileList = z.object({ files: z.array(z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/), size: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) })).max(100000) });
// A safety barrier: existing manifests must be indexed before shared CAS objects can be recycled.
export async function indexClientStorage(client: PrismaClient = prisma) {
  const owners = await client.client.findMany({ where: { storageIndexedAt: null }, take: 4, orderBy: { createdAt: "asc" },
    include: { uploads: true, drafts: true, releases: true } });
  for (const owner of owners) {
    const indexes = new Map<string, string>();
    for (const upload of owner.uploads) if (upload.filesObjectKey && upload.filesSha256) indexes.set(upload.filesObjectKey, upload.filesSha256);
    for (const draft of owner.drafts) if (draft.candidateManifestKey && draft.candidateManifestSha256) indexes.set(draft.candidateManifestKey, draft.candidateManifestSha256);
    for (const release of owner.releases) indexes.set(release.manifestObjectKey, release.manifestSha256);
    const files = new Map<string, number>();
    for (const [key, sha] of indexes) {
      const bytes = await readObject(key); invariant(digest(bytes) === sha, 422, "历史文件索引校验失败；回收清理暂停");
      const raw = JSON.parse(bytes.toString("utf8"));
      const recipe = raw?.format === "mua-recipe-content" ? readRecipeContent(bytes) : raw?.format === "mua-recipe-manifest" ? readRecipeManifest(bytes) :
        raw?.schemaVersion === 2 && raw?.format === "mua-import-recipe" ? parseRecipeInventory(raw) : null;
      const localFiles = recipe ? recipe.files
        .filter(file => file.source.type === "local").map(file => ({ sha256: file.hashes.sha256, size: file.size })) : raw;
      const parsed = fileList.safeParse(Array.isArray(localFiles) ? { files: localFiles } : localFiles); invariant(parsed.success, 422, "历史文件索引无效；回收清理暂停");
      for (const file of parsed.data.files) { invariant(!files.has(file.sha256) || files.get(file.sha256) === file.size, 422, "历史 CAS 文件大小冲突"); files.set(file.sha256, file.size); }
    }
    await client.$transaction(async db => {
      // No GC can pass the index barrier until these references have committed.
      // Batch legacy manifests so large clients do not need three queries per file.
      const ordered = [...files].sort(([a], [b]) => a.localeCompare(b));
      for (let start = 0; start < ordered.length; start += 1000) {
        const batch = ordered.slice(start, start + 1000);
        await db.casObject.createMany({ data: batch.map(([sha256, size]) => ({ sha256, size: BigInt(size) })), skipDuplicates: true });
        const stored = await db.casObject.findMany({ where: { sha256: { in: batch.map(([sha]) => sha) } } });
        invariant(stored.every(object => object.size === BigInt(files.get(object.sha256)!)), 422, "历史 CAS 文件大小冲突");
        await db.casReference.createMany({ data: batch.map(([sha256]) => ({ sha256, clientId: owner.id })), skipDuplicates: true });
      }
      await db.client.update({ where: { id: owner.id }, data: { storageIndexedAt: new Date() } });
    }, transactionOptions);
  }
  return await client.client.count({ where: { storageIndexedAt: null } }) === 0;
}

export async function recycleSettings(db: Db, actor: Actor) {
  superOnly(actor); const settings = await db.platformSettings.findUnique({ where: { id: "platform" } });
  return { recycleRetentionDays: settings?.recycleRetentionDays ?? 7 };
}
export async function updateRecycleSettings(db: Db, actor: Actor, raw: unknown) {
  superOnly(actor); const parsed = z.object({ recycleRetentionDays: z.number().int().min(1).max(365) }).strict().safeParse(raw);
  invariant(parsed.success, 400, "回收站保留期必须为 1–365 天的整数");
  await db.platformSettings.upsert({ where: { id: "platform" }, create: { id: "platform", ...parsed.data }, update: parsed.data });
  await audit(db, actor, "RECYCLE_SETTINGS_UPDATE", "PlatformSettings", "platform", undefined, undefined, parsed.data);
  return parsed.data;
}

export async function maintainRecycleBin(client: PrismaClient = prisma, now = new Date()) {
  if (!await indexClientStorage(client)) return;
  // Round-robin reconciliation also catches S3 completions that raced a deletion.
  const owners = await client.client.findMany({ where: { deletedAt: { not: null } }, take: 4, orderBy: [{ recycledAt: { sort: "asc", nulls: "first" } }, { id: "asc" }],
    include: { uploads: true, drafts: true, releases: true } });
  for (const owner of owners) {
    await client.$transaction(async db => {
      await db.$executeRaw`SELECT pg_advisory_xact_lock(731404, hashtext(${owner.id}))`;
      const keys = new Set<string>();
      for (const upload of owner.uploads) { await abortMultipart(upload.sourceObjectKey, upload.multipartId); keys.add(upload.sourceObjectKey); if (upload.filesObjectKey) keys.add(upload.filesObjectKey); }
      for (const draft of owner.drafts) { if (draft.sourceObjectKey) keys.add(draft.sourceObjectKey); if (draft.candidateManifestKey) keys.add(draft.candidateManifestKey); }
      for (const release of owner.releases) keys.add(release.manifestObjectKey);
      // Include failed attempts and lease-loss artifacts, not only the winning database pointer.
      let continuation: string | undefined;
      do {
        const objects = await storageClient().listObjects({ Bucket: packagesBucket(), Prefix: `muapacks/${owner.id}/`, ContinuationToken: continuation });
        for (const object of objects.Contents ?? []) if (object.Key) keys.add(object.Key);
        continuation = objects.NextContinuationToken;
      } while (continuation);
      for (const key of keys) {
        const bucket = packagesBucket(); const trashKey = `recycle/clients/${owner.id}/${key}`;
        const row = await db.recycleObject.upsert({ where: { bucket_objectKey: { bucket, objectKey: key } }, create: { bucket, objectKey: key, trashKey, clientId: owner.id }, update: {} });
        if (await head(bucket, key)) {
          await copyStoredObject(bucket, key, trashKey); await remove(bucket, key);
          await db.recycleObject.update({ where: { bucket_objectKey: { bucket, objectKey: key } }, data: { trashedAt: now, purgedAt: null } });
        } else if (!row.trashedAt || (row.purgedAt && await head(bucket, trashKey))) {
          await db.recycleObject.update({ where: { bucket_objectKey: { bucket, objectKey: key } }, data: { trashedAt: now, purgedAt: null } });
        }
      }
      await db.client.update({ where: { id: owner.id }, data: { recycledAt: now } });
    }, transactionOptions);
  }
  // Reconsider previously shared files after the last live reference disappears.
  const candidates = await client.casObject.findMany({ where: { purgedAt: null, trashedAt: null,
    references: { some: { client: { deletedAt: { not: null }, recycledAt: { not: null } } }, none: { client: { deletedAt: null } } } }, take: 200 });
  for (const object of candidates) await client.$transaction(async db => {
    await hashLock(db, object.sha256);
    if (await db.casReference.count({ where: { sha256: object.sha256, client: { deletedAt: null } } })) return;
    const row = await db.casObject.findUniqueOrThrow({ where: { sha256: object.sha256 } }); if (row.trashedAt || row.purgedAt) return;
    const key = casKey(object.sha256), trash = trashCasKey(object.sha256);
    if (await head(casBucket(), key)) {
      await copyStoredObject(casBucket(), key, trash); await verifyCas(trash, object.sha256, Number(object.size)); await remove(casBucket(), key);
    } else await verifyCas(trash, object.sha256, Number(object.size));
    await db.casObject.update({ where: { sha256: object.sha256 }, data: { trashedAt: now } });
  }, transactionOptions);
  const settings = await client.platformSettings.findUnique({ where: { id: "platform" } });
  const cutoff = new Date(now.getTime() - (settings?.recycleRetentionDays ?? 7) * 86400000);
  const expiredFiles = await client.casObject.findMany({ where: { trashedAt: { lte: cutoff }, purgedAt: null }, take: 200 });
  for (const object of expiredFiles) await client.$transaction(async db => {
    await hashLock(db, object.sha256);
    const row = await db.casObject.findUniqueOrThrow({ where: { sha256: object.sha256 } });
    if (!row.trashedAt || row.trashedAt > cutoff || row.purgedAt || await db.casReference.count({ where: { sha256: object.sha256, client: { deletedAt: null } } })) return;
    await remove(casBucket(), trashCasKey(object.sha256));
    await db.casObject.update({ where: { sha256: object.sha256 }, data: { purgedAt: now } });
  }, transactionOptions);
  const expiredPackages = await client.recycleObject.findMany({ where: { trashedAt: { lte: cutoff }, purgedAt: null }, take: 100 });
  for (const object of expiredPackages) await client.$transaction(async db => {
    await db.$executeRaw`SELECT pg_advisory_xact_lock(731404, hashtext(${object.clientId}))`;
    const row = await db.recycleObject.findUniqueOrThrow({ where: { bucket_objectKey: { bucket: object.bucket, objectKey: object.objectKey } } });
    if (!row.trashedAt || row.trashedAt > cutoff || row.purgedAt) return;
    await remove(object.bucket, object.trashKey);
    await db.recycleObject.update({ where: { bucket_objectKey: { bucket: object.bucket, objectKey: object.objectKey } }, data: { purgedAt: now } });
  }, transactionOptions);
}
