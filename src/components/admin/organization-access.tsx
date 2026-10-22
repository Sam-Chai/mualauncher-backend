"use client";
import { useEffect, useId, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { useI18n } from "@/components/preferences";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, useAdmin } from "./provider";
import { DataTable } from "./data-table";
import { SchemaForm } from "./form";
import { unionSiteInput } from "@/lib/union-contract";
import type { MemberServer } from "@/lib/union-contract";
import type { AccessRequestRow, AccessGrantRow } from "@/lib/organization-access";
type Site = { code: string; organizationId: string; bsRoot: string; enabled: boolean; revision: number };
type Target = { id: string; displayName: string };

export function OrganizationAccess() {
  const { t } = useI18n(); const { state } = useAdmin();
  const fieldId = useId();
  const sources = state.organizations.filter(o => !o.archivedAt && (state.actor.isSuperAdmin || o.permissions.includes("ORG_MEMBERS_MANAGE")));
  const [source, setSource] = useState(sources[0]?.id ?? ""), [target, setTarget] = useState(""), [member, setMember] = useState("");
  const [targets, setTargets] = useState<Target[]>([]), [servers, setServers] = useState<MemberServer[]>([]), [selected, setSelected] = useState<string[]>([]);
  const [automatic, setAutomatic] = useState(false), [reason, setReason] = useState(""), [note, setNote] = useState("");
  const [requests, setRequests] = useState<AccessRequestRow[]>([]), [grants, setGrants] = useState<AccessGrantRow[]>([]), [sites, setSites] = useState<Site[]>([]);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const sourceOrg = sources.find(o => o.id === source);
  const manage = (id: string) => sources.some(o => o.id === id);
  async function refresh() {
    const data = await api<{ requests: AccessRequestRow[]; grants: AccessGrantRow[] }>("/api/admin/access/requests"); setRequests(data.requests); setGrants(data.grants);
    if (state.actor.isSuperAdmin) setSites(await api<Site[]>("/api/admin/union-sites"));
  }
  useEffect(() => { let alive = true; api<{ requests: AccessRequestRow[]; grants: AccessGrantRow[] }>("/api/admin/access/requests").then(data => { if (alive) { setRequests(data.requests); setGrants(data.grants); } }).catch(e => { if (alive) setError(e.message); });
    if (state.actor.isSuperAdmin) api<Site[]>("/api/admin/union-sites").then(data => { if(alive)setSites(data); }).catch(e=>{if(alive)setError(e.message);});
    return () => { alive = false; }; }, [state.actor.isSuperAdmin]);
  useEffect(() => { let alive = true; if (source) api<Target[]>(`/api/admin/access/candidates?sourceOrganizationId=${source}`).then(data => { if (alive) setTargets(data); }).catch(e => { if (alive) setError(e.message); }); return () => { alive = false; }; }, [source]);
  useEffect(() => {
    let alive = true;
    if (source && target) api<MemberServer[]>(`/api/admin/access/candidates?sourceOrganizationId=${source}&targetOrganizationId=${target}`)
      .then(data => { if (alive) setServers(data); }).catch(e => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [source, target]);
  async function perform(work: () => Promise<unknown>) { setBusy(true); setError(""); try { await work(); await refresh(); return true; } catch(e){setError(e instanceof Error?e.message:"请求失败");return false;}finally{setBusy(false);} }
  const serverColumns: ColumnDef<MemberServer>[] = [{ id: "select", header: t("选择"), cell: ({ row }) => <input aria-label={t("选择服务器")+row.original.displayName} type="checkbox" checked={selected.includes(row.original.serverId)} onChange={e=>setSelected(e.target.checked?[...selected,row.original.serverId]:selected.filter(s=>s!==row.original.serverId))} /> },
    { accessorKey: "displayName", header: t("服务器") }, { id: "client", header: t("客户端"), accessorFn: s=>s.currentRelease.name }, { id: "version", header: t("版本"), accessorFn:s=>s.currentRelease.versionLabel }];
  const requestColumns: ColumnDef<AccessRequestRow>[] = [
    { id:"member",header:t("成员"),accessorFn:r=>`${r.memberName} · ${r.sourceName}` }, { accessorKey:"targetName",header:t("目标组织") },
    { id:"scope",header:t("申请范围"),accessorFn:r=>r.serverIds.join(", "),cell:({row})=><div>{row.original.serverIds.join(", ")}<p className="text-xs text-muted-foreground">{t(row.original.autoIncludeNewServers?"自动加入新增服务器":"仅所选服务器")}</p></div> },
    { accessorKey:"reason",header:t("申请理由") },{ accessorKey:"status",header:t("状态"),cell:({row})=>t(row.original.status) },
    { id:"actions",header:t("操作"),cell:({row})=>row.original.status==="PENDING"?<div className="flex gap-2">{manage(row.original.targetOrganizationId)&&<><Button size="sm" disabled={busy} onClick={()=>void perform(()=>api(`/api/admin/access/requests/${row.original.id}`,"POST",{revision:row.original.revision,decision:"APPROVED",note}))}>{t("同意")}</Button><Button size="sm" variant="outline" disabled={busy} onClick={()=>void perform(()=>api(`/api/admin/access/requests/${row.original.id}`,"POST",{revision:row.original.revision,decision:"REJECTED",note}))}>{t("拒绝")}</Button></>}{manage(row.original.sourceOrganizationId)&&<Button size="sm" variant="outline" disabled={busy} onClick={()=>void perform(()=>api(`/api/admin/access/requests/${row.original.id}`,"POST",{revision:row.original.revision,decision:"CANCELLED",note}))}>{t("取消申请")}</Button>}</div>:<span className="text-xs">{row.original.note}</span> },
  ];
  const grantColumns: ColumnDef<AccessGrantRow>[] = [{id:"member",header:t("成员"),accessorFn:r=>`${r.memberName} · ${r.sourceName}`},{accessorKey:"targetName",header:t("目标组织")},{id:"scope",header:t("授权范围"),accessorFn:r=>r.serverIds.join(", ")},
    {id:"automatic",header:t("新增服务器"),accessorFn:r=>t(r.autoIncludeNewServers?"自动加入":"不自动加入")},
    {id:"revoke",header:t("操作"),cell:({row})=>row.original.revokedAt?t("已撤销"):<Button size="sm" variant="outline" disabled={busy||!note.trim()} onClick={()=>void perform(()=>api(`/api/admin/access/grants/${row.original.id}/revoke`,"POST",{reason:note}))}>{t("撤销授权")}</Button>}];
  const siteAddresses = (site: Site) => {
    const known = state.organizations.find(org => org.id === site.organizationId)?.skinSites?.filter(item => item.code === site.code) ?? [];
    return known[0]?.url === site.bsRoot ? [...new Set(known.map(item => item.url))] : [site.bsRoot];
  };
  const siteColumns: ColumnDef<Site>[] = [
    { accessorKey: "code", header: t("皮肤站代码"), cell: ({ row }) => <code className="text-xs">{row.original.code}</code> },
    { id: "organization", header: t("组织"), accessorFn: site => state.organizations.find(org => org.id === site.organizationId)?.displayName ?? site.organizationId },
    { id: "addresses", header: t("皮肤站地址"), accessorFn: site => siteAddresses(site).join(" "),
      cell: ({ row }) => <div className="space-y-1">{siteAddresses(row.original).map(url => <p key={url} className="max-w-xs truncate text-xs text-muted-foreground" title={url}>{url}</p>)}</div> },
    { id: "status", header: t("状态"), accessorFn: site => t(site.enabled ? "启用中" : "停用"),
      cell: ({ row }) => <Badge variant={row.original.enabled ? "secondary" : "outline"}>{t(row.original.enabled ? "启用中" : "停用")}</Badge> },
    { id: "actions", header: t("操作"), enableSorting: false, enableHiding: false, cell: ({ row }) => <Button size="sm" variant="outline" disabled={busy}
      onClick={() => void perform(() => api("/api/admin/union-sites", "PUT", { code: row.original.code, organizationId: row.original.organizationId, bsRoot: row.original.bsRoot, revision: row.original.revision, enabled: !row.original.enabled }))}>{t(row.original.enabled ? "停用" : "启用")}</Button> },
  ];
  return <div className="space-y-6"><h1 className="text-2xl font-semibold">{t("跨组织访问")}</h1>{error&&<Alert variant="destructive"><AlertDescription>{t(error)}</AlertDescription></Alert>}
    {!!sources.length&&<Card><CardHeader><CardTitle>{t("为本组织成员申请访问")}</CardTitle></CardHeader><CardContent className="space-y-4"><div className="grid gap-4 md:grid-cols-3">
      <div className="min-w-0 space-y-2"><Label htmlFor={`${fieldId}-source`}>{t("源组织")}</Label><Select value={source} disabled={busy} onValueChange={value=>{setSource(value);setMember("");setTarget("");setTargets([]);setServers([]);setSelected([]);}}>
        <SelectTrigger id={`${fieldId}-source`} className="w-full"><SelectValue placeholder={t("请选择")} /></SelectTrigger><SelectContent>{sources.map(org=><SelectItem key={org.id} value={org.id}>{org.displayName}</SelectItem>)}</SelectContent>
      </Select></div>
      <div className="min-w-0 space-y-2"><Label htmlFor={`${fieldId}-member`}>{t("成员")}</Label><Select value={member} disabled={busy || !sourceOrg?.members.some(item=>item.status==="ACTIVE")} onValueChange={setMember}>
        <SelectTrigger id={`${fieldId}-member`} className="w-full"><SelectValue placeholder={t("请选择")} /></SelectTrigger><SelectContent>{sourceOrg?.members.filter(item=>item.status==="ACTIVE").map(item=><SelectItem key={item.account.id} value={item.account.id}>{item.account.displayName}</SelectItem>)}</SelectContent>
      </Select></div>
      <div className="min-w-0 space-y-2"><Label htmlFor={`${fieldId}-target`}>{t("目标组织")}</Label><Select value={target} disabled={busy || !targets.length} onValueChange={value=>{setTarget(value);setServers([]);setSelected([]);}}>
        <SelectTrigger id={`${fieldId}-target`} className="w-full"><SelectValue placeholder={t("请选择")} /></SelectTrigger><SelectContent>{targets.map(org=><SelectItem key={org.id} value={org.id}>{org.displayName}</SelectItem>)}</SelectContent>
      </Select></div>
    </div><Button variant="outline" disabled={!servers.length} onClick={()=>setSelected(selected.length===servers.length?[]:servers.map(s=>s.serverId))}>{t(selected.length===servers.length&&servers.length?"取消全选":"全选全部可申请服务器")}</Button>
      <DataTable columns={serverColumns} data={servers} empty={t("请选择目标组织；未发布资源不会显示。")} />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={automatic} onChange={e=>setAutomatic(e.target.checked)} />{t("是否自动加入新增的服务器到列表")}</label>
      <Input aria-label={t("申请理由")} value={reason} maxLength={1000} onChange={e=>setReason(e.target.value)} placeholder={t("申请理由")} />
      <Button disabled={busy||!member||!target||!selected.length||!reason.trim()} onClick={async()=>{if(await perform(()=>api("/api/admin/access/requests","POST",{sourceOrganizationId:source,targetOrganizationId:target,accountId:member,serverIds:selected,autoIncludeNewServers:automatic,reason}))) {setSelected([]);setReason("");}}}>{t("提交申请")}</Button>
    </CardContent></Card>}
    <Card><CardHeader><CardTitle>{t("访问申请与审批")}</CardTitle></CardHeader><CardContent className="space-y-4"><p className="text-sm text-muted-foreground">{t("批准前核对成员、服务器清单和自动加入选项；范围变化需要重新申请。")}</p><Input aria-label={t("审批说明或撤销原因")} placeholder={t("审批说明或撤销原因")} value={note} maxLength={1000} onChange={e=>setNote(e.target.value)} /><Button variant="outline" disabled={busy} onClick={()=>void perform(async()=>undefined)}>{t("刷新")}</Button><DataTable columns={requestColumns} data={requests} empty={t("暂无访问申请。")} /></CardContent></Card>
    <Card><CardHeader><CardTitle>{t("已批准的访问授权")}</CardTitle></CardHeader><CardContent><DataTable columns={grantColumns} data={grants} empty={t("暂无访问授权。")} /></CardContent></Card>
    {state.actor.isSuperAdmin&&<Card><CardHeader><CardTitle>{t("Union 皮肤站组织映射")}</CardTitle></CardHeader><CardContent className="space-y-4"><p className="text-sm text-muted-foreground">{t("映射仅由超管维护；MUA 代码应指向 MUA 组织。已有映射不能直接转移组织。")}</p><SchemaForm key={sites.map(s=>s.code+s.revision).join()} schema={unionSiteInput.omit({revision:true})} defaults={{code:"",organizationId:"",bsRoot:"",enabled:true}} fields={[
      {name:"code",label:t("皮肤站代码")},{name:"organizationId",label:t("组织"),type:"select",options:state.organizations.filter(o=>!o.archivedAt).map(o=>({value:o.id,label:o.displayName}))},{name:"bsRoot",label:t("皮肤站地址")},{name:"enabled",label:t("启用"),type:"checkbox"}
    ]} onSubmit={values=>perform(()=>api("/api/admin/union-sites","PUT",{...values,revision:sites.find(s=>s.code===values.code)?.revision??0}))} />
      <DataTable columns={siteColumns} data={sites} getRowId={site=>site.code} caption="Union 皮肤站组织映射" searchPlaceholder="搜索皮肤站映射…" empty="暂无皮肤站组织映射。" />
    </CardContent></Card>}
  </div>;
}
