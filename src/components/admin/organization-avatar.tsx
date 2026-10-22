"use client";
import { diagnosticText } from "@/lib/diagnostics";
import { serializeError } from "@/lib/diagnostics";
import { formatMessage } from "@/lib/diagnostics";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useI18n } from "@/components/preferences";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, useAdmin, RequestError, type Organization } from "./provider";
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
        const response = await fetch(endpoint + "?variant=source", { cache: "no-store" }); if (!response.ok) throw new Error(diagnosticText("organizationAvatar.cannotReadOriginalImage"));
        setSource({ url: URL.createObjectURL(await response.blob()), width: info.metadata.width, height: info.metadata.height }); setCrop(info.metadata.crop);
      }
    } catch (e) { setError(e instanceof Error ? serializeError(e) : t("organizationAvatar.cannotReadImage")); } finally { setLoading(false); }
  }
  async function choose(file?: File) {
    if (!file) return; setError(""); let url: string | undefined;
    try {
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error(diagnosticText("organizationAvatar.selectAStaticPngJpegOrWebpImage"));
      if (file.size > MAX_AVATAR_BYTES) throw new Error(diagnosticText("organizationAvatar.imageMustNotExceed8Mib"));
      url = URL.createObjectURL(file); const img = new window.Image(); img.src = url; await img.decode();
      if (img.naturalWidth * img.naturalHeight > 16_000_000) throw new Error(diagnosticText("organizationAvatar.tooManyImagePixelsResizeTheImageAndRetry"));
      setSource({ url, file, width: img.naturalWidth, height: img.naturalHeight }); setCrop(avatarCrop(img.naturalWidth, img.naturalHeight)); url = undefined;
    } catch (e) { setError(e instanceof Error ? serializeError(e) : t("organizationAvatar.cannotReadImage")); } finally { if (url) URL.revokeObjectURL(url); }
  }
  return <section className="space-y-3" aria-label={t("organizationAvatar.organizationAvatar")}>
    <div><h3 className="text-sm font-medium">{t("organizationAvatar.organizationAvatar")}</h3><p className="text-xs text-muted-foreground">{t("organizationAvatar.avatarsAreSavedAs512X512SquaresOriginal")}</p></div>
    <div className="relative size-28 overflow-hidden rounded-lg border bg-muted">{image ? <Image unoptimized src={image} alt={organization.displayName} fill sizes="112px" className="object-cover" /> : <span className="flex size-full items-center justify-center text-sm text-muted-foreground">{t("organizationAvatar.noAvatarUploaded")}</span>}</div>
    <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" disabled={busy || loading} onClick={() => void start(false)}>{t("organizationAvatar.uploadAvatar")}</Button>
      {image && <><Button type="button" size="sm" variant="outline" disabled={busy || loading} onClick={() => void start(true)}>{t("organizationAvatar.cropAgain")}</Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy || loading} onClick={() => void run(async () => { const info = await api<z.infer<typeof avatarMetadataSchema>>(metadataEndpoint); await api(endpoint, "DELETE", { expectedRevision: info.revision }); }, t("organizationAvatar.organizationAvatarRemoved"))}>{t("organizationAvatar.removeImage")}</Button></>}
    </div>
    <Dialog open={open} onOpenChange={v => { if (!busy && !loading) setOpen(v); }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl"><DialogHeader><DialogTitle>{t("organizationAvatar.editOrganizationAvatar")}</DialogTitle><DialogDescription>{t("organizationAvatar.useASquareCropDragTheGridAdjustThe")}</DialogDescription></DialogHeader>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label={t("organizationAvatar.chooseOrganizationAvatarImage")} disabled={busy || loading} onChange={event => { void choose(event.target.files?.[0]); event.target.value = ""; }} />
      <Button type="button" variant="outline" disabled={busy || loading} onClick={() => input.current?.click()}>{source ? t("organizationAvatar.replaceOriginalImage") : t("organizationAvatar.selectImage")}</Button>
      {loading && <p role="status">{t("organizationAvatar.readingImage")}</p>}{error && <p role="alert" className="text-sm text-destructive">{formatMessage(t, error)}</p>}
      {source && crop && <><MottoCropGrid source={source} crop={crop} onChange={setCrop} disabled={busy || loading} />
        <label className="text-sm">{t("organizationAvatar.selectionSize")}<input type="range" className="block w-full accent-primary" min={10} max={100} value={Math.round(crop.width / avatarCrop(source.width, source.height).width * 100)} onChange={e => setCrop(avatarCrop(source.width, source.height, Number(e.target.value) / 100, { x: crop.left + crop.width / 2, y: crop.top + crop.height / 2 }))} disabled={busy || loading} /></label>
        <div className="flex justify-between gap-2"><Button type="button" variant="ghost" disabled={busy} onClick={() => setCrop(avatarCrop(source.width, source.height))}>{t("organizationAvatar.resetSelection")}</Button>
          <Button type="button" disabled={busy || loading} onClick={() => void run(async () => { const body = new FormData(); if (source.file) body.append("source", source.file); body.append("crop", JSON.stringify(crop)); body.append("expectedRevision", String(revision.current));
            const response = await fetch(endpoint, { method: "POST", body }); const result = await response.json(); if (!response.ok) throw new RequestError(result.error ?? "Image upload failed", response.status, result); setOpen(false); }, t("organizationAvatar.organizationAvatarSaved"))}>{t("organizationAvatar.uploadAndSave")}</Button></div>
      </>}
    </DialogContent></Dialog>
  </section>;
}
