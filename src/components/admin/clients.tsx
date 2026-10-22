"use client";
import { serializeError } from "@/lib/diagnostics";
import { formatMessage } from "@/lib/diagnostics";

import { DisplayScheduleNote } from "./display-schedule";
import { useI18n } from "@/components/preferences";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { LoaderCircle, History, Download } from "lucide-react";
import type { ColumnDef, CellContext } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { api, useAdmin, RequestError } from "./provider";
import { DataTable } from "./data-table";
import { Heading, NoPermission } from "./common";
import { ArchiveButton, EditorDialog } from "./form";
import { ClientUploadDialog } from "./client-upload";
import { MarkdownText, UpdateStats, RecipeImportStats, RecipeFileTable, RecipeDistributionStats, ModTable } from "./client-shared";
import { clientMetadataSchema, packageFormatVersionSchema, formatBytes, uploadProcessingLabel, type ClientMetadata, type UpdateStatistics, type ReleaseManifest, type PackFile } from "@/lib/client-contract";
import type { clientList } from "@/lib/client-service";
import { navigateAfterAuthChange } from "@/lib/auth-navigation";
import { Progress } from "@/components/ui/progress";
import { PackageBuildOptions } from "./package-platforms";
import { packageBuildLabel } from "@/lib/package-contract";
import { compareClientVersions } from "@/lib/client-version";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { muaPlatformSchema, type MuaPlatformManifest, type MuaFile } from "@/lib/muapack-contract";
import type { RecipeManifest } from "@/lib/muapack-v2-contract";
import type { RecipeImportStatistics } from "@/lib/recipe-inventory";

