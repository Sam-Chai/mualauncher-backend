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
  return <Card><CardHeader><CardTitle>{t("开放的 muapack 格式")}</CardTitle>
    <CardDescription>{t("控制添加和更新客户端时可选择的格式。默认全部开放，至少保留一种；已创建的任务与历史发布继续可用。")}</CardDescription>
  </CardHeader><CardContent><SchemaForm key={state.enabledPackageFormats.join(",")}
    schema={z.object({ formats: z.array(z.enum(["1", "2"])).min(1, t("至少开放一种 muapack 格式")) })}
    fields={[{ name: "formats", label: t("允许上传的格式"), type: "roles", options: [{ value: "1", label: t("v1 · 完整环境包") }, { value: "2", label: t("v2 · 轻量配方包") }] }]}
    defaults={{ formats: state.enabledPackageFormats.map(String) }} disabled={busy} label={t("保存开放格式")}
    onSubmit={values => run(() => api("/api/admin/package-format-settings", "PATCH", { enabledPackageFormats: (values.formats as string[]).map(Number) }), t("开放格式已保存"))} />
  </CardContent></Card>;
}
