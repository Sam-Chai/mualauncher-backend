"use client";
import { useI18n } from "@/components/preferences";
import { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SchemaForm } from "./form";
import { api, useAdmin } from "./provider";

export function PackageFormatSettingsCard() {
  const { t } = useI18n();
  const { state, busy, run } = useAdmin();
  if (!state.actor.isSuperAdmin) return null;
  return <Card><CardHeader><CardTitle>{t("packageFormatSettings.enabledMuapackFormats")}</CardTitle>
    <CardDescription>{t("packageFormatSettings.chooseFormatsAvailableForNewClientsAndUpdatesBoth")}</CardDescription>
  </CardHeader><CardContent><SchemaForm key={state.enabledPackageFormats.join(",")}
    schema={z.object({ formats: z.array(z.enum(["1", "2"])).min(1, t("packageFormatSettings.enableAtLeastOneMuapackFormat")) })}
    fields={[{ name: "formats", label: t("packageFormatSettings.allowedUploadFormats"), type: "roles", options: [{ value: "1", label: t("packageFormatChoice.v1FullEnvironmentPackage") }, { value: "2", label: t("packageFormatChoice.v2LightweightRecipe") }] }]}
    defaults={{ formats: state.enabledPackageFormats.map(String) }} disabled={busy} label={t("packageFormatSettings.saveEnabledFormats")}
    onSubmit={values => run(() => api("/api/admin/package-format-settings", "PATCH", { enabledPackageFormats: (values.formats as string[]).map(Number) }), t("packageFormatSettings.enabledFormatsSaved"))} />
  </CardContent></Card>;
}
