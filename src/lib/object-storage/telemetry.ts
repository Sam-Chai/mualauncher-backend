import "server-only";
import { createHash, createHmac } from "node:crypto";
import { storageConfiguration } from "./config";
import { storageClient, packagesBucket, casBucket, environmentsBucket } from "../storage";
import type { ObjectStorage } from "./types";
import type { TelemetryBucket } from "../storage-telemetry-contract";
import { integerMetric, parseMetrics, trafficCounters, type CounterSnapshot, type Metric } from "../storage-telemetry-metrics";

export function telemetryConfiguration() {
  const storage = storageConfiguration();
  const grouped = new Map<string, TelemetryBucket["roles"]>();
  for (const [role, bucket] of [["PACKAGES", packagesBucket()], ["CAS", casBucket()], ["ENVIRONMENTS", environmentsBucket()]] as const)
    grouped.set(bucket, [...(grouped.get(bucket) ?? []), role]);
  const buckets = [...grouped].map(([bucket, roles]) => ({ bucket, roles }));
  const metricsEndpoint = process.env.OSS_METRICS_ENDPOINT?.trim() || storage.endpoint;
  const id = createHash("sha256").update(JSON.stringify([storage.provider, storage.endpoint ?? "", storage.region, buckets, metricsEndpoint ?? ""])).digest("hex");
  return { storage, buckets, metricsEndpoint, id, enabled: process.env.OSS_TELEMETRY_ENABLED?.trim().toLowerCase() !== "false", intervalMs: storage.provider === "minio" ? 60_000 : 900_000 };
}
export type TelemetryConfiguration = ReturnType<typeof telemetryConfiguration>;

export async function inventoryBucket(client: Pick<ObjectStorage, "listObjects">, bucket: string, deadline = Date.now() + 90_000) {
  let bytes = BigInt(0), objects = BigInt(0), token: string | undefined;
  const seen = new Set<string>();
  for (let page = 0; page < 10_000; page++) {
    if (Date.now() > deadline) throw new Error("Inventory deadline exceeded");
    const result = await client.listObjects({ Bucket: bucket, ContinuationToken: token });
    for (const row of result.Contents ?? []) {
      if (!row.Key || row.Size === undefined) throw new Error("Object listing omitted size");
      bytes += BigInt(integerMetric(row.Size)); objects++;
    }
    token = result.NextContinuationToken;
    if (!token) {
      if (result.IsTruncated) throw new Error("Truncated inventory without cursor");
      return { bytes: bytes.toString(), objects: objects.toString() };
    }
    if (seen.has(token)) throw new Error("Repeated inventory cursor");
    seen.add(token);
  }
  throw new Error("Inventory page limit exceeded");
}
function metricsToken(config: TelemetryConfiguration) {
  const provided = process.env.OSS_METRICS_BEARER_TOKEN?.trim();
  if (provided) return provided;
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const payload = encode({ alg: "HS512", typ: "JWT" }) + "." + encode({ sub: config.storage.accessKeyId, iss: "prometheus", exp: Math.floor(Date.now() / 1000) + 300 });
  return payload + "." + createHmac("sha512", config.storage.secretAccessKey).update(payload).digest("base64url");
}
async function metrics(config: TelemetryConfiguration, path: string): Promise<Metric[]> {
  const url = new URL(config.metricsEndpoint!);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("Invalid metrics endpoint");
  url.pathname = path;
  const response = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000),
    headers: { Authorization: `Bearer ${metricsToken(config)}`, ...(config.storage.sessionToken ? { "X-Amz-Security-Token": config.storage.sessionToken } : {}) } });
  if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error("Metrics unavailable"); }
  const chunks: Uint8Array[] = []; let size = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 8 * 1024 * 1024) throw new Error("Metrics response too large");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return parseMetrics(Buffer.concat(chunks).toString("utf8"));
}
export type StorageTelemetryCollection = { buckets: TelemetryBucket[]; counters: CounterSnapshot | null; metricsUnavailable: boolean };
export async function collectStorageMetrics(config = telemetryConfiguration()): Promise<StorageTelemetryCollection> {
  let bucketMetrics: Metric[] | null = null, nodeMetrics: Metric[] | null = null;
  if (config.storage.provider === "minio") {
    const results = await Promise.allSettled([metrics(config, "/minio/v2/metrics/bucket"), metrics(config, "/minio/v2/metrics/node")]);
    if (results[0].status === "fulfilled") bucketMetrics = results[0].value;
    if (results[1].status === "fulfilled") nodeMetrics = results[1].value;
  }
  const now = new Date();
  const ages = bucketMetrics?.filter(row => row.name === "minio_bucket_usage_last_activity_nano_seconds").map(row => row.value / 1e6) ?? [];
  const observedAt = ages.length ? new Date(now.getTime() - Math.max(...ages)).toISOString() : null;
  const buckets = await Promise.all(config.buckets.map(async identity => {
    const usage = bucketMetrics?.filter(row => row.labels.bucket === identity.bucket && row.name === "minio_bucket_usage_total_bytes") ?? [];
    const counts = bucketMetrics?.filter(row => row.labels.bucket === identity.bucket && row.name === "minio_bucket_usage_object_total") ?? [];
    try {
      if (usage.length && counts.length) return { ...identity, bytes: integerMetric(Math.max(...usage.map(row => row.value))),
        objects: integerMetric(Math.max(...counts.map(row => row.value))), observedAt, method: "MINIO_METRICS" as const, status: "READY" as const };
      const result = await inventoryBucket(storageClient(), identity.bucket);
      return { ...identity, ...result, observedAt: new Date().toISOString(), method: "OBJECT_LIST" as const, status: "READY" as const };
    } catch { return { ...identity, bytes: null, objects: null, observedAt: null, method: "OBJECT_LIST" as const, status: "ERROR" as const }; }
  }));
  return { buckets, counters: bucketMetrics && nodeMetrics ? trafficCounters(bucketMetrics, nodeMetrics, config.buckets.map(row => row.bucket), now) : null,
    metricsUnavailable: config.storage.provider === "minio" && (!bucketMetrics || !nodeMetrics) };
}
