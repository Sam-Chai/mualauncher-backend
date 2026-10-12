"use client";
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
const modColumns: ColumnDef<ModRow>[] = [
  { accessorKey: "fileName", header: "模组文件", cell: ({ getValue }) => <span className="break-all font-medium">{String(getValue())}</span> },
  { accessorKey: "path", header: "客户端内路径", cell: ({ getValue }) => <code className="break-all text-xs text-muted-foreground">{String(getValue())}</code> },
  { id: "optional", header: "安装要求", accessorFn: row => row.detail?.optional ? "optional 可选" : "必需", cell: ({ row }) => <Badge variant={row.original.detail?.optional ? "secondary" : "outline"}>{row.original.detail?.optional ? "optional · 玩家选择" : "必需"}</Badge> },
  { id: "source", header: "来源", accessorFn: row => row.detail?.source === "remote" ? "远程下载" : "本地文件", cell: ({ row }) => <div className="space-y-1"><span>{row.original.detail?.source === "remote" ? "远程下载" : "本地文件"}</span>
    {row.original.detail?.downloads?.map((url, i) => <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="block text-xs text-primary underline">下载直链 {i + 1}</a>)}</div> },
  { id: "progress", header: "校验／下载", cell: ({ row }) => {
    const detail = row.original.detail; if (!detail?.status) return "—";
    if (detail.status === "DECLARED") return <div className="space-y-1 text-xs"><p>声明已保存 · 由 Launcher 下载</p><p className="text-muted-foreground">声明大小 {formatBytes(detail.size ?? 0)} · 文件字节未校验</p></div>;
    const percent = detail.status === "VERIFIED" ? 100 : detail.size ? Math.min(100, Math.floor((detail.downloadedBytes ?? 0) / detail.size * 100)) : 0;
    return <div className="min-w-28 space-y-1"><span className="text-xs">{detail.status === "VERIFIED" ? "已校验" : detail.status === "FAILED" ? "失败" : detail.status === "DOWNLOADING" ? `下载 ${percent}%` : "等待处理"}</span><Progress value={percent} />
      {detail.size !== undefined && <p className="text-xs text-muted-foreground">{formatBytes(detail.downloadedBytes ?? 0)} / {formatBytes(detail.size)}</p>}{detail.error && <p role="alert" className="text-xs text-destructive">{detail.error}</p>}</div>;
  } },
];
const modRowId = (row: ModRow) => row.path;
export function ModTable({ mods, details, empty = "未识别到模组 JAR 文件" }: { mods: readonly string[]; details?: readonly ModDetail[]; empty?: string }) {
  return <DataTable data={mods.map(name => { const path = name.startsWith("versions/") ? name : `mods/${name}`; return { fileName: name.split("/").at(-1)!, path, detail: details?.find(detail => detail.path === path) }; })}
    columns={modColumns} getRowId={modRowId} caption="模组列表" searchPlaceholder="搜索模组文件或路径…" empty={empty} />;
}

