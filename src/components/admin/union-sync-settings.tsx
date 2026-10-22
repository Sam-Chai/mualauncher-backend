"use client";
import { serializeError } from "@/lib/diagnostics";
import { formatMessage } from "@/lib/diagnostics";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/preferences";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api, useAdmin } from "./provider";
import type { UnionSyncStatus } from "@/lib/union-directory-contract";
const labels = { WAITING: "unionSyncSettings.waitingForFirstSynchronization", RUNNING: "unionSyncSettings.synchronizing", SYNCED: "unionSyncSettings.synchronized", PARTIAL: "unionSyncSettings.partiallySynchronized", ERROR: "unionSyncSettings.synchronizationFailed", STALE: "unionSyncSettings.synchronizationIsStale" };
const problems: Record<string, string> = { DUPLICATE_CODE: "unionSyncSettings.thisCodeIdentifiesMultipleSitesAutomaticCreationWasSkipped", INVALID_CODE: "unionSyncSettings.invalidSiteCode", INVALID_URL: "unionSyncSettings.invalidSiteAddress", ORGANIZATION_CONFLICT: "unionSyncSettings.matchingOrganizationsConflictOrAreArchivedSkipped", MAPPING_URL_MISMATCH: "unionSyncSettings.theManualAddressDiffersFromUpstreamTheManualSetting", SITE_NAME_UNAVAILABLE: "unionSyncSettings.siteNameUnavailable" };
export function UnionSyncSettings() {
  const { t, formatDate } = useI18n(), { run, busy, refresh } = useAdmin();
  const [status, setStatus] = useState<UnionSyncStatus | null>(null), [error, setError] = useState("");
  const refreshRef = useRef(refresh), lastSync = useRef<string | null>(null);
  useEffect(() => { refreshRef.current = refresh; }, [refresh]);
  useEffect(() => {
    let active = true;
    async function load() { try { const next = await api<UnionSyncStatus>("/api/admin/union-sync"); if (!active) return; setStatus(next); setError("");
      if (next.syncedAt && lastSync.current !== next.syncedAt) { lastSync.current = next.syncedAt; await refreshRef.current(); }
    } catch (e) { if (active) setError(e instanceof Error ? serializeError(e) : "clientShared.requestFailed"); } }
    void load(); const timer = setInterval(() => void load(), 10_000); return () => { active = false; clearInterval(timer); };
  }, []);
  return <Card><CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><CardTitle>{t("unionSyncSettings.unionOrganizationDirectorySynchronization")}</CardTitle>{status && <Badge variant={status.status === "SYNCED" ? "secondary" : "outline"}>{t(labels[status.status])}</Badge>}</div><CardDescription>{t("unionSyncSettings.theWorkerSynchronizesTheUnionDirectoryEveryMinuteNew")}</CardDescription></CardHeader><CardContent className="space-y-4 text-sm">
    {error && <p role="alert" className="text-destructive">{formatMessage(t, error)}</p>}
    {!status ? <p role="status">{t("unionSyncSettings.loadingSynchronizationStatus")}</p> : <><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[
      [t("unionSyncSettings.lastAttempt"), status.attemptedAt ? formatDate(status.attemptedAt) : t("unionSyncSettings.notSynchronizedYet")], [t("unionSyncSettings.latestSuccessfulSynchronization"), status.syncedAt ? formatDate(status.syncedAt) : t("unionSyncSettings.notSynchronizedYet")],
      [t("unionSyncSettings.nextScheduledAttempt"), status.nextSyncAt ? formatDate(status.nextSyncAt) : t("clients.waitingForWorker")], [t("unionSyncSettings.upstreamVersion"), status.upstreamVersion ?? "—"],
      [t("unionSyncSettings.upstreamRecordsSynchronized"), `${status.receivedCount} / ${status.syncedCount}`], [t("unionSyncSettings.organizationsCreatedInThisSynchronization"), String(status.createdCount)],
    ].map(([label, value]) => <div key={label}><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 break-words font-medium">{value}</p></div>)}</div>
      <section aria-label={t("unionSyncSettings.websiteInformation")} className="space-y-3 rounded-lg border p-4">
        <h3 className="font-medium">{t("unionSyncSettings.websiteInformation")}</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2"><p className="font-medium">{t("unionSyncSettings.websiteAvatar")}</p>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-muted-foreground">{[
              [t("unionSyncSettings.imported"), status.avatars.imported], [t("unionSyncSettings.manuallySet"), status.avatars.manual],
              [t("unionSyncSettings.pending"), status.avatars.pending], [t("unionSyncSettings.failed"), status.avatars.failed],
            ].map(([label, value]) => <div key={label} className="flex justify-between gap-2"><dt>{label}</dt><dd className="tabular-nums text-foreground">{value}</dd></div>)}</dl>
            <p className="text-xs text-muted-foreground">{t("unionSyncSettings.theDirectorySynchronizesEvery60SecondsWebsiteIconsAre")}</p>
          </div>
          <div className="space-y-2"><p className="font-medium">{t("organizations.description")}</p><p className="text-muted-foreground">{t("unionSyncSettings.descriptionSync")}</p></div>
        </div>
      </section>
      <section aria-label={t("unionSyncSettings.syncLog")} className="space-y-2">
        <h3 className="font-medium">{t("unionSyncSettings.syncLog")}</h3>
        <p className="text-xs text-muted-foreground">{t("unionSyncSettings.latestSyncResults")}</p>
        <div className="max-h-52 space-y-2 overflow-y-auto rounded-lg border p-3">
          {status.error && <p role="alert" className="text-destructive">{t("unionSyncSettings.theDirectoryRequestFailedExistingOrganizationsAndMappingsAre")}</p>}
          {status.issues.map((issue, index) => <p key={index}><code>{issue.code}</code> · {t(problems[issue.issue] ?? "unionSyncSettings.siteUpdateFailed")}</p>)}
          {!status.error && !status.issues.length && <p className="text-muted-foreground">{t(status.syncedAt ? "unionSyncSettings.noSyncIssues" : "unionSyncSettings.noSyncLog")}</p>}
        </div>
      </section>
    </>}
    <Button type="button" variant="outline" disabled={busy} onClick={() => void run(() => api("/api/admin/union-sync", "POST", {}), t("unionSyncSettings.synchronizationScheduledWaitingForTheWorker"), false)}>{t("unionSyncSettings.synchronizeNow")}</Button>
  </CardContent></Card>;
}
