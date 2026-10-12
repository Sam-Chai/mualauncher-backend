"use client";
import { useEffect, useRef, useState, type PointerEvent, type KeyboardEvent } from "react";
import Image from "next/image";
import { ImagePlus, Crop, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, RequestError, useAdmin, type Server } from "./provider";
import { MAX_MOTTO_UPLOAD_BYTES, MAX_MOTTO_PIXELS, SERVER_MOTTO_RATIO, SERVER_MOTTO_RATIO_LABEL, SERVER_MOTTO_FADE, mottoCrop, type MottoCrop, type MottoMetadata } from "@/lib/server-motto-contract";

export type MottoDraft = { file: File; crop: MottoCrop; width: number; height: number; previewUrl: string };
type Source = { url: string; width: number; height: number; file?: File };

export async function uploadMotto(serverId: string, expectedIconObjectKey: string | null, file: File | undefined, crop: MottoCrop) {
  const form = new FormData();
  if (file) form.append("source", file);
  form.append("crop", JSON.stringify(crop)); form.append("expectedIconObjectKey", JSON.stringify(expectedIconObjectKey));
  const response = await fetch(`/api/admin/servers/${serverId}/motto-image`, { method: "POST", body: form });
  const result = await response.json();
  if (!response.ok) throw new RequestError(result.error ?? "图片上传失败", response.status);
  return result;
}

export function MottoPreview({ src, alt, draft, className = "w-48" }: { src: string | null; alt: string; draft?: MottoDraft | null; className?: string }) {
  return <div className={`relative overflow-hidden rounded-md bg-white ${className}`} style={{ aspectRatio: SERVER_MOTTO_RATIO }}>
    {draft ? <svg className="size-full" viewBox={`${draft.crop.left * draft.width} ${draft.crop.top * draft.height} ${draft.crop.width * draft.width} ${draft.crop.height * draft.height}`} role="img" aria-label={alt}>
      <image href={draft.previewUrl} width={draft.width} height={draft.height} />
    </svg> : src ? <Image unoptimized src={src} alt={alt} width={244} height={92} className="size-full object-cover" />
      : <span className="flex size-full items-center justify-center text-xs text-muted-foreground">未上传箴言</span>}
    {(src || draft) && <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ backgroundImage: SERVER_MOTTO_FADE }} />}
  </div>;
}

