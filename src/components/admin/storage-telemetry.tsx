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
  const labels = { WAITING: "等待 Worker 采集", READY: "已接入", STALE: "数据已过期", ERROR: "采集失败", DISABLED: "遥测已停用" } as const;
  return <Card className="min-w-0"><CardHeader><div className="flex items-center justify-between gap-3"><HardDrive className="size-5 text-muted-foreground" /><Badge variant={failed || data?.status === "ERROR" ? "destructive" : "secondary"}>{t(failed ? "读取存储遥测失败" : data ? labels[data.status] : "正在读取遥测…")}</Badge></div><CardTitle>{t(details ? "存储遥测" : "CDN 与存储流量")}</CardTitle><CardDescription>{t("全平台存储统计 · 不随组织筛选变化")}</CardDescription></CardHeader><CardContent className="space-y-5">
    <dl className={details ? "grid grid-cols-2 gap-5 md:grid-cols-4" : "grid grid-cols-2 gap-x-4 gap-y-5"}>{[
      [t("存储用量"), formatTelemetryBytes(data?.capacityBytes ?? null)],
      [t("对象数量"), data?.objectCount ?? "—"],
      [t("今日已采集下行"), formatTelemetryBytes(data?.traffic.sentBytes ?? null)],
      [t("今日已采集上行"), formatTelemetryBytes(data?.traffic.receivedBytes ?? null)],
    ].map(([label, value]) => <div key={label} className="min-w-0 space-y-1"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="font-semibold tabular-nums wrap-anywhere">{value}</dd></div>)}</dl>
    <div className="space-y-1 text-xs text-muted-foreground">
      {data && <p>{t("存储供应商：")}{data.provider}</p>}
      <p>{data?.collectedAt ? t("采集时间：{0}", { "0": formatDate(data.collectedAt) }) : t("暂无已采集数据，请确认 Worker 正在运行。")}</p>
      <p>{data?.traffic.supported === false ? t("当前供应商尚未接入流量指标；容量来自对象列表。") : t("流量仅统计已采集区间，包含 Worker 与后台访问；缺失值不代表零。")}</p>
      {data?.traffic.startsAt && <p>{t("今日采集起点：{0}", { "0": formatDate(data.traffic.startsAt) })}</p>}
      {data?.traffic.endsAt && <p>{t("流量数据截至：{0}", { "0": formatDate(data.traffic.endsAt) })}</p>}
      {data?.issue === "METRICS_UNAVAILABLE" && <p role="status">{t("MinIO 指标暂不可用，容量已尝试通过对象列表读取。")}</p>}
      <p>{t("CDN：待接入")}</p>
    </div>
    {details && <div className="grid gap-4 border-t pt-4 md:grid-cols-3">{data?.buckets.map(bucket => <div key={bucket.bucket} className="min-w-0 space-y-1 rounded-lg border p-4 text-sm"><div className="flex flex-wrap justify-between gap-2"><code className="wrap-anywhere">{bucket.bucket}</code><span>{formatTelemetryBytes(bucket.bytes)}</span></div><p className="text-xs text-muted-foreground">{bucket.roles.join(" / ")} · {bucket.objects ?? "—"} {t("个对象")}</p><p className="text-xs text-muted-foreground">{t(bucket.method === "MINIO_METRICS" ? "容量来源：MinIO 后台扫描统计" : "容量来源：当前对象列表，不含历史版本和未完成分片")}</p><p className="text-xs text-muted-foreground">{bucket.observedAt ? t("数据时间：{0}", { "0": formatDate(bucket.observedAt) }) : t("供应商未提供容量数据时间")}{bucket.status === "ERROR" && ` · ${t("采集失败，保留上次数据")}`}</p></div>)}<p className="text-xs text-muted-foreground md:col-span-3">{t("容量包含源包、产物、共享 CAS、环境缓存及仍保留的回收对象，不是可分配磁盘剩余容量，也不是账单。")}</p></div>}
    {details && data && <div className="space-y-3 border-t pt-4"><p className="text-xs text-muted-foreground">{t("近 24 小时已采集流量 · 北京时间 · 按采集结束时间归集，缺失不补零")}</p><AreaChart className="h-48" data={data.history.map(point => ({
      hour: `${((new Date(point.hour).getUTCHours() + 8) % 24).toString().padStart(2, "0")}:00`,
      [t("下行")]: point.sentBytes === null ? null : Number(point.sentBytes), [t("上行")]: point.receivedBytes === null ? null : Number(point.receivedBytes),
    }))} index="hour" categories={[t("下行"), t("上行")]} colors={["blue", "emerald"]} yAxisWidth={88} connectNulls={false} valueFormatter={value => formatTelemetryBytes(BigInt(Math.max(0, Math.round(value))).toString())} /></div>}
    {!details && <Button asChild variant="outline"><Link href="/admin/system/storage">{t("查看 Storage")}<ArrowUpRight className="size-4" /></Link></Button>}
  </CardContent></Card>;
}
