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
  if (organizationArchived) return "servers.organizationArchived";
  if (server.archivedAt) return "servers.serverArchived";
  if (server.clientArchivedAt) return "clients.clientArchived";
  if (!server.isListed) return "servers.notListed";
  if (server.currentReleaseActive && !displayWindowOpen(server)) return "servers.outsideDisplayWindow";
  return server.currentReleaseActive ? "dashboard.publicDistribution" : "servers.waitingForAValidRelease";
}

function releaseStatus(server: Server) {
  if (server.clientArchivedAt) return "clients.clientArchived";
  if (server.currentReleaseActive) return "servers.currentReleaseBound";
  if (server.currentReleaseId) return "servers.currentReleaseArchived";
  return server.boundClientId ? "servers.boundUnpublished" : "servers.noClientBound";
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
  const scheduleFields = { displayMode: z.enum(["PERMANENT", "RANGE"]), displayStartsAt: z.string(), displayEndsAt: z.string() };
  const colorField = { themeColor: z.string().regex(/^(#[0-9a-fA-F]{6})?$/, t("servers.enterRrggbbOrLeaveBlank")) };
  const listingFields = {
    sortOrder: z.string().refine(value => value.trim() !== "" && Number.isSafeInteger(Number(value)) && Math.abs(Number(value)) <= 2147483647, t("servers.enterAValidIntegerSortOrder")),
    isListed: z.boolean(),
  };
  const profileSchema = z.object(base).extend(scheduleFields);
  const validateSchedule = (value: z.infer<typeof profileSchema>, ctx: z.RefinementCtx) => {
    if (value.displayMode === "RANGE") {
      const start = displayTimeIso(value.displayStartsAt), end = displayTimeIso(value.displayEndsAt);
      if (!start || !end || start >= end) ctx.addIssue({ code: "custom", path: ["displayEndsAt"], message: t("servers.chooseAValidDisplayWindowWithAnEndLater") });
    }
  };
  const schema = server ? listing ? profileSchema.extend({ ...colorField, ...listingFields }).superRefine(validateSchedule) : profileSchema.extend(colorField).superRefine(validateSchedule)
    : profileSchema.extend({ organizationId: z.string().uuid(t("servers.selectAnOrganization")), serverId: z.string().regex(/^[A-Za-z]{3,5}$/, t("servers.idMustBeTheExisting35EnglishLetters")) }).superRefine(validateSchedule);
  const fields: Field[] = [
    ...(!server ? [{ name: "organizationId", label: t("clientUpload.organization"), type: "select" as const, options: organizations.filter(org => !org.archivedAt).map(org => ({ value: org.id, label: org.displayName, translate: false })) }, { name: "serverId", label: "MUA server ID", hint: t("servers.useTheExistingMuaIdItCannotBeChanged"), placeholder: "NPUR" }] : []),
    { name: "displayName", label: t("servers.displayAlias"), placeholder: "NPU RELEASE" },
    { name: "description", label: t("organizations.description"), type: "textarea" },
    { name: "gameAddress", label: t("servers.connectionAddress"), placeholder: "play.example.edu:25565" },
    ...(canEdit ? [
      { name: "displayMode", label: t("servers.displayMode"), type: "select" as const, options: [{ value: "PERMANENT", label: t("servers.permanentDisplay") }, { value: "RANGE", label: t("servers.scheduledDisplay") }], hint: t("servers.theWindowControlsDirectoryVisibilityOnlyExpiryDoesNot") },
      { name: "displayStartsAt", label: t("servers.displayStartsUtc0800"), type: "datetime-local" as const, visibleWhen: { name: "displayMode", value: "RANGE" } },
      { name: "displayEndsAt", label: t("servers.displayEndsUtc0800"), type: "datetime-local" as const, visibleWhen: { name: "displayMode", value: "RANGE" }, hint: t("servers.theStartIsInclusiveAndTheEndIsExclusive") },
    ] : []),
    ...(server && canEdit ? [{ name: "themeColor", label: t("servers.displayColor"), placeholder: "#3b82f6" }] : []),
    ...(listing ? [
      { name: "sortOrder", label: t("servers.sortOrder"), type: "number" as const, hint: t("servers.smallerNumbersAppearEarlierInLauncher") },
      { name: "isListed", label: t("servers.markAsListed"), type: "checkbox" as const, hint: t("servers.appearsPubliclyOnlyWithAValidCurrentReleaseAnd") },
    ] : []),
  ];
  if (!server && !superAdmin) return null;
  return <div className="space-y-6">
    {server && <section className="space-y-3" aria-label={t("servers.serverStatus")}>
      <h3 className="font-medium">{t("servers.serverStatus")}</h3>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">MUA server ID</dt><dd><code>{server.serverId}</code></dd>
        <dt className="text-muted-foreground">{t("clientUpload.organization")}</dt><dd>{organization?.displayName}</dd>
        <dt className="text-muted-foreground">{t("servers.resourceStatus")}</dt><dd>{organization?.archivedAt ? t("servers.organizationArchived") : server.archivedAt ? t("servers.serverArchived") : t("common.active")}</dd>
        <dt className="text-muted-foreground">{t("servers.listingFlag")}</dt><dd>{server.isListed ? t("servers.markedAsListed") : t("servers.notListed")}</dd>
        <dt className="text-muted-foreground">{t("servers.directoryStatus")}</dt><dd>{t(directoryStatus(server, !!organization?.archivedAt))}</dd>
        <dt className="text-muted-foreground">{t("servers.displayMode")}</dt><dd>{t(server.displayMode === "RANGE" ? "servers.scheduledDisplay" : "servers.permanentDisplay")}</dd>
        <dt className="text-muted-foreground">{t("servers.displayColor")}</dt><dd><code>{server.themeColor || t("servers.default")}</code></dd>
        <dt className="text-muted-foreground">{t("servers.connectionProbe")}</dt><dd><ServerStatusLight serverId={server.serverId} address={server.gameAddress} archived={archived} showLabel /></dd>
        <dt className="text-muted-foreground">{t("servers.currentClient")}</dt><dd className="break-words">{server.boundClientName || t("clients.unbound")} · {t(releaseStatus(server))}<DisplayScheduleNote schedule={server} /></dd>
      </dl>
      {archived && <p className="text-sm text-muted-foreground">{t("servers.serverDetailsAndDisplaySettingsCannotBeChangedWhile")}{organization?.archivedAt ? t("servers.restoreTheOrganizationFirst") : t("servers.restoreTheServerToContinueEditing")}</p>}
    </section>}
    <ServerMottoField server={server} editable={canEdit} pending={pendingMotto} onPrepare={setPendingMotto} />
    {canEdit ? <SchemaForm key={server?.serverId ?? "new"} schema={schema} fields={fields} disabled={busy} defaults={{
      displayName: server?.displayName ?? "", description: server?.description ?? "", gameAddress: server?.gameAddress ?? "",
      ...(canEdit ? { displayMode: server?.displayMode ?? "PERMANENT", displayStartsAt: displayTimeInput(server?.displayStartsAt ?? null), displayEndsAt: displayTimeInput(server?.displayEndsAt ?? null) } : {}),
      ...(server ? { themeColor: server.themeColor ?? "", ...(listing ? { sortOrder: String(server.sortOrder), isListed: server.isListed } : {}) }
        : { serverId: "", organizationId: organizations.find(org => !org.archivedAt)?.id ?? "" }),
    }} onSubmit={async values => {
      const payload = { ...values, ...(listing ? { sortOrder: Number(values.sortOrder) } : {}), ...(canEdit ? { displayStartsAt: values.displayMode === "RANGE" ? displayTimeIso(String(values.displayStartsAt)) : null, displayEndsAt: values.displayMode === "RANGE" ? displayTimeIso(String(values.displayEndsAt)) : null } : {}) };
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
      <dt className="text-muted-foreground">{t("servers.displayAlias")}</dt><dd className="break-words">{server.displayName}</dd>
      <dt className="text-muted-foreground">{t("organizations.description")}</dt><dd className="whitespace-pre-wrap break-words">{server.description || t("servers.notSet")}</dd>
      <dt className="text-muted-foreground">{t("servers.connectionAddress")}</dt><dd className="break-all">{server.gameAddress || t("servers.notSet")}</dd>
      <dt className="text-muted-foreground">{t("servers.sortOrder")}</dt><dd>{server.sortOrder}</dd>
    </dl>}
    {server && superAdmin && <section className="flex items-center justify-between gap-4 border-t pt-4" aria-label={t("servers.archiveManagement")}>
      <div><h3 className="text-sm font-medium">{server.archivedAt ? t("servers.restoreServer") : t("servers.archiveServer")}</h3><p className="text-xs text-muted-foreground">{server.archivedAt ? t("servers.rebindAClientAndConfirmListingAfterRestoration") : t("servers.stopDistributionRetainServerRecordsAndHistory")}</p></div>
      <ArchiveButton kind="servers" id={server.serverId} archived={!!server.archivedAt} />
    </section>}
  </div>;
}

function ServerEditor({ server }: { server?: Server }) {
  const { t } = useI18n();
  const { state, organizations, busy } = useAdmin();
  const canManage = state.actor.isSuperAdmin || !!server?.permissions.includes("SERVER_EDIT");
  const title = server ? canManage ? t("servers.editServer") : t("servers.serverDetails") : t("servers.registerServer");
  return <EditorDialog title={title} description={server ? t("servers.viewServerDetailsListingAndBindingStatusInOne") : t("servers.registerAServerUsingItsExistingMuaServerId")}
    disabled={busy || !organizations.some(org => !org.archivedAt)}
    trigger={server ? <Button variant="outline" size="sm" disabled={busy}>{canManage ? <Pencil className="size-3.5" /> : <Eye className="size-3.5" />}{canManage ? t("clientUpload.edit") : t("servers.view")}</Button> : undefined}>
    {close => <ServerEditorContent server={server} onSaved={close} />}
  </EditorDialog>;
}

export function ServersPage() {
  const { t } = useI18n();
  const { state, servers } = useAdmin();
  const organization = (server: Server) => state.organizations.find(org => org.id === server.organizationId);
  const columns: ColumnDef<Server>[] = [
    { id: "motto", header: t("serverMotto.serverMotto"), enableSorting: false, enableHiding: false, cell: ({ row }) => <MottoPreview table className="w-full min-w-48" src={row.original.mottoImageUrl} alt={t("serverMotto.imageAlt", { "server": row.original.displayName })} /> },
    { accessorKey: "displayName", header: t("clients.server"), cell: ({ row }) => <div className="flex items-center gap-3">
      <ServerStatusLight serverId={row.original.serverId} address={row.original.gameAddress} archived={!!row.original.archivedAt || !!organization(row.original)?.archivedAt} />
      <div><p className="font-medium">{row.original.displayName}</p><p className="text-xs text-muted-foreground">{row.original.serverId}</p></div>
    </div> },
    { id: "organization", header: t("dashboard.organization"), accessorFn: server => organization(server)?.displayName ?? "" },
    { accessorKey: "gameAddress", header: t("servers.connectionAddress"), cell: ({ row }) => <code className="text-xs">{row.original.gameAddress || t("servers.notSet")}</code> },
    { accessorKey: "sortOrder", header: t("servers.sortOrder") },
    { accessorKey: "themeColor", header: t("servers.displayColor"), cell: ({ row }) => <code>{row.original.themeColor || t("servers.default")}</code> },
    { id: "status", header: t("servers.directoryStatus"), accessorFn: server => t(directoryStatus(server, !!organization(server)?.archivedAt)), cell: ({ getValue }) => <Badge variant="outline">{String(getValue())}</Badge> },
    { id: "release", header: t("servers.currentClient"), accessorFn: server => `${server.boundClientName || ""} ${releaseStatus(server)}`, cell: ({ row }) => <div className="space-y-1">
      {row.original.boundClientId && (row.original.permissions.includes("DRAFT_READ") || row.original.permissions.includes("RELEASE_READ"))
        ? <Link className="font-medium hover:underline" href={`/admin/clients/${row.original.boundClientId}`}>{row.original.boundClientName}</Link>
        : row.original.boundClientName && <p className="font-medium">{row.original.boundClientName}</p>}
      <p className="text-xs text-muted-foreground">{t(releaseStatus(row.original))}</p><DisplayScheduleNote schedule={row.original} />
    </div> },
    { id: "actions", header: t("clients.actions"), enableHiding: false, cell: ({ row }) => <ServerEditor server={row.original} /> },
  ];
  return <>
    <Heading title={t("navigation.servers")} description={t("servers.manageServerDetailsLauncherDisplayAndDistributionStatusTogether")} action={state.actor.isSuperAdmin && <ServerEditor />} />
    <Alert><AlertDescription>{t("servers.statusLightsProbeMinecraftJavaServersEveryMinuteHover")}</AlertDescription></Alert>
    <DataTable data={servers} columns={columns} columnClassNames={{ motto: { header: "w-48", cell: "relative w-48 p-0" } }} getRowId={server => server.serverId} empty={t("servers.noAccessibleServersCreateAnOrganizationAndRegisterA")} />
  </>;
}
