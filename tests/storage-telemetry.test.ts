import "dotenv/config";
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseMetrics, trafficCounters, counterDelta, sumKnown } from "../src/lib/storage-telemetry-metrics";
import { inventoryBucket, telemetryConfiguration } from "../src/lib/object-storage/telemetry";
import type { ObjectStorage } from "../src/lib/object-storage/types";

const at = new Date("2026-10-18T01:00:00Z");
const sample = (value: number, generation = 100, server = "node1") => trafficCounters(
  parseMetrics(`minio_bucket_traffic_sent_bytes{bucket="packs",server="${server}"} ${value}`),
  parseMetrics(`minio_node_process_starttime_seconds{server="${server}"} ${generation}`), ["packs"], at);

test("Prometheus parsing preserves escaped labels, handles scientific notation and rejects invalid data", () => {
  const rows = parseMetrics('# HELP test data\nmetric{bucket="a\\\"b",server="x"} 1.234e3\nother +Inf\n');
  assert.equal(rows.length, 1); assert.equal(rows[0].labels.bucket, 'a"b'); assert.equal(rows[0].value, 1234);
  assert.throws(() => parseMetrics('metric{broken} 1'));
  assert.throws(() => parseMetrics('not a metric response'));
  assert.throws(() => trafficCounters(parseMetrics('minio_bucket_traffic_sent_bytes{bucket="packs"} 1e20'), [], ["packs"], at));
});
test("counter deltas never turn first samples, missing series, resets or changed nodes into downloads", () => {
  assert.equal(counterDelta(null, sample(100), "packs", "sent"), null);
  assert.equal(counterDelta(sample(100), sample(150), "packs", "sent"), "50");
  assert.equal(counterDelta(sample(100), sample(100), "packs", "sent"), "0");
  assert.equal(counterDelta(sample(100), sample(5), "packs", "sent"), null);
  assert.equal(counterDelta(sample(100), sample(500, 200), "packs", "sent"), null);
  assert.equal(counterDelta(sample(100), sample(500, 100, "node2"), "packs", "sent"), null);
  assert.equal(counterDelta(sample(100), sample(500), "packs", "received"), null);
  const current = sample(500); current.generations = {};
  assert.equal(counterDelta(sample(100), current, "packs", "sent"), null);
  assert.equal(sumKnown([null, null]), null); assert.equal(sumKnown(["0", null]), "0");
  assert.equal(sumKnown(["9007199254740993", "2"]), "9007199254740995");
});
test("counter aggregation retains separate nodes and rejects topology changes", () => {
  const before = sample(100), after = sample(120);
  Object.assign(before.values, sample(200, 100, "node2").values); before.generations.node2 = "100";
  Object.assign(after.values, sample(230, 100, "node2").values); after.generations.node2 = "100";
  assert.equal(counterDelta(before, after, "packs", "sent"), "50");
  delete after.generations.node2; assert.equal(counterDelta(before, after, "packs", "sent"), null);
});
test("inventory paginates once per object, includes zero-byte objects and rejects incomplete scans", async () => {
  const tokens: (string | undefined)[] = [];
  const client: Pick<ObjectStorage, "listObjects"> = { listObjects: async ({ ContinuationToken }: { ContinuationToken?: string }) => {
    tokens.push(ContinuationToken);
    return ContinuationToken ? { Contents: [{ Key: "b", Size: 0 }] } : { Contents: [{ Key: "a", Size: 1024 }], NextContinuationToken: "next" };
  } };
  assert.deepEqual(await inventoryBucket(client, "bucket"), { bytes: "1024", objects: "2" });
  assert.deepEqual(tokens, [undefined, "next"]);
  client.listObjects = async () => ({ Contents: [{ Key: "a" }] }); await assert.rejects(inventoryBucket(client, "bucket"));
  client.listObjects = async () => ({ Contents: [], NextContinuationToken: "same" }); await assert.rejects(inventoryBucket(client, "bucket"), /Repeated/);
  client.listObjects = async () => ({ IsTruncated: true }); await assert.rejects(inventoryBucket(client, "bucket"), /Truncated/);
  await assert.rejects(inventoryBucket(client, "bucket", 0), /deadline/);
});
test("backend identities isolate endpoints and buckets, ignore credential rotation and deduplicate reused buckets", t => {
  const env = { OSS_PROVIDER: "minio", OSS_ENDPOINT: "http://127.0.0.1:9000", OSS_ACCESS_KEY_ID: "id", OSS_SECRET_ACCESS_KEY: "secret", OSS_PACKAGES_BUCKET: "same", OSS_CAS_BUCKET: "same", OSS_ENVIRONMENTS_BUCKET: "env" };
  const old = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  t.after(() => { for (const [key, value] of Object.entries(old)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  Object.assign(process.env, env);
  const first = telemetryConfiguration();
  assert.equal(first.buckets.length, 2); assert.deepEqual(first.buckets[0].roles, ["PACKAGES", "CAS"]);
  process.env.OSS_SECRET_ACCESS_KEY = "rotated"; assert.equal(telemetryConfiguration().id, first.id);
  process.env.OSS_ENDPOINT = "http://127.0.0.1:9002"; assert.notEqual(telemetryConfiguration().id, first.id);
});
