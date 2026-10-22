"use client";
import { serializeError } from "@/lib/diagnostics";
import { formatMessage } from "@/lib/diagnostics";

import { useI18n } from "@/components/preferences";
import { useEffect, useState } from "react";
import { api, useAdmin } from "./provider";
import type { RecipeDistributionStatistics } from "@/lib/recipe-distribution-contract";
import type { Translate } from "@/lib/i18n";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "./data-table";
import { Card, CardContent } from "@/components/ui/card";
import { formatBytes, type UpdateStatistics, type ImportFile } from "@/lib/client-contract";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import type { RecipeImportStatistics } from "@/lib/recipe-inventory";
import type { RecipeFile } from "@/lib/recipe-inventory";

type ModDetail = Pick<ImportFile, "path" | "optional"> & Partial<ImportFile>;
type ModRow = { fileName: string; path: string; detail?: ModDetail };
const modColumns = (t: Translate): ColumnDef<ModRow>[] => [
  { accessorKey: "fileName", header: t("clientShared.modFile"), cell: ({ getValue }) => <span className="break-all font-medium">{String(getValue())}</span> },
  { accessorKey: "path", header: t("clientShared.pathInClient"), cell: ({ getValue }) => <code className="break-all text-xs text-muted-foreground">{String(getValue())}</code> },
  { id: "optional", header: t("clientShared.installationRequirement"), accessorFn: row => row.detail?.optional ? t("clientShared.optional") : t("clientShared.required"), cell: ({ row }) => <Badge variant={row.original.detail?.optional ? "secondary" : "outline"}>{row.original.detail?.optional ? t("clientShared.optionalPlayerChoice") : t("clientShared.required")}</Badge> },
  { id: "source", header: t("clientShared.source"), accessorFn: row => row.detail?.source === "remote" ? t("clientShared.remoteDownload") : t("clientShared.localFile"), cell: ({ row }) => <div className="space-y-1"><span>{row.original.detail?.source === "remote" ? t("clientShared.remoteDownload") : t("clientShared.localFile")}</span>
    {row.original.detail?.downloads?.map((url, i) => <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="block text-xs text-primary underline">{t("clientShared.directDownload") + " "}{i + 1}</a>)}</div> },
  { id: "progress", header: t("clientShared.validationDownload"), cell: ({ row }) => {
    const detail = row.original.detail; if (!detail?.status) return "—";
    if (detail.status === "DECLARED") return <div className="space-y-1 text-xs"><p>{t("clientShared.declarationSavedDownloadedByLauncher")}</p><p className="text-muted-foreground">{t("clientShared.declaredSize") + " "}{formatBytes(detail.size ?? 0)} {" " + t("clientShared.fileBytesNotVerified")}</p></div>;
    const percent = detail.status === "VERIFIED" ? 100 : detail.size ? Math.min(100, Math.floor((detail.downloadedBytes ?? 0) / detail.size * 100)) : 0;
    return <div className="min-w-28 space-y-1"><span className="text-xs">{detail.status === "VERIFIED" ? t("clientShared.verified") : detail.status === "FAILED" ? t("clientShared.failed") : detail.status === "DOWNLOADING" ? t("clientShared.downloadProgress", { "percent": percent }) : t("clientShared.waitingForProcessing")}</span><Progress value={percent} />
      {detail.size !== undefined && <p className="text-xs text-muted-foreground">{formatBytes(detail.downloadedBytes ?? 0)} / {formatBytes(detail.size)}</p>}{detail.error && <p role="alert" className="text-xs text-destructive">{formatMessage(t, detail.error)}</p>}</div>;
  } },
];
const modRowId = (row: ModRow) => row.path;
export function ModTable({ mods, details, empty = "clientShared.noModJarFilesDetected" }: { mods: readonly string[]; details?: readonly ModDetail[]; empty?: string }) {
  const { t } = useI18n();
  return <DataTable data={mods.map(name => { const path = name.startsWith("versions/") ? name : `mods/${name}`; return { fileName: name.split("/").at(-1)!, path, detail: details?.find(detail => detail.path === path) }; })}
    columns={modColumns(t)} getRowId={modRowId} caption={t("clientShared.modList")} searchPlaceholder={t("clientShared.searchModFilesOrPaths")} empty={empty} />;
}

