"use client";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "./data-table";
import { Card, CardContent } from "@/components/ui/card";
import { formatBytes, type UpdateStatistics } from "@/lib/client-contract";

type ModRow = { fileName: string; path: string };
const modColumns: ColumnDef<ModRow>[] = [
  { accessorKey: "fileName", header: "模组文件", cell: ({ getValue }) => <span className="break-all font-medium">{String(getValue())}</span> },
  { accessorKey: "path", header: "客户端内路径", cell: ({ getValue }) => <code className="break-all text-xs text-muted-foreground">{String(getValue())}</code> },
];
const modRowId = (row: ModRow) => row.path;
export function ModTable({ mods, empty = "未识别到模组 JAR 文件" }: { mods: readonly string[]; empty?: string }) {
  return <DataTable data={mods.map(name => ({ fileName: name.split("/").at(-1)!, path: name.startsWith("versions/") ? name : `mods/${name}` }))}
    columns={modColumns} getRowId={modRowId} caption="模组列表" searchPlaceholder="搜索模组文件或路径…" empty={empty} />;
}

export function MarkdownText({ value }: { value: string }) {
  return <div className="space-y-3 break-words text-sm leading-7 [&_h1]:text-xl [&_h2]:text-lg [&_h3]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:overflow-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_a]:text-primary [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:pl-4 [&_table]:w-full [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:p-2">
    <Markdown remarkPlugins={[remarkGfm]} skipHtml components={{ img: ({ alt }) => <span className="text-muted-foreground">[图片：{alt}]</span>, a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}>{value || "暂无说明"}</Markdown>
  </div>;
}
export function UpdateStats({ statistics, version }: { statistics: UpdateStatistics; version: string }) {
  return <Card className="bg-muted/30"><CardContent className="space-y-4 pt-5"><p className="font-semibold">{statistics.previousVersion ? `${statistics.previousVersion} → ${version || "新版本"}` : `首次发布 · ${version || "新版本"}`}</p>
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">{[
      ["新增文件", statistics.addedFiles], ["修改文件", statistics.modifiedFiles], ["删除文件", statistics.deletedFiles],
      ["客户端完整大小", formatBytes(statistics.fullSize)], ["实际新增数据", formatBytes(statistics.newDataSize)],
      ["玩家预计更新", formatBytes(statistics.estimatedDownloadSize)], ["文件复用率（CAS）", `${statistics.casReusePercent}%`],
    ].map(([label, value]) => <div key={label} className="flex justify-between gap-3 border-b pb-2"><dt className="text-muted-foreground">{label}</dt><dd className="font-medium tabular-nums">{value}</dd></div>)}</dl>
    <p className="text-xs leading-5 text-muted-foreground">预计更新量按完整安装的上一版本计算，玩家已有缓存和 preserve 文件会影响实际下载量。删除统计表示版本差异，preserve 文件不会自动删除。</p>
  </CardContent></Card>;
}
