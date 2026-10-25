"use client";
import { useEffect, useState } from "react";
import { useI18n } from "@/components/preferences";
import { formatMessage, serializeError } from "@/lib/diagnostics";
import type { ExecutionMode, ExecutionSettings, ExecutionRuns } from "@/lib/execution-management-contract";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { api, useAdmin } from "./provider";
import { DataTable } from "./data-table";
import type { ColumnDef } from "@tanstack/react-table";
export function ExecutionSettingsCard() {
  const { t, formatDate } = useI18n(), { busy, run } = useAdmin();
  const [data, setData] = useState<ExecutionSettings | null>(null), [draft, setDraft] = useState<{ mode: ExecutionMode; revision: number } | null>(null), [error, setError] = useState("");
  useEffect(() => {
    let active = true; const refresh = () => { void api<ExecutionSettings>("/api/admin/execution-settings").then(value => { if (active) { setData(value); setError(""); } }).catch(error => { if (active) setError(serializeError(error)); }); };
    refresh(); const timer = setInterval(refresh, 10000); return () => { active = false; clearInterval(timer); };
  }, []);
  const mode = draft?.mode ?? data?.mode ?? "DOCKER_GVISOR";
  return <Card><CardHeader><CardTitle>{t("executionSettings.title")}</CardTitle><CardDescription>{t("executionSettings.description")}</CardDescription></CardHeader><CardContent className="space-y-5">
    {error && <p role="alert" className="text-sm text-destructive">{formatMessage(t, error)}</p>}
    {!data ? <p role="status">{t("executionSettings.loading")}</p> : <>
      <div className="flex flex-wrap items-end gap-3"><div className="grid gap-2 text-sm"><label htmlFor="execution-mode">{t("executionSettings.mode")}</label>
        <select id="execution-mode" className={`h-9 rounded-md border bg-background px-3 ${(mode === "DOCKER_GVISOR" ? !data.dockerAvailable : !data.bareAvailable) ? "text-muted-foreground" : ""}`} value={mode} disabled={busy} onChange={event => setDraft({ mode: event.target.value as ExecutionMode, revision: data.revision })}>
          <option value="DOCKER_GVISOR" disabled={!data.dockerAvailable}>{t("executionSettings.docker")}</option>
          <option value="BARE" disabled={!data.bareAvailable}>{t("executionSettings.bare")}</option>
        </select></div>
        <Button type="button" disabled={busy || !draft} onClick={() => void run(async () => { const next = await api<ExecutionSettings>("/api/admin/execution-settings", "PATCH", draft); setData(next); setDraft(null); }, t("executionSettings.saved"), false)}>{t("executionSettings.save")}</Button>
      </div>
      {!data.dockerAvailable && <p className="text-sm text-muted-foreground">{t("executionSettings.dockerUnavailable")}</p>}
      {mode === "BARE" && <p role="note" className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">{t("executionSettings.bareWarning")}</p>}
      <div className="space-y-3" aria-label={t("executionSettings.workerStatus")}>
        {!data.workers.length && <p className="text-sm text-muted-foreground">{t("executionSettings.noWorkers")}</p>}
        {data.workers.map(worker => <div key={worker.id} className="rounded-md border p-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><code className="break-all text-xs">{worker.id}</code><span className="text-muted-foreground">{t(worker.fresh ? "executionSettings.fresh" : "executionSettings.stale")} · {formatDate(worker.lastSeen)}</span></div>
          {worker.status ? <div className="mt-3 grid gap-2 md:grid-cols-3"><p>Docker · {t(worker.status.docker.connected ? "executionSettings.connected" : worker.status.docker.installed ? "executionSettings.disconnected" : "executionSettings.notInstalled")}{worker.status.docker.version ? ` (${worker.status.docker.version})` : ""}</p>
            <p>gVisor · {t(worker.status.gvisor.verified ? "executionSettings.verified" : worker.status.gvisor.registered ? "executionSettings.notReady" : "executionSettings.notRegistered")}</p>
            <p>Java · {worker.status.bare.version ?? t("executionSettings.unavailable")}</p>
            {worker.status.gvisor.reason && <p className="text-xs text-muted-foreground md:col-span-3">{formatMessage(t, worker.status.gvisor.reason)}</p>}
          </div> : <p className="mt-2 text-muted-foreground">{t("executionSettings.notReported")}</p>}
        </div>)}
      </div>
    </>}
  </CardContent></Card>;
}
export function ExecutionInstancesCard() {
  const { t, formatDate } = useI18n(); const [data, setData] = useState<ExecutionRuns | null>(null), [error, setError] = useState("");
  useEffect(() => { let active = true; const refresh = () => { void api<ExecutionRuns>("/api/admin/execution-instances").then(value => { if (active) { setData(value); setError(""); } }).catch(error => { if (active) setError(serializeError(error)); }); }; refresh(); const timer = setInterval(refresh, 10000); return () => { active = false; clearInterval(timer); }; }, []);
  type Run = ExecutionRuns["runs"][number];
  const states = { PREPARING: "executionSettings.preparing", RUNNING: "executionSettings.running", SUCCEEDED: "executionSettings.succeeded", FAILED: "executionSettings.failed", CANCELLED: "executionSettings.cancelled", INTERRUPTED: "executionSettings.interrupted", CLEANUP_FAILED: "executionSettings.cleanupFailed" } as const;
  const containerStates = { CREATED: "executionSettings.created", RUNNING: "executionSettings.running", EXITED: "executionSettings.exited", REMOVED: "executionSettings.removed", UNKNOWN: "executionSettings.unknown" } as const;
  const columns: ColumnDef<Run>[] = [
    { accessorKey: "startedAt", header: t("executionSettings.startedAt"), cell: ({ row }) => formatDate(row.original.startedAt) },
    { accessorKey: "state", header: t("executionSettings.state"), cell: ({ row }) => t(states[row.original.state]) },
    { id: "instances", header: t("executionSettings.instances"), accessorFn: row => row.containers.map(container => container.name).join(" "), cell: ({ row }) => <div className="max-w-lg space-y-2 text-xs">{row.original.containers.length ? row.original.containers.map(container => <div key={container.id}><code className="break-all">{container.name}</code><p className="text-muted-foreground">{container.id.slice(0, 12)} · {t(container.role === "input" ? "executionSettings.inputContainer" : "executionSettings.executorContainer")} · {t(containerStates[container.state])}</p></div>) : t(row.original.mode === "BARE" ? "executionSettings.bare" : "executionSettings.notCreated")}</div> },
    { id: "parameters", header: t("executionSettings.parameters"), cell: ({ row: { original: run } }) => <details className="max-w-md text-xs"><summary className="cursor-pointer">{t("executionSettings.details")}</summary><dl className="mt-2 grid grid-cols-[auto_1fr] gap-2">
      {[[t("executionSettings.worker"), run.workerId], [t("executionSettings.task"), run.buildId ?? "—"], [t("executionSettings.image"), run.image], [t("executionSettings.architecture"), run.architecture], ["Runtime", run.limits.runtime], ["CPU", run.limits.cpus ?? t("executionSettings.hostShared")], [t("executionSettings.memory"), run.limits.memoryMiB === null ? t("executionSettings.hostShared") : `${run.limits.memoryMiB} MiB`], [t("executionSettings.heap"), `${run.limits.heapMiB} MiB`], [t("executionSettings.workspace"), run.limits.workspaceMiB === null ? t("executionSettings.hostShared") : `${run.limits.workspaceMiB} MiB`], ["PID", run.limits.pids ?? t("executionSettings.hostShared")], [t("executionSettings.network"), t(run.limits.network === "none" ? "executionSettings.offline" : "executionSettings.hostShared")], [t("executionSettings.deadline"), `${run.limits.deadlineSeconds} s`]].map(([label, value]) => <div key={label} className="contents"><dt>{label}</dt><dd className="break-all">{value}</dd></div>)}
      </dl>{run.error && <p className="mt-2 text-destructive">{formatMessage(t, run.error)}</p>}</details> },
  ];
  return <Card><CardHeader><CardTitle>{t("executionSettings.instancesTitle")}</CardTitle><CardDescription>{t("executionSettings.instancesDescription")}</CardDescription></CardHeader><CardContent className="space-y-3">{error && <p role="alert" className="text-destructive">{formatMessage(t, error)}</p>}{data ? <DataTable data={data.runs} columns={columns} getRowId={row => row.id} /> : <p>{t("executionSettings.loading")}</p>}</CardContent></Card>;
}