export function MarkdownText({ value }: { value: string }) {
  const { t } = useI18n();
  return <div className="space-y-3 break-words text-sm leading-7 [&_h1]:text-xl [&_h2]:text-lg [&_h3]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:overflow-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_a]:text-primary [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:pl-4 [&_table]:w-full [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:p-2">
    <Markdown remarkPlugins={[remarkGfm]} skipHtml components={{ img: ({ alt }) => <span className="text-muted-foreground">{t("clientShared.image")}{alt}]</span>, a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}>{value || t("clientShared.noDescription")}</Markdown>
  </div>;
}
export function UpdateStats({ statistics, comparison, version, updating = false }: { statistics: UpdateStatistics; comparison?: UpdateStatistics | null; version: string; updating?: boolean }) {
  const { t } = useI18n();
  const hasBaseline = !!statistics.previousVersion;
  return <Card className="bg-muted/30"><CardContent className="space-y-4 pt-5"><p className="font-semibold">{hasBaseline ? t("clientShared.updateVersions", { "previousVersion": statistics.previousVersion, "nextVersion": version || t("clientShared.newVersion") }) : `${updating ? t("clientShared.update") : t("clientShared.firstRelease")} · ${version || t("clientShared.newVersion")}`}</p>
    {comparison && <div className="space-y-2 rounded-md border p-3 text-sm"><p className="font-medium">{t("clientShared.comparedWithPreviousUpload") + " "}{comparison.previousVersion} → {version || t("clientShared.newVersion")}</p>
      <p>{t("clientShared.added") + " "}{comparison.addedFiles} {" " + t("clientShared.modified") + " "}{comparison.modifiedFiles} {" " + t("clientShared.removed") + " "}{comparison.deletedFiles} {" " + t("clientShared.estimatedChangedPayload") + " "}{formatBytes(comparison.estimatedDownloadSize)}</p>
      <p className="text-xs text-muted-foreground">{t("clientShared.thisComparesUnpublishedDraftsAndIsNotABaseline")}</p></div>}
    <p className="text-sm font-medium">{hasBaseline ? t("clientShared.playerBaseline", { "version": statistics.previousVersion }) : t("clientShared.playerInstallationBaselineNoPublishedVersion")}</p>
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">{[
      [t("clientShared.addedFiles"), statistics.addedFiles], [t("clientShared.modifiedFiles"), statistics.modifiedFiles], [t("clientShared.removedFiles"), statistics.deletedFiles],
      [t("clientShared.fullClientSize"), formatBytes(statistics.fullSize)], [t("clientShared.newData"), formatBytes(statistics.newDataSize)],
      [hasBaseline ? t("clientShared.estimatedPlayerUpdate") : t("clientShared.estimatedFirstInstallation"), formatBytes(statistics.estimatedDownloadSize)], [t("clientShared.fileReuseCas"), `${statistics.casReusePercent}%`],
    ].map(([label, value]) => <div key={label} className="flex justify-between gap-3 border-b pb-2"><dt className="text-muted-foreground">{label}</dt><dd className="font-medium tabular-nums">{value}</dd></div>)}</dl>
    <p className="text-xs leading-5 text-muted-foreground">{hasBaseline ? t("clientShared.updateEstimatesAssumeACompleteInstallationOfTheCurrent") : t("clientShared.thereIsNoPublishedEnabledBaselineAFullPackage")} {" " + t("clientShared.theseStatisticsCoverPackFilesExcludingMinecraftJavaAnd")}</p>
  </CardContent></Card>;
}

