"use client";
import { useI18n } from "@/components/preferences";

export function AccountIdentity({ username, unionSubject }: { username?: string | null; unionSubject?: string | null }) {
  const { t } = useI18n();
  return <div className="space-y-0.5 text-xs text-muted-foreground">
    {unionSubject && <p>Union · <code>{unionSubject}</code></p>}
    {username && <p>@{username}</p>}
    {!unionSubject && !username && <p>{t("accountIdentity.noSignInIdentityConfigured")}</p>}
  </div>;
}
