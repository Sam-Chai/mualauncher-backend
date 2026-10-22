"use client";
import { serializeError } from "@/lib/diagnostics";
import { formatMessage } from "@/lib/diagnostics";

import { useI18n } from "@/components/preferences";
import { PreferenceControls } from "@/components/preferences";
import { useId, useState } from "react";
import { ChevronDown, Hexagon, LogIn, ShieldCheck } from "lucide-react";
import { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { SchemaForm } from "@/components/admin/form";
import { api } from "@/components/admin/provider";
import { navigateAfterAuthChange } from "@/lib/auth-navigation";
import { PROJECT_NAME } from "@/lib/branding";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/components/use-hydrated";
const schema = z.object({ username: z.string().trim().min(3, "loginForm.enterYourUsername").max(64), password: z.string().min(1, "loginForm.enterYourPassword").max(128) });
export default function LoginForm({ unionEnabled = false, unionError = false, returnTo }: { unionEnabled?: boolean; unionError?: boolean; returnTo?: string }) {
  const { t } = useI18n();
  const hydrated = useHydrated();
  const passwordFormId = useId();
  const [passwordExpanded, setPasswordExpanded] = useState(false);
  const [error, setError] = useState(unionError ? "loginForm.unionSignInDidNotCompleteTryAgainOr" : "");
  return <div className="w-full max-w-md space-y-6">
    <div className="flex justify-end"><PreferenceControls /></div>
    <div className="flex items-center justify-center gap-3"><div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Hexagon /></div><div><p className="text-lg font-semibold">{PROJECT_NAME}</p><p className="text-xs text-muted-foreground">{t("shell.universityAllianceManagement")}</p></div></div>
    <Card><CardHeader><CardTitle className="text-xl">{t("auth.login.title")}</CardTitle><CardDescription>{t("loginForm.signInToUnionLinkWithYourSkinSite")}</CardDescription></CardHeader><CardContent className="space-y-5">
      {unionEnabled ? <Button size="lg" className="h-14 w-full text-base font-semibold" asChild><a href={`/api/auth/union/start${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`}><LogIn className="size-5" aria-hidden="true" />{t("auth.login.skinSite")}</a></Button> : <>
        <Button size="lg" className="h-14 w-full text-base font-semibold" disabled><LogIn className="size-5" aria-hidden="true" />{t("auth.login.skinSite")}</Button>
        <p className="text-sm text-muted-foreground">{t("loginForm.unionOauthIsNotConfiguredSignInWithYour")}</p>
      </>}
      {error && <Alert variant="destructive" role="alert"><AlertDescription>{formatMessage(t, error)}</AlertDescription></Alert>}
      <div className="border-t pt-4">
        <Button type="button" variant="ghost" size="sm" className="mx-auto flex text-muted-foreground" disabled={!hydrated}
          aria-expanded={passwordExpanded} aria-controls={passwordFormId} onClick={() => setPasswordExpanded(expanded => !expanded)}>
          {t("auth.login.password")}<ChevronDown className={`size-3.5 transition-transform${passwordExpanded ? " rotate-180" : ""}`} aria-hidden="true" />
        </Button>
        <div id={passwordFormId} hidden={!passwordExpanded} className="pt-5"><SchemaForm schema={schema} defaults={{ username: "", password: "" }} label={t("auth.login.submit")} action="/api/auth/login"
        fields={[{ name: "username", label: t("auth.fields.username"), autoComplete: "username", placeholder: "mua-admin" }, { name: "password", label: t("auth.fields.password"), type: "password", autoComplete: "current-password" }]}
        onSubmit={async values => { setError(""); try { await api("/api/auth/login", "POST", values); navigateAfterAuthChange(returnTo ?? "/admin"); return true; } catch (error) { setError(error instanceof Error ? serializeError(error) : t("loginForm.signInFailed")); return false; } }} /></div>
      </div>
    </CardContent></Card><p className="flex items-center justify-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="size-3.5" />{t("loginForm.allowlistedMembersOnlyOrganizationAccessIsolation")}</p>
  </div>;
}