export function RecipeImportStats({ statistics }: { statistics: RecipeImportStatistics }) {
  const { t } = useI18n();
  return <Card className="bg-muted/30"><CardContent className="space-y-3 pt-5"><p className="font-semibold">{t("clientShared.v2ImportResults")}</p>
    <dl className="grid grid-cols-2 gap-3 text-sm">{[
      [t("clientShared.localFile"), statistics.localFiles], [t("clientShared.remoteDeclarations"), statistics.remoteFiles], [t("clientShared.optionalFiles"), statistics.optionalFiles],
      [t("clientShared.localFileSize"), formatBytes(statistics.localSize)], [t("clientShared.declaredRemoteSize"), formatBytes(statistics.remoteDeclaredSize)],
      [t("clientShared.newLocalData"), formatBytes(statistics.newLocalDataSize)], [t("clientShared.localFileCasReuse"), `${statistics.localCasReusePercent}%`],
    ].map(([label, value]) => <div key={label} className="flex justify-between gap-3"><dt className="text-muted-foreground">{label}</dt><dd>{value}</dd></div>)}</dl>
    <p className="text-xs text-muted-foreground">{t("clientShared.launcherDownloadsRemoteModsAndEnvironmentsRemoteSizesAre")}</p>
  </CardContent></Card>;
}

const recipeColumns = (t: Translate): ColumnDef<RecipeFile>[] => [
  { accessorKey: "path", header: t("clientShared.path") }, { accessorKey: "size", header: t("clientShared.size"), cell: ({ getValue }) => formatBytes(Number(getValue())) },
  { accessorKey: "policy", header: t("clientShared.policy") }, { id: "optional", header: t("clientShared.installationRequirement"), accessorFn: file => file.optional ? t("clientShared.optionalPlayerChoice") : t("clientShared.required") },
  { id: "source", header: t("clientShared.source"), accessorFn: file => file.source.type === "local" ? t("clientShared.localVerified") : t("clientShared.remoteDeclarationLauncherDownload") },
  { id: "hash", header: t("clientShared.contentDigest"), accessorFn: file => "sha512" in file.hashes ? file.hashes.sha512 : file.hashes.sha256,
    cell: ({ row }) => <code className="text-xs" title={JSON.stringify(row.original.hashes)}>{"sha512" in row.original.hashes ? "SHA-512" : "SHA-256"} · {String(row.getValue("hash")).slice(0, 16)}…</code> },
];
export function RecipeFileTable({ files }: { files: RecipeFile[] }) {
  const { t } = useI18n(); return <DataTable data={files} columns={recipeColumns(t)} getRowId={file => file.path} caption={t("clientShared.v2CompleteFileList")} />; }

export function RecipeDistributionStats({ path, revision }: { path: string; revision?: string }) {
  const { t } = useI18n(), { epoch } = useAdmin();
  const [result, setResult] = useState<{ path: string; data?: RecipeDistributionStatistics; error?: string } | null>(null);
  useEffect(() => {
    let active = true;
    void api<RecipeDistributionStatistics>(path).then(data => { if (active) setResult({ path, data }); }).catch(error => { if (active) setResult({ path, error: error instanceof Error ? serializeError(error) : "clientShared.requestFailed" }); });
    return () => { active = false; };
  }, [path, epoch, revision]);
  const data = result?.path === path ? result.data : undefined;
  if (!data) return <p role="status" className="text-sm text-muted-foreground">{formatMessage(t, result?.path === path && result.error ? result.error : "clientShared.readingV2DistributionStatistics")}</p>;
  return <RecipeDistributionDetails statistics={data} />;
}

