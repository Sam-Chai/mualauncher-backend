"use client";
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
import { MarkdownText, UpdateStats, RecipeImportStats, RecipeFileTable, ModTable } from "./client-shared";
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
const statusLabels: Record<string, string> = { UPLOADING: "上传未完成", WAITING_PROCESSOR: "上传已保存 · 等待 v2 处理器", QUEUED: "等待处理", PROCESSING: "正在分析", READY: "等待填写提交", FAILED: "解析失败", SUBMITTED: "待审核", APPROVED: "审核通过 · 待发布", REJECTED: "已驳回", RELEASED: "已发布", DRAFT: "资料草稿" };
function metadata(version: Draft | Release | undefined): ClientMetadata | undefined {
  if (!version) return undefined;
  const parsed = clientMetadataSchema.safeParse("candidateMetadata" in version ? version.candidateMetadata : version.environmentSnapshot);
  return parsed.success ? parsed.data : { versionLabel: version.versionLabel ?? "", name: version.name ?? "", minecraftVersion: "", javaVersion: 21,
    mods: [], summary: version.summary || version.changelog, description: version.description };
}
function useClients() {
  const { epoch } = useAdmin(); const [rows, setRows] = useState<ClientRow[] | null>(null); const [error, setError] = useState("");
  useEffect(() => {
    let active = true; let fetching = false;
    async function refresh() {
      if (fetching) return; fetching = true;
      try { const next = await api<ClientRow[]>("/api/v1/clients"); if (active) { setRows(next); setError(""); } }
      catch (error) { if (active) { if (error instanceof RequestError && error.status === 401) navigateAfterAuthChange("/login"); setError(error instanceof Error ? error.message : "读取客户端失败"); } }
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
  return <div className="space-y-1"><p className="font-medium">{current?.versionLabel ?? t("尚未发布")}</p>{pending && <p className="text-xs text-muted-foreground">{pending.versionLabel} · {t(statusLabels[pending.status])}</p>}{uploading && <p className="text-xs text-muted-foreground">{["QUEUED", "PROCESSING"].includes(uploading.status) || uploading.packageFormatVersion === 2 && uploading.status === "READY" ? t(uploadProcessingLabel(uploading)) : t(statusLabels[uploading.status])}</p>}</div>;
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
  const prepared = row.uploads.find(upload => ["WAITING_PROCESSOR", "READY", "QUEUED", "PROCESSING", "FAILED"].includes(upload.status) && upload.canEdit);
  const canUpdate = !row.archived && !row.blocked && row.permissions.includes("DRAFT_CREATE") && row.permissions.includes("DRAFT_SUBMIT") && (!row.currentReleaseId || row.permissions.includes("DRAFT_EDIT"));
  const comparisonDrafts = row.permissions.includes("DRAFT_ARCHIVE") ? row.drafts.filter(draft => !draft.archivedAt && draft.status !== "RELEASED" && draft.upload) : [];
  const defaultPackageFormatVersion = packageFormatVersionSchema.parse(row.initialPackageFormatVersion ?? row.drafts[0]?.packageFormatVersion ?? 1);
  return <div className="flex flex-wrap gap-2">{canUpdate && <ClientUploadDialog key="update" targets={targets} organizations={organizations} clientId={row.clientId} client={row} current={current} defaultPackageFormatVersion={defaultPackageFormatVersion} comparisonDrafts={comparisonDrafts} onDone={() => {}} disabled={busy} />}
    {prepared && canUpdate && <ClientUploadDialog key={prepared.id} targets={targets} organizations={organizations} clientId={row.clientId} client={row} resume={prepared} current={current} comparisonDrafts={comparisonDrafts} onDone={() => {}} disabled={busy} />}
    <VersionHistory key="history" row={row} />{row.drafts.find(draft => !draft.archivedAt && ["SUBMITTED", "APPROVED"].includes(draft.status)) && <PackageDialog row={row} draft={row.drafts.find(draft => !draft.archivedAt && ["SUBMITTED", "APPROVED"].includes(draft.status))!} />}<BindingDialog key="binding" row={row} />{row.permissions.includes("CLIENT_ARCHIVE") && <ArchiveButton key="archive" kind="clients" id={row.clientId} archived={row.archived} disabled={row.blocked} />}
    <FullPackageDownload row={row} />
    {row.canDelete && <DeleteClientButton key="delete" row={row} />}
    {row.uploads.some(upload => upload.canEdit && upload.status === "UPLOADING") && <Button variant="ghost" size="sm" disabled={busy} onClick={() => void run(async () => { for (const upload of row.uploads.filter(upload => upload.canEdit && upload.status === "UPLOADING")) await api(`/api/v1/clients/uploads/${upload.id}/cancel`, "POST", {}); }, t("已取消未完成上传"))}>{t("取消未完成上传")}</Button>}
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
    <Button size="sm" variant="outline" disabled={!versions.length} title={versions.length ? t("下载已生成的完整客户端包") : t("完整包生成后可下载")}><Download className="size-3.5" />{t("下载完整包")}</Button>
  </DialogTrigger><DialogContent><DialogHeader><DialogTitle>{row.name} {" " + t("· 下载完整 .muapack")}</DialogTitle><DialogDescription>{t("选择已生成的版本。v1 需选择平台并包含环境；v2 为通用包，由 Launcher 下载远程模组及环境。")}</DialogDescription></DialogHeader>
    <label className="space-y-2 text-sm"><span>{selected?.packageFormatVersion === 2 ? t("版本") : t("版本 / 平台")}</span><select className="w-full rounded-md border bg-background p-2" value={selected?.id ?? ""} disabled={downloading} onChange={event => { setSelection(event.target.value); setError(""); }}>
      {versions.map(version => <option key={version.id} value={version.id}>{version.versionLabel} · {version.platform === "universal" ? t("v2 跨平台配方") : version.platform} · {formatBytes(version.size)}{version.current ? t(" · 当前版本") : version.kind === "drafts" ? t(" · 待发布版本") : t(" · 发布记录")}</option>)}
    </select></label>
    {error && <Alert variant="destructive"><AlertDescription>{t(error)}</AlertDescription></Alert>}
    <Button disabled={downloading || !selected} onClick={async () => {
      if (!selected) return; setDownloading(true); setError("");
      try {
        const download = await api<{ url: string }>(`/api/v1/clients/${row.clientId}/${selected.kind}/${selected.versionId}/package${selected.packageFormatVersion === 2 ? "" : `?platform=${selected.platform}`}`);
        const link = document.createElement("a"); link.href = download.url; document.body.appendChild(link); link.click(); link.remove();
      } catch (error) { setError(error instanceof Error ? error.message : t("获取下载链接失败")); }
      finally { setDownloading(false); }
    }}>{downloading ? <><LoaderCircle className="size-4 animate-spin" />{t("正在准备下载…")}</> : <><Download className="size-4" />{t("下载完整包")}{selected ? ` (${formatBytes(selected.size)})` : ""}</>}</Button>
  </DialogContent></Dialog>;
}
function DeleteClientButton({ row }: { row: ClientRow }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false); const { busy, run } = useAdmin();
  return <AlertDialog open={open} onOpenChange={setOpen}><AlertDialogTrigger asChild><Button variant="destructive" size="sm" disabled={busy}>{t("删除")}</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t("删除“")}{row.name}”？</AlertDialogTitle><AlertDialogDescription>{t("此客户端已归档下架且未绑定服务器，无论是否曾发布均可删除。删除后客户端无法恢复，名称可重新使用；发布与审计记录保留，文件由 Worker 移入 OSS 回收站，按超管设置的保留期清理。其他客户端仍使用的文件会保留。回收站中的相同文件可供后续上传复用。")}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={busy}>{t("取消")}</AlertDialogCancel><Button variant="destructive" disabled={busy} onClick={async () => { if (await run(() => api(`/api/v1/clients/${row.clientId}/delete`, "POST", {}), t("已删除客户端，文件等待回收"))) setOpen(false); }}>{t("确认删除")}</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>;
}
export function ClientsPage({ serverId }: { serverId?: string }) {
  const { t } = useI18n();
  const { state, organizationId, busy } = useAdmin(); const { rows, error } = useClients();
  const targets = uploadTargets(state);
  const organizations = uploadOrganizations(state).filter(org => organizationId === "all" || org.id === organizationId);
  const visible = rows?.filter(row => (!serverId || row.clientId === serverId) && (serverId || organizationId === "all" || row.organizationId === organizationId)) ?? [];
  const columns: ColumnDef<ClientRow>[] = [
    { id: "name", header: t("客户端名称"), accessorFn: row => row.name,
      cell: ({ getValue, row }) => <div><p className="font-medium">{String(getValue())}</p><p className="text-xs text-muted-foreground">{row.original.organizationName}</p></div> },
    { id: "server", header: t("绑定服务器"), accessorFn: row => row.serverId ? `${row.serverName} (${row.serverId})` : row.requestedServerId ? t("待绑定 {0}", { "0": row.requestedServerId }) : t("未绑定") },
    { id: "version", header: t("当前版本"), accessorFn: row => row.releases.find(release => release.id === row.currentReleaseId)?.versionLabel ?? t("未发布"), cell: ({ row }) => <CurrentVersion row={row.original} /> },
    { id: "runtime", header: t("运行环境"), accessorFn: row => { const data = metadata(row.releases.find(release => release.id === row.currentReleaseId) ?? row.drafts[0]); return data?.minecraftVersion ? `MC ${data.minecraftVersion} · Java ${data.javaVersion}` : t("等待填写"); } },
    { id: "status", header: t("状态"), accessorFn: row => ({ ARCHIVED: t("已归档"), PUBLISHED: t("已发布"), UNPUBLISHED: t("未发布") })[row.lifecycleStatus], cell: ({ getValue }) => <Badge variant="outline">{String(getValue())}</Badge> },
    { id: "packages", header: t("组包进度"), accessorFn: row => row.drafts[0]?.packageBuilds.map(build => `${build.platform} ${packageBuildLabel(build)}`).join(" ") ?? "", cell: ({ row }) => <PackageProgress draft={row.original.drafts[0]} /> },
    { id: "actions", header: t("操作"), enableHiding: false, cell: ClientActionsCell },
  ];
  if (serverId && rows && !rows.some(row => row.clientId === serverId)) return <NoPermission />;
  return <><Heading title={t("客户端管理")} description={t("上传完整客户端、创建新版本并提交审核；客户端可独立上传和保留；每个服务器同时只绑定一个客户端。")}
    action={organizations.length > 0 && !serverId && <ClientUploadDialog targets={targets} organizations={organizations} onDone={() => {}} disabled={!rows || busy || (!organizations.some(org => org.canUnbound) && !targets.some(target => organizations.some(org => org.id === target.organizationId)))} />} />
    {error && <Alert variant="destructive"><AlertDescription>{t(error)}</AlertDescription></Alert>}
    {!rows && !error ? <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />{t("读取客户端…")}</p> : <DataTable data={visible} columns={columns} getRowId={clientRowId} empty={t("暂无客户端。点击右侧“添加客户端”上传完整 .minecraft ZIP。")} searchPlaceholder={t("搜索客户端、组织或服务器…")} />}
  </>;
}
export function ClientDetailPage() { return <ClientsPage serverId={useParams<{ id: string }>().id} />; }
function VersionDetails({ version }: { version: Draft | Release }) {
  const { t } = useI18n();
  const data = metadata(version)!;
  const upload = "upload" in version ? version.upload : version.sourceDraft?.upload;
  return <div className="space-y-5"><dl className="grid grid-cols-2 gap-3 text-sm"><div>{t("客户端版本：")}{data.versionLabel}</div><div>{t("客户端名称：")}{data.name}</div><div>MC：{data.minecraftVersion || t("未填写")}</div><div>Java：{data.javaVersion}</div></dl>
    <div><h3 className="mb-2 font-semibold">{data.summary || t("提交说明")}</h3><MarkdownText value={data.description} /></div>
    <div className="space-y-3"><h3 className="text-sm font-medium">{t("模组列表 ·") + " "}{data.mods.length}</h3><ModTable mods={data.mods} details={data.modDetails} /></div>
    {"reviewNote" in version && version.reviewNote && <Alert><AlertDescription>{t("审核说明：")}{version.reviewNote}</AlertDescription></Alert>}
    {upload?.statistics && (version.packageFormatVersion === 2 ? <RecipeImportStats statistics={upload.statistics as unknown as RecipeImportStatistics} /> : <UpdateStats statistics={upload.statistics as unknown as UpdateStatistics} comparison={upload.comparisonStatistics as unknown as UpdateStatistics | null} version={data.versionLabel} updating={!!upload.comparisonStatistics} />)}
  </div>;
}
function ActivateButton({ row, release }: { row: ClientRow; release: Release }) {
  const { t } = useI18n();
  const { run, busy } = useAdmin();
  if (!row.permissions.includes("RELEASE_ACTIVATE") || row.currentReleaseId === release.id || row.archived || row.blocked || release.archivedAt) return null;
  return <EditorDialog title={t("切换当前版本")} trigger={<Button size="sm" variant="outline">{t("设为当前版本")}</Button>} description={t("服务器将使用 {0}；已有发布内容不会被修改。", { "0": release.versionLabel })}>{close => <Button disabled={busy} onClick={async () => {
    if (await run(() => api(`/api/v1/clients/${row.clientId}/releases/${release.id}/activate`, "POST", { publicationRevision: row.publicationRevision }), t("当前版本已切换"))) close();
  }}>{t("确认切换")}</Button>}</EditorDialog>;
}
function VersionHistory({ row }: { row: ClientRow }) {
  const { t, formatDate } = useI18n();
  const columns: ColumnDef<ReleaseRow>[] = [{ id: "version", accessorFn: item => item.release.versionLabel, header: t("版本") }, { id: "summary", accessorFn: item => item.release.summary, header: "Summary" },
    { id: "publishedAt", header: t("发布时间"), accessorFn: item => formatDate(item.release.publishedAt) },
    { id: "action", header: t("操作"), cell: ReleaseActionsCell }];
  return <EditorDialog title={t("{0} · 版本记录", { "0": row.name })} trigger={<Button variant="ghost" size="sm"><History className="size-3.5" />{t("记录")}</Button>} description={t("保留所有版本与审核记录，更新客户端会创建新版本。")}>{() => <div className="space-y-6">
    <DataTable data={row.releases.map(release => ({ row, release }))} columns={columns} getRowId={releaseRowId} empty={t("尚无发布版本。")} />
    {row.drafts.map(draft => <details key={draft.id} className="rounded-lg border p-4"><summary className="cursor-pointer text-sm font-medium">{draft.versionLabel} · {draft.archivedAt ? draft.archiveReason === "SUPERSEDED" ? t("已被新发布替代 · 归档") : t("已归档") : t(statusLabels[draft.status])}</summary><div className="mt-4 space-y-4"><VersionDetails version={draft} />
      {draft.replacesDraftId && <p className="text-xs text-muted-foreground">{t("替代草稿：")}{row.drafts.find(previous => previous.id === draft.replacesDraftId)?.versionLabel ?? draft.replacesDraftId}</p>}
      {draft.supersededByDraftId && <p className="text-xs text-muted-foreground">{t("替代发布：")}{row.releases.find(release => release.id === draft.supersededByDraftId)?.versionLabel ?? draft.supersededByDraftId}</p>}
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
    void api<ReleaseManifest | RecipeManifest>(`/api/v1/clients/${row.clientId}/drafts/${draft.id}/manifest`).then(data => { if (active) { setManifest(data); setError(""); } }).catch(error => { if (active) setError(error instanceof Error ? error.message : t("读取文件清单失败")); });
    return () => { active = false; };
  }, [open, row.clientId, draft.id, t]);
  const columns: ColumnDef<PackFile>[] = [{ accessorKey: "path", header: t("路径") }, { accessorKey: "size", header: t("大小"), cell: ({ getValue }) => formatBytes(Number(getValue())) }, { accessorKey: "policy", header: t("文件策略") }, { accessorKey: "sha256", header: "SHA-256", cell: ({ getValue }) => <code className="text-xs" title={String(getValue())}>{String(getValue()).slice(0, 16)}…</code> }];
  return <Dialog open={open} onOpenChange={value => { if (value) setPackageRevision(draft.packageRevision); setOpen(value); }}><DialogTrigger asChild><Button size="sm" variant="outline">{t("查看 / 审核")}</Button></DialogTrigger><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl"><DialogHeader><DialogTitle>{draft.name} · {draft.versionLabel}</DialogTitle><DialogDescription>{row.organizationName} / {row.serverName} ({row.serverId}) · {t(statusLabels[draft.status])}</DialogDescription></DialogHeader>
    <p className="text-xs text-muted-foreground">{draft.packageFormatVersion === 2 ? t("v2 通用配方包 · 组包修订 {0}", { "0": draft.packageRevision }) : t("v1 · 平台方案 {0}：{1}", { "0": draft.packageRevision, "1": draft.packageBuilds.map(build => build.platform).join("、") })}</p>{packageRevision !== draft.packageRevision && <Alert variant="destructive"><AlertDescription>{t("组包方案已改变，请关闭后重新打开审核窗口核对。")}</AlertDescription></Alert>}
    <Tabs defaultValue="details"><TabsList><TabsTrigger value="details">{t("版本资料")}</TabsTrigger><TabsTrigger value="files">{t("文件清单")}</TabsTrigger></TabsList><TabsContent value="details" className="mt-4"><VersionDetails version={draft} /></TabsContent><TabsContent value="files" className="mt-4">{manifest ? manifest.format === "mua-recipe-manifest" ? <><p className="mb-3 text-xs text-muted-foreground">{t("远程文件仅声明，字节未在后台验证；环境由 Launcher 准备。")}</p><RecipeFileTable files={manifest.files} /></> : <DataTable data={manifest.files} columns={columns} /> : <p className="text-sm text-muted-foreground">{t(error) || t("正在读取文件清单…")}</p>}</TabsContent></Tabs>
    {draft.status === "SUBMITTED" && row.permissions.includes("DRAFT_REVIEW") && !row.archived && !row.blocked && <div className="space-y-3 border-t pt-5"><Input placeholder={t("审核说明（驳回时请说明原因）")} value={note} onChange={event => setNote(event.target.value)} /><div className="flex justify-end gap-3">{([ ["reject", t("驳回")], ["approve", t("审核通过")] ] as const).map(([decision, label]) => <Button key={decision} variant={decision === "reject" ? "outline" : "default"} disabled={busy || !manifest || packageRevision !== draft.packageRevision || (decision === "reject" && !note.trim())} onClick={async () => {
      if (await run(() => api(`/api/v1/clients/${row.clientId}/drafts/${draft.id}/review`, "POST", { decision, note, contentRevision: draft.contentRevision, packageRevision }), decision === "approve" ? t("已审核通过，等待发布") : t("已驳回"))) setOpen(false);
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
  return <EditorDialog title={t("发布客户端")} trigger={<Button size="sm" disabled={!ready} title={ready ? "" : t("等待必需的客户端包生成完毕")}>{ready ? t("发布") : t("等待组包")}</Button>} description={activate ? t("发布 {0}，服务器当前版本将切换到此版本。", { "0": draft.versionLabel }) : t("发布版本。此账号没有切换权限，需要版本切换人员在发布记录中启用。")}>{close => <div className="space-y-4">
    {canReplace && <div className="space-y-2"><p className="text-sm font-medium">{t("发布成功后归档的旧草稿")}</p><Select value={replacement} onValueChange={setReplacement}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>
      <SelectItem value="none">{t("不替代其他草稿")}</SelectItem>{candidates.map(previous => <SelectItem key={previous.id} value={previous.id}>{previous.versionLabel}</SelectItem>)}
      {replacement !== "none" && !candidates.some(previous => previous.id === replacement) && <SelectItem value={replacement} disabled>{t("已关联草稿 ·") + " "}{row.drafts.find(previous => previous.id === replacement)?.versionLabel}</SelectItem>}
    </SelectContent></Select><p className="text-xs text-muted-foreground">{t("只归档所选旧草稿及其替代链。发布失败不归档，已发布历史保留。")}</p></div>}
    {!canReplace && draft.replacesDraftId && <p className="text-sm">{t("发布成功后归档已关联的旧草稿：")}{row.drafts.find(previous => previous.id === draft.replacesDraftId)?.versionLabel}</p>}
    <Button disabled={busy || !ready} onClick={async () => {
      if (await run(() => api(`/api/v1/clients/${row.clientId}/drafts/${draft.id}/publish`, "POST", { activate, contentRevision: draft.contentRevision, packageRevision: draft.packageRevision,
        ...(canReplace ? { replacesDraftId: replacement === "none" ? null : replacement } : {}) }), activate ? t("客户端已发布并切换为当前版本，替代草稿已归档") : t("客户端已发布，替代草稿已归档，等待启用"))) close();
    }}>{t("确认签名并发布")}</Button></div>}</EditorDialog>;
}
function ArchiveDraftButton({ row, draft }: { row: ClientRow; draft: Draft }) {
  const { t } = useI18n();
  const { run, busy } = useAdmin();
  if (draft.archivedAt || draft.status === "RELEASED" || row.archived || row.blocked || !row.permissions.includes("DRAFT_ARCHIVE")) return null;
  return <EditorDialog title={t("撤回并归档未发布版本")} trigger={<Button size="sm" variant="outline">{t("撤回 / 归档")}</Button>} description={t("归档 {0}，取消未完成组包任务并移出待发布列表。版本记录和文件会保留，服务器当前发布不受影响。", { "0": draft.versionLabel ?? t("此草稿") })}>{close =>
    <Button disabled={busy} onClick={async () => { if (await run(() => api(`/api/v1/clients/${row.clientId}/drafts/${draft.id}/archive`, "POST", { contentRevision: draft.contentRevision, packageRevision: draft.packageRevision }), t("未发布版本已归档"))) close(); }}>{t("确认撤回并归档")}</Button>
  }</EditorDialog>;
}
function PackageProgress({ draft }: { draft?: Draft }) {
  const { t } = useI18n();
  const builds = draft?.packageBuilds ?? [];
  if (!builds.length) return <span className="text-xs text-muted-foreground">{t("尚无任务")}</span>;
  const completed = builds.filter(build => build.status === "READY").length;
  const progress = Math.floor(builds.reduce((sum, build) => sum + build.progress, 0) / builds.length);
  return <div className="min-w-36 space-y-1" role="status"><p className="text-xs">{completed}/{builds.length} {draft?.packageFormatVersion === 2 ? t("个配方包") : t("个平台")}{t("完成 ·") + " "}{progress}%</p><Progress value={progress} />
    {builds.some(build => build.status === "FAILED") ? <p className="text-xs text-destructive">{t("生成失败，查看详情后重试")}</p> : <p className="text-xs text-muted-foreground">{builds.find(build => build.status === "PROCESSING")?.phase ?? (builds.some(build => build.status === "PREPARED") ? (draft?.packageFormatVersion === 2 ? t("配方已准备，等待审核签名") : t("环境已准备，等待审核签名")) : completed === builds.length ? t("全部完成，可发布") : t("等待 Worker"))}</p>}
  </div>;
}
function PackageDialog({ row, draft }: { row: ClientRow; draft: Draft }) {
  const { t } = useI18n();
  const { run, busy } = useAdmin(); const [open, setOpen] = useState(false);
  const selectedPlatforms = () => (draft.packageFormatVersion === 2 ? draft.supportedPlatforms : draft.packageBuilds.map(build => build.platform)).map(platform => muaPlatformSchema.parse(platform));
  const [platforms, setPlatforms] = useState(selectedPlatforms);
  const canEdit = row.permissions.includes("DRAFT_CREATE") && row.permissions.includes("DRAFT_SUBMIT") && (!row.currentReleaseId || row.permissions.includes("DRAFT_EDIT")) && !row.archived && !row.blocked;
  return <Dialog open={open} onOpenChange={value => { if (value) setPlatforms(selectedPlatforms()); setOpen(value); }}><DialogTrigger asChild><Button size="sm" variant="outline">{draft.packageFormatVersion === 2 ? t("组包进度") : t("组包 / 平台")}</Button></DialogTrigger>
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{draft.name} · {draft.versionLabel} {" " + t("· 发布包")}</DialogTitle><DialogDescription>{draft.packageFormatVersion === 2 ? t("v2 生成通用配方包；有同格式的已发布基准时同时生成更新包，仅携带变化所需的本地文件。远程模组与环境由 Launcher 下载，基准不匹配时使用完整包。") : t("整包用于首次安装，更新包以此前当前发布为基准。没有可用基准时使用整包。改变审核通过版本的平台选择后，需要重新审核。")}</DialogDescription></DialogHeader>
      <PackageBuildOptions packageFormatVersion={draft.packageFormatVersion === 2 ? 2 : 1} value={platforms} onChange={setPlatforms} disabled={!canEdit || busy} />
      {canEdit && <div className="flex gap-2">{draft.packageFormatVersion === 1 && <Button disabled={busy || !platforms.length} onClick={() => void run(() => api(`/api/v1/clients/${row.clientId}/drafts/${draft.id}/platforms`, "POST", { platforms }), t("发布平台已保存，请核对审核状态"))}>{t("保存平台")}</Button>}
        {draft.packageBuilds.some(build => build.status === "FAILED") && <Button variant="outline" disabled={busy} onClick={() => void run(() => api(`/api/v1/clients/${row.clientId}/drafts/${draft.id}/retry-packages`, "POST", {}), t("失败任务已重新排队"))}>{t("重试失败任务")}</Button>}</div>}
      <div className="space-y-3">{draft.packageBuilds.map(build => <div key={build.platform} className="space-y-2 rounded-md border p-3"><div className="flex justify-between gap-2 text-sm"><span>{build.platform === "universal" ? t("v2 跨平台完整配方") : build.platform}</span><span>{packageBuildLabel(build)}</span></div><Progress value={build.progress} />
        {build.error && <p className="break-all text-xs text-destructive">{t(build.error)}</p>}{build.artifacts && <p className="text-xs text-muted-foreground">{t("整包") + " "}{formatBytes(build.artifacts.full.size)} · {build.artifacts.update ? t("更新包 {0}", { "0": formatBytes(build.artifacts.update.size) }) : t("首次发布／无可用基准，使用整包")}{draft.packageFormatVersion === 2 && t(" · 环境与远程模组由 Launcher 下载")}</p>}
        {["PREPARED", "READY"].includes(build.status) && <PlatformManifestDialog row={row} draft={draft} platform={build.platform} />}
      </div>)}</div><p className="text-xs text-muted-foreground">{t("可以关闭此页面。客户端管理表格每 5 秒刷新后台进度。")}</p>
    </DialogContent></Dialog>;
}
function PlatformManifestDialog({ row, draft, platform }: { row: ClientRow; draft: Draft; platform: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false), [manifest, setManifest] = useState<MuaPlatformManifest | RecipeManifest | null>(null), [error, setError] = useState("");
  useEffect(() => { if (!open) return; let active = true;
    void api<MuaPlatformManifest | RecipeManifest>(`/api/v1/clients/${row.clientId}/drafts/${draft.id}/platform-manifest?platform=${platform}`).then(data => { if (active) { setManifest(data); setError(""); } }).catch(error => { if (active) setError(error instanceof Error ? error.message : t("读取平台清单失败")); });
    return () => { active = false; };
  }, [open, row.clientId, draft.id, platform, t]);
  const columns: ColumnDef<MuaFile>[] = [{ id: "path", header: t("目标路径"), accessorFn: file => `${file.root}/${file.path}` }, { accessorKey: "policy", header: t("策略") }, { accessorKey: "size", header: t("大小"), cell: ({ getValue }) => formatBytes(Number(getValue())) }, { accessorKey: "sha256", header: "SHA-256", cell: ({ getValue }) => <code className="text-xs">{String(getValue()).slice(0, 16)}…</code> }];
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button variant="ghost" size="sm">{t("查看环境与完整清单")}</Button></DialogTrigger><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl"><DialogHeader><DialogTitle>{platform === "universal" ? t("v2 跨平台配方") : platform} {" " + t("· 环境与完整清单")}</DialogTitle><DialogDescription>{draft.packageFormatVersion === 2 ? t("签名绑定本地载荷、远程下载声明和运行环境要求。远程字节与环境由 Launcher 校验和安装。") : t("清单记录实际下载和校验的环境与客户端文件，签名绑定这些内容。")}</DialogDescription></DialogHeader>
    {manifest?.format === "mua-recipe-manifest" ? <div className="space-y-4 text-sm"><p>MC {manifest.runtime.minecraft} · {manifest.runtime.loader ? `${manifest.runtime.loader.type} ${manifest.runtime.loader.version}` : t("原版")}</p><p>Java {manifest.runtime.java.major} · {manifest.runtime.java.imageType.toUpperCase()} {" " + t("· 由 Launcher 准备")}</p><p>{t("支持平台：")}{manifest.supportedPlatforms.join("、")}</p><RecipeFileTable files={manifest.files} /></div> : manifest ? <div className="space-y-4 text-sm"><p>MC {manifest.runtime.minecraft} · {manifest.runtime.loader ? `${manifest.runtime.loader.type} ${manifest.runtime.loader.version}` : t("原版")}</p><p>Java {manifest.runtime.java.major} · {manifest.runtime.java.vendor} · {manifest.runtime.java.build}</p><p className="break-all">{t("入口：")}{manifest.launch.mainClass}</p>
      <details><summary>{t("启动参数与内存")}</summary><pre className="mt-2 overflow-x-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify(manifest.launch, null, 2)}</pre></details><DataTable data={manifest.files} columns={columns} /></div> : <p role="status">{t(error) || t("读取清单…")}</p>}
  </DialogContent></Dialog>;
}
function ReviewActionsCell({ row: item }: CellContext<ReviewRow, unknown>) {
  const { t } = useI18n();
  if (item.original.row.archived || item.original.draft.archivedAt) return <EditorDialog title={t("已归档草稿")} trigger={<Button size="sm" variant="ghost">{t("详情")}</Button>} description={t("保留归档记录与文件。")}>{() => <VersionDetails version={item.original.draft} />}</EditorDialog>;
  return <div className="flex flex-wrap gap-2"><ReviewDialog row={item.original.row} draft={item.original.draft} /><PackageDialog row={item.original.row} draft={item.original.draft} /><PublishButton row={item.original.row} draft={item.original.draft} /><ArchiveDraftButton row={item.original.row} draft={item.original.draft} /></div>;
}
function ReleaseActionsCell({ row: item }: CellContext<ReleaseRow, unknown>) {
  const { t } = useI18n();
  return <div className="flex gap-2"><EditorDialog title={t("版本 {0}", { "0": item.original.release.versionLabel })} trigger={<Button size="sm" variant="ghost">{t("详情")}</Button>} description={t("已发布版本内容不可修改。")}>{() => <VersionDetails version={item.original.release} />}</EditorDialog><ActivateButton row={item.original.row} release={item.original.release} /></div>;
}
export function ReleasesPage({ mode = "published" }: { mode?: "all" | "review" | "published" | "revoked" }) {
  const { t, formatDate } = useI18n();
  const { organizationId } = useAdmin(); const { rows, error } = useClients();
  const visible = rows?.filter(row => organizationId === "all" || row.organizationId === organizationId) ?? [];
  const drafts = visible.filter(row => row.permissions.includes("DRAFT_REVIEW") || row.permissions.includes("RELEASE_PUBLISH"))
    .flatMap(row => row.drafts.filter(draft => draft.status !== "RELEASED" && (mode === "revoked" ? row.archived || !!draft.archivedAt : !row.archived && !draft.archivedAt && ["SUBMITTED", "APPROVED"].includes(draft.status))).map(draft => ({ row, draft })));
  const releases = visible.flatMap(row => row.releases.filter(release => mode === "revoked" ? row.archived || !!release.archivedAt : !row.archived && !release.archivedAt).map(release => ({ row, release })));
  const reviewColumns: ColumnDef<(typeof drafts)[number]>[] = [{ id: "name", header: t("客户端"), accessorFn: item => item.draft.name }, { id: "version", header: t("版本"), accessorFn: item => item.draft.versionLabel }, { id: "server", header: t("服务器"), accessorFn: item => `${item.row.organizationName} / ${item.row.serverName}` }, { id: "status", header: t("状态"), accessorFn: item => item.row.archived ? t("客户端已归档") : item.draft.archivedAt ? item.draft.archiveReason === "SUPERSEDED" ? t("被新发布替代 · 已归档") : t("已归档") : t(statusLabels[item.draft.status]) },
    { id: "packages", header: t("组包进度"), cell: ({ row }) => <PackageProgress draft={row.original.draft} /> }, { id: "actions", header: t("操作"), cell: ReviewActionsCell }];
  const releaseColumns: ColumnDef<(typeof releases)[number]>[] = [{ id: "name", header: t("客户端"), accessorFn: item => item.release.name }, { id: "version", header: t("版本"), accessorFn: item => item.release.versionLabel }, { id: "server", header: t("服务器"), accessorFn: item => item.row.serverName }, { id: "current", header: t("状态"), accessorFn: item => item.row.archived ? t("客户端已归档") : item.release.archivedAt ? t("版本已归档") : item.row.currentReleaseId === item.release.id ? t("当前版本") : t("历史版本") }, { id: "date", header: t("发布时间"), accessorFn: item => formatDate(item.release.publishedAt) },
    { id: "actions", header: t("操作"), cell: ReleaseActionsCell }];
  return <><Heading title={mode === "review" ? t("客户端审核与发布") : mode === "revoked" ? t("已归档版本") : t("已发布客户端")} description={mode === "review" ? t("核对版本资料与真实文件清单，审核通过后签名发布。审核、发布、版本切换分别按 RBAC 授权。") : t("查看不可变的发布记录与服务器当前版本。")} />
    {error && <Alert variant="destructive"><AlertDescription>{t(error)}</AlertDescription></Alert>}
    {!rows && !error ? <p role="status" className="text-sm text-muted-foreground">{t("正在读取版本…")}</p> : mode === "review" ? <DataTable data={drafts} columns={reviewColumns} getRowId={reviewRowId} empty={t("暂无待审核或待发布的客户端。")} /> : <div className="space-y-6"><DataTable data={releases} columns={releaseColumns} getRowId={releaseRowId} empty={t("暂无发布记录。")} />{mode === "revoked" && <DataTable data={drafts} columns={reviewColumns} getRowId={reviewRowId} caption={t("已归档的未发布版本")} empty={t("暂无归档草稿。")} />}</div>}
  </>;
}

function BindingDialog({ row }: { row: ClientRow }) {
  const { t } = useI18n();
  const { state, run, busy } = useAdmin(); const [open, setOpen] = useState(false); const [serverId, setServerId] = useState("");
  if (!row.permissions.includes("CLIENT_BIND") || row.blocked || row.archived) return null;
  const targets = state.organizations.flatMap(org => org.servers).filter(server => server.organizationId === row.organizationId && !server.archivedAt && server.permissions.includes("CLIENT_BIND"));
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button size="sm" variant="outline">{row.serverId ? t("绑定 / 解绑") : t("绑定")}</Button></DialogTrigger>
    <DialogContent><DialogHeader><DialogTitle>{row.name} {" " + t("· 服务器绑定")}</DialogTitle><DialogDescription>{t("每个客户端最多绑定一个服务器。替换会保留原客户端与所有版本；新客户端未发布时，原绑定继续服务直到新版本审核发布。")}</DialogDescription></DialogHeader>
    <p className="text-sm">{row.serverId ? t("当前：{0} ({1})", { "0": row.serverName, "1": row.serverId }) : row.requestedServerId ? t("待发布后绑定：{0}", { "0": row.requestedServerId }) : t("当前未绑定")}</p>
    {row.serverId || row.requestedServerId ? <Button variant="outline" disabled={busy} onClick={async () => {
      if (!window.confirm(row.serverId ? t("解绑将停止该服务器的客户端分发，历史版本仍保留。是否继续？") : t("取消待发布后的绑定请求？"))) return;
      if (await run(() => api(`/api/v1/clients/${row.clientId}/unbind`, "POST", { serverId: row.serverId, publicationRevision: row.bindingRevision }), t("已解绑／取消待绑定"))) setOpen(false);
    }}>{t("解绑／取消待绑定")}</Button> : null}
    {!row.serverId && <><select aria-label={t("选择绑定服务器")} className="rounded-md border bg-background p-2" value={serverId} onChange={event => setServerId(event.target.value)}>
      <option value="">{t("选择服务器")}</option>{targets.map(target => <option key={target.serverId} value={target.serverId}>{target.displayName} ({target.serverId}){target.boundClientName ? t(" · 已绑定 {0}", { "0": target.boundClientName }) : ""}</option>)}
    </select><Button disabled={busy || !serverId} onClick={async () => {
      const target = targets.find(target => target.serverId === serverId)!;
      const replaceConfirmed = !!target.boundClientId && window.confirm(t("服务器已绑定“{0}”，是否重新绑定到“{1}”？原客户端与历史版本会保留。", { "0": target.boundClientName, "1": row.name }));
      if (target.boundClientId && !replaceConfirmed) return;
      if (await run(() => api(`/api/v1/clients/${row.clientId}/bind`, "POST", { serverId, publicationRevision: target.publicationRevision, expectedClientId: target.boundClientId, replaceConfirmed }), t("绑定请求已保存"))) setOpen(false);
    }}>{t("确认绑定")}</Button></>}
  </DialogContent></Dialog>;
}
