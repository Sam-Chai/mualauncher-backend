import { z } from "zod";

const bytes = z.string().regex(/^\d+$/).nullable();
const timestamp = z.string().datetime().nullable();
export const telemetryBucketSchema = z.object({
  bucket: z.string(), roles: z.array(z.enum(["PACKAGES", "CAS", "ENVIRONMENTS"])),
  bytes, objects: bytes, observedAt: timestamp,
  method: z.enum(["MINIO_METRICS", "OBJECT_LIST"]),
  status: z.enum(["READY", "ERROR"]),
}).strict();
export const storageTelemetrySchema = z.object({
  provider: z.enum(["minio", "aws", "s3", "ali", "tencent", "huawei"]),
  status: z.enum(["WAITING", "READY", "STALE", "ERROR", "DISABLED"]), collectedAt: timestamp,
  issue: z.union([z.enum(["COLLECTION_FAILED", "METRICS_UNAVAILABLE"]), z.null()]),
  buckets: z.array(telemetryBucketSchema), capacityBytes: bytes, objectCount: bytes,
  traffic: z.object({
    supported: z.boolean(), sentBytes: bytes, receivedBytes: bytes,
    startsAt: timestamp, endsAt: timestamp, samples: z.number().int().nonnegative(), hasGaps: z.boolean(),
  }).strict(),
  history: z.array(z.object({ hour: z.string().datetime(), sentBytes: bytes, receivedBytes: bytes }).strict()),
  cdn: z.literal("NOT_CONNECTED"),
}).strict();
export type TelemetryBucket = z.infer<typeof telemetryBucketSchema>;
export type StorageTelemetry = z.infer<typeof storageTelemetrySchema>;