type ClientRow = Awaited<ReturnType<typeof clientList>>[number];
type Draft = ClientRow["drafts"][number];
type Release = ClientRow["releases"][number];
type ReviewRow = { row: ClientRow; draft: Draft };
type ReleaseRow = { row: ClientRow; release: Release };
const clientRowId = (row: ClientRow) => row.clientId;
const reviewRowId = (item: ReviewRow) => item.draft.id;
const releaseRowId = (item: ReleaseRow) => item.release.id;
const statusLabels: Record<string, string> = { UPLOADING: "clients.uploadIncomplete", QUEUED: "clientShared.waitingForProcessing", PROCESSING: "clients.analyzing", READY: "clients.awaitingDetailsAndSubmission", FAILED: "clients.processingFailed", SUBMITTED: "clients.pendingReview", APPROVED: "clients.approvedAwaitingPublication", REJECTED: "clients.rejected", RELEASED: "clients.published", DRAFT: "clients.metadataDraft" };
function metadata(version: Draft | Release | undefined): ClientMetadata | undefined {
  if (!version) return undefined;
  const parsed = clientMetadataSchema.safeParse("candidateMetadata" in version ? version.candidateMetadata : version.environmentSnapshot);
  return parsed.success ? parsed.data : undefined;
}
function useClients() {
  const { epoch } = useAdmin(); const [rows, setRows] = useState<ClientRow[] | null>(null); const [error, setError] = useState("");
  useEffect(() => {
    let active = true; let fetching = false;
    async function refresh() {
      if (fetching) return; fetching = true;
      try { const next = await api<ClientRow[]>("/api/v1/clients"); if (active) { setRows(next); setError(""); } }
      catch (error) { if (active) { if (error instanceof RequestError && error.status === 401) navigateAfterAuthChange("/login"); setError(error instanceof Error ? serializeError(error) : "clients.couldNotReadClients"); } }
      finally { fetching = false; }
    }
    void refresh(); const timer = setInterval(() => void refresh(), 5000);
    return () => { active = false; clearInterval(timer); };
  }, [epoch]);
  return { rows, error };
}
function CurrentVersion({ row }: { row: ClientRow }) {
  const { t } = useI18n();
  const current = row.releases.find(release => release.id === row.currentReleaseId);
  const pending = row.drafts.find(draft => !draft.archivedAt && ["SUBMITTED", "APPROVED", "REJECTED"].includes(draft.status));
  const uploading = row.uploads[0];
  return <div className="space-y-1"><p className="font-medium">{current?.versionLabel ?? t("clients.notYetPublished")}</p>{pending && <p className="text-xs text-muted-foreground">{pending.versionLabel} · {t(statusLabels[pending.status])}</p>}{uploading && <p className="text-xs text-muted-foreground">{["QUEUED", "PROCESSING"].includes(uploading.status) || uploading.packageFormatVersion === 2 && uploading.status === "READY" ? uploadProcessingLabel(uploading, t) : t(statusLabels[uploading.status])}</p>}</div>;
}
function uploadOrganizations(state: ReturnType<typeof useAdmin>["state"]) {
  return state.organizations.filter(org => !org.archivedAt && (org.permissions.includes("DRAFT_CREATE") || org.servers.some(server => server.permissions.includes("DRAFT_CREATE"))))
    .map(org => ({ id: org.id, displayName: org.displayName, canUnbound: org.permissions.includes("DRAFT_CREATE") && org.permissions.includes("DRAFT_SUBMIT") }));
}
function uploadTargets(state: ReturnType<typeof useAdmin>["state"]) {
  return state.organizations.flatMap(org => org.servers.filter(server => !org.archivedAt && !server.archivedAt && server.permissions.includes("DRAFT_CREATE") && server.permissions.includes("DRAFT_SUBMIT") && server.permissions.includes("CLIENT_BIND"))
    .map(server => ({ ...server, organizationName: org.displayName })));
}
// Stable cell identities keep dialogs and in-flight uploads mounted during polling.
function ClientActionsCell({ row: tableRow }: CellContext<ClientRow, unknown>) {
  const { t } = useI18n();
  const { state, run, busy } = useAdmin(); const row = tableRow.original;
  const targets = uploadTargets(state).filter(target => target.organizationId === row.organizationId);
  const organizations = uploadOrganizations(state);
  const previous = metadata(row.releases.find(release => release.id === row.currentReleaseId) ?? row.drafts.find(draft => !draft.archivedAt) ?? row.releases[0]);
  const current = previous ? { ...previous, name: row.name } : undefined;
  const prepared = row.uploads.find(upload => ["READY", "QUEUED", "PROCESSING", "FAILED"].includes(upload.status) && upload.canEdit);
  const canUpdate = !row.archived && !row.blocked && row.permissions.includes("DRAFT_CREATE") && row.permissions.includes("DRAFT_SUBMIT") && (!row.currentReleaseId || row.permissions.includes("DRAFT_EDIT"));
  const comparisonDrafts = row.permissions.includes("DRAFT_ARCHIVE") ? row.drafts.filter(draft => !draft.archivedAt && draft.status !== "RELEASED" && draft.upload) : [];
  const defaultPackageFormatVersion = packageFormatVersionSchema.parse(row.initialPackageFormatVersion ?? row.drafts[0]?.packageFormatVersion ?? 1);
  return <div className="flex flex-wrap gap-2">{canUpdate && <ClientUploadDialog key="update" targets={targets} organizations={organizations} clientId={row.clientId} client={row} current={current} defaultPackageFormatVersion={defaultPackageFormatVersion} comparisonDrafts={comparisonDrafts} onDone={() => {}} disabled={busy} />}
    {prepared && canUpdate && <ClientUploadDialog key={prepared.id} targets={targets} organizations={organizations} clientId={row.clientId} client={row} resume={prepared} current={current} comparisonDrafts={comparisonDrafts} onDone={() => {}} disabled={busy} />}
    <VersionHistory key="history" row={row} />{row.drafts.find(draft => !draft.archivedAt && ["SUBMITTED", "APPROVED"].includes(draft.status)) && <PackageDialog row={row} draft={row.drafts.find(draft => !draft.archivedAt && ["SUBMITTED", "APPROVED"].includes(draft.status))!} />}<BindingDialog key="binding" row={row} />{row.permissions.includes("CLIENT_ARCHIVE") && <ArchiveButton key="archive" kind="clients" id={row.clientId} archived={row.archived} disabled={row.blocked} />}
    <FullPackageDownload row={row} />
    {row.canDelete && <DeleteClientButton key="delete" row={row} />}
    {row.uploads.some(upload => upload.canEdit && upload.status === "UPLOADING") && <Button variant="ghost" size="sm" disabled={busy} onClick={() => void run(async () => { for (const upload of row.uploads.filter(upload => upload.canEdit && upload.status === "UPLOADING")) await api(`/api/v1/clients/uploads/${upload.id}/cancel`, "POST", {}); }, t("clients.incompleteUploadCancelled"))}>{t("clients.cancelIncompleteUpload")}</Button>}
  </div>;
}
function FullPackageDownload({ row }: { row: ClientRow }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false), [selection, setSelection] = useState(""), [downloading, setDownloading] = useState(false), [error, setError] = useState("");
  const versions = [
    ...row.drafts.filter(draft => draft.status !== "RELEASED").map(draft => ({ ...draft, kind: "drafts" as const })),
    ...row.releases.map(release => ({ ...release, kind: "releases" as const })),
  ].flatMap(version => version.packageBuilds.filter(build => build.status === "READY" && build.artifacts).map(build => ({
    id: `${version.kind}/${version.id}/${build.platform}`, kind: version.kind, versionId: version.id, versionLabel: version.versionLabel, platform: build.platform,
    size: build.artifacts!.full.size, current: version.id === row.currentReleaseId, packageFormatVersion: version.packageFormatVersion,
  })));
  const selected = versions.find(version => version.id === selection) ?? versions[0];
  return <Dialog open={open} onOpenChange={value => { setOpen(value); setError(""); }}><DialogTrigger asChild>
    <Button size="sm" variant="outline" disabled={!versions.length} title={versions.length ? t("clients.downloadGeneratedFullClientPackage") : t("clients.downloadAvailableAfterFullPackageGeneration")}><Download className="size-3.5" />{t("clients.downloadFullPackage")}</Button>
  </DialogTrigger><DialogContent><DialogHeader><DialogTitle>{row.name} {" " + t("clients.downloadCompleteMuapack")}</DialogTitle><DialogDescription>{t("clients.selectAGeneratedVersionV1IncludesAPlatformEnvironment")}</DialogDescription></DialogHeader>
    <label className="space-y-2 text-sm"><span>{selected?.packageFormatVersion === 2 ? t("clients.version") : t("clients.versionPlatform")}</span><select className="w-full rounded-md border bg-background p-2" value={selected?.id ?? ""} disabled={downloading} onChange={event => { setSelection(event.target.value); setError(""); }}>
      {versions.map(version => <option key={version.id} value={version.id}>{version.versionLabel} · {version.platform === "universal" ? t("clients.v2UniversalRecipe") : version.platform} · {formatBytes(version.size)}{version.current ? t("clients.currentVersion") : version.kind === "drafts" ? t("clients.awaitingPublication") : t("clients.releaseRecord")}</option>)}
    </select></label>
    {error && <Alert variant="destructive"><AlertDescription>{formatMessage(t, error)}</AlertDescription></Alert>}
    <Button disabled={downloading || !selected} onClick={async () => {
      if (!selected) return; setDownloading(true); setError("");
      try {
        const download = await api<{ url: string }>(`/api/v1/clients/${row.clientId}/${selected.kind}/${selected.versionId}/package${selected.packageFormatVersion === 2 ? "" : `?platform=${selected.platform}`}`);
        const link = document.createElement("a"); link.href = download.url; document.body.appendChild(link); link.click(); link.remove();
      } catch (error) { setError(error instanceof Error ? serializeError(error) : t("clients.couldNotObtainDownloadLink")); }
      finally { setDownloading(false); }
    }}>{downloading ? <><LoaderCircle className="size-4 animate-spin" />{t("clients.preparingDownload")}</> : <><Download className="size-4" />{t("clients.downloadFullPackage")}{selected ? ` (${formatBytes(selected.size)})` : ""}</>}</Button>
  </DialogContent></Dialog>;
}
function DeleteClientButton({ row }: { row: ClientRow }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false); const { busy, run } = useAdmin();
  return <AlertDialog open={open} onOpenChange={setOpen}><AlertDialogTrigger asChild><Button variant="destructive" size="sm" disabled={busy}>{t("clients.delete")}</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t("clients.deleteVariant")}{row.name}”？</AlertDialogTitle><AlertDialogDescription>{t("clients.thisClientIsArchivedAndUnboundAndCanBe")}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={busy}>{t("common.actions.cancel")}</AlertDialogCancel><Button variant="destructive" disabled={busy} onClick={async () => { if (await run(() => api(`/api/v1/clients/${row.clientId}/delete`, "POST", {}), t("clients.clientDeletedFilesAwaitRecycling"))) setOpen(false); }}>{t("clients.confirmDeletion")}</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>;
}
export function ClientsPage({ clientId }: { clientId?: string }) {
  const { t } = useI18n();
  const { state, organizationId, busy } = useAdmin(); const { rows, error } = useClients();
  const targets = uploadTargets(state);
  const organizations = uploadOrganizations(state).filter(org => organizationId === "all" || org.id === organizationId);
  const visible = rows?.filter(row => (!clientId || row.clientId === clientId) && (clientId || organizationId === "all" || row.organizationId === organizationId)) ?? [];
  const columns: ColumnDef<ClientRow>[] = [
    { id: "name", header: t("clientUpload.clientName"), accessorFn: row => row.name,
      cell: ({ getValue, row }) => <div><p className="font-medium">{String(getValue())}</p><p className="text-xs text-muted-foreground">{row.original.organizationName}</p></div> },
    { id: "server", header: t("clients.boundServer"), accessorFn: row => row.serverId ? `${row.serverName} (${row.serverId})` : row.requestedServerId ? t("clients.pendingBinding", { "server": row.requestedServerId }) : t("clients.unbound") },
    { id: "version", header: t("clients.currentVersionVariant"), accessorFn: row => row.releases.find(release => release.id === row.currentReleaseId)?.versionLabel ?? t("clients.unpublished"), cell: ({ row }) => <CurrentVersion row={row.original} /> },
    { id: "runtime", header: t("clients.runtimeEnvironment"), accessorFn: row => { const data = metadata(row.releases.find(release => release.id === row.currentReleaseId) ?? row.drafts[0]); return data?.minecraftVersion ? `MC ${data.minecraftVersion} · Java ${data.javaVersion}` : t("clients.awaitingDetails"); } },
    { id: "status", header: t("clients.status"), accessorFn: row => ({ ARCHIVED: t("clients.archived"), PUBLISHED: t("clients.published"), UNPUBLISHED: t("clients.unpublished") })[row.lifecycleStatus], cell: ({ getValue, row }) => <div className="space-y-1"><Badge variant="outline">{String(getValue())}</Badge><DisplayScheduleNote schedule={row.original.displaySchedule} /></div> },
    { id: "packages", header: t("clients.packagingProgress"), accessorFn: row => row.drafts[0]?.packageBuilds.map(build => `${build.platform} ${packageBuildLabel(build, t)}`).join(" ") ?? "", cell: ({ row }) => <PackageProgress draft={row.original.drafts[0]} /> },
    { id: "actions", header: t("clients.actions"), enableHiding: false, cell: ClientActionsCell },
  ];
  if (clientId && rows && !rows.some(row => row.clientId === clientId)) return <NoPermission />;
  return <><Heading title={t("navigation.clients")} description={t("clients.uploadCompleteClientsCreateVersionsAndSubmitForReview")}
    action={organizations.length > 0 && !clientId && <ClientUploadDialog targets={targets} organizations={organizations} onDone={() => {}} disabled={!rows || busy || (!organizations.some(org => org.canUnbound) && !targets.some(target => organizations.some(org => org.id === target.organizationId)))} />} />
    {error && <Alert variant="destructive"><AlertDescription>{formatMessage(t, error)}</AlertDescription></Alert>}
    {!rows && !error ? <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />{t("clients.loadingClients")}</p> : <DataTable data={visible} columns={columns} getRowId={clientRowId} empty={t("clients.noClientsClickAddClientToUploadAComplete")} searchPlaceholder={t("clients.searchClientsOrganizationsOrServers")} />}
  </>;
}
export function ClientDetailPage() { return <ClientsPage clientId={useParams<{ id: string }>().id} />; }
function VersionDetails({ version, clientId }: { version: Draft | Release; clientId: string }) {
  const { t } = useI18n();
  const data = metadata(version);
  if (!data) return <Alert variant="destructive"><AlertDescription>{t("clients.versionMetadataIsMissingOrInvalidCheckTheUpload")}</AlertDescription></Alert>;
  const upload = "upload" in version ? version.upload : version.sourceDraft?.upload;
  return <div className="space-y-5"><dl className="grid grid-cols-2 gap-3 text-sm"><div>{t("clients.clientVersion")}{data.versionLabel}</div><div>{t("clients.clientName")}{data.name}</div><div>MC：{data.minecraftVersion || t("clients.notEntered")}</div><div>Java：{data.javaVersion}</div></dl>
    <div><h3 className="mb-2 font-semibold">{data.summary || t("clients.submissionNotes")}</h3><MarkdownText value={data.description} /></div>
    <div className="space-y-3"><h3 className="text-sm font-medium">{t("clientUpload.modList") + " "}{data.mods.length}</h3><ModTable mods={data.mods} details={data.modDetails} /></div>
    {"reviewNote" in version && version.reviewNote && <Alert><AlertDescription>{t("clients.reviewNotes")}{version.reviewNote}</AlertDescription></Alert>}
    {upload?.statistics && (version.packageFormatVersion === 2 ? <RecipeImportStats statistics={upload.statistics as unknown as RecipeImportStatistics} /> : <UpdateStats statistics={upload.statistics as unknown as UpdateStatistics} comparison={upload.comparisonStatistics as unknown as UpdateStatistics | null} version={data.versionLabel} updating={!!upload.comparisonStatistics} />)}
    {version.packageFormatVersion === 2 && <RecipeDistributionStats path={`/api/v1/clients/${clientId}/${"candidateMetadata" in version ? "drafts" : "releases"}/${version.id}/distribution-statistics`} revision={JSON.stringify(version.packageBuilds)} />}
  </div>;
}
function ActivateButton({ row, release }: { row: ClientRow; release: Release }) {
  const { t } = useI18n();
  const { run, busy } = useAdmin();
  if (!row.permissions.includes("RELEASE_ACTIVATE") || row.currentReleaseId === release.id || row.archived || row.blocked || release.archivedAt) return null;
  return <EditorDialog title={t("clients.switchCurrentVersion")} trigger={<Button size="sm" variant="outline">{t("clients.setAsCurrentVersion")}</Button>} description={t("clients.switchVersionConfirmation", { "version": release.versionLabel })}>{close => <Button disabled={busy} onClick={async () => {
    if (await run(() => api(`/api/v1/clients/${row.clientId}/releases/${release.id}/activate`, "POST", { publicationRevision: row.publicationRevision }), t("clients.currentVersionSwitched"))) close();
  }}>{t("clients.confirmSwitch")}</Button>}</EditorDialog>;
}
function VersionHistory({ row }: { row: ClientRow }) {
  const { t, formatDate } = useI18n();
  const columns: ColumnDef<ReleaseRow>[] = [{ id: "version", accessorFn: item => item.release.versionLabel, header: t("clients.version") }, { id: "summary", accessorFn: item => item.release.summary, header: "Summary" },
    { id: "publishedAt", header: t("clients.publishedAt"), accessorFn: item => formatDate(item.release.publishedAt) },
    { id: "action", header: t("clients.actions"), cell: ReleaseActionsCell }];
  return <EditorDialog title={t("clients.historyTitle", { "client": row.name })} trigger={<Button variant="ghost" size="sm"><History className="size-3.5" />{t("clients.records")}</Button>} description={t("clients.allVersionsAndReviewsAreKeptUpdatingAClient")}>{() => <div className="space-y-6">
    <DataTable data={row.releases.map(release => ({ row, release }))} columns={columns} getRowId={releaseRowId} empty={t("clients.noPublishedVersions")} />
    {row.drafts.map(draft => <details key={draft.id} className="rounded-lg border p-4"><summary className="cursor-pointer text-sm font-medium">{draft.versionLabel} · {draft.archivedAt ? draft.archiveReason === "SUPERSEDED" ? t("clients.replacedByANewReleaseArchived") : t("clients.archived") : t(statusLabels[draft.status])}</summary><div className="mt-4 space-y-4"><VersionDetails version={draft} clientId={row.clientId} />
      {draft.replacesDraftId && <p className="text-xs text-muted-foreground">{t("clients.replacementDraft")}{row.drafts.find(previous => previous.id === draft.replacesDraftId)?.versionLabel ?? draft.replacesDraftId}</p>}
      {draft.supersededByDraftId && <p className="text-xs text-muted-foreground">{t("clients.replacementRelease")}{row.releases.find(release => release.id === draft.supersededByDraftId)?.versionLabel ?? draft.supersededByDraftId}</p>}
      <ArchiveDraftButton row={row} draft={draft} /></div></details>)}
  </div>}</EditorDialog>;
}
function ReviewDialog({ row, draft }: { row: ClientRow; draft: Draft }) {
  const { t } = useI18n();
  const { run, busy } = useAdmin(); const [open, setOpen] = useState(false); const [note, setNote] = useState("");
  const [packageRevision, setPackageRevision] = useState(draft.packageRevision);
  const [manifest, setManifest] = useState<ReleaseManifest | RecipeManifest | null>(null); const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return; let active = true;
    void api<ReleaseManifest | RecipeManifest>(`/api/v1/clients/${row.clientId}/drafts/${draft.id}/manifest`).then(data => { if (active) { setManifest(data); setError(""); } }).catch(error => { if (active) setError(error instanceof Error ? serializeError(error) : t("clients.couldNotReadFileList")); });
    return () => { active = false; };
  }, [open, row.clientId, draft.id, t]);
  const columns: ColumnDef<PackFile>[] = [{ accessorKey: "path", header: t("clientShared.path") }, { accessorKey: "size", header: t("clientShared.size"), cell: ({ getValue }) => formatBytes(Number(getValue())) }, { accessorKey: "policy", header: t("clients.filePolicy") }, { accessorKey: "sha256", header: "SHA-256", cell: ({ getValue }) => <code className="text-xs" title={String(getValue())}>{String(getValue()).slice(0, 16)}…</code> }];
  return <Dialog open={open} onOpenChange={value => { if (value) setPackageRevision(draft.packageRevision); setOpen(value); }}><DialogTrigger asChild><Button size="sm" variant="outline">{t("clients.viewReview")}</Button></DialogTrigger><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl"><DialogHeader><DialogTitle>{draft.name} · {draft.versionLabel}</DialogTitle><DialogDescription>{row.organizationName} / {row.serverName} ({row.serverId}) · {t(statusLabels[draft.status])}</DialogDescription></DialogHeader>
    <p className="text-xs text-muted-foreground">{draft.packageFormatVersion === 2 ? t("clients.v2PackagingRevision", { "revision": draft.packageRevision }) : t("clients.v1PlatformPlan", { "revision": draft.packageRevision, "platforms": draft.packageBuilds.map(build => build.platform).join("、") })}</p>{packageRevision !== draft.packageRevision && <Alert variant="destructive"><AlertDescription>{t("clients.thePackagingPlanChangedCloseAndReopenThisReview")}</AlertDescription></Alert>}
    <Tabs defaultValue="details"><TabsList><TabsTrigger value="details">{t("clients.versionDetails")}</TabsTrigger><TabsTrigger value="files">{t("clients.fileList")}</TabsTrigger></TabsList><TabsContent value="details" className="mt-4"><VersionDetails version={draft} clientId={row.clientId} /></TabsContent><TabsContent value="files" className="mt-4">{manifest ? manifest.format === "mua-recipe-manifest" ? <><p className="mb-3 text-xs text-muted-foreground">{t("clients.remoteFilesAreDeclarationsTheirBytesAreNotVerified")}</p><RecipeFileTable files={manifest.files} /></> : <DataTable data={manifest.files} columns={columns} /> : <p className="text-sm text-muted-foreground">{formatMessage(t, error) || t("clients.loadingFileList")}</p>}</TabsContent></Tabs>
    {draft.status === "SUBMITTED" && row.permissions.includes("DRAFT_REVIEW") && !row.archived && !row.blocked && <div className="space-y-3 border-t pt-5"><Input placeholder={t("clients.reviewNotesRequiredForRejection")} value={note} onChange={event => setNote(event.target.value)} /><div className="flex justify-end gap-3">{([ ["reject", t("clients.reject")], ["approve", t("clients.approveReview")] ] as const).map(([decision, label]) => <Button key={decision} variant={decision === "reject" ? "outline" : "default"} disabled={busy || !manifest || packageRevision !== draft.packageRevision || (decision === "reject" && !note.trim())} onClick={async () => {
      if (await run(() => api(`/api/v1/clients/${row.clientId}/drafts/${draft.id}/review`, "POST", { decision, note, contentRevision: draft.contentRevision, packageRevision }), decision === "approve" ? t("clients.approvedAwaitingPublicationVariant") : t("clients.rejected"))) setOpen(false);
    }}>{label}</Button>)}</div></div>}
  </DialogContent></Dialog>;
}
function PublishButton({ row, draft }: { row: ClientRow; draft: Draft }) {
  const { t } = useI18n();
  const { run, busy } = useAdmin();
  const [replacement, setReplacement] = useState(draft.replacesDraftId ?? "none");
  if (draft.archivedAt || draft.status !== "APPROVED" || !row.permissions.includes("RELEASE_PUBLISH") || row.archived || row.blocked) return null;
  const activate = row.permissions.includes("RELEASE_ACTIVATE") && (!row.requestedServerId || row.permissions.includes("CLIENT_BIND"));
  const ready = draft.packageBuilds.length > 0 && draft.packageBuilds.every(build => build.status === "READY");
  const canReplace = row.permissions.includes("DRAFT_ARCHIVE");
  const candidates = row.drafts.filter(previous => !previous.archivedAt && previous.status !== "RELEASED" && previous.upload && previous.versionSequence < draft.versionSequence &&
    (!previous.versionLabel || !draft.versionLabel || (compareClientVersions(draft.versionLabel, previous.versionLabel) ?? 1) > 0));
  return <EditorDialog title={t("clients.publishClient")} trigger={<Button size="sm" disabled={!ready} title={ready ? "" : t("clients.waitingForRequiredClientPackages")}>{ready ? t("clients.publish") : t("clients.awaitingPackaging")}</Button>} description={activate ? t("clients.publishConfirmation", { "version": draft.versionLabel }) : t("clients.publishThisVersionThisAccountCannotActivateVersionsA")}>{close => <div className="space-y-4">
    {canReplace && <div className="space-y-2"><p className="text-sm font-medium">{t("clients.draftsArchivedAfterSuccessfulPublication")}</p><Select value={replacement} onValueChange={setReplacement}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>
      <SelectItem value="none">{t("clients.doNotReplaceOtherDrafts")}</SelectItem>{candidates.map(previous => <SelectItem key={previous.id} value={previous.id}>{previous.versionLabel}</SelectItem>)}
      {replacement !== "none" && !candidates.some(previous => previous.id === replacement) && <SelectItem value={replacement} disabled>{t("clients.linkedDraft") + " "}{row.drafts.find(previous => previous.id === replacement)?.versionLabel}</SelectItem>}
    </SelectContent></Select><p className="text-xs text-muted-foreground">{t("clients.onlyTheSelectedDraftAndItsReplacementChainAre")}</p></div>}
    {!canReplace && draft.replacesDraftId && <p className="text-sm">{t("clients.afterPublicationArchiveTheLinkedDrafts")}{row.drafts.find(previous => previous.id === draft.replacesDraftId)?.versionLabel}</p>}
    <Button disabled={busy || !ready} onClick={async () => {
      if (await run(() => api(`/api/v1/clients/${row.clientId}/drafts/${draft.id}/publish`, "POST", { activate, contentRevision: draft.contentRevision, packageRevision: draft.packageRevision,
        ...(canReplace ? { replacesDraftId: replacement === "none" ? null : replacement } : {}) }), activate ? t("clients.clientPublishedAndActivatedReplacedDraftsArchived") : t("clients.clientPublishedReplacedDraftsArchivedAwaitingActivation"))) close();
    }}>{t("clients.confirmSigningAndPublication")}</Button></div>}</EditorDialog>;
}
function ArchiveDraftButton({ row, draft }: { row: ClientRow; draft: Draft }) {
  const { t } = useI18n();
  const { run, busy } = useAdmin();
  if (draft.archivedAt || draft.status === "RELEASED" || row.archived || row.blocked || !row.permissions.includes("DRAFT_ARCHIVE")) return null;
  return <EditorDialog title={t("clients.withdrawAndArchiveUnpublishedVersion")} trigger={<Button size="sm" variant="outline">{t("clients.withdrawArchive")}</Button>} description={t("clients.archiveDraftConfirmation", { "version": draft.versionLabel ?? t("clients.thisDraft") })}>{close =>
    <Button disabled={busy} onClick={async () => { if (await run(() => api(`/api/v1/clients/${row.clientId}/drafts/${draft.id}/archive`, "POST", { contentRevision: draft.contentRevision, packageRevision: draft.packageRevision }), t("clients.unpublishedVersionArchived"))) close(); }}>{t("clients.confirmWithdrawalAndArchive")}</Button>
  }</EditorDialog>;
}
function PackageProgress({ draft }: { draft?: Draft }) {
  const { t } = useI18n();
  const builds = draft?.packageBuilds ?? [];
  if (!builds.length) return <span className="text-xs text-muted-foreground">{t("clients.noTasksYet")}</span>;
  const completed = builds.filter(build => build.status === "READY").length;
  const progress = Math.floor(builds.reduce((sum, build) => sum + build.progress, 0) / builds.length);
  return <div className="min-w-36 space-y-1" role="status"><p className="text-xs">{completed}/{builds.length} {draft?.packageFormatVersion === 2 ? t("clients.recipePackages") : t("clients.platforms")}{t("clients.complete") + " "}{progress}%</p><Progress value={progress} />
    {builds.some(build => build.status === "FAILED") ? <p className="text-xs text-destructive">{t("clients.generationFailedCheckDetailsAndRetry")}</p> : <p className="text-xs text-muted-foreground">{builds.find(build => build.status === "PROCESSING")?.phase ? formatMessage(t, builds.find(build => build.status === "PROCESSING")!.phase) : (builds.some(build => build.status === "PREPARED") ? (draft?.packageFormatVersion === 2 ? t("clients.recipePreparedAwaitingReviewAndSignature") : t("clients.environmentPreparedAwaitingReviewAndSignature")) : completed === builds.length ? t("clients.allCompleteReadyToPublish") : t("clients.waitingForWorker"))}</p>}
  </div>;
}
function PackageDialog({ row, draft }: { row: ClientRow; draft: Draft }) {
  const { t } = useI18n();
  const { run, busy } = useAdmin(); const [open, setOpen] = useState(false);
  const selectedPlatforms = () => (draft.packageFormatVersion === 2 ? [] : draft.packageBuilds.map(build => build.platform)).map(platform => muaPlatformSchema.parse(platform));
  const [platforms, setPlatforms] = useState(selectedPlatforms);
  const canEdit = row.permissions.includes("DRAFT_CREATE") && row.permissions.includes("DRAFT_SUBMIT") && (!row.currentReleaseId || row.permissions.includes("DRAFT_EDIT")) && !row.archived && !row.blocked;
  return <Dialog open={open} onOpenChange={value => { if (value) setPlatforms(selectedPlatforms()); setOpen(value); }}><DialogTrigger asChild><Button size="sm" variant="outline">{draft.packageFormatVersion === 2 ? t("clients.packagingProgress") : t("clients.packagingPlatforms")}</Button></DialogTrigger>
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{draft.name} · {draft.versionLabel} {" " + t("clients.releasePackages")}</DialogTitle><DialogDescription>{draft.packageFormatVersion === 2 ? t("clients.v2GeneratesAUniversalRecipeAndAnUpdateWhen") : t("clients.fullPackagesServeFirstInstallationsUpdatesUseThePreviously")}</DialogDescription></DialogHeader>
      <PackageBuildOptions packageFormatVersion={draft.packageFormatVersion === 2 ? 2 : 1} value={platforms} onChange={setPlatforms} disabled={!canEdit || busy} />
      {canEdit && <div className="flex gap-2">{draft.packageFormatVersion === 1 && <Button disabled={busy || !platforms.length} onClick={() => void run(() => api(`/api/v1/clients/${row.clientId}/drafts/${draft.id}/platforms`, "POST", { platforms }), t("clients.platformsSavedCheckReviewStatus"))}>{t("clients.savePlatforms")}</Button>}
        {draft.packageBuilds.some(build => build.status === "FAILED") && <Button variant="outline" disabled={busy} onClick={() => void run(() => api(`/api/v1/clients/${row.clientId}/drafts/${draft.id}/retry-packages`, "POST", {}), t("clients.failedTasksRequeued"))}>{t("clients.retryFailedTasks")}</Button>}</div>}
      <div className="space-y-3">{draft.packageBuilds.map(build => <div key={build.platform} className="space-y-2 rounded-md border p-3"><div className="flex justify-between gap-2 text-sm"><span>{build.platform === "universal" ? t("clients.v2UniversalFullRecipe") : build.platform}</span><span>{packageBuildLabel(build, t)}</span></div><Progress value={build.progress} />
        {build.error && <p className="break-all text-xs text-destructive">{formatMessage(t, build.error)}</p>}{build.artifacts && <p className="text-xs text-muted-foreground">{t("clients.fullPackage") + " "}{formatBytes(build.artifacts.full.size)} · {build.artifacts.update ? t("clients.updatePackage", { "version": formatBytes(build.artifacts.update.size) }) : t("clients.firstReleaseNoUsableBaselineUseFullPackage")}{draft.packageFormatVersion === 2 && t("clients.launcherDownloadsEnvironmentsAndRemoteMods")}</p>}
        {["PREPARED", "READY"].includes(build.status) && <PlatformManifestDialog row={row} draft={draft} platform={build.platform} />}
      </div>)}</div><p className="text-xs text-muted-foreground">{t("clients.youMayCloseThisPageClientManagementRefreshesBackground")}</p>
    </DialogContent></Dialog>;
}
function PlatformManifestDialog({ row, draft, platform }: { row: ClientRow; draft: Draft; platform: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false), [manifest, setManifest] = useState<MuaPlatformManifest | RecipeManifest | null>(null), [error, setError] = useState("");
  useEffect(() => { if (!open) return; let active = true;
    void api<MuaPlatformManifest | RecipeManifest>(`/api/v1/clients/${row.clientId}/drafts/${draft.id}/platform-manifest?platform=${platform}`).then(data => { if (active) { setManifest(data); setError(""); } }).catch(error => { if (active) setError(error instanceof Error ? serializeError(error) : t("clients.couldNotReadPlatformList")); });
    return () => { active = false; };
  }, [open, row.clientId, draft.id, platform, t]);
  const columns: ColumnDef<MuaFile>[] = [{ id: "path", header: t("clients.targetPath"), accessorFn: file => `${file.root}/${file.path}` }, { accessorKey: "policy", header: t("clientShared.policy") }, { accessorKey: "size", header: t("clientShared.size"), cell: ({ getValue }) => formatBytes(Number(getValue())) }, { accessorKey: "sha256", header: "SHA-256", cell: ({ getValue }) => <code className="text-xs">{String(getValue()).slice(0, 16)}…</code> }];
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button variant="ghost" size="sm">{t("clients.viewEnvironmentAndFullManifest")}</Button></DialogTrigger><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl"><DialogHeader><DialogTitle>{platform === "universal" ? t("clients.v2UniversalRecipe") : platform} {" " + t("clients.environmentAndFullManifest")}</DialogTitle><DialogDescription>{draft.packageFormatVersion === 2 ? t("clients.theSignatureBindsLocalPayloadsRemoteDeclarationsAndEnvironment") : t("clients.theManifestRecordsDownloadedAndVerifiedEnvironmentAndClient")}</DialogDescription></DialogHeader>
    {manifest?.format === "mua-recipe-manifest" ? <div className="space-y-4 text-sm"><p>MC {manifest.runtime.minecraft} · {manifest.runtime.loader ? `${manifest.runtime.loader.type} ${manifest.runtime.loader.version}` : t("clients.vanilla")}</p><p>Java {manifest.runtime.java.major} · {manifest.runtime.java.imageType.toUpperCase()} {" " + t("clients.preparedByLauncher")}</p><RecipeFileTable files={manifest.files} /></div> : manifest ? <div className="space-y-4 text-sm"><p>MC {manifest.runtime.minecraft} · {manifest.runtime.loader ? `${manifest.runtime.loader.type} ${manifest.runtime.loader.version}` : t("clients.vanilla")}</p><p>Java {manifest.runtime.java.major} · {manifest.runtime.java.vendor} · {manifest.runtime.java.build}</p><p className="break-all">{t("clients.entryPoint")}{manifest.launch.mainClass}</p>
      <details><summary>{t("clients.launchArgumentsAndMemory")}</summary><pre className="mt-2 overflow-x-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify(manifest.launch, null, 2)}</pre></details><DataTable data={manifest.files} columns={columns} /></div> : <p role="status">{formatMessage(t, error) || t("clients.loadingManifest")}</p>}
  </DialogContent></Dialog>;
}
function ReviewActionsCell({ row: item }: CellContext<ReviewRow, unknown>) {
  const { t } = useI18n();
  if (item.original.row.archived || item.original.draft.archivedAt) return <EditorDialog title={t("clients.archivedDrafts")} trigger={<Button size="sm" variant="ghost">{t("clients.details")}</Button>} description={t("clients.archivedRecordsAndFilesAreRetained")}>{() => <VersionDetails version={item.original.draft} clientId={item.original.row.clientId} />}</EditorDialog>;
  return <div className="flex flex-wrap gap-2"><ReviewDialog row={item.original.row} draft={item.original.draft} /><PackageDialog row={item.original.row} draft={item.original.draft} /><PublishButton row={item.original.row} draft={item.original.draft} /><ArchiveDraftButton row={item.original.row} draft={item.original.draft} /></div>;
}
function ReleaseActionsCell({ row: item }: CellContext<ReleaseRow, unknown>) {
  const { t } = useI18n();
  return <div className="flex gap-2"><EditorDialog title={t("clients.versionLabel", { "version": item.original.release.versionLabel })} trigger={<Button size="sm" variant="ghost">{t("clients.details")}</Button>} description={t("clients.publishedVersionContentCannotBeModified")}>{() => <VersionDetails version={item.original.release} clientId={item.original.row.clientId} />}</EditorDialog><ActivateButton row={item.original.row} release={item.original.release} /></div>;
}
export function ReleasesPage({ mode = "published" }: { mode?: "all" | "review" | "published" | "archived" }) {
  const { t, formatDate } = useI18n();
  const { organizationId } = useAdmin(); const { rows, error } = useClients();
  const visible = rows?.filter(row => organizationId === "all" || row.organizationId === organizationId) ?? [];
  const drafts = visible.filter(row => row.permissions.includes("DRAFT_REVIEW") || row.permissions.includes("RELEASE_PUBLISH"))
    .flatMap(row => row.drafts.filter(draft => draft.status !== "RELEASED" && (mode === "archived" ? row.archived || !!draft.archivedAt : !row.archived && !draft.archivedAt && ["SUBMITTED", "APPROVED"].includes(draft.status))).map(draft => ({ row, draft })));
  const releases = visible.flatMap(row => row.releases.filter(release => mode === "archived" ? row.archived || !!release.archivedAt : !row.archived && !release.archivedAt).map(release => ({ row, release })));
  const reviewColumns: ColumnDef<(typeof drafts)[number]>[] = [{ id: "name", header: t("clients.client"), accessorFn: item => item.draft.name }, { id: "version", header: t("clients.version"), accessorFn: item => item.draft.versionLabel }, { id: "server", header: t("clients.server"), accessorFn: item => `${item.row.organizationName} / ${item.row.serverName}` }, { id: "status", header: t("clients.status"), accessorFn: item => item.row.archived ? t("clients.clientArchived") : item.draft.archivedAt ? item.draft.archiveReason === "SUPERSEDED" ? t("clients.replacedByANewReleaseArchivedVariant") : t("clients.archived") : t(statusLabels[item.draft.status]) },
    { id: "packages", header: t("clients.packagingProgress"), cell: ({ row }) => <PackageProgress draft={row.original.draft} /> }, { id: "actions", header: t("clients.actions"), cell: ReviewActionsCell }];
  const releaseColumns: ColumnDef<(typeof releases)[number]>[] = [{ id: "name", header: t("clients.client"), accessorFn: item => item.release.name }, { id: "version", header: t("clients.version"), accessorFn: item => item.release.versionLabel }, { id: "server", header: t("clients.server"), accessorFn: item => item.row.serverName }, { id: "current", header: t("clients.status"), accessorFn: item => item.row.archived ? t("clients.clientArchived") : item.release.archivedAt ? t("clients.versionArchived") : item.row.currentReleaseId === item.release.id ? t("clients.currentVersionVariant") : t("clients.historicalVersion") }, { id: "date", header: t("clients.publishedAt"), accessorFn: item => formatDate(item.release.publishedAt) },
    { id: "actions", header: t("clients.actions"), cell: ReleaseActionsCell }];
  return <><Heading title={mode === "review" ? t("clients.clientReviewAndPublication") : mode === "archived" ? t("clients.archivedVersions") : t("clients.publishedClients")} description={mode === "review" ? t("clients.verifyVersionDetailsAndActualFileListsThenSign") : t("clients.viewImmutableReleaseRecordsAndTheCurrentServerVersion")} />
    {error && <Alert variant="destructive"><AlertDescription>{formatMessage(t, error)}</AlertDescription></Alert>}
    {!rows && !error ? <p role="status" className="text-sm text-muted-foreground">{t("clients.loadingVersions")}</p> : mode === "review" ? <DataTable data={drafts} columns={reviewColumns} getRowId={reviewRowId} empty={t("clients.noClientsAwaitingReviewOrPublication")} /> : <div className="space-y-6"><DataTable data={releases} columns={releaseColumns} getRowId={releaseRowId} empty={t("clients.noReleaseRecords")} />{mode === "archived" && <DataTable data={drafts} columns={reviewColumns} getRowId={reviewRowId} caption={t("clients.archivedUnpublishedVersions")} empty={t("clients.noArchivedDrafts")} />}</div>}
  </>;
}

function BindingDialog({ row }: { row: ClientRow }) {
  const { t } = useI18n();
  const { state, run, busy } = useAdmin(); const [open, setOpen] = useState(false); const [serverId, setServerId] = useState("");
  if (!row.permissions.includes("CLIENT_BIND") || row.blocked || row.archived) return null;
  const targets = state.organizations.flatMap(org => org.servers).filter(server => server.organizationId === row.organizationId && !server.archivedAt && server.permissions.includes("CLIENT_BIND"));
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button size="sm" variant="outline">{row.serverId ? t("clients.bindUnbind") : t("clients.bind")}</Button></DialogTrigger>
    <DialogContent><DialogHeader><DialogTitle>{row.name} {" " + t("clients.serverBinding")}</DialogTitle><DialogDescription>{t("clients.eachClientCanBindToOneServerReplacementRetains")}</DialogDescription></DialogHeader>
    <p className="text-sm">{row.serverId ? t("clients.currentVersion", { "version": row.serverName, "status": row.serverId }) : row.requestedServerId ? t("clients.bindAfterPublication", { "server": row.requestedServerId }) : t("clients.currentlyUnbound")}</p>
    {row.serverId || row.requestedServerId ? <Button variant="outline" disabled={busy} onClick={async () => {
      if (!window.confirm(row.serverId ? t("clients.unbindingStopsClientDistributionForThisServerVersionHistory") : t("clients.cancelThePendingBindingRequest"))) return;
      if (await run(() => api(`/api/v1/clients/${row.clientId}/unbind`, "POST", { serverId: row.serverId, publicationRevision: row.bindingRevision }), t("clients.unboundPendingBindingCancelled"))) setOpen(false);
    }}>{t("clients.unbindCancelPendingBinding")}</Button> : null}
    {!row.serverId && <><select aria-label={t("clients.selectServerToBind")} className="rounded-md border bg-background p-2" value={serverId} onChange={event => setServerId(event.target.value)}>
      <option value="">{t("clients.selectServer")}</option>{targets.map(target => <option key={target.serverId} value={target.serverId}>{target.displayName} ({target.serverId}){target.boundClientName ? t("clientUpload.boundServerSuffix", { "server": target.boundClientName }) : ""}</option>)}
    </select><Button disabled={busy || !serverId} onClick={async () => {
      const target = targets.find(target => target.serverId === serverId)!;
      const replaceConfirmed = !!target.boundClientId && window.confirm(t("clients.rebindConfirmation", { "previousClient": target.boundClientName, "nextClient": row.name }));
      if (target.boundClientId && !replaceConfirmed) return;
      if (await run(() => api(`/api/v1/clients/${row.clientId}/bind`, "POST", { serverId, publicationRevision: target.publicationRevision, expectedClientId: target.boundClientId, replaceConfirmed }), t("clients.bindingRequestSaved"))) setOpen(false);
    }}>{t("clients.confirmBinding")}</Button></>}
  </DialogContent></Dialog>;
}
