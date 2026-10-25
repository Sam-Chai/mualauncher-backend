"use client";
import { serializeError } from "@/lib/diagnostics";
import { formatMessage } from "@/lib/diagnostics";

import { useI18n } from "@/components/preferences";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Heading, NoPermission } from "./common";
import { api, useAdmin } from "./provider";
import type { infrastructureStatus } from "@/lib/infrastructure";
import { StorageTelemetryCard } from "./storage-telemetry";
import { ExecutionInstancesCard } from "./execution-settings";
const taskStatuses: Record<string, string> = {
  UPLOADING: "pipeline.taskUploading", PROCESSING: "pipeline.taskProcessing", READY: "pipeline.taskReady",
  FAILED: "clientShared.failed", CANCELLED: "pipeline.taskCancelled", WAITING: "clients.waitingForWorker",
  QUEUED: "clients.waitingForWorker", PENDING: "clients.waitingForWorker", SUBMITTED: "clients.pendingReview",
  PREPARED: "clients.recipePreparedAwaitingReviewAndSignature",
};
type PipelineStatus = Awaited<ReturnType<typeof infrastructureStatus>>;
export function PipelinePage({ mode }: { mode: "storage" | "workers" | "signing" }) {
  const { t, formatDate } = useI18n();
  const { state } = useAdmin(); const superAdmin = state.actor.isSuperAdmin;
  const [data, setData] = useState<PipelineStatus | null>(null); const [error, setError] = useState("");
  useEffect(() => {
    if (!superAdmin) return; let active = true;
    const refresh = () => { void api<PipelineStatus>("/api/admin/pipeline").then(next => { if (active) { setData(next); setError(""); } }).catch(error => { if (active) setError(error instanceof Error ? serializeError(error) : t("pipeline.couldNotReadInfrastructureStatus")); }); };
    refresh(); const timer = setInterval(refresh, 10000); return () => { active = false; clearInterval(timer); };
  }, [superAdmin, t]);
  if (!superAdmin) return <NoPermission />;
  return <><Heading title={mode === "storage" ? "navigation.storage" : mode === "workers" ? "navigation.taskProcessing" : "navigation.signingKeys"} description={t("pipeline.actualStatusOfClientUploadsDeduplicationAndReleaseServices")} />
    {error && <Alert variant="destructive"><AlertDescription>{formatMessage(t, error)}</AlertDescription></Alert>}
    {!data ? <p className="text-sm text-muted-foreground">{t("pipeline.checkingServices")}</p> : mode === "storage" ? <div className="space-y-6"><Card><CardHeader><CardTitle>{data.storageReady ? t("pipeline.objectStorageConnected") : t("pipeline.objectStorageConnectionFailed")}</CardTitle><CardDescription>{t("pipeline.threePrivateObjectStorageBucketsSeparatelyStoreSourcePacks")}</CardDescription></CardHeader><CardContent className="space-y-3 text-sm"><p>{t("pipeline.sourcePacksManifestsAndMuapack")}<code>{data.packagesBucket}</code></p><p>{t("pipeline.sharedFiles")}<code>{data.casBucket}</code></p><p>{t("pipeline.environmentCache")}<code>{data.environmentsBucket}</code></p><p className="text-muted-foreground">{t("pipeline.archivingRetainsHistoricalObjectsSeeStorageTelemetryForObserved")}</p></CardContent></Card><StorageTelemetryCard details /></div>
      : mode === "workers" ? <div className="grid gap-5 md:grid-cols-3"><Card><CardHeader><CardTitle>{t("pipeline.onlineWorkers") + " "}{data.workers.length}</CardTitle><CardDescription>{t("pipeline.processesWithAHeartbeatInTheLast30Seconds")}</CardDescription></CardHeader><CardContent className="space-y-2 text-xs">{data.workers.length ? data.workers.map(worker => <p key={worker.id}>{worker.id} · {formatDate(worker.lastSeen)}</p>) : <p>{t("pipeline.noOnlineWorkersRunNpmRunWorker")}</p>}</CardContent></Card><Card><CardHeader><CardTitle>{t("pipeline.uploadTasks")}</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">{data.queue.length ? data.queue.map(row => <p key={row.status} className="flex justify-between"><span>{t(taskStatuses[row.status] ?? "clients.waitingForWorker")}</span><span>{row.count}</span></p>) : <p>{t("pipeline.noUploadTasks")}</p>}</CardContent></Card><Card><CardHeader><CardTitle>{t("pipeline.packagingTasks")}</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">{data.packageQueue.length ? data.packageQueue.map(row => <p key={row.status} className="flex justify-between"><span>{t(taskStatuses[row.status] ?? "clients.waitingForWorker")}</span><span>{row.count}</span></p>) : <p>{t("pipeline.noPackagingTasks")}</p>}</CardContent></Card></div>
      : <Card><CardHeader><CardTitle>{t("pipeline.ed25519ReleaseSigning")}</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">{data.signing ? <><p>{t("pipeline.keyId")}<code>{data.signing.keyId}</code></p><p>{t("pipeline.spkiPublicKeyBase64")}</p><pre className="overflow-auto rounded-md bg-muted p-3 text-xs">{data.signing.publicKey}</pre></> : <p>{t("pipeline.noReleaseKeyConfiguredPublicationIsBlocked")}</p>}</CardContent></Card>}
    {mode === "workers" && data && <div className="mt-5"><ExecutionInstancesCard /></div>}
  </>;
}