export function MottoCropGrid({ source, crop, onChange, disabled = false }: { source: Source; crop: MottoCrop; onChange: (crop: MottoCrop) => void; disabled?: boolean }) {
  const drag = useRef<{ x: number; y: number; crop: MottoCrop } | null>(null);
  const point = (event: PointerEvent<SVGSVGElement>) => {
    const position = event.currentTarget.createSVGPoint(); position.x = event.clientX; position.y = event.clientY;
    const matrix = event.currentTarget.getScreenCTM();
    return matrix ? position.matrixTransform(matrix.inverse()) : { x: 0, y: 0 };
  };
  const move = (left: number, top: number) => onChange({ ...crop, left: Math.max(0, Math.min(1 - crop.width, left)), top: Math.max(0, Math.min(1 - crop.height, top)) });
  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (disabled) return;
    const steps: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (!steps[event.key]) return;
    event.preventDefault(); const [x, y] = steps[event.key], step = event.shiftKey ? 0.02 : 0.005;
    move(crop.left + x * step, crop.top + y * step);
  };
  const x = crop.left * source.width, y = crop.top * source.height, width = crop.width * source.width, height = crop.height * source.height;
  const stroke = Math.max(source.width, source.height) / 400;
  return <svg viewBox={`0 0 ${source.width} ${source.height}`} className="block max-h-[50vh] w-full touch-none cursor-move rounded-md bg-neutral-900 outline-offset-4 focus-visible:outline-2 focus-visible:outline-primary" tabIndex={0} role="application" aria-label="图片裁剪网格，拖动选区或使用方向键移动" onKeyDown={onKeyDown}
    onPointerDown={event => {
      if (disabled || event.button !== 0) return;
      event.currentTarget.setPointerCapture(event.pointerId); const p = point(event);
      const inside = p.x >= x && p.x <= x + width && p.y >= y && p.y <= y + height;
      const selected = inside ? crop : { ...crop, left: Math.max(0, Math.min(1 - crop.width, p.x / source.width - crop.width / 2)), top: Math.max(0, Math.min(1 - crop.height, p.y / source.height - crop.height / 2)) };
      drag.current = { x: p.x, y: p.y, crop: selected }; onChange(selected);
    }} onPointerMove={event => {
      if (disabled || !drag.current) return; const p = point(event), start = drag.current;
      move(start.crop.left + (p.x - start.x) / source.width, start.crop.top + (p.y - start.y) / source.height);
    }} onPointerUp={event => { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
    onPointerCancel={() => { drag.current = null; }}>
    <image href={source.url} width={source.width} height={source.height} />
    <path d={`M0 0H${source.width}V${source.height}H0Z M${x} ${y}V${y + height}H${x + width}V${y}Z`} fill="black" fillOpacity={0.55} fillRule="evenodd" pointerEvents="none" />
    <rect x={x} y={y} width={width} height={height} fill="none" stroke="white" strokeWidth={stroke} pointerEvents="none" />
    {[1, 2].map(index => <g key={index} stroke="white" strokeOpacity={0.65} strokeWidth={stroke / 2} pointerEvents="none">
      <line x1={x + width * index / 3} y1={y} x2={x + width * index / 3} y2={y + height} />
      <line x1={x} y1={y + height * index / 3} x2={x + width} y2={y + height * index / 3} />
    </g>)}
  </svg>;
}

export function ServerMottoField({ server, editable, pending, onPrepare }: { server?: Server; editable: boolean; pending?: MottoDraft | null; onPrepare?: (draft: MottoDraft | null) => void }) {
  const { busy, run } = useAdmin();
  const [open, setOpen] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState("");
  const [source, setSource] = useState<Source | null>(null), [crop, setCrop] = useState<MottoCrop | null>(null);
  const expectedKey = useRef<string | null>(null), input = useRef<HTMLInputElement>(null);
  useEffect(() => () => { if (source?.url.startsWith("blob:")) URL.revokeObjectURL(source.url); }, [source?.url]);
  async function choose(file: File | undefined) {
    if (!file) return;
    setError(""); setLoading(true);
    let url: string | undefined;
    try {
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("请选择静态 PNG、JPEG 或 WebP 图片。");
      if (file.size > MAX_MOTTO_UPLOAD_BYTES) throw new Error("图片不能超过 8 MiB。");
      url = URL.createObjectURL(file);
      const image = new window.Image(); image.src = url; await image.decode();
      if (image.naturalWidth * image.naturalHeight > MAX_MOTTO_PIXELS) throw new Error("图片像素总量过大，请缩小图片后重试。");
      setSource({ url, width: image.naturalWidth, height: image.naturalHeight, file }); setCrop(mottoCrop(image.naturalWidth, image.naturalHeight)); url = undefined;
    } catch (error) { setError(error instanceof Error ? error.message : "无法读取图片"); }
    finally { if (url) URL.revokeObjectURL(url); setLoading(false); }
  }
  async function start(edit: boolean) {
    expectedKey.current = server?.iconObjectKey ?? null;
    setError(""); setSource(null); setCrop(null); setOpen(true);
    if (edit && pending) { setSource({ url: URL.createObjectURL(pending.file), width: pending.width, height: pending.height, file: pending.file }); setCrop(pending.crop); return; }
    if (!edit || !server?.mottoImageUrl) return;
    setLoading(true);
    try {
      const metadata = await api<MottoMetadata>(`${server.mottoImageUrl}&variant=metadata`);
      const response = await fetch(`${server.mottoImageUrl}&variant=source`, { cache: "no-store" });
      if (!response.ok) throw new Error("原图读取失败，请刷新后重试。");
      const url = URL.createObjectURL(await response.blob());
      setSource({ url, width: metadata.width, height: metadata.height }); setCrop(metadata.crop);
    } catch (error) { setError(error instanceof Error ? error.message : "无法读取原图"); }
    finally { setLoading(false); }
  }
  const scale = source && crop ? crop.width / mottoCrop(source.width, source.height).width : 1;
  return <section className="space-y-3" aria-label="服务器箴言">
    <div><h3 className="text-sm font-medium">服务器箴言</h3><p className="text-xs text-muted-foreground">推荐宽高比 {SERVER_MOTTO_RATIO_LABEL}，上传后可移动、缩放裁剪选区。</p></div>
    <MottoPreview src={server?.mottoImageUrl ?? null} draft={pending} alt={`${server?.displayName ?? "服务器"}箴言`} className="w-full max-w-sm border" />
    {editable && <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" variant="outline" disabled={busy || loading} onClick={() => void start(false)}><ImagePlus className="size-4" />上传图片</Button>
      {(server?.mottoImageUrl || pending) && <><Button type="button" size="sm" variant="outline" disabled={busy || loading} onClick={() => void start(true)}><Crop className="size-4" />重新裁剪</Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy || loading} onClick={async () => {
          if (pending) { onPrepare?.(null); return; }
          if (server) await run(() => api(`/api/admin/servers/${server.serverId}/motto-image`, "DELETE", { expectedIconObjectKey: server.iconObjectKey }), "已移除服务器箴言");
        }}>移除图片</Button></>}
    </div>}
    {pending && <p className="text-xs text-muted-foreground">图片已裁剪，将随服务器资料一起保存。</p>}
    <Dialog open={open} onOpenChange={value => { if (!busy && !loading) setOpen(value); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl"><DialogHeader><DialogTitle>编辑服务器箴言</DialogTitle><DialogDescription>默认裁剪比例 {SERVER_MOTTO_RATIO_LABEL}。拖动网格移动选区，调整滑杆缩放；方向键可微调位置。</DialogDescription></DialogHeader>
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label="选择服务器箴言图片" disabled={busy || loading} onChange={event => { void choose(event.target.files?.[0]); event.target.value = ""; }} />
        <Button type="button" variant="outline" disabled={busy || loading} onClick={() => input.current?.click()}>{source ? "更换原图" : "选择图片"}</Button>
        {loading && <p role="status" className="text-sm text-muted-foreground">正在读取图片…</p>}
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        {source && crop && <>
          <MottoCropGrid source={source} crop={crop} onChange={setCrop} disabled={busy || loading} />
          <label className="space-y-2 text-sm">选区大小<input type="range" className="block w-full accent-primary" min={10} max={100} step={1} value={Math.round(scale * 100)} disabled={busy || loading} onChange={event => setCrop(mottoCrop(source.width, source.height, Number(event.target.value) / 100, { x: crop.left + crop.width / 2, y: crop.top + crop.height / 2 }))} /></label>
          <div className="flex justify-between gap-3"><Button type="button" variant="ghost" disabled={busy || loading} onClick={() => setCrop(mottoCrop(source.width, source.height))}><RotateCcw className="size-4" />重置选区</Button>
            <Button type="button" disabled={busy || loading} onClick={async () => {
              if (!server && source.file) { onPrepare?.({ file: source.file, crop, width: source.width, height: source.height, previewUrl: URL.createObjectURL(source.file) }); setOpen(false); return; }
              if (server && await run(() => uploadMotto(server.serverId, expectedKey.current, source.file, crop), "服务器箴言已保存")) { onPrepare?.(null); setOpen(false); }
            }}>{busy ? "正在保存…" : server ? "上传并保存" : "使用选区"}</Button>
          </div>
        </>}
      </DialogContent>
    </Dialog>
  </section>;
}
