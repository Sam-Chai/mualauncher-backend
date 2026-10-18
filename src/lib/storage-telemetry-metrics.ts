import { z } from "zod";

export type Metric = { name: string; labels: Record<string, string>; value: number };
export const counterSnapshotSchema = z.object({
  at: z.string().datetime(), generations: z.record(z.string()),
  values: z.record(z.object({ bucket: z.string(), direction: z.enum(["sent", "received"]), value: z.string().regex(/^\d+$/) })),
});
export type CounterSnapshot = z.infer<typeof counterSnapshotSchema>;

export function parseMetrics(text: string): Metric[] {
  const result: Metric[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const match = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{(.*)\})?\s+([^\s]+)(?:\s+\d+)?$/.exec(line);
    if (!match) throw new Error("Invalid metrics response");
    const labels: Record<string, string> = {};
    if (match[2]) {
      let rest = match[2];
      while (rest) {
        const label = /^([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\[\\"n])*)"(?:,|$)/.exec(rest);
        if (!label) throw new Error("Invalid metric labels");
        labels[label[1]] = label[2].replace(/\\([\\"n])/g, (_, value: string) => value === "n" ? "\n" : value);
        rest = rest.slice(label[0].length);
      }
    }
    const value = Number(match[3]);
    if (Number.isFinite(value)) result.push({ name: match[1], labels, value });
  }
  return result;
}
export function integerMetric(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Metric outside safe integer range");
  return BigInt(value).toString();
}
export function trafficCounters(metrics: Metric[], nodes: Metric[], buckets: string[], at: Date): CounterSnapshot {
  const values: CounterSnapshot["values"] = {};
  for (const row of metrics) {
    const direction = row.name === "minio_bucket_traffic_sent_bytes" ? "sent" : row.name === "minio_bucket_traffic_received_bytes" ? "received" : null;
    if (!direction || !buckets.includes(row.labels.bucket)) continue;
    const key = JSON.stringify([row.name, Object.entries(row.labels).sort(([a], [b]) => a.localeCompare(b))]);
    if (values[key]) throw new Error("Duplicate metric series");
    values[key] = { bucket: row.labels.bucket, direction, value: integerMetric(row.value) };
  }
  const servers = [...new Set(metrics.filter(row => row.name.startsWith("minio_bucket_traffic_")).map(row => row.labels.server).filter(Boolean))];
  const generations: Record<string, string> = {};
  for (const row of nodes) {
    if (!["minio_process_start_time_seconds", "minio_node_process_starttime_seconds"].includes(row.name)) continue;
    const server = row.labels.server || (servers.length === 1 ? servers[0] : undefined);
    if (server && row.value > 0) generations[server] = String(row.value);
  }
  return { at: at.toISOString(), values, generations };
}
export function counterDelta(previous: CounterSnapshot | null, current: CounterSnapshot, bucket: string, direction: "sent" | "received"): string | null {
  if (!previous) return null;
  const rows = Object.entries(current.values).filter(([, row]) => row.bucket === bucket && row.direction === direction);
  const oldRows = Object.entries(previous.values).filter(([, row]) => row.bucket === bucket && row.direction === direction);
  if (!rows.length || rows.length !== oldRows.length) return null;
  // A decrease alone cannot detect a restart followed by a busy interval. Require stable process generations too.
  const generationKeys = Object.keys(current.generations).sort();
  if (!generationKeys.length || JSON.stringify(generationKeys) !== JSON.stringify(Object.keys(previous.generations).sort()) ||
    generationKeys.some(key => current.generations[key] !== previous.generations[key])) return null;
  let delta = BigInt(0);
  for (const [key, row] of rows) {
    const old = previous.values[key];
    const labels = (JSON.parse(key) as [string, [string, string][]])[1];
    const server = labels.find(([name]) => name === "server")?.[1];
    if (!server || !current.generations[server] || !old || BigInt(row.value) < BigInt(old.value)) return null;
    delta += BigInt(row.value) - BigInt(old.value);
  }
  return delta.toString();
}
export function sumKnown(values: (string | null)[]): string | null {
  const known = values.filter((value): value is string => value !== null);
  return known.length ? known.reduce((total, value) => total + BigInt(value), BigInt(0)).toString() : null;
}
