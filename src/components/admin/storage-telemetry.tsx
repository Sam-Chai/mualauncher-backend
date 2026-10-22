"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, HardDrive } from "lucide-react";
import { useI18n } from "@/components/preferences";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AreaChart } from "@/components/charts/area-chart";
import { api, useAdmin } from "./provider";
import type { StorageTelemetry } from "@/lib/storage-telemetry-contract";

export function formatTelemetryBytes(value: string | null): string {
  if (value === null) return "—";
  const bytes = BigInt(value);
  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
  let index = 0, divisor = BigInt(1);
  while (bytes >= divisor * BigInt(1024) && index < units.length - 1) { index++; divisor *= BigInt(1024); }
  return index ? `${bytes / divisor}.${(bytes % divisor * BigInt(100) / divisor).toString().padStart(2, "0")} ${units[index]}` : `${bytes} B`;
}
export function StorageTelemetryCard({ details = false }: { details?: boolean }) {
  const { t, formatDate } = useI18n();
  const { state } = useAdmin();
  const [data, setData] = useState<StorageTelemetry | null>(null);
  const [failed, setFailed] = useState(false);
  const allowed = state.actor.isSuperAdmin;
  useEffect(() => {
    if (!allowed) return;
    let active = true, pending = false;
    const refresh = async () => {
      if (pending) return; pending = true;
      try { const next = await api<StorageTelemetry>("/api/admin/storage-telemetry"); if (active) { setData(next); setFailed(false); } }
      catch { if (active) setFailed(true); }
      finally { pending = false; }
    };
    void refresh(); const timer = setInterval(() => void refresh(), 60_000);
    return () => { active = false; clearInterval(timer); };
  }, [allowed]);
  if (!allowed) return null;
  const labels = { WAITING: "storageTelemetry.waitingForWorkerCollection", READY: "storageTelemetry.connected", STALE: "storageTelemetry.dataIsStale", ERROR: "storageTelemetry.collectionFailed", DISABLED: "storageTelemetry.telemetryDisabled" } as const;
  return <Card className="min-w-0"><CardHeader><div className="flex items-center justify-between gap-3"><HardDrive className="size-5 text-muted-foreground" /><Badge variant={failed || data?.status === "ERROR" ? "destructive" : "secondary"}>{t(failed ? "storageTelemetry.unableToReadStorageTelemetry" : data ? labels[data.status] : "storageTelemetry.readingTelemetry")}</Badge></div><CardTitle>{t(details ? "storageTelemetry.storageTelemetry" : "storageTelemetry.cdnAndStorageTraffic")}</CardTitle><CardDescription>{t("storageTelemetry.platformWideStorageStatisticsUnaffectedByOrganizationFilters")}</CardDescription></CardHeader><CardContent className="space-y-5">
    <dl className={details ? "grid grid-cols-2 gap-5 md:grid-cols-4" : "grid grid-cols-2 gap-x-4 gap-y-5"}>{[
      [t("storageTelemetry.storageUsage"), formatTelemetryBytes(data?.capacityBytes ?? null)],
      [t("storageTelemetry.objectCount"), data?.objectCount ?? "—"],
      [t("storageTelemetry.observedDownloadsToday"), formatTelemetryBytes(data?.traffic.sentBytes ?? null)],
      [t("storageTelemetry.observedUploadsToday"), formatTelemetryBytes(data?.traffic.receivedBytes ?? null)],
    ].map(([label, value]) => <div key={label} className="min-w-0 space-y-1"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="font-semibold tabular-nums wrap-anywhere">{value}</dd></div>)}</dl>
    <div className="space-y-1 text-xs text-muted-foreground">
      {data && <p>{t("storageTelemetry.storageProvider")}{data.provider}</p>}
      <p>{data?.collectedAt ? t("storageTelemetry.collectedAt", { "time": formatDate(data.collectedAt) }) : t("storageTelemetry.noCollectedDataYetCheckThatTheWorkerIs")}</p>
      <p>{data?.traffic.supported === false ? t("storageTelemetry.trafficMetricsAreNotIntegratedForThisProviderCapacity") : t("storageTelemetry.trafficCoversObservedIntervalsIncludingWorkerAndAdminAccess")}</p>
      {data?.traffic.startsAt && <p>{t("storageTelemetry.observationStartsAt", { "time": formatDate(data.traffic.startsAt) })}</p>}
      {data?.traffic.endsAt && <p>{t("storageTelemetry.trafficThrough", { "time": formatDate(data.traffic.endsAt) })}</p>}
      {data?.issue === "METRICS_UNAVAILABLE" && <p role="status">{t("storageTelemetry.minioMetricsAreUnavailableObjectListingsWereAttemptedFor")}</p>}
      <p>{t("storageTelemetry.cdnNotConnected")}</p>
    </div>
    {details && <div className="grid gap-4 border-t pt-4 md:grid-cols-3">{data?.buckets.map(bucket => <div key={bucket.bucket} className="min-w-0 space-y-1 rounded-lg border p-4 text-sm"><div className="flex flex-wrap justify-between gap-2"><code className="wrap-anywhere">{bucket.bucket}</code><span>{formatTelemetryBytes(bucket.bytes)}</span></div><p className="text-xs text-muted-foreground">{bucket.roles.join(" / ")} · {bucket.objects ?? "—"} {t("storageTelemetry.objects")}</p><p className="text-xs text-muted-foreground">{t(bucket.method === "MINIO_METRICS" ? "storageTelemetry.capacitySourceMinioBackgroundScanner" : "storageTelemetry.capacitySourceCurrentObjectListingsExcludesOldVersionsAnd")}</p><p className="text-xs text-muted-foreground">{bucket.observedAt ? t("storageTelemetry.dataTimestamp", { "time": formatDate(bucket.observedAt) }) : t("storageTelemetry.theProviderDidNotReportTheCapacityTimestamp")}{bucket.status === "ERROR" && ` · ${t("storageTelemetry.collectionFailedPreviousDataRetained")}`}</p></div>)}<p className="text-xs text-muted-foreground md:col-span-3">{t("storageTelemetry.capacityIncludesSourcePacksArtifactsSharedCasEnvironmentCaches")}</p></div>}
    {details && data && <div className="space-y-3 border-t pt-4"><p className="text-xs text-muted-foreground">{t("storageTelemetry.observedTrafficOverTheLast24HoursBeijingTime")}</p><AreaChart className="h-48" data={data.history.map(point => ({
      hour: `${((new Date(point.hour).getUTCHours() + 8) % 24).toString().padStart(2, "0")}:00`,
      [t("storageTelemetry.downloads")]: point.sentBytes === null ? null : Number(point.sentBytes), [t("storageTelemetry.uploads")]: point.receivedBytes === null ? null : Number(point.receivedBytes),
    }))} index="hour" categories={[t("storageTelemetry.downloads"), t("storageTelemetry.uploads")]} colors={["blue", "emerald"]} yAxisWidth={88} connectNulls={false} valueFormatter={value => formatTelemetryBytes(BigInt(Math.max(0, Math.round(value))).toString())} /></div>}
    {!details && <Button asChild variant="outline"><Link href="/admin/system/storage">{t("storageTelemetry.viewStorage")}<ArrowUpRight className="size-4" /></Link></Button>}
  </CardContent></Card>;
}
