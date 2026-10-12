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
  return <Card><CardHeader><CardTitle>{t("muapack 上传大小")}</CardTitle>
    <CardDescription>{t("仅 MUA 超管可管理。限制制作 v1／v2 muapack 时上传的完整源包大小；已创建的上传和历史版本不受调整影响。")}</CardDescription>
  </CardHeader><CardContent><SchemaForm key={state.maxUploadSizeMb}
    schema={z.object({ maxUploadSizeMb: z.string().regex(/^\d+$/, t("请输入整数 MB")).refine(value => Number(value) >= 1 && Number(value) <= MAX_UPLOAD_SIZE_MB, t("请输入 1–{0} MB", { "0": MAX_UPLOAD_SIZE_MB })) })}
    fields={[{ name: "maxUploadSizeMb", label: t("允许最大上传 muapack 的文件大小（MB）"), type: "number", hint: t("默认 1024 MB（1 GB）。可设置 1–{0} MB，1 MB = 1024 × 1024 字节。", { "0": MAX_UPLOAD_SIZE_MB }) }]}
    defaults={{ maxUploadSizeMb: String(state.maxUploadSizeMb) }} disabled={busy} label={t("保存上传大小")}
    onSubmit={values => run(() => api("/api/admin/upload-size-settings", "PATCH", { maxUploadSizeMb: Number(values.maxUploadSizeMb) }), t("最大上传大小已保存"))} />
  </CardContent></Card>;
}
