import { formatMessage, type DisplayMessage } from "./diagnostics";
import { translator, localizedDate, type Locale } from "./i18n";
export const DEFAULT_HIGH_LATENCY_MS = 300;
export const SERVER_PROBE_CACHE_MS = 30_000;
export type ServerProbeResult = {
  state: "ONLINE" | "HIGH_LATENCY" | "OFFLINE" | "UNKNOWN";
  address: string | null; checkedAt: string | null; latencyMs: number | null;
  latencyKind: "PONG" | "STATUS" | null; highLatencyMs: number;
  message: DisplayMessage; version: string | null; playersOnline: number | null;
};

export function probeTooltip(result: ServerProbeResult | null, locale: Locale = "zh-CN") {
  const t = translator(locale);
  if (!result) return t("system.probingMinecraftServer");
  const parts = [formatMessage(t, result.message)];
  if (result.latencyMs !== null) parts.push(t("serverProbe.latency", { "latency": result.latencyMs, "kind": t(result.latencyKind === "PONG" ? "system.pingRoundTrip" : "system.statusRequestRoundTrip") }));
  if (result.state === "HIGH_LATENCY") parts.push(t("serverProbe.highLatencyThreshold", { "threshold": result.highLatencyMs }));
  if (result.version) parts.push(t("serverProbe.version", { "version": result.version }));
  if (result.playersOnline !== null) parts.push(t("serverProbe.onlinePlayers", { "count": result.playersOnline }));
  if (result.checkedAt) parts.push(t("serverProbe.checkedAt", { "time": localizedDate(result.checkedAt, locale) }));
  return parts.join("\n");
}
