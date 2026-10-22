"use client";
import { serializeError } from "@/lib/diagnostics";
import { formatMessage } from "@/lib/diagnostics";

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
  useEffect(() => { let alive = true; api<{ requests: AccessRequestRow[]; grants: AccessGrantRow[] }>("/api/admin/access/requests").then(data => { if (alive) { setRequests(data.requests); setGrants(data.grants); } }).catch(e => { if (alive) setError(serializeError(e)); });
    if (state.actor.isSuperAdmin) api<Site[]>("/api/admin/union-sites").then(data => { if(alive)setSites(data); }).catch(e=>{if(alive)setError(serializeError(e));});
    return () => { alive = false; }; }, [state.actor.isSuperAdmin]);
  useEffect(() => { let alive = true; if (source) api<Target[]>(`/api/admin/access/candidates?sourceOrganizationId=${source}`).then(data => { if (alive) setTargets(data); }).catch(e => { if (alive) setError(serializeError(e)); }); return () => { alive = false; }; }, [source]);
  useEffect(() => {
    let alive = true;
    if (source && target) api<MemberServer[]>(`/api/admin/access/candidates?sourceOrganizationId=${source}&targetOrganizationId=${target}`)
      .then(data => { if (alive) setServers(data); }).catch(e => { if (alive) setError(serializeError(e)); });
    return () => { alive = false; };
  }, [source, target]);
  async function perform(work: () => Promise<unknown>) { setBusy(true); setError(""); try { await work(); await refresh(); return true; } catch(e){setError(e instanceof Error?serializeError(e):"clientShared.requestFailed");return false;}finally{setBusy(false);} }
  const serverColumns: ColumnDef<MemberServer>[] = [{ id: "select", header: t("organizationAccess.select"), cell: ({ row }) => <input aria-label={t("clients.selectServer")+row.original.displayName} type="checkbox" checked={selected.includes(row.original.serverId)} onChange={e=>setSelected(e.target.checked?[...selected,row.original.serverId]:selected.filter(s=>s!==row.original.serverId))} /> },
    { accessorKey: "displayName", header: t("clients.server") }, { id: "client", header: t("clients.client"), accessorFn: s=>s.currentRelease.name }, { id: "version", header: t("clients.version"), accessorFn:s=>s.currentRelease.versionLabel }];
  const requestColumns: ColumnDef<AccessRequestRow>[] = [
    { id:"member",header:t("members.members"),accessorFn:r=>`${r.memberName} · ${r.sourceName}` }, { accessorKey:"targetName",header:t("organizationAccess.targetOrganization") },
    { id:"scope",header:t("organizationAccess.requestedServers"),accessorFn:r=>r.serverIds.join(", "),cell:({row})=><div>{row.original.serverIds.join(", ")}<p className="text-xs text-muted-foreground">{t(row.original.autoIncludeNewServers?"organizationAccess.automaticallyIncludeNewlyAvailableServers":"organizationAccess.selectedServersOnly")}</p></div> },
    { accessorKey:"reason",header:t("organizationAccess.requestReason") },{ accessorKey:"status",header:t("clients.status"),cell:({row})=>t(`organizationAccess.requestStatus.${row.original.status}`) },
    { id:"actions",header:t("clients.actions"),cell:({row})=>row.original.status==="PENDING"?<div className="flex gap-2">{manage(row.original.targetOrganizationId)&&<><Button size="sm" disabled={busy} onClick={()=>void perform(()=>api(`/api/admin/access/requests/${row.original.id}`,"POST",{revision:row.original.revision,decision:"APPROVED",note}))}>{t("organizationAccess.approve")}</Button><Button size="sm" variant="outline" disabled={busy} onClick={()=>void perform(()=>api(`/api/admin/access/requests/${row.original.id}`,"POST",{revision:row.original.revision,decision:"REJECTED",note}))}>{t("organizationAccess.reject")}</Button></>}{manage(row.original.sourceOrganizationId)&&<Button size="sm" variant="outline" disabled={busy} onClick={()=>void perform(()=>api(`/api/admin/access/requests/${row.original.id}`,"POST",{revision:row.original.revision,decision:"CANCELLED",note}))}>{t("organizationAccess.cancelRequest")}</Button>}</div>:<span className="text-xs">{row.original.note}</span> },
  ];
  const grantColumns: ColumnDef<AccessGrantRow>[] = [{id:"member",header:t("members.members"),accessorFn:r=>`${r.memberName} · ${r.sourceName}`},{accessorKey:"targetName",header:t("organizationAccess.targetOrganization")},{id:"scope",header:t("organizationAccess.approvedServers"),accessorFn:r=>r.serverIds.join(", ")},
    {id:"automatic",header:t("organizationAccess.newServers"),accessorFn:r=>t(r.autoIncludeNewServers?"organizationAccess.includeAutomatically":"organizationAccess.doNotIncludeAutomatically")},
    {id:"revoke",header:t("clients.actions"),cell:({row})=>row.original.revokedAt?t("apiTokens.revoked"):<Button size="sm" variant="outline" disabled={busy||!note.trim()} onClick={()=>void perform(()=>api(`/api/admin/access/grants/${row.original.id}/revoke`,"POST",{reason:note}))}>{t("organizationAccess.revokeAccess")}</Button>}];
  const siteAddresses = (site: Site) => {
    const known = state.organizations.find(org => org.id === site.organizationId)?.skinSites?.filter(item => item.code === site.code) ?? [];
    return known[0]?.url === site.bsRoot ? [...new Set(known.map(item => item.url))] : [site.bsRoot];
  };
  const siteColumns: ColumnDef<Site>[] = [
    { accessorKey: "code", header: t("organizationAccess.skinSiteCode"), cell: ({ row }) => <code className="text-xs">{row.original.code}</code> },
    { id: "organization", header: t("dashboard.organization"), accessorFn: site => state.organizations.find(org => org.id === site.organizationId)?.displayName ?? site.organizationId },
    { id: "addresses", header: t("organizationAccess.skinSiteUrl"), accessorFn: site => siteAddresses(site).join(" "),
      cell: ({ row }) => <div className="space-y-1">{siteAddresses(row.original).map(url => <p key={url} className="max-w-xs truncate text-xs text-muted-foreground" title={url}>{url}</p>)}</div> },
    { id: "status", header: t("clients.status"), accessorFn: site => t(site.enabled ? "common.active" : "members.disabled"),
      cell: ({ row }) => <Badge variant={row.original.enabled ? "secondary" : "outline"}>{t(row.original.enabled ? "common.active" : "members.disabled")}</Badge> },
    { id: "actions", header: t("clients.actions"), enableSorting: false, enableHiding: false, cell: ({ row }) => <Button size="sm" variant="outline" disabled={busy}
      onClick={() => void perform(() => api("/api/admin/union-sites", "PUT", { code: row.original.code, organizationId: row.original.organizationId, bsRoot: row.original.bsRoot, revision: row.original.revision, enabled: !row.original.enabled }))}>{t(row.original.enabled ? "members.disabled" : "apiTokens.enabled")}</Button> },
  ];
  return <div className="space-y-6"><h1 className="text-2xl font-semibold">{t("navigation.crossOrganizationAccess")}</h1>{error&&<Alert variant="destructive"><AlertDescription>{formatMessage(t, error)}</AlertDescription></Alert>}
    {!!sources.length&&<Card><CardHeader><CardTitle>{t("organizationAccess.requestAccessForAHomeOrganizationMember")}</CardTitle></CardHeader><CardContent className="space-y-4"><div className="grid gap-4 md:grid-cols-3">
      <div className="min-w-0 space-y-2"><Label htmlFor={`${fieldId}-source`}>{t("organizationAccess.homeOrganization")}</Label><Select value={source} disabled={busy} onValueChange={value=>{setSource(value);setMember("");setTarget("");setTargets([]);setServers([]);setSelected([]);}}>
        <SelectTrigger id={`${fieldId}-source`} className="w-full"><SelectValue placeholder={t("common.select.placeholder")} /></SelectTrigger><SelectContent>{sources.map(org=><SelectItem key={org.id} value={org.id}>{org.displayName}</SelectItem>)}</SelectContent>
      </Select></div>
      <div className="min-w-0 space-y-2"><Label htmlFor={`${fieldId}-member`}>{t("members.members")}</Label><Select value={member} disabled={busy || !sourceOrg?.members.some(item=>item.status==="ACTIVE")} onValueChange={setMember}>
        <SelectTrigger id={`${fieldId}-member`} className="w-full"><SelectValue placeholder={t("common.select.placeholder")} /></SelectTrigger><SelectContent>{sourceOrg?.members.filter(item=>item.status==="ACTIVE").map(item=><SelectItem key={item.account.id} value={item.account.id}>{item.account.displayName}</SelectItem>)}</SelectContent>
      </Select></div>
      <div className="min-w-0 space-y-2"><Label htmlFor={`${fieldId}-target`}>{t("organizationAccess.targetOrganization")}</Label><Select value={target} disabled={busy || !targets.length} onValueChange={value=>{setTarget(value);setServers([]);setSelected([]);}}>
        <SelectTrigger id={`${fieldId}-target`} className="w-full"><SelectValue placeholder={t("common.select.placeholder")} /></SelectTrigger><SelectContent>{targets.map(org=><SelectItem key={org.id} value={org.id}>{org.displayName}</SelectItem>)}</SelectContent>
      </Select></div>
    </div><Button variant="outline" disabled={!servers.length} onClick={()=>setSelected(selected.length===servers.length?[]:servers.map(s=>s.serverId))}>{t(selected.length===servers.length&&servers.length?"organizationAccess.clearSelection":"organizationAccess.selectAllAvailableServers")}</Button>
      <DataTable columns={serverColumns} data={servers} empty={t("organizationAccess.chooseATargetOrganizationUnpublishedResourcesAreNotShown")} />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={automatic} onChange={e=>setAutomatic(e.target.checked)} />{t("organizationAccess.automaticallyIncludeNewlyAvailableServersInTheList")}</label>
      <Input aria-label={t("organizationAccess.requestReason")} value={reason} maxLength={1000} onChange={e=>setReason(e.target.value)} placeholder={t("organizationAccess.requestReason")} />
      <Button disabled={busy||!member||!target||!selected.length||!reason.trim()} onClick={async()=>{if(await perform(()=>api("/api/admin/access/requests","POST",{sourceOrganizationId:source,targetOrganizationId:target,accountId:member,serverIds:selected,autoIncludeNewServers:automatic,reason}))) {setSelected([]);setReason("");}}}>{t("organizationAccess.submitRequest")}</Button>
    </CardContent></Card>}
    <Card><CardHeader><CardTitle>{t("organizationAccess.accessRequestsAndApprovals")}</CardTitle></CardHeader><CardContent className="space-y-4"><p className="text-sm text-muted-foreground">{t("organizationAccess.checkTheMemberServerListAndAutoIncludeOption")}</p><Input aria-label={t("organizationAccess.reviewNoteOrRevocationReason")} placeholder={t("organizationAccess.reviewNoteOrRevocationReason")} value={note} maxLength={1000} onChange={e=>setNote(e.target.value)} /><Button variant="outline" disabled={busy} onClick={()=>void perform(async()=>undefined)}>{t("organizationAccess.refresh")}</Button><DataTable columns={requestColumns} data={requests} empty={t("organizationAccess.noAccessRequests")} /></CardContent></Card>
    <Card><CardHeader><CardTitle>{t("organizationAccess.approvedAccessGrants")}</CardTitle></CardHeader><CardContent><DataTable columns={grantColumns} data={grants} empty={t("organizationAccess.noAccessGrants")} /></CardContent></Card>
    {state.actor.isSuperAdmin&&<Card><CardHeader><CardTitle>{t("organizationAccess.unionSkinSiteOrganizationMappings")}</CardTitle></CardHeader><CardContent className="space-y-4"><p className="text-sm text-muted-foreground">{t("organizationAccess.onlySystemAdministratorsManageMappingsMuaMustMapTo")}</p><SchemaForm key={sites.map(s=>s.code+s.revision).join()} schema={unionSiteInput.omit({revision:true})} defaults={{code:"",organizationId:"",bsRoot:"",enabled:true}} fields={[
      {name:"code",label:t("organizationAccess.skinSiteCode")},{name:"organizationId",label:t("dashboard.organization"),type:"select",options:state.organizations.filter(o=>!o.archivedAt).map(o=>({value:o.id,label:o.displayName}))},{name:"bsRoot",label:t("organizationAccess.skinSiteUrl")},{name:"enabled",label:t("apiTokens.enabled"),type:"checkbox"}
    ]} onSubmit={values=>perform(()=>api("/api/admin/union-sites","PUT",{...values,revision:sites.find(s=>s.code===values.code)?.revision??0}))} />
      <DataTable columns={siteColumns} data={sites} getRowId={site=>site.code} caption="organizationAccess.unionSkinSiteOrganizationMappings" searchPlaceholder="organizationAccess.searchSkinSiteMappings" empty="organizationAccess.noSkinSiteOrganizationMappings" />
    </CardContent></Card>}
  </div>;
}
