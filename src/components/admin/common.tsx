"use client";
import type { ReactNode } from "react";
import { useI18n } from "@/components/preferences";
import { ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
export function Heading({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  const { t } = useI18n();
  return <div className="flex flex-wrap items-start justify-between gap-4"><div className="space-y-2"><h1 className="text-2xl font-semibold tracking-tight">{t(title)}</h1><p className="text-sm text-muted-foreground">{t(description)}</p></div>{action}</div>;
}
export function Status({ archived, active = "common.active" }: { archived?: unknown; active?: string }) {
  const { t } = useI18n();
  return <Badge variant={archived ? "secondary" : "outline"} className="whitespace-nowrap">{archived ? t("clients.archived") : t(active)}</Badge>;
}

export function NoPermission() {
  const { t } = useI18n();
  return <Card><CardHeader><ShieldAlert className="size-8 text-muted-foreground" /><CardTitle>{t("common.youDoNotHaveAccessToThisModule")}</CardTitle><CardDescription>{t("common.contactAMuaAdministratorToAssignTheAppropriateRole")}</CardDescription></CardHeader></Card>;
}
