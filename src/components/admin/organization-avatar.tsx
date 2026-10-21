"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useI18n } from "@/components/preferences";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, useAdmin, type Organization } from "./provider";
import { MottoCropGrid } from "./server-motto";
import { avatarCrop, organizationAvatarUrl, MAX_AVATAR_BYTES, type avatarMetadataSchema } from "@/lib/organization-avatar-contract";
import type { MottoCrop } from "@/lib/server-motto-contract";
import type { z } from "zod";
type Source = { url: string; width: number; height: number; file?: File };
export function OrganizationAvatarField({ organization }: { organization: Organization }) {
  const { t } = useI18n(), { busy, run } = useAdmin();
  const [open, setOpen] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState("");
  const [source, setSource] = useState<Source | null>(null), [crop, setCrop] = useState<MottoCrop | null>(null);
  const revision = useRef(0), input = useRef<HTMLInputElement>(null);
  const endpoint = `/api/admin/organizations/${organization.id}/avatar-image`, image = organizationAvatarUrl(organization.avatarObjectKey, organization.id);
  const metadataEndpoint = `${image ?? `${endpoint}?version=none`}&variant=metadata`;
  useEffect(() => () => { if (source?.url.startsWith("blob:")) URL.revokeObjectURL(source.url); }, [source?.url]);
  async function start(recrop: boolean) {
    setOpen(true); setLoading(true); setError(""); setSource(null); setCrop(null);
    try {
      const info = await api<z.infer<typeof avatarMetadataSchema>>(metadataEndpoint); revision.current = info.revision;
      if (recrop && info.metadata) {
        const response = await fetch(endpoint + "?variant=source", { cache: "no-store" }); if (!response.ok) throw new Error(t("无法读取原图"));
        setSource({ url: URL.createObjectURL(await response.blob()), width: info.metadata.width, height: info.metadata.height }); setCrop(info.metadata.crop);
      }
    } catch (e) { setError(e instanceof Error ? e.message : t("无法读取图片")); } finally { setLoading(false); }
  }
  async function choose(file?: File) {
    if (!file) return; setError(""); let url: string | undefined;
    try {
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error(t("请选择静态 PNG、JPEG 或 WebP 图片。"));
      if (file.size > MAX_AVATAR_BYTES) throw new Error(t("图片不能超过 8 MiB。"));
      url = URL.createObjectURL(file); const img = new window.Image(); img.src = url; await img.decode();
      if (img.naturalWidth * img.naturalHeight > 16_000_000) throw new Error(t("图片像素总量过大，请缩小图片后重试。"));
      setSource({ url, file, width: img.naturalWidth, height: img.naturalHeight }); setCrop(avatarCrop(img.naturalWidth, img.naturalHeight)); url = undefined;
    } catch (e) { setError(e instanceof Error ? e.message : t("无法读取图片")); } finally { if (url) URL.revokeObjectURL(url); }
  }
  return <section className="space-y-3" aria-label={t("组织头像")}>
    <div><h3 className="text-sm font-medium">{t("组织头像")}</h3><p className="text-xs text-muted-foreground">{t("头像保存为 512×512 正方形；保留原图以便重新裁剪。手动修改后不会被网站图标同步覆盖。")}</p></div>
    <div className="relative size-28 overflow-hidden rounded-lg border bg-muted">{image ? <Image unoptimized src={image} alt={organization.displayName} fill sizes="112px" className="object-cover" /> : <span className="flex size-full items-center justify-center text-sm text-muted-foreground">{t("未上传头像")}</span>}</div>
    <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" disabled={busy || loading} onClick={() => void start(false)}>{t("上传头像")}</Button>
      {image && <><Button type="button" size="sm" variant="outline" disabled={busy || loading} onClick={() => void start(true)}>{t("重新裁剪")}</Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy || loading} onClick={() => void run(async () => { const info = await api<z.infer<typeof avatarMetadataSchema>>(metadataEndpoint); await api(endpoint, "DELETE", { expectedRevision: info.revision }); }, t("组织头像已移除"))}>{t("移除图片")}</Button></>}
    </div>
    <Dialog open={open} onOpenChange={v => { if (!busy && !loading) setOpen(v); }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl"><DialogHeader><DialogTitle>{t("编辑组织头像")}</DialogTitle><DialogDescription>{t("固定 1:1 选区；拖动网格、调整滑杆或使用方向键移动。")}</DialogDescription></DialogHeader>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label={t("选择组织头像图片")} disabled={busy || loading} onChange={event => { void choose(event.target.files?.[0]); event.target.value = ""; }} />
      <Button type="button" variant="outline" disabled={busy || loading} onClick={() => input.current?.click()}>{source ? t("更换原图") : t("选择图片")}</Button>
      {loading && <p role="status">{t("正在读取图片…")}</p>}{error && <p role="alert" className="text-sm text-destructive">{t(error)}</p>}
      {source && crop && <><MottoCropGrid source={source} crop={crop} onChange={setCrop} disabled={busy || loading} />
        <label className="text-sm">{t("选区大小")}<input type="range" className="block w-full accent-primary" min={10} max={100} value={Math.round(crop.width / avatarCrop(source.width, source.height).width * 100)} onChange={e => setCrop(avatarCrop(source.width, source.height, Number(e.target.value) / 100, { x: crop.left + crop.width / 2, y: crop.top + crop.height / 2 }))} disabled={busy || loading} /></label>
        <div className="flex justify-between gap-2"><Button type="button" variant="ghost" disabled={busy} onClick={() => setCrop(avatarCrop(source.width, source.height))}>{t("重置选区")}</Button>
          <Button type="button" disabled={busy || loading} onClick={() => void run(async () => { const body = new FormData(); if (source.file) body.append("source", source.file); body.append("crop", JSON.stringify(crop)); body.append("expectedRevision", String(revision.current));
            const response = await fetch(endpoint, { method: "POST", body }); const result = await response.json(); if (!response.ok) throw new Error(result.error ?? t("图片上传失败")); setOpen(false); }, t("组织头像已保存"))}>{t("上传并保存")}</Button></div>
      </>}
    </DialogContent></Dialog>
  </section>;
}