export function RecipeDistributionDetails({ statistics: s }: { statistics: RecipeDistributionStatistics }) {
  const { t } = useI18n();
  const size = (value: number | null) => value === null ? t("clientShared.availableAfterPackaging") : formatBytes(value);
  const labels = { added: t("clientShared.added"), modified: t("clientShared.edit"), removed: t("clientShared.removedDeclaration"), policy: t("clientShared.policyOptionalChange"), source: t("clientShared.downloadUrlChange") };
  const columns: ColumnDef<RecipeDistributionStatistics["changes"][number]>[] = [
    { accessorKey: "path", header: t("clientShared.path"), cell: ({ getValue }) => <code className="text-xs">{String(getValue())}</code> },
    { id: "change", header: t("clientShared.change"), accessorFn: row => row.kinds.map(kind => labels[kind]).join(" · ") },
    { id: "before", header: t("clientShared.previousFile"), accessorFn: row => row.before ? `${row.before.source.type === "local" ? t("clientShared.localFile") : t("clientShared.remoteDeclarations")} · ${formatBytes(row.before.size)}` : "—" },
    { id: "after", header: t("clientShared.targetFile"), accessorFn: row => row.after ? `${row.after.source.type === "local" ? t("clientShared.localFile") : t("clientShared.remoteDeclarations")} · ${formatBytes(row.after.size)}` : "—" },
  ];
  return <Card data-v2-distribution className="bg-muted/30"><CardContent className="space-y-4 pt-5">
    <p className="font-semibold">{t("clientShared.v2DistributionAndPlayerDownloadEstimate")}</p>
    <p className="text-sm">{s.base ? t("clientShared.playerBaseline", { "version": s.base.version }) : t("clientShared.noUsablePublishedV2BaselineUseTheFullPackage")}</p>
    <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">{[
      [t("clientShared.targetLocalFiles"), `${s.localFiles} · ${formatBytes(s.localBytes)}`], [t("clientShared.targetRemoteDeclarations"), `${s.remoteFiles} · ${formatBytes(s.remoteDeclaredBytes)}`],
      [t("clientShared.optionalFiles"), s.optionalFiles], [t("clientShared.localPayloadForThisPackageUncompressed"), formatBytes(s.localPayloadBytes)],
      [t("clientShared.estimatedRemoteDownloadsDeduplicated"), formatBytes(s.remoteDownloadBytes)], [t("clientShared.fullPackageZipSize"), size(s.fullPackageBytes)],
      [t("clientShared.updatePackageZipSize"), s.base ? size(s.updatePackageBytes) : t("clientShared.notApplicable")],
      [t("clientShared.knownNetworkBytesPackageRemote"), size(s.knownNetworkBytes)], [t("clientShared.environmentDownloadSize"), t("clientShared.pendingLauncherResolution")],
    ].map(([label, value]) => <div key={label} className="flex justify-between gap-3 border-b pb-2"><dt className="text-muted-foreground">{label}</dt><dd className="shrink-0 whitespace-nowrap text-right tabular-nums">{value}</dd></div>)}</dl>
    <p className="text-xs text-muted-foreground">{t("clientShared.theEstimateAssumesACompleteBaselineNoExtraPlayer")}</p>
    <p className="text-xs text-muted-foreground">{t("clientShared.runtimeChange")}: {s.runtimeChanged === null ? t("clientShared.notComparedYet") : s.runtimeChanged ? t("clientShared.yes") : t("clientShared.no")} · {t("clientShared.launchConfigurationChange")}: {s.launchChanged === null ? t("clientShared.notComparedYet") : s.launchChanged ? t("clientShared.yes") : t("clientShared.no")}</p>
    <details><summary className="cursor-pointer text-sm font-medium">{t("clientShared.fileChanges") + " "}{s.changes.length}</summary><div className="mt-3"><DataTable data={s.changes} columns={columns} getRowId={file => file.path} empty={t("clientShared.fileDeclarationsUnchanged")} /></div></details>
    <p className="text-xs text-muted-foreground">{t("clientShared.removalIsAManifestDifferenceOnlyRemovalpolicyRetainDoes")}</p>
  </CardContent></Card>;
}
