"use client";
import { serializeError } from "@/lib/diagnostics";
import { formatMessage } from "@/lib/diagnostics";

import { useI18n } from "@/components/preferences";
import { useEffect, useState } from "react";
import { z } from "zod";
import type { ColumnDef } from "@tanstack/react-table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api, useAdmin, type State } from "./provider";
import { DataTable } from "./data-table";
import { Heading, NoPermission } from "./common";
import { SchemaForm, passwordSchema } from "./form";
import { navigateAfterAuthChange } from "@/lib/auth-navigation";
import { ApiTokens } from "./api-tokens";
import type { DownloadSettings } from "@/lib/download-settings";
import { MINECRAFT_SOURCES, JAVA_SOURCES } from "@/lib/download-sources";
import { PackageFormatSettingsCard } from "./package-format-settings";
import { UploadSizeSettingsCard } from "./upload-size-settings";
import { UnionSyncSettings } from "./union-sync-settings";
export function AuditPage() {
  const { t, formatDate } = useI18n();
  const { state } = useAdmin();
  if (!state.actor.isSuperAdmin) return <NoPermission />;
  const columns: ColumnDef<State["events"][number]>[] = [
    { accessorKey: "createdAt", header: t("system.time"), cell: ({ row }) => <span className="whitespace-nowrap text-xs">{formatDate(row.original.createdAt)}</span> },
    { id: "actor", header: t("system.actor"), accessorFn: event => event.actor.displayName },
    { accessorKey: "action", header: t("system.action"), cell: ({ getValue }) => <code className="text-xs">{String(getValue())}</code> },
    { accessorKey: "targetType", header: t("system.objectType") },
    { accessorKey: "targetId", header: t("system.objectId"), cell: ({ getValue }) => <code className="text-xs">{String(getValue())}</code> },
    { id: "scope", header: t("system.scope"), accessorFn: event => event.serverId || event.organizationId || t("system.global") },
  ];
  return <><Heading title="navigation.auditLog" description={t("system.latest50ActionsNewestFirstAuditRecordsAreRead")} /><DataTable data={state.events} columns={columns} searchPlaceholder={t("system.searchActionsObjectsOrActors")} /></>;
}
export function SettingsPage() {
  const { t } = useI18n();
  const { state, busy, run } = useAdmin();
  return <><Heading title="navigation.settings" description={t("system.accountSecurityAndPlatformIntegrations")} /><div className="space-y-6"><div className="grid items-stretch gap-6 xl:grid-cols-2">
    <Card><CardHeader><CardTitle>{t("system.accountSecurity")}</CardTitle><CardDescription>{state.actor.displayName} {" " + t("system.changingYourPasswordRevokesAllSessionsSignInAgain")}</CardDescription></CardHeader><CardContent><SchemaForm schema={z.object({ currentPassword: z.string().min(1, t("system.enterYourCurrentPassword")).max(128), newPassword: passwordSchema })} fields={[{ name: "currentPassword", label: t("system.currentPassword"), type: "password", autoComplete: "current-password" }, { name: "newPassword", label: t("system.newPassword"), type: "password", autoComplete: "new-password" }]} defaults={{ currentPassword: "", newPassword: "" }} disabled={busy} label={t("system.changePasswordAndSignOut")}
      onSubmit={values => run(async () => { await api("/api/auth/password", "POST", values); navigateAfterAuthChange("/login"); }, "", false)} /></CardContent></Card>
    <Card><CardHeader><CardTitle>{t("system.platformIntegrations")}</CardTitle><CardDescription>{t("system.allowlistedSignInApplicationLayerRbacAndPostgresqlRls")}</CardDescription></CardHeader><CardContent className="space-y-4 text-sm">{[[t("system.authentication"), t("system.localAllowlistEnabled")], [t("system.skinSiteSignIn"), t("system.skinSiteIdentityMemberSignIn")], [t("system.dataProtection"), t("system.integratedApplicationLayerRbacRetained")], [t("system.objectStorage"), t("system.objectStorageAdaptersIntegrated")], [t("navigation.taskProcessing"), t("system.independentWorkerPersistentPostgresqlTasks")]].map(([label, value]) => <div key={label} className="flex justify-between gap-4 border-b pb-3 last:border-0"><span className="text-muted-foreground">{label}</span><span className="text-right">{value}</span></div>)}</CardContent></Card>
  </div><div className="grid items-stretch gap-6 xl:grid-cols-2">
    <ApiTokens />
    {state.actor.isSuperAdmin && <RecycleSettings />}
  </div>
    {state.actor.isSuperAdmin && <DownloadSettingsCards />}
    {state.actor.isSuperAdmin && <UnionSyncSettings />}
  </div></>;
}
function DownloadSettingsCards() {
  const { t } = useI18n();
  const { busy, run } = useAdmin(); const [settings, setSettings] = useState<DownloadSettings | null>(null), [error, setError] = useState("");
  useEffect(() => { let active = true; void api<DownloadSettings>("/api/admin/download-settings").then(value => { if (active) setSettings(value); }).catch(error => { if (active) setError(error instanceof Error ? serializeError(error) : t("system.couldNotReadDownloadSettings")); }); return () => { active = false; }; }, [t]);
  const status = error ? <p role="alert" className="text-sm text-destructive">{formatMessage(t, error)}</p> : <p role="status" className="text-sm text-muted-foreground">{t("system.readingDownloadSettings")}</p>;
  return <div className="grid items-stretch gap-6 xl:grid-cols-2"><Card className="min-w-0"><CardHeader><CardTitle>{t("system.workerDownloadSources")}</CardTitle><CardDescription>{t("system.tryTheSelectedRegionalMirrorsBeforeFallingBackTo")}</CardDescription></CardHeader><CardContent className="space-y-5">
    {!settings ? status : <SchemaForm key={JSON.stringify([settings.remoteSourceWhitelistEnabled, settings.remoteSourceHosts, settings.minecraftDownloadSources, settings.javaDownloadSources, settings.javaImageType])}
      schema={z.object({ whitelist: z.boolean(), hosts: z.string().max(30000),
        mirrors: z.array(z.enum(["bmclapi", "ustc", "nju"])), javaMirrors: z.array(z.enum(["tuna"])), javaType: z.enum(["jre", "jdk"]) })}
      fields={[{ name: "mirrors", label: t("system.minecraftAndLoaderDownloadSources"), type: "roles", options: MINECRAFT_SOURCES.map(source => ({ value: source.value, label: source.label })),
        hint: t("system.trySelectedBmclapiUstcNjuSourcesThenOfficialSources") },
        { name: "javaMirrors", label: t("system.javaDownloadSources"), type: "roles", options: JAVA_SOURCES.map(source => ({ value: source.value, label: source.label })), hint: t("system.javaArchivesUseTsinghuaFirstFallingBackToOfficial") },
        { name: "javaType", label: t("system.bundledJavaEnvironment"), type: "select", options: [{ value: "jre", label: t("system.jreDefaultRunsTheGame") }, { value: "jdk", label: t("system.jdkForClientsRequiringDevelopmentTools") }], hint: t("system.someJavaPlatformCombinationsHaveNoJreSuchAs") },
        { name: "whitelist", label: t("system.enableRemotePackSourceAllowlist"), type: "checkbox", hint: t("system.appliesToRemotePackFilesNotBuiltInEnvironment") },
        { name: "hosts", label: t("system.allowedRemoteSources"), type: "textarea", hint: t("system.oneCompleteDomainPerLineNoSchemePathOr") },
        ]}
      defaults={{ whitelist: settings.remoteSourceWhitelistEnabled, hosts: settings.remoteSourceHosts.join("\n"),
        mirrors: settings.minecraftDownloadSources, javaMirrors: settings.javaDownloadSources, javaType: settings.javaImageType }} disabled={busy} label={t("system.saveDownloadSettings")}
      onSubmit={values => run(async () => { const next = await api<DownloadSettings>("/api/admin/download-settings", "PATCH", { ...settings, remoteSourceWhitelistEnabled: values.whitelist,
        remoteSourceHosts: String(values.hosts).split(/[\s,]+/).filter(Boolean),
        minecraftDownloadSources: MINECRAFT_SOURCES.filter(source => Array.isArray(values.mirrors) && values.mirrors.includes(source.value)).map(source => source.value),
        javaDownloadSources: values.javaMirrors, javaImageType: values.javaType }); setSettings(next); }, t("system.downloadSettingsSaved"))} />}
    <div className="space-y-1 border-t pt-4 text-xs text-muted-foreground"><p>{t("system.environmentMirrorSources")}</p>{[...MINECRAFT_SOURCES, ...JAVA_SOURCES].map(source => <p key={source.value}><a className="underline" href={"documentation" in source ? source.documentation : source.url + "/"} target="_blank" rel="noreferrer">{t(source.label)}</a> · {source.url}</p>)}</div>
  </CardContent></Card><div className="grid min-w-0 grid-rows-[auto_auto_1fr] gap-6">
    <Card><CardHeader><CardTitle>{t("system.workerProxySettings")}</CardTitle><CardDescription>{t("system.configureTheDownloadProxyForOfficialEnvironmentsAndRemote")}</CardDescription></CardHeader><CardContent>
      {!settings ? status : <SchemaForm key={JSON.stringify([settings.downloadProxyEnabled, settings.downloadProxyUrl, settings.mirrorProxyEnabled])}
        schema={z.object({ proxy: z.boolean(), proxyUrl: z.string().trim().max(2000), mirrorProxy: z.boolean() }).refine(values => !values.proxy || !!values.proxyUrl, { message: t("system.enterAnAddressWhenEnablingTheProxy"), path: ["proxyUrl"] })}
        fields={[
          { name: "proxy", label: t("system.useAProxyForOfficialEnvironmentsAndRemotePack"), type: "checkbox" },
          { name: "proxyUrl", label: t("system.httpHttpsProxyAddress"), placeholder: "http://127.0.0.1:7890", hint: t("system.supportsConnectProxiesWithoutCredentialsAppliesToOfficialEnvironment") },
          { name: "mirrorProxy", label: t("system.alsoProxyMirrorDownloads"), type: "checkbox", hint: t("system.disabledByDefaultMirrorsAndTheirCdnsConnectDirectly") },
        ]}
        defaults={{ proxy: settings.downloadProxyEnabled, proxyUrl: settings.downloadProxyUrl, mirrorProxy: settings.mirrorProxyEnabled }} disabled={busy} label={t("system.saveProxySettings")}
        onSubmit={values => run(async () => { const next = await api<DownloadSettings>("/api/admin/download-settings", "PATCH", { ...settings,
          downloadProxyEnabled: values.proxy, downloadProxyUrl: values.proxyUrl, mirrorProxyEnabled: values.mirrorProxy }); setSettings(next); }, t("system.proxySettingsSaved"))} />}
    </CardContent></Card>
    <UploadSizeSettingsCard />
    <PackageFormatSettingsCard />
  </div></div>;
}
function RecycleSettings() {
  const { t } = useI18n();
  const { busy, run } = useAdmin(); const [days, setDays] = useState<number | null>(null); const [error, setError] = useState("");
  useEffect(() => { let active = true; void api<{ recycleRetentionDays: number }>("/api/admin/recycle-settings").then(data => { if (active) setDays(data.recycleRetentionDays); }).catch(error => { if (active) setError(error instanceof Error ? serializeError(error) : t("system.couldNotReadRecycleBinSettings")); }); return () => { active = false; }; }, [t]);
  return <Card><CardHeader><CardTitle>{t("system.ossRecycleBin")}</CardTitle><CardDescription>{t("system.onlyMuaSuperadminsCanChangeThisDefaultRetentionIs")}</CardDescription></CardHeader><CardContent>{error ? <p role="alert" className="text-sm text-destructive">{formatMessage(t, error)}</p> : days === null ? <p role="status" className="text-sm text-muted-foreground">{t("system.readingRecycleBinSettings")}</p> : <SchemaForm key={days} schema={z.object({ days: z.string().regex(/^\d+$/, t("system.enterAnIntegerNumberOfDays")).refine(value => Number(value) >= 1 && Number(value) <= 365, t("system.retentionMustBe1365Days")) })} fields={[{ name: "days", label: t("system.fileRetentionDays"), type: "number", hint: t("system.reducingRetentionPermanentlyRemovesExpiredFilesOnTheNext") }]} defaults={{ days: String(days) }} disabled={busy} label={t("system.saveRecycleBinSettings")} onSubmit={values => run(async () => { const next = await api<{ recycleRetentionDays: number }>("/api/admin/recycle-settings", "PATCH", { recycleRetentionDays: Number(values.days) }); setDays(next.recycleRetentionDays); }, t("system.recycleBinSettingsSaved"))} />}</CardContent></Card>;
}
