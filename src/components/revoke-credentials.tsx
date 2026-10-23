"use client";
import { useState } from "react";
import { useI18n } from "./preferences";
import { Button } from "./ui/button";
import { Alert, AlertDescription } from "./ui/alert";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "./ui/alert-dialog";
import { api } from "./admin/provider";
import { navigateAfterAuthChange } from "@/lib/auth-navigation";
import { formatMessage, serializeError } from "@/lib/diagnostics";

export function RevokeCredentials({ account, self = true }: { account?: { id: string; displayName: string }; self?: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  return <AlertDialog open={open} onOpenChange={setOpen}><AlertDialogTrigger asChild><Button variant="outline" size="sm">{t("credentials.revoke")}</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t("credentials.confirm", { name: account?.displayName ?? t("credentials.yourAccount") })}</AlertDialogTitle><AlertDialogDescription>{t("credentials.description")}</AlertDialogDescription></AlertDialogHeader>
    {error && <Alert variant="destructive"><AlertDescription>{formatMessage(t, error)}</AlertDescription></Alert>}
    <AlertDialogFooter><AlertDialogCancel disabled={busy}>{t("common.actions.cancel")}</AlertDialogCancel><Button variant="destructive" disabled={busy} onClick={async () => {
      setBusy(true); setError("");
      try { await api(account ? `/api/admin/accounts/${account.id}/revoke-credentials` : "/api/auth/revoke-credentials", "POST", {}); if (self) navigateAfterAuthChange("/login"); else setOpen(false); }
      catch (e) { setError(e instanceof Error ? serializeError(e) : "clientShared.requestFailed"); }
      finally { setBusy(false); }
    }}>{t("credentials.revoke")}</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>;
}