export function MarkdownText({ value }: { value: string }) {
  return <div className="space-y-3 break-words text-sm leading-7 [&_h1]:text-xl [&_h2]:text-lg [&_h3]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:overflow-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_a]:text-primary [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:pl-4 [&_table]:w-full [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:p-2">
    <Markdown remarkPlugins={[remarkGfm]} skipHtml components={{ img: ({ alt }) => <span className="text-muted-foreground">[图片：{alt}]</span>, a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}>{value || "暂无说明"}</Markdown>
  </div>;
}
export function UpdateStats({ statistics, comparison, version, updating = false }: { statistics: UpdateStatistics; comparison?: UpdateStatistics | null; version: string; updating?: boolean }) {
  const hasBaseline = !!statistics.previousVersion;
  return <Card className="bg-muted/30"><CardContent className="space-y-4 pt-5"><p className="font-semibold">{hasBaseline ? `更新版本 · ${statistics.previousVersion} → ${version || "新版本"}` : `${updating ? "更新版本" : "首次发布"} · ${version || "新版本"}`}</p>
    {comparison && <div className="space-y-2 rounded-md border p-3 text-sm"><p className="font-medium">相对上次上传 · {comparison.previousVersion} → {version || "新版本"}</p>
      <p>新增 {comparison.addedFiles} · 修改 {comparison.modifiedFiles} · 删除 {comparison.deletedFiles} · 差异载荷预估 {formatBytes(comparison.estimatedDownloadSize)}</p>
      <p className="text-xs text-muted-foreground">这是未发布草稿间的对比，不代表玩家可以使用此基准下载更新包。</p></div>}
    <p className="text-sm font-medium">{hasBaseline ? `玩家安装基准 · ${statistics.previousVersion}` : "玩家安装基准 · 无已发布版本"}</p>
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">{[
      ["新增文件", statistics.addedFiles], ["修改文件", statistics.modifiedFiles], ["删除文件", statistics.deletedFiles],
      ["客户端完整大小", formatBytes(statistics.fullSize)], ["实际新增数据", formatBytes(statistics.newDataSize)],
      [hasBaseline ? "玩家预计更新" : "预计首次安装", formatBytes(statistics.estimatedDownloadSize)], ["文件复用率（CAS）", `${statistics.casReusePercent}%`],
    ].map(([label, value]) => <div key={label} className="flex justify-between gap-3 border-b pb-2"><dt className="text-muted-foreground">{label}</dt><dd className="font-medium tabular-nums">{value}</dd></div>)}</dl>
    <p className="text-xs leading-5 text-muted-foreground">{hasBaseline ? "预计更新量按完整安装的当前已发布版本计算，玩家已有缓存和 preserve 文件会影响实际下载量。删除统计表示版本差异，preserve 文件不会自动删除。" : "尚无已发布并启用的基准版本，本次按首次安装计算，将生成完整包。审核通过不等于发布并启用。"} 此处统计整合包文件，不包含后续组装的 Minecraft、Java 和加载器环境。</p>
  </CardContent></Card>;
}

export function RecipeImportStats({ statistics }: { statistics: RecipeImportStatistics }) {
  return <Card className="bg-muted/30"><CardContent className="space-y-3 pt-5"><p className="font-semibold">v2 导入结果</p>
    <dl className="grid grid-cols-2 gap-3 text-sm">{[
      ["本地文件", statistics.localFiles], ["远程声明", statistics.remoteFiles], ["optional 文件", statistics.optionalFiles],
      ["本地文件大小", formatBytes(statistics.localSize)], ["远程声明大小", formatBytes(statistics.remoteDeclaredSize)],
      ["实际新增本地数据", formatBytes(statistics.newLocalDataSize)], ["本地文件 CAS 复用率", `${statistics.localCasReusePercent}%`],
    ].map(([label, value]) => <div key={label} className="flex justify-between gap-3"><dt className="text-muted-foreground">{label}</dt><dd>{value}</dd></div>)}</dl>
    <p className="text-xs text-muted-foreground">远程模组和运行环境由 Launcher 下载。远程大小是包内声明，不包含环境，也不代表玩家预计更新量。</p>
  </CardContent></Card>;
}

const recipeColumns: ColumnDef<RecipeFile>[] = [
  { accessorKey: "path", header: "路径" }, { accessorKey: "size", header: "大小", cell: ({ getValue }) => formatBytes(Number(getValue())) },
  { accessorKey: "policy", header: "策略" }, { id: "optional", header: "安装要求", accessorFn: file => file.optional ? "optional · 玩家选择" : "必需" },
  { id: "source", header: "来源", accessorFn: file => file.source.type === "local" ? "本地 · 已校验" : "远程声明 · Launcher 下载" },
  { id: "hash", header: "内容摘要", accessorFn: file => "sha512" in file.hashes ? file.hashes.sha512 : file.hashes.sha256,
    cell: ({ row }) => <code className="text-xs" title={JSON.stringify(row.original.hashes)}>{"sha512" in row.original.hashes ? "SHA-512" : "SHA-256"} · {String(row.getValue("hash")).slice(0, 16)}…</code> },
];
export function RecipeFileTable({ files }: { files: RecipeFile[] }) { return <DataTable data={files} columns={recipeColumns} getRowId={file => file.path} caption="v2 完整文件清单" />; }
