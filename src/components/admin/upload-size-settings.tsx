"use client";
import { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MAX_UPLOAD_SIZE_MB } from "@/lib/upload-size-policy";
import { SchemaForm } from "./form";
import { api, useAdmin } from "./provider";

export function UploadSizeSettingsCard() {
  const { state, busy, run } = useAdmin();
  if (!state.actor.isSuperAdmin) return null;
  return <Card><CardHeader><CardTitle>muapack 上传大小</CardTitle>
    <CardDescription>仅 MUA 超管可管理。限制制作 v1／v2 muapack 时上传的完整源包大小；已创建的上传和历史版本不受调整影响。</CardDescription>
  </CardHeader><CardContent><SchemaForm key={state.maxUploadSizeMb}
    schema={z.object({ maxUploadSizeMb: z.string().regex(/^\d+$/, "请输入整数 MB").refine(value => Number(value) >= 1 && Number(value) <= MAX_UPLOAD_SIZE_MB, `请输入 1–${MAX_UPLOAD_SIZE_MB} MB`) })}
    fields={[{ name: "maxUploadSizeMb", label: "允许最大上传 muapack 的文件大小（MB）", type: "number", hint: `默认 1024 MB（1 GB）。可设置 1–${MAX_UPLOAD_SIZE_MB} MB，1 MB = 1024 × 1024 字节。` }]}
    defaults={{ maxUploadSizeMb: String(state.maxUploadSizeMb) }} disabled={busy} label="保存上传大小"
    onSubmit={values => run(() => api("/api/admin/upload-size-settings", "PATCH", { maxUploadSizeMb: Number(values.maxUploadSizeMb) }), "最大上传大小已保存")} />
  </CardContent></Card>;
}
