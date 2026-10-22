"use client";
import { serializeError } from "@/lib/diagnostics";
import { formatMessage } from "@/lib/diagnostics";

import { useState } from "react";
import { useI18n } from "@/components/preferences";
import { Button } from "@/components/ui/button";
import { api } from "@/components/admin/provider";
export function LauncherConfirm({ id, name }: { id: string; name: string }) {
  const { t } = useI18n(); const [done, setDone] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  return <main className="mx-auto max-w-lg space-y-5 p-8"><h1 className="text-xl font-semibold">{t("launcherConfirm.confirmLauncherSignIn")}</h1><p>{name}</p><p>{t("launcherConfirm.confirmOnlyIfYouJustStartedSignInFrom")}</p>{error && <p role="alert">{formatMessage(t, error)}</p>}{done ? <p>{t("launcherConfirm.signInConfirmedReturnToYourLauncher")}</p> : <Button disabled={busy} onClick={async () => { setBusy(true); try { await api("/api/auth/launcher/approve", "POST", { id }); setDone(true); } catch(e){setError(e instanceof Error?serializeError(e):"clientShared.requestFailed");}finally{setBusy(false);} }}>{t("launcherConfirm.confirmSignIn")}</Button>}</main>;
}
