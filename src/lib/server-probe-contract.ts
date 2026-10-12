import { translator, localizedDate, type Locale } from "./i18n";
export const DEFAULT_HIGH_LATENCY_MS = 300;
export const SERVER_PROBE_CACHE_MS = 30_000;
export type ServerProbeResult = {
  state: "ONLINE" | "HIGH_LATENCY" | "OFFLINE" | "UNKNOWN";
  address: string | null; checkedAt: string | null; latencyMs: number | null;
  latencyKind: "PONG" | "STATUS" | null; highLatencyMs: number;
  message: string; version: string | null; playersOnline: number | null;
};

export function probeTooltip(result: ServerProbeResult | null, locale: Locale = "zh-CN") {
  const t = translator(locale);
  if (!result) return t("正在探测 Minecraft 服务器…");
  const parts = [t(result.message)];
  if (result.latencyMs !== null) parts.push(t("延迟 {0} ms（{1}，后端探测）", { "0": result.latencyMs, "1": t(result.latencyKind === "PONG" ? "Ping 往返" : "状态请求往返") }));
  if (result.state === "HIGH_LATENCY") parts.push(t("高延迟阈值：{0} ms", { "0": result.highLatencyMs }));
  if (result.version) parts.push(t("版本：{0}", { "0": result.version }));
  if (result.playersOnline !== null) parts.push(t("在线玩家：{0}", { "0": result.playersOnline }));
  if (result.checkedAt) parts.push(t("检查时间：{0}", { "0": localizedDate(result.checkedAt, locale) }));
  return parts.join("\n");
}
