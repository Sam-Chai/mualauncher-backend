"use client";
import { useI18n } from "@/components/preferences";
import { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MAX_UPLOAD_SIZE_MB } from "@/lib/upload-size-policy";
import { SchemaForm } from "./form";
import { api, useAdmin } from "./provider";

export function UploadSizeSettingsCard() {
  const { t } = useI18n();
  const { state, busy, run } = useAdmin();
  if (!state.actor.isSuperAdmin) return null;
  return <Card><CardHeader><CardTitle>{t("uploadSizeSettings.muapackUploadSize")}</CardTitle>
    <CardDescription>{t("uploadSizeSettings.onlyMuaSuperadminsCanManageThisLimitsCompleteSource")}</CardDescription>
  </CardHeader><CardContent><SchemaForm key={state.maxUploadSizeMb}
    schema={z.object({ maxUploadSizeMb: z.string().regex(/^\d+$/, t("uploadSizeSettings.enterAnIntegerNumberOfMb")).refine(value => Number(value) >= 1 && Number(value) <= MAX_UPLOAD_SIZE_MB, t("uploadSizeSettings.placeholder", { "maxMb": MAX_UPLOAD_SIZE_MB })) })}
    fields={[{ name: "maxUploadSizeMb", label: t("uploadSizeSettings.maximumMuapackUploadSizeMb"), type: "number", hint: t("uploadSizeSettings.rangeHint", { "maxMb": MAX_UPLOAD_SIZE_MB }) }]}
    defaults={{ maxUploadSizeMb: String(state.maxUploadSizeMb) }} disabled={busy} label={t("uploadSizeSettings.saveUploadSize")}
    onSubmit={values => run(() => api("/api/admin/upload-size-settings", "PATCH", { maxUploadSizeMb: Number(values.maxUploadSizeMb) }), t("uploadSizeSettings.maximumUploadSizeSaved"))} />
  </CardContent></Card>;
}
