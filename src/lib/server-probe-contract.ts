export const DEFAULT_HIGH_LATENCY_MS = 300;
export const SERVER_PROBE_CACHE_MS = 30_000;
export type ServerProbeResult = {
  state: "ONLINE" | "HIGH_LATENCY" | "OFFLINE" | "UNKNOWN";
  address: string | null; checkedAt: string | null; latencyMs: number | null;
  latencyKind: "PONG" | "STATUS" | null; highLatencyMs: number;
  message: string; version: string | null; playersOnline: number | null;
};

export function probeTooltip(result: ServerProbeResult | null) {
  if (!result) return "正在探测 Minecraft 服务器…";
  const parts = [result.message];
  if (result.latencyMs !== null) parts.push(`延迟 ${result.latencyMs} ms（${result.latencyKind === "PONG" ? "Ping 往返" : "状态请求往返"}，后端探测）`);
  if (result.state === "HIGH_LATENCY") parts.push(`高延迟阈值：${result.highLatencyMs} ms`);
  if (result.version) parts.push(`版本：${result.version}`);
  if (result.playersOnline !== null) parts.push(`在线玩家：${result.playersOnline}`);
  if (result.checkedAt) parts.push(`检查时间：${new Date(result.checkedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}`);
  return parts.join("\n");
}
