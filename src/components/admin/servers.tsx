"use client";
import { useI18n } from "@/components/preferences";
import { displayTimeInput, displayTimeIso, displayWindowOpen } from "@/lib/server-display";
import { DisplayScheduleNote } from "./display-schedule";
import Link from "next/link";
import { z } from "zod";
import { Eye, Pencil } from "lucide-react";
import { useEffect, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api, useAdmin, type Server } from "./provider";
import { DataTable } from "./data-table";
import { Heading } from "./common";
import { ArchiveButton, EditorDialog, SchemaForm, nameSchema, textSchema, type Field } from "./form";
import { MottoPreview, ServerMottoField, uploadMotto, type MottoDraft } from "./server-motto";
import { ServerStatusLight } from "./server-status";

function directoryStatus(server: Server, organizationArchived: boolean) {
  if (organizationArchived) return "组织已归档";
  if (server.archivedAt) return "服务器已归档";
  if (server.clientArchivedAt) return "客户端已归档";
  if (!server.isListed) return "未上架";
  if (server.currentReleaseActive && !displayWindowOpen(server)) return "展示区间外";
  return server.currentReleaseActive ? "公开分发" : "等待有效发布";
}

function releaseStatus(server: Server) {
  if (server.clientArchivedAt) return "客户端已归档";
  if (server.currentReleaseActive) return "已绑定当前发布";
  if (server.currentReleaseId) return "当前发布已归档";
  return server.boundClientId ? "已绑定，尚未发布" : "未绑定客户端";
}

