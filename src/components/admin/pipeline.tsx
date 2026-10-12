"use client";
import { useI18n } from "@/components/preferences";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Heading, NoPermission } from "./common";
import { api, useAdmin } from "./provider";
import type { infrastructureStatus } from "@/lib/infrastructure";
type PipelineStatus = Awaited<ReturnType<typeof infrastructureStatus>>;
export function PipelinePage({ mode }: { mode: "storage" | "workers" | "signing" }) {
  const { t, formatDate } = useI18n();
  const { state } = useAdmin(); const superAdmin = state.actor.isSuperAdmin;
  const [data, setData] = useState<PipelineStatus | null>(null); const [error, setError] = useState("");
  useEffect(() => {
    if (!superAdmin) return; let active = true;
    const refresh = () => { void api<PipelineStatus>("/api/admin/pipeline").then(next => { if (active) { setData(next); setError(""); } }).catch(error => { if (active) setError(error instanceof Error ? error.message : t("读取接入状态失败")); }); };
    refresh(); const timer = setInterval(refresh, 10000); return () => { active = false; clearInterval(timer); };
  }, [superAdmin, t]);
  if (!superAdmin) return <NoPermission />;
  return <><Heading title={mode === "storage" ? "Storage" : mode === "workers" ? "Worker" : "Signing Keys"} description={t("客户端上传、文件去重与发布服务的实际运行状态。")} />
    {error && <Alert variant="destructive"><AlertDescription>{t(error)}</AlertDescription></Alert>}
    {!data ? <p className="text-sm text-muted-foreground">{t("正在检查服务…")}</p> : mode === "storage" ? <Card><CardHeader><CardTitle>{data.storageReady ? t("对象存储已连接") : t("对象存储连接失败")}</CardTitle><CardDescription>{t("三个私有 S3 桶，客户端源包／产物、CAS 与环境缓存分开保存。")}</CardDescription></CardHeader><CardContent className="space-y-3 text-sm"><p>{t("原始包、Manifest 与 muapack：")}<code>{data.packagesBucket}</code></p><p>CAS：<code>{data.casBucket}</code></p><p>{t("环境缓存：")}<code>{data.environmentsBucket}</code></p><p className="text-muted-foreground">{t("归档保留历史对象。当前未接入 CDN 流量与容量遥测。")}</p></CardContent></Card>
      : mode === "workers" ? <div className="grid gap-5 md:grid-cols-3"><Card><CardHeader><CardTitle>{t("在线 Worker ·") + " "}{data.workers.length}</CardTitle><CardDescription>{t("最近 30 秒内有心跳的进程；上传与组包分开处理，任务持久化在 PostgreSQL。")}</CardDescription></CardHeader><CardContent className="space-y-2 text-xs">{data.workers.length ? data.workers.map(worker => <p key={worker.id}>{worker.id} · {formatDate(worker.lastSeen)}</p>) : <p>{t("暂无在线 Worker，请运行 npm run worker。")}</p>}</CardContent></Card><Card><CardHeader><CardTitle>{t("上传任务")}</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">{data.queue.length ? data.queue.map(row => <p key={row.status} className="flex justify-between"><span>{row.status}</span><span>{row.count}</span></p>) : <p>{t("暂无上传任务。")}</p>}</CardContent></Card><Card><CardHeader><CardTitle>{t("组包任务")}</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">{data.packageQueue.length ? data.packageQueue.map(row => <p key={row.status} className="flex justify-between"><span>{row.status}</span><span>{row.count}</span></p>) : <p>{t("暂无组包任务。")}</p>}</CardContent></Card></div>
      : <Card><CardHeader><CardTitle>{t("Ed25519 发布签名")}</CardTitle><CardDescription>{t("当前为本地开发密钥。Launcher 的可信公钥仍需通过可信渠道固定。")}</CardDescription></CardHeader><CardContent className="space-y-3 text-sm">{data.signing ? <><p>Key ID：<code>{data.signing.keyId}</code></p><p>{t("SPKI 公钥（Base64）：")}</p><pre className="overflow-auto rounded-md bg-muted p-3 text-xs">{data.signing.publicKey}</pre></> : <p>{t("发布密钥未配置，发布操作会被阻止。")}</p>}</CardContent></Card>}
  </>;
}
