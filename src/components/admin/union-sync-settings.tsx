"use client";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/preferences";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api, useAdmin } from "./provider";
import type { UnionSyncStatus } from "@/lib/union-directory-contract";
const labels = { WAITING: "等待首次同步", RUNNING: "正在同步", SYNCED: "已同步", PARTIAL: "部分同步", ERROR: "同步失败", STALE: "同步已过期" };
const problems: Record<string, string> = { DUPLICATE_CODE: "同一 CODE 对应多个站点，已跳过自动创建", INVALID_CODE: "站点代码无效", INVALID_URL: "站点地址无效", ORGANIZATION_CONFLICT: "同名组织冲突或已归档，已跳过", MAPPING_URL_MISMATCH: "人工映射地址与上游不同，已保留人工设置" };
export function UnionSyncSettings() {
  const { t, formatDate } = useI18n(), { run, busy, refresh } = useAdmin();
  const [status, setStatus] = useState<UnionSyncStatus | null>(null), [error, setError] = useState("");
  const refreshRef = useRef(refresh), lastSync = useRef<string | null>(null);
  useEffect(() => { refreshRef.current = refresh; }, [refresh]);
  useEffect(() => {
    let active = true;
    async function load() { try { const next = await api<UnionSyncStatus>("/api/admin/union-sync"); if (!active) return; setStatus(next); setError("");
      if (next.syncedAt && lastSync.current !== next.syncedAt) { lastSync.current = next.syncedAt; await refreshRef.current(); }
    } catch (e) { if (active) setError(e instanceof Error ? e.message : "请求失败"); } }
    void load(); const timer = setInterval(() => void load(), 10_000); return () => { active = false; clearInterval(timer); };
  }, []);
  return <Card><CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><CardTitle>{t("Union 组织目录同步")}</CardTitle>{status && <Badge variant={status.status === "SYNCED" ? "secondary" : "outline"}>{t(labels[status.status])}</Badge>}</div><CardDescription>{t("Worker 每分钟从联盟 API 同步组织目录；新组织使用 CODE 作为初始别名，不授予管理权限。网站图标自动导入，手动头像优先。")}</CardDescription></CardHeader><CardContent className="space-y-4 text-sm">
    {error && <p role="alert" className="text-destructive">{t(error)}</p>}
    {!status ? <p role="status">{t("正在读取同步状态…")}</p> : <><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[
      [t("上次尝试"), status.attemptedAt ? formatDate(status.attemptedAt) : t("尚未同步")], [t("最近成功同步"), status.syncedAt ? formatDate(status.syncedAt) : t("尚未同步")],
      [t("下次计划"), status.nextSyncAt ? formatDate(status.nextSyncAt) : t("等待 Worker")], [t("上游版本"), status.upstreamVersion ?? "—"],
      [t("上游记录／已同步"), `${status.receivedCount} / ${status.syncedCount}`], [t("本次新建组织"), String(status.createdCount)],
      [t("网站头像／手动头像"), `${status.avatars.imported} / ${status.avatars.manual}`], [t("头像等待／失败"), `${status.avatars.pending} / ${status.avatars.failed}`],
    ].map(([label, value]) => <div key={label}><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 break-words font-medium">{value}</p></div>)}</div>
      {status.error && <p role="alert" className="text-destructive">{t("联盟目录请求失败；保留已有组织和映射，下一分钟重试。")}</p>}
      {!!status.issues.length && <div className="max-h-52 space-y-2 overflow-y-auto rounded border p-3">{status.issues.map((issue, index) => <p key={index}><code>{issue.code}</code> · {t(problems[issue.issue] ?? issue.issue)}</p>)}</div>}
      <p className="text-xs text-muted-foreground">{t("目录每 60 秒同步。网站头像首次导入后每天检查，失败一小时后重试；裁剪或移除头像后保留人工选择。")}</p>
    </>}
    <Button type="button" variant="outline" disabled={busy} onClick={() => void run(() => api("/api/admin/union-sync", "POST", {}), t("已安排同步，请等待 Worker 执行"), false)}>{t("立即同步")}</Button>
  </CardContent></Card>;
}
