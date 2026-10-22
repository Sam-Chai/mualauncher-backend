"use client";
import { diagnosticText, serializeError } from "@/lib/diagnostics";
import { useI18n } from "@/components/preferences";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { navigateAfterAuthChange } from "@/lib/auth-navigation";
import { DEFAULT_HIGH_LATENCY_MS, probeTooltip, type ServerProbeResult } from "@/lib/server-probe-contract";

const colors = { ONLINE: "bg-emerald-500", HIGH_LATENCY: "bg-amber-400", OFFLINE: "bg-red-500", UNKNOWN: "bg-neutral-400" };
const labels = { ONLINE: "serverStatus.online", HIGH_LATENCY: "serverStatus.highLatency", OFFLINE: "serverStatus.unreachableMcUnconfirmed", UNKNOWN: "serverStatus.unconfirmed" };
export function ProbeLamp({ result, onRefresh, showLabel = false }: { result: ServerProbeResult | null; onRefresh?: () => void; showLabel?: boolean }) {
  const { t, locale } = useI18n();
  const title = probeTooltip(result, locale);
  return <span className="inline-flex items-center gap-1.5">
    <TooltipProvider><Tooltip><TooltipTrigger asChild><Button type="button" variant="ghost" size="icon" className="size-7 shrink-0" aria-label={title} title={title} onClick={onRefresh}>
      <span aria-hidden="true" data-probe-state={result?.state ?? "CHECKING"} className={`size-2.5 rounded-full ring-1 ring-black/10 ${result ? colors[result.state] : "animate-pulse bg-neutral-400"}`} />
    </Button></TooltipTrigger><TooltipContent className="max-w-sm whitespace-pre-line">{title}{onRefresh && t("serverStatus.clickTheStatusLightToRefreshResultsAreBriefly")}</TooltipContent></Tooltip></TooltipProvider>
    {showLabel && <span className="text-sm">{result ? t(labels[result.state]) : t("serverStatus.probing")}</span>}
  </span>;
}

function unknown(address: string | null, message: string): ServerProbeResult {
  return { state: "UNKNOWN", address, checkedAt: null, latencyMs: null, latencyKind: null, highLatencyMs: DEFAULT_HIGH_LATENCY_MS, message, version: null, playersOnline: null };
}

export function ServerStatusLight({ serverId, address, archived = false, showLabel = false }: { serverId: string; address: string | null; archived?: boolean; showLabel?: boolean }) {
  const [data, setData] = useState<{ key: string; value: ServerProbeResult } | null>(null);
  const request = useRef<AbortController | null>(null);
  const key = JSON.stringify([serverId, address, archived]);
  const refresh = useCallback(async () => {
    if (archived || !address?.trim()) return;
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 15000);
    try {
      const response = await fetch(`/api/admin/servers/${serverId}/probe`, { cache: "no-store", signal: controller.signal });
      if (response.status === 401) { navigateAfterAuthChange("/login"); return; }
      if (!response.ok) throw new Error(response.status === 403 || response.status === 404 ? diagnosticText("serverStatus.serverReadAccessDeniedOrServerNoLongerAccessible") : diagnosticText("serverStatus.probeServiceUnavailableServerStatusCannotBeDetermined"));
      const result = await response.json() as ServerProbeResult & { serverId: string };
      if (controller.signal.aborted) return;
      setData({ key, value: result.serverId === serverId && result.address === address ? result : unknown(address, diagnosticText("serverStatus.serverAddressChangedRefreshManagementData")) });
    } catch (error) {
      if (controller.signal.aborted && !timedOut) return;
      setData({ key, value: unknown(address, timedOut ? diagnosticText("serverStatus.probeRequestTimedOutServerStatusCannotBeDetermined") : error instanceof Error ? serializeError(error) : diagnosticText("serverStatus.probeServiceTemporarilyUnavailable")) });
    } finally { clearTimeout(timeout); }
  }, [serverId, address, archived, key]);
  useEffect(() => {
    if (archived || !address?.trim()) return;
    const initial = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 60000);
    const visible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", visible);
    return () => { clearTimeout(initial); clearInterval(timer); request.current?.abort(); document.removeEventListener("visibilitychange", visible); };
  }, [refresh, archived, address]);
  const result = archived ? unknown(address, diagnosticText("serverStatus.serverOrOrganizationArchivedProbeSkipped")) : !address?.trim() ? unknown(address, diagnosticText("serverStatus.noServerConnectionAddressConfigured")) : data?.key === key ? data.value : null;
  return <ProbeLamp result={result} onRefresh={archived || !address?.trim() ? undefined : () => void refresh()} showLabel={showLabel} />;
}
