"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { z } from "zod";
import { GitBranch, ArrowLeft } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { api, useAdmin, formatDate, RequestError, type Server, type ClientData } from "./provider";
import { DataTable } from "./data-table";
import { Heading, Status, NoPermission } from "./common";
import { ArchiveButton, EditorDialog, SchemaForm, nameSchema, textSchema, type Field } from "./form";
type Bundle = { serverId: string; data: ClientData };
function useClientData(ids: string[]) {
  const { epoch } = useAdmin();
  const router = useRouter();
  const key = ids.join(",");
  const [result, setResult] = useState<{ key: string; epoch: number; bundles?: Bundle[]; error?: string }>({ key: "", epoch: -1 });
  useEffect(() => {
    let active = true;
    Promise.all(key ? key.split(",").map(async serverId => ({ serverId, data: await api<ClientData>(`/api/admin/servers/${serverId}/clients`) })) : [])
      .then(bundles => { if (active) setResult({ key, epoch, bundles }); })
      .catch(error => { if (active) { if (error instanceof RequestError && error.status === 401) { router.replace("/login"); router.refresh(); } setResult({ key, epoch, error: error instanceof Error ? error.message : "读取失败" }); } });
    return () => { active = false; };
  }, [key, epoch, router]);
  return result.key === key && result.epoch === epoch ? result : { key, epoch };
}
export function ClientsPage() {
  const { state, servers } = useAdmin();
  const visible = servers.filter(server => server.permissions.includes("DRAFT_READ") || server.permissions.includes("RELEASE_READ"));
  const columns: ColumnDef<Server>[] = [
    { accessorKey: "displayName", header: "Client Profile", cell: ({ row }) => <Link className="font-medium hover:underline" href={`/admin/clients/${row.original.serverId}`}>{row.original.displayName}</Link> },
    { accessorKey: "serverId", header: "绑定服务器", cell: ({ row }) => <code>{row.original.serverId}</code> },
    { id: "organization", header: "组织", accessorFn: server => state.organizations.find(org => org.id === server.organizationId)?.displayName },
    { id: "status", header: "状态", accessorFn: server => server.clientArchivedAt ? "已归档" : "启用中", cell: ({ row }) => <Status archived={row.original.clientArchivedAt} /> },
    { id: "current", header: "当前发布", accessorFn: server => server.currentReleaseId ?? "未发布", cell: ({ row }) => <span className="text-xs text-muted-foreground">{row.original.currentReleaseId || "未发布"}</span> },
    { id: "actions", header: "版本管理", enableHiding: false, cell: ({ row }) => <Button variant="outline" size="sm" asChild><Link href={`/admin/clients/${row.original.serverId}`}><GitBranch className="size-3.5" />管理版本</Link></Button> },
  ];
  return <><Heading title="Client Profiles" description="每个服务器拥有一个专用客户端。版本资料、草稿和发布历史在客户端内管理。" /><DataTable data={visible} columns={columns} empty="暂无可访问客户端。登记服务器时会自动创建专用客户端。" /></>;
}
const draftSchema = z.object({ versionLabel: z.string().trim().min(1, "请填写版本标签").max(100), name: nameSchema, description: textSchema(10000), changelog: textSchema(10000) });
const draftFields: Field[] = [{ name: "versionLabel", label: "版本标签", placeholder: "2026.10.1" }, { name: "name", label: "客户端名称" }, { name: "description", label: "简介", type: "textarea" }, { name: "changelog", label: "更新日志", type: "textarea" }];
type Draft = ClientData["drafts"][number];
function DraftEditor({ server, draft, disabled }: { server: Server; draft?: Draft; disabled: boolean }) {
  const { busy, run } = useAdmin();
  return <EditorDialog title={draft ? "编辑版本草稿" : "新建版本草稿"} disabled={disabled} description="当前可管理版本资料。整合包上传与自动填充将在 Worker 接入后开放。" trigger={draft ? <Button variant="outline" size="sm" disabled={disabled}>编辑</Button> : undefined}>
    {close => <SchemaForm schema={draftSchema} fields={draftFields} disabled={disabled || busy} defaults={{ versionLabel: draft?.versionLabel ?? "", name: draft?.name ?? server.displayName, description: draft?.description ?? "", changelog: draft?.changelog ?? "" }}
      onSubmit={async values => { const ok = await run(() => api(`/api/admin/servers/${server.serverId}/drafts${draft ? "/" + draft.id : ""}`, draft ? "PATCH" : "POST", { ...values, ...(draft ? { contentRevision: draft.contentRevision } : {}) })); if (ok) close(); return ok; }} />}
  </EditorDialog>;
}
function DraftsTable({ server, data }: { server: Server; data: ClientData }) {
  const { state, busy, run } = useAdmin();
  const blocked = busy || !!server.archivedAt || !!server.clientArchivedAt || !!state.organizations.find(org => org.id === server.organizationId)?.archivedAt;
  const columns: ColumnDef<Draft>[] = [
    { accessorKey: "versionLabel", header: "版本", cell: ({ row }) => <div><p className="font-medium">{row.original.versionLabel || "未命名"}</p><p className="text-xs text-muted-foreground">{row.original.name}</p></div> },
    { accessorKey: "status", header: "状态", cell: ({ row }) => <Status archived={row.original.archivedAt} active={row.original.status} /> },
    { accessorKey: "contentRevision", header: "资料修订" },
    { accessorKey: "createdAt", header: "创建时间", cell: ({ row }) => <span className="text-xs">{formatDate(row.original.createdAt)}</span> },
    { id: "actions", header: "操作", enableHiding: false, cell: ({ row }) => {
      const draft = row.original; const editable = ["DRAFT", "REJECTED"].includes(draft.status);
      return <div className="flex gap-2">{server.permissions.includes("DRAFT_EDIT") && <DraftEditor server={server} draft={draft} disabled={blocked || !!draft.archivedAt || !editable} />}
        <EditorDialog title="草稿资料" description="此版本资料的当前快照。" trigger={<Button size="sm" variant="ghost">详情</Button>}>{() => <div className="space-y-4"><p className="whitespace-pre-wrap text-sm">{draft.description || "暂无简介"}</p><h3 className="font-medium">更新日志</h3><pre className="whitespace-pre-wrap text-sm text-muted-foreground">{draft.changelog || "暂无更新日志"}</pre></div>}</EditorDialog>
        {server.permissions.includes("DRAFT_ARCHIVE") && <Button variant="outline" size="sm" disabled={blocked || !editable} onClick={() => void run(() => api(`/api/admin/servers/${server.serverId}/drafts/${draft.id}/archive`, "POST", { archived: !draft.archivedAt }), draft.archivedAt ? "已恢复草稿" : "已归档草稿")}>{draft.archivedAt ? "恢复" : "归档"}</Button>}</div>;
    } },
  ];
  return <div className="space-y-5">{server.permissions.includes("DRAFT_CREATE") && <DraftEditor server={server} disabled={blocked} />}<DataTable data={data.drafts} columns={columns} empty="暂无版本草稿。创建草稿后填写版本资料。" /></div>;
}
type ReleaseRow = ClientData["releases"][number] & { server: Server };
function releaseColumns(): ColumnDef<ReleaseRow>[] {
  return [
    { accessorKey: "versionLabel", header: "版本", cell: ({ row }) => <div><p className="font-medium">{row.original.versionLabel}</p><p className="text-xs text-muted-foreground">{row.original.name}</p></div> },
    { id: "server", header: "服务器", accessorFn: release => release.server.displayName, cell: ({ row }) => <Link className="hover:underline" href={`/admin/clients/${row.original.server.serverId}/releases`}>{row.original.server.displayName} <span className="text-xs text-muted-foreground">{row.original.server.serverId}</span></Link> },
    { id: "status", header: "发布状态", accessorFn: release => release.archivedAt ? "已归档" : release.id === release.server.currentReleaseId ? "当前版本" : "历史版本", cell: ({ getValue }) => <Badge variant="outline">{String(getValue())}</Badge> },
    { accessorKey: "publishedAt", header: "发布时间", cell: ({ row }) => <span className="text-xs">{formatDate(row.original.publishedAt)}</span> },
    { id: "details", header: "资料", enableHiding: false, cell: ({ row }) => <EditorDialog title={`版本 ${row.original.versionLabel}`} description="发布内容为不可变快照，修改客户端需要发布新版本。" trigger={<Button variant="outline" size="sm">查看</Button>}>{() => <div className="space-y-4"><p className="whitespace-pre-wrap text-sm">{row.original.description || "暂无简介"}</p><h3 className="font-medium">更新日志</h3><pre className="whitespace-pre-wrap text-sm text-muted-foreground">{row.original.changelog || "暂无更新日志"}</pre></div>}</EditorDialog> },
  ];
}
export function ClientDetailPage({ releasesOnly = false }: { releasesOnly?: boolean }) {
  const { id } = useParams<{ id: string }>();
  const { state } = useAdmin();
  // Detail links remain usable when the header's organization filter changes.
  const server = state.organizations.flatMap(org => org.servers).find(server => server.serverId === id);
  const result = useClientData(server ? [server.serverId] : []);
  if (!server || (!server.permissions.includes("DRAFT_READ") && !server.permissions.includes("RELEASE_READ"))) return <NoPermission />;
  const org = state.organizations.find(org => org.id === server.organizationId)!;
  const bundle = result.bundles?.[0]?.data;
  return <><div><Button variant="ghost" size="sm" asChild><Link href="/admin/clients"><ArrowLeft className="size-3.5" />Client Profiles</Link></Button></div>
    <Heading title={`${server.displayName} · ${releasesOnly ? "Releases" : "客户端"}`} description={`${org.displayName} / ${server.serverId} · 专用客户端`} action={state.actor.isSuperAdmin && <ArchiveButton kind="clients" id={server.serverId} archived={!!server.clientArchivedAt} />} />
    {(org.archivedAt || server.archivedAt || server.clientArchivedAt) && <Alert><AlertDescription>所属资源已归档，版本资料只读，客户端停止分发。</AlertDescription></Alert>}
    <Alert><AlertDescription>整合包上传、自动解析、审核与签名发布待接入。已发布版本不可编辑，每次变更需要创建新版本。</AlertDescription></Alert>
    {result.error && <Alert variant="destructive" role="alert"><AlertDescription>{result.error}</AlertDescription></Alert>}
    {!bundle && !result.error && <p role="status" className="text-sm text-muted-foreground">正在读取版本记录…</p>}
    {bundle && (releasesOnly ? server.permissions.includes("RELEASE_READ") ? <DataTable data={bundle.releases.map(release => ({ ...release, server }))} columns={releaseColumns()} empty="暂无已审核并签名的发布版本。" /> : <NoPermission /> : <Tabs defaultValue="profile"><TabsList><TabsTrigger value="profile">简介与绑定</TabsTrigger>{server.permissions.includes("DRAFT_READ") && <TabsTrigger value="drafts">版本草稿</TabsTrigger>}{server.permissions.includes("RELEASE_READ") && <TabsTrigger value="releases">发布历史</TabsTrigger>}</TabsList>
      <TabsContent value="profile" className="mt-5"><Card><CardHeader><CardTitle>{server.displayName}</CardTitle><CardDescription>客户端与服务器一一对应，绑定 ID 不可更改。</CardDescription></CardHeader><CardContent className="grid gap-5 text-sm sm:grid-cols-2"><div><p className="text-muted-foreground">绑定服务器</p><p className="mt-1 font-medium">{server.displayName} ({server.serverId})</p></div><div><p className="text-muted-foreground">所属组织</p><p className="mt-1 font-medium">{org.displayName}</p></div><div className="sm:col-span-2"><p className="text-muted-foreground">简介</p><p className="mt-1 whitespace-pre-wrap">{server.description || "暂无简介。各版本的客户端简介在草稿内编辑。"}</p></div><div className="sm:col-span-2"><p className="text-muted-foreground">当前发布 ID</p><code className="mt-1 block break-all">{server.currentReleaseId || "未发布"}</code></div></CardContent></Card></TabsContent>
      <TabsContent value="drafts" className="mt-5"><DraftsTable server={server} data={bundle} /></TabsContent><TabsContent value="releases" className="mt-5"><DataTable data={bundle.releases.map(release => ({ ...release, server }))} columns={releaseColumns()} empty="暂无已审核并签名的发布版本。" /></TabsContent>
    </Tabs>)}</>;
}
export function ReleasesPage({ mode = "all" }: { mode?: "all" | "review" | "published" | "revoked" }) {
  const { servers } = useAdmin();
  const allowed = servers.filter(server => mode === "review" ? server.permissions.includes("DRAFT_REVIEW") : server.permissions.includes("RELEASE_READ"));
  const result = useClientData(allowed.map(server => server.serverId));
  const releases = result.bundles?.flatMap(bundle => bundle.data.releases.map(release => ({ ...release, server: allowed.find(server => server.serverId === bundle.serverId)! }))) ?? [];
  const drafts = result.bundles?.flatMap(bundle => bundle.data.drafts.filter(draft => !draft.archivedAt && draft.status === "SUBMITTED").map(draft => ({ ...draft, server: allowed.find(server => server.serverId === bundle.serverId)! }))) ?? [];
  const columns: ColumnDef<Draft & { server: Server }>[] = [{ accessorKey: "versionLabel", header: "版本" }, { accessorKey: "name", header: "名称" }, { id: "server", header: "服务器", accessorFn: row => row.server.displayName }, { accessorKey: "status", header: "状态" }, { accessorKey: "contentRevision", header: "资料修订" }];
  const titles = { all: "Releases", review: "待审核", published: "已发布", revoked: "已撤销" };
  return <><Heading title={titles[mode]} description="版本属于对应服务器的专用客户端；每个服务器最多绑定一个当前发布。" />
    <Alert><AlertDescription>{mode === "review" ? "审核队列读取已提交草稿；上传、解析和审核操作尚未开放。" : mode === "revoked" ? "当前展示已归档发布记录。独立撤销流程将在发布服务接入后开放。" : "这里展示真实发布记录。签名发布与当前版本切换操作尚未开放。"}</AlertDescription></Alert>
    {result.error ? <Alert variant="destructive" role="alert"><AlertDescription>{result.error}</AlertDescription></Alert> : !result.bundles ? <p role="status" className="text-sm text-muted-foreground">正在读取版本记录…</p> : mode === "review" ? <DataTable data={drafts} columns={columns} empty="暂无可访问的待审核版本。" /> : <DataTable data={releases.filter(release => mode === "published" ? !release.archivedAt : mode === "revoked" ? !!release.archivedAt : true)} columns={releaseColumns()} empty="暂无可访问的发布记录。" />}</>;
}