// The same content serves editors and readers; only permitted controls are rendered.
export function ServerEditorContent({ server: initialServer, onSaved }: { server?: Server; onSaved: () => void }) {
  const { t } = useI18n();
  const { state, organizations, busy, run, refresh } = useAdmin();
  const [createdServerId, setCreatedServerId] = useState<string | null>(null);
  const [pendingMotto, setPendingMotto] = useState<MottoDraft | null>(null);
  const server = initialServer ?? state.organizations.flatMap(org => org.servers).find(server => server.serverId === createdServerId);
  useEffect(() => () => { if (pendingMotto) URL.revokeObjectURL(pendingMotto.previewUrl); }, [pendingMotto]);
  const superAdmin = state.actor.isSuperAdmin;
  const organization = state.organizations.find(org => org.id === server?.organizationId);
  const archived = !!server?.archivedAt || !!organization?.archivedAt;
  const canEdit = !archived && (superAdmin || !!server?.permissions.includes("SERVER_EDIT"));
  const listing = !!server && superAdmin;
  const base = { displayName: nameSchema, description: textSchema(), gameAddress: textSchema(255) };
  const listingFields = {
    displayMode: z.enum(["PERMANENT", "RANGE"]), displayStartsAt: z.string(), displayEndsAt: z.string(),
    sortOrder: z.string().refine(value => value.trim() !== "" && Number.isSafeInteger(Number(value)) && Math.abs(Number(value)) <= 2147483647, t("请输入有效排序整数")),
    themeColor: z.string().regex(/^(#[0-9a-fA-F]{6})?$/, t("请输入 #RRGGBB 或留空")), isListed: z.boolean(),
  };
  const schema = server ? listing ? z.object(base).extend(listingFields).superRefine((value, ctx) => {
    if (value.displayMode === "RANGE") {
      const start = displayTimeIso(value.displayStartsAt), end = displayTimeIso(value.displayEndsAt);
      if (!start || !end || start >= end) ctx.addIssue({ code: "custom", path: ["displayEndsAt"], message: t("请选择有效展示区间，结束时间须晚于开始时间") });
    }
  }) : z.object(base)
    : z.object(base).extend({ organizationId: z.string().uuid(t("请选择组织")), serverId: z.string().regex(/^[A-Za-z]{3,5}$/, t("ID 须为已有的 3–5 位英文字母")) });
  const fields: Field[] = [
    ...(!server ? [{ name: "organizationId", label: t("所属组织"), type: "select" as const, options: organizations.filter(org => !org.archivedAt).map(org => ({ value: org.id, label: org.displayName, translate: false })) }, { name: "serverId", label: "MUA server ID", hint: t("使用已有 MUA ID，创建后不可更改。"), placeholder: "NPUR" }] : []),
    { name: "displayName", label: t("显示别名"), placeholder: "NPU RELEASE" },
    { name: "description", label: t("简介"), type: "textarea" },
    { name: "gameAddress", label: t("连接地址"), placeholder: "play.example.edu:25565" },
    ...(listing ? [
      { name: "displayMode", label: t("展示模式"), type: "select" as const, options: [{ value: "PERMANENT", label: t("永久展示") }, { value: "RANGE", label: t("区间展示") }], hint: t("区间仅控制目录展示，到期不会下架客户端或停止下载。") },
      { name: "displayStartsAt", label: t("展示开始时间（北京时间）"), type: "datetime-local" as const, visibleWhen: { name: "displayMode", value: "RANGE" } },
      { name: "displayEndsAt", label: t("展示结束时间（北京时间）"), type: "datetime-local" as const, visibleWhen: { name: "displayMode", value: "RANGE" }, hint: t("包含开始时间，不包含结束时间。") },
      { name: "sortOrder", label: t("排序"), type: "number" as const, hint: t("数字越小，在 Launcher 中越靠前。") },
      { name: "themeColor", label: t("展示颜色"), placeholder: "#3b82f6" },
      { name: "isListed", label: t("标记上架"), type: "checkbox" as const, hint: t("只有存在有效当前发布且组织、服务器、客户端均启用时，才会出现在公开列表。") },
    ] : []),
  ];
  if (!server && !superAdmin) return null;
  return <div className="space-y-6">
    {server && <section className="space-y-3" aria-label={t("服务器状态")}>
      <h3 className="font-medium">{t("服务器状态")}</h3>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">MUA server ID</dt><dd><code>{server.serverId}</code></dd>
        <dt className="text-muted-foreground">{t("所属组织")}</dt><dd>{organization?.displayName}</dd>
        <dt className="text-muted-foreground">{t("资源状态")}</dt><dd>{organization?.archivedAt ? t("组织已归档") : server.archivedAt ? t("服务器已归档") : t("启用中")}</dd>
        <dt className="text-muted-foreground">{t("上架标记")}</dt><dd>{server.isListed ? t("已标记上架") : t("未上架")}</dd>
        <dt className="text-muted-foreground">{t("目录状态")}</dt><dd>{t(directoryStatus(server, !!organization?.archivedAt))}</dd>
        <dt className="text-muted-foreground">{t("连接探测")}</dt><dd><ServerStatusLight serverId={server.serverId} address={server.gameAddress} archived={archived} showLabel /></dd>
        <dt className="text-muted-foreground">{t("当前客户端")}</dt><dd className="break-words">{server.boundClientName || t("未绑定")} · {t(releaseStatus(server))}<DisplayScheduleNote schedule={server} /></dd>
      </dl>
      {archived && <p className="text-sm text-muted-foreground">{t("归档期间不能修改服务器资料与展示设置。")}{organization?.archivedAt ? t("请先恢复所属组织。") : t("恢复服务器后可继续编辑。")}</p>}
    </section>}
    <ServerMottoField server={server} editable={canEdit} pending={pendingMotto} onPrepare={setPendingMotto} />
    {canEdit ? <SchemaForm key={server?.serverId ?? "new"} schema={schema} fields={fields} disabled={busy} defaults={{
      displayName: server?.displayName ?? "", description: server?.description ?? "", gameAddress: server?.gameAddress ?? "",
      ...(server ? listing ? { displayMode: server.displayMode, displayStartsAt: displayTimeInput(server.displayStartsAt), displayEndsAt: displayTimeInput(server.displayEndsAt), sortOrder: String(server.sortOrder), themeColor: server.themeColor ?? "", isListed: server.isListed } : {}
        : { serverId: "", organizationId: organizations.find(org => !org.archivedAt)?.id ?? "" }),
    }} onSubmit={async values => {
      const payload = { ...values, ...(listing ? { sortOrder: Number(values.sortOrder), displayStartsAt: values.displayMode === "RANGE" ? displayTimeIso(String(values.displayStartsAt)) : null, displayEndsAt: values.displayMode === "RANGE" ? displayTimeIso(String(values.displayEndsAt)) : null } : {}) };
      const ok = await run(async () => {
        let serverId = server?.serverId ?? createdServerId;
        if (!serverId) {
          const created = await api<{ serverId: string }>("/api/admin/servers", "POST", payload);
          serverId = created.serverId; setCreatedServerId(serverId);
          // If image storage fails after registration, keep the created record and allow a retry without registering twice.
          await refresh();
        } else await api(`/api/admin/servers/${serverId}`, "PATCH", server ? payload : {
          displayName: values.displayName, description: values.description, gameAddress: values.gameAddress,
        });
        if (pendingMotto) await uploadMotto(serverId, server?.iconObjectKey ?? null, pendingMotto.file, pendingMotto.crop);
      });
      if (ok) { setPendingMotto(null); onSaved(); }
      return ok;
    }} /> : server && <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
      <dt className="text-muted-foreground">{t("显示别名")}</dt><dd className="break-words">{server.displayName}</dd>
      <dt className="text-muted-foreground">{t("简介")}</dt><dd className="whitespace-pre-wrap break-words">{server.description || t("未设置")}</dd>
      <dt className="text-muted-foreground">{t("连接地址")}</dt><dd className="break-all">{server.gameAddress || t("未设置")}</dd>
      <dt className="text-muted-foreground">{t("排序")}</dt><dd>{server.sortOrder}</dd>
      <dt className="text-muted-foreground">{t("展示颜色")}</dt><dd>{server.themeColor || t("默认")}</dd>
    </dl>}
    {server && superAdmin && <section className="flex items-center justify-between gap-4 border-t pt-4" aria-label={t("归档管理")}>
      <div><h3 className="text-sm font-medium">{server.archivedAt ? t("恢复服务器") : t("归档服务器")}</h3><p className="text-xs text-muted-foreground">{server.archivedAt ? t("恢复后需重新绑定客户端并确认上架。") : t("停止分发，保留服务器记录与历史。")}</p></div>
      <ArchiveButton kind="servers" id={server.serverId} archived={!!server.archivedAt} />
    </section>}
  </div>;
}

function ServerEditor({ server }: { server?: Server }) {
  const { t } = useI18n();
  const { state, organizations, busy } = useAdmin();
  const canManage = state.actor.isSuperAdmin || !!server?.permissions.includes("SERVER_EDIT");
  const title = server ? canManage ? t("编辑服务器") : t("服务器详情") : t("登记服务器");
  return <EditorDialog title={title} description={server ? t("集中查看服务器资料、上架与绑定状态；按当前权限提供控制选项。") : t("使用已有 MUA server ID 登记服务器，保存后可设置展示信息。")}
    disabled={busy || !organizations.some(org => !org.archivedAt)}
    trigger={server ? <Button variant="outline" size="sm" disabled={busy}>{canManage ? <Pencil className="size-3.5" /> : <Eye className="size-3.5" />}{canManage ? t("编辑") : t("查看")}</Button> : undefined}>
    {close => <ServerEditorContent server={server} onSaved={close} />}
  </EditorDialog>;
}

export function ServersPage() {
  const { t } = useI18n();
  const { state, servers } = useAdmin();
  const organization = (server: Server) => state.organizations.find(org => org.id === server.organizationId);
  const columns: ColumnDef<Server>[] = [
    { id: "motto", header: t("服务器箴言"), enableSorting: false, enableHiding: false, cell: ({ row }) => <MottoPreview src={row.original.mottoImageUrl} alt={t("{0}箴言", { "0": row.original.displayName })} /> },
    { accessorKey: "displayName", header: t("服务器"), cell: ({ row }) => <div className="flex items-center gap-3">
      <ServerStatusLight serverId={row.original.serverId} address={row.original.gameAddress} archived={!!row.original.archivedAt || !!organization(row.original)?.archivedAt} />
      <div><p className="font-medium">{row.original.displayName}</p><p className="text-xs text-muted-foreground">{row.original.serverId}</p></div>
    </div> },
    { id: "organization", header: t("组织"), accessorFn: server => organization(server)?.displayName ?? "" },
    { accessorKey: "gameAddress", header: t("连接地址"), cell: ({ row }) => <code className="text-xs">{row.original.gameAddress || t("未设置")}</code> },
    { accessorKey: "sortOrder", header: t("排序") },
    { accessorKey: "themeColor", header: t("展示颜色"), cell: ({ row }) => <code>{row.original.themeColor || t("默认")}</code> },
    { id: "status", header: t("目录状态"), accessorFn: server => t(directoryStatus(server, !!organization(server)?.archivedAt)), cell: ({ getValue }) => <Badge variant="outline">{String(getValue())}</Badge> },
    { id: "release", header: t("当前客户端"), accessorFn: server => `${server.boundClientName || ""} ${releaseStatus(server)}`, cell: ({ row }) => <div className="space-y-1">
      {row.original.boundClientId && (row.original.permissions.includes("DRAFT_READ") || row.original.permissions.includes("RELEASE_READ"))
        ? <Link className="font-medium hover:underline" href={`/admin/clients/${row.original.boundClientId}`}>{row.original.boundClientName}</Link>
        : row.original.boundClientName && <p className="font-medium">{row.original.boundClientName}</p>}
      <p className="text-xs text-muted-foreground">{t(releaseStatus(row.original))}</p><DisplayScheduleNote schedule={row.original} />
    </div> },
    { id: "actions", header: t("操作"), enableHiding: false, cell: ({ row }) => <ServerEditor server={row.original} /> },
  ];
  return <>
    <Heading title={t("服务器管理")} description={t("统一管理服务器资料、Launcher 展示与分发状态。")} action={state.actor.isSuperAdmin && <ServerEditor />} />
    <Alert><AlertDescription>{t("状态灯每分钟探测一次 Minecraft Java 服务器，悬停查看延迟与原因，点击可刷新。延迟从后端测得；目录状态仍表示上架与客户端发布配置。")}</AlertDescription></Alert>
    <DataTable data={servers} columns={columns} getRowId={server => server.serverId} empty={t("暂无可访问服务器。请先创建组织并登记 MUA server ID。")} />
  </>;
}
