import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Actor, Db } from "./auth";
import type { PrismaClient, Prisma } from "@/generated/prisma/client";
import { superOnly } from "./rbac";
import { collectStorageMetrics, telemetryConfiguration } from "./object-storage/telemetry";
import { counterDelta, counterSnapshotSchema, sumKnown } from "./storage-telemetry-metrics";
import { storageTelemetrySchema, telemetryBucketSchema, type StorageTelemetry } from "./storage-telemetry-contract";

const snapshotSchema = z.array(telemetryBucketSchema);
const deltasSchema = z.array(z.object({ bucket: z.string(), sentBytes: z.string().nullable(), receivedBytes: z.string().nullable() }));
// One lease per backend, shared by all Worker processes. No network I/O inside a database transaction.
export async function collectStorageTelemetry(db: PrismaClient) {
  const config = telemetryConfiguration();
  if (!config.enabled) return false;
  const now = new Date(), leaseToken = randomUUID();
  await db.storageTelemetrySource.upsert({ where: { id: config.id }, create: { id: config.id, provider: config.storage.provider, nextCollectAt: now }, update: {} });
  const claimed = await db.storageTelemetrySource.updateMany({ where: { id: config.id, nextCollectAt: { lte: now },
    OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] }, data: { leaseToken, leaseUntil: new Date(now.getTime() + 300_000), attemptedAt: now } });
  if (!claimed.count) return false;
  try {
    const previous = await db.storageTelemetrySource.findUniqueOrThrow({ where: { id: config.id } });
    const collection = await collectStorageMetrics(config);
    const collectedAt = new Date();
    const oldSnapshot = snapshotSchema.safeParse(previous.snapshot);
    const snapshot = collection.buckets.map(row => row.status === "ERROR" ? { ...(oldSnapshot.success ? oldSnapshot.data.find(old => old.bucket === row.bucket) ?? row : row), status: "ERROR" as const } : row);
    const oldCounters = counterSnapshotSchema.safeParse(previous.counters);
    const counters = collection.counters;
    const prior = oldCounters.success ? oldCounters.data : null;
    const deltas = counters ? config.buckets.map(({ bucket }) => ({ bucket,
      sentBytes: counterDelta(prior, counters, bucket, "sent"), receivedBytes: counterDelta(prior, counters, bucket, "received") })) : [];
    const issue = collection.buckets.some(row => row.status === "ERROR") ? "COLLECTION_FAILED" : collection.metricsUnavailable ? "METRICS_UNAVAILABLE" : null;
    const sent = sumKnown(deltas.map(row => row.sentBytes)), received = sumKnown(deltas.map(row => row.receivedBytes));
    await db.$transaction(async tx => {
      const owned = await tx.storageTelemetrySource.updateMany({ where: { id: config.id, leaseToken }, data: {
        snapshot, ...(counters ? { counters: counters as Prisma.InputJsonValue } : {}), sampledAt: collectedAt, error: issue,
        leaseToken: null, leaseUntil: null, nextCollectAt: new Date(collectedAt.getTime() + (issue ? 900_000 : config.intervalMs)),
      } });
      if (!owned.count) return;
      if (prior && counters && new Date(counters.at) > new Date(prior.at)) await tx.storageTelemetrySample.create({ data: {
        sourceId: config.id, startsAt: new Date(prior.at), endsAt: new Date(counters.at),
        sentBytes: sent === null ? null : BigInt(sent), receivedBytes: received === null ? null : BigInt(received), buckets: deltas,
      } });
      await tx.storageTelemetrySample.deleteMany({ where: { sourceId: config.id, endsAt: { lt: new Date(collectedAt.getTime() - 90 * 86400_000) } } });
    });
    return true;
  } catch {
    await db.storageTelemetrySource.updateMany({ where: { id: config.id, leaseToken }, data: {
      error: "COLLECTION_FAILED", leaseToken: null, leaseUntil: null, nextCollectAt: new Date(Date.now() + 60_000),
    } });
    return false;
  }
}
export async function storageTelemetry(db: Db, actor: Actor, now = new Date()): Promise<StorageTelemetry> {
  superOnly(actor);
  const config = telemetryConfiguration();
  const source = await db.storageTelemetrySource.findUnique({ where: { id: config.id } });
  const parsed = snapshotSchema.safeParse(source?.snapshot);
  const buckets = parsed.success ? parsed.data : [];
  const start = new Date(Math.floor((now.getTime() + 8 * 3600_000) / 86400_000) * 86400_000 - 8 * 3600_000);
  const samples = await db.storageTelemetrySample.findMany({ where: { sourceId: config.id, startsAt: { gte: new Date(now.getTime() - 86400_000) }, endsAt: { lte: now } }, orderBy: { startsAt: "asc" }, take: 2000 });
  const today = samples.filter(row => row.startsAt >= start);
  const valid = today.filter(row => row.sentBytes !== null || row.receivedBytes !== null);
  const hasGaps = !valid.length || valid[0].startsAt.getTime() > start.getTime() ||
    now.getTime() - valid.at(-1)!.endsAt.getTime() > config.intervalMs * 2 ||
    today.some((row, index) => {
      const deltas = deltasSchema.safeParse(row.buckets);
      return row.sentBytes === null || row.receivedBytes === null || !deltas.success || deltas.data.length !== config.buckets.length ||
        deltas.data.some(bucket => bucket.sentBytes === null || bucket.receivedBytes === null) ||
        index > 0 && row.startsAt.getTime() > today[index - 1].endsAt.getTime();
    });
  const history: StorageTelemetry["history"] = [];
  // These are observed intervals grouped by collection end time, not an estimated per-hour transfer rate.
  for (let i = 23; i >= 0; i--) {
    const hour = new Date(Math.floor(now.getTime() / 3600_000) * 3600_000 - i * 3600_000);
    const rows = samples.filter(row => row.endsAt >= hour && row.endsAt.getTime() < hour.getTime() + 3600_000);
    history.push({ hour: hour.toISOString(), sentBytes: sumKnown(rows.map(row => row.sentBytes?.toString() ?? null)), receivedBytes: sumKnown(rows.map(row => row.receivedBytes?.toString() ?? null)) });
  }
  const intervalMs = source?.error === "METRICS_UNAVAILABLE" ? 900_000 : config.intervalMs;
  const stale = !!source?.sampledAt && now.getTime() - source.sampledAt.getTime() > intervalMs * 3;
  return storageTelemetrySchema.parse({ provider: config.storage.provider,
    status: !config.enabled ? "DISABLED" : !source?.sampledAt ? source?.error ? "ERROR" : "WAITING" : source.error === "COLLECTION_FAILED" ? "ERROR" : stale ? "STALE" : "READY",
    collectedAt: source?.sampledAt?.toISOString() ?? null, issue: source?.error ?? null, buckets,
    capacityBytes: buckets.length === config.buckets.length && buckets.every(row => row.bytes !== null) ? sumKnown(buckets.map(row => row.bytes)) : null,
    objectCount: buckets.length === config.buckets.length && buckets.every(row => row.objects !== null) ? sumKnown(buckets.map(row => row.objects)) : null,
    traffic: { supported: config.storage.provider === "minio", sentBytes: sumKnown(today.map(row => row.sentBytes?.toString() ?? null)),
      receivedBytes: sumKnown(today.map(row => row.receivedBytes?.toString() ?? null)), startsAt: valid[0]?.startsAt.toISOString() ?? null,
      endsAt: valid.at(-1)?.endsAt.toISOString() ?? null, samples: valid.length,
      hasGaps }, history, cdn: "NOT_CONNECTED",
  });
}
