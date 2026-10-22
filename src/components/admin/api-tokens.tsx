"use client";
import { serializeError } from "@/lib/diagnostics";
import { formatMessage } from "@/lib/diagnostics";

import { useI18n } from "@/components/preferences";
import { useEffect, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { EditorDialog, SchemaForm } from "./form";
import { api, useAdmin } from "./provider";
import { rolePermissions, type Permission } from "@/lib/roles";
type TokenRow = { id: string; name: string; expiresAt: string; revokedAt: string | null; serverIds: string[]; permissions: string[] };
const tokenSchema = z.object({ name: z.string().trim().min(1).max(100), serverIds: z.array(z.string()).min(1, "apiTokens.selectAtLeastOneServer"), permissions: z.array(z.string()).min(1), expiresInDays: z.string().regex(/^([1-9]|[1-8][0-9]|90)$/, "apiTokens.validFor190Days") });
export function ApiTokens() {
  const { t, formatDate } = useI18n();
  const { state, busy, run, epoch } = useAdmin(); const [tokens, setTokens] = useState<TokenRow[]>([]); const [secret, setSecret] = useState(""); const [error, setError] = useState("");
  const servers = state.organizations.flatMap(org => org.servers.filter(server => !org.archivedAt && !server.archivedAt && !server.clientArchivedAt).map(server => ({ ...server, organizationName: org.displayName })));
  const permissionOptions = [...new Set(Object.values(rolePermissions).flat())].filter(permission => !permission.startsWith("ORG_") && permission !== "SERVER_EDIT" && servers.some(server => server.permissions.includes(permission as Permission)));
  useEffect(() => { let active = true; void api<TokenRow[]>("/api/admin/tokens").then(rows => { if (active) { setTokens(rows); setError(""); } }).catch(error => { if (active) setError(error instanceof Error ? serializeError(error) : t("apiTokens.couldNotReadTokens")); }); return () => { active = false; }; }, [epoch, t]);
  return <Card className="min-w-0"><CardHeader><CardTitle>{t("apiTokens.apiTokensAutomation")}</CardTitle><CardDescription>{t("apiTokens.githubActionsAndManualUploadsUseTheSameClient")}</CardDescription></CardHeader><CardContent className="space-y-5">
    {servers.length > 0 && <EditorDialog title={t("apiTokens.createApiToken")} description={t("apiTokens.tokensLastUpTo90DaysAndAreShown")}>{close => <SchemaForm schema={tokenSchema} fields={[
      { name: "name", label: t("apiTokens.name"), placeholder: "GitHub Actions · NPU" }, { name: "serverIds", label: t("apiTokens.serverScope"), type: "roles", options: servers.map(server => ({ value: server.serverId, label: `${server.organizationName} / ${server.displayName}` })) },
      { name: "permissions", label: t("apiTokens.permissionScope"), type: "roles", options: permissionOptions.map(permission => ({ value: permission, label: permission })), hint: t("apiTokens.uploadsTypicallyRequireServerReadDraftReadDraftCreate") }, { name: "expiresInDays", label: t("apiTokens.validityDays"), type: "number" },
    ]} defaults={{ name: "", serverIds: [], permissions: ["SERVER_READ", "DRAFT_READ", "DRAFT_CREATE", "DRAFT_EDIT", "DRAFT_SUBMIT"].filter(permission => permissionOptions.includes(permission as Permission)), expiresInDays: "30" }} disabled={busy} label={t("apiTokens.createToken")}
      onSubmit={async values => { const ok = await run(async () => { const result = await api<{ token: string }>("/api/admin/tokens", "POST", { ...values, expiresInDays: Number(values.expiresInDays) }); setSecret(result.token); }, t("apiTokens.tokenCreated")); if (ok) close(); return ok; }} />}</EditorDialog>}
    {error && <Alert variant="destructive"><AlertDescription>{formatMessage(t, error)}</AlertDescription></Alert>}
    {secret && <Alert><AlertDescription className="w-full space-y-3"><p>{t("apiTokens.saveThisTokenItCannotBeViewedAgainAfter")}</p><Input readOnly value={secret} aria-label={t("apiTokens.newApiToken")} /><div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => void navigator.clipboard.writeText(secret)}>{t("apiTokens.copy")}</Button><Button variant="ghost" size="sm" onClick={() => setSecret("")}>{t("apiTokens.savedClose")}</Button></div></AlertDescription></Alert>}
    {tokens.map(token => <div key={token.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"><div className="min-w-0 space-y-1 text-sm wrap-anywhere"><p className="font-medium">{token.name} · {token.revokedAt ? t("apiTokens.revoked") : new Date(token.expiresAt) <= new Date() ? t("apiTokens.expired") : t("apiTokens.enabled")}</p><p className="text-xs text-muted-foreground">{token.serverIds.join(", ")} {" " + t("apiTokens.expires") + " "}{formatDate(token.expiresAt)}</p><p className="text-xs text-muted-foreground">{token.permissions.join(" / ")}</p></div>{!token.revokedAt && <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => api(`/api/admin/tokens/${token.id}/revoke`, "POST", {}), t("apiTokens.tokenRevoked"))}>{t("apiTokens.revoke")}</Button>}</div>)}
    {!tokens.length && <p className="text-sm text-muted-foreground">{t("apiTokens.noApiTokens")}</p>}
  </CardContent></Card>;
}
