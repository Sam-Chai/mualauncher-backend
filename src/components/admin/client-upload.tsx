"use client";
import { useEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, UploadCloud, LoaderCircle, FileArchive } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormField, FormItem, FormControl, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { api, useAdmin, type Server } from "./provider";
import { clientMetadataSchema, formatBytes, uploadProcessingLabel, runtimeAutofill, type ClientMetadata, type UploadView } from "@/lib/client-contract";
import { UpdateStats, MarkdownText, ModTable } from "./client-shared";

function putPart(url: string, bytes: Blob, onProgress: (value: number) => void, signal: AbortSignal) {
  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest(); const abort = () => xhr.abort();
    xhr.open("PUT", url); xhr.timeout = 300000;
    xhr.upload.onprogress = event => onProgress(event.loaded);
    xhr.onload = () => { const etag = xhr.getResponseHeader("ETag"); if (xhr.status >= 200 && xhr.status < 300 && etag) resolve(etag); else reject(new Error("分片上传失败，请检查对象存储连接")); };
    xhr.onerror = () => reject(new Error("无法连接对象存储，请检查网络"));
    xhr.ontimeout = () => reject(new Error("分片上传超时")); xhr.onabort = () => reject(new Error("上传已取消"));
    xhr.onloadend = () => signal.removeEventListener("abort", abort);
    signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) { reject(new Error("上传已取消")); return; }
    xhr.send(bytes);
  });
}
type Target = Server & { organizationName: string };
type ClientIdentity = { clientId: string; name: string; organizationId: string; currentReleaseId: string | null; publicationRevision: number };
type Props = { targets: Target[]; organizations: { id: string; displayName: string; canUnbound: boolean }[]; client?: ClientIdentity; current?: ClientMetadata; clientId?: string; resume?: UploadView; disabled?: boolean; onDone: () => void };
export function ClientUploadDialog(props: Props) {
  const [open, setOpen] = useState(false);
  const [editorProps, setEditorProps] = useState<Props | null>(null);
  function changeOpen(next: boolean) { if (next) setEditorProps(props); setOpen(next); }
  return <Dialog open={open} onOpenChange={changeOpen}><DialogTrigger asChild><Button variant={props.clientId ? "outline" : "default"} size={props.clientId ? "sm" : "default"} disabled={props.disabled}>
    {!props.clientId && <Plus className="size-4" />}{props.resume ? "继续填写" : props.clientId ? "更新" : "添加客户端"}
  </Button></DialogTrigger><DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl" onInteractOutside={event => event.preventDefault()}><DialogHeader>
    <DialogTitle>{props.clientId ? "更新客户端" : "添加客户端"}</DialogTitle><DialogDescription>上传完整 .minecraft ZIP，填写版本资料后提交审核。审核并发布后才会切换服务器当前版本。</DialogDescription>
  </DialogHeader>{open && editorProps && <UploadEditor {...editorProps} onDone={() => { props.onDone(); setOpen(false); }} />}</DialogContent></Dialog>;
}
function UploadEditor({ targets, organizations, client: originalClient, current, clientId: fixedClient, resume, onDone }: Props) {
  const { run, refresh } = useAdmin();
  const [organizationId, setOrganizationId] = useState(originalClient?.organizationId ?? (organizations.length === 1 ? organizations[0].id : ""));
  const [serverId, setServerId] = useState("none");
  const [identity, setIdentity] = useState<ClientIdentity | null>(originalClient ?? null);
  const [file, setFile] = useState<File | null>(null); const [upload, setUpload] = useState<UploadView | null>(resume ?? null);
  const [uploading, setUploading] = useState(false); const [percent, setPercent] = useState(0); const [error, setError] = useState(""); const [dragging, setDragging] = useState(false);
  const initialMods = resume?.detectedMods ?? current?.mods ?? [];
  const input = useRef<HTMLInputElement>(null); const controller = useRef<AbortController | null>(null); const selectedUpload = useRef<string | null>(resume?.id ?? null);
  const form = useForm<ClientMetadata>({ resolver: zodResolver(clientMetadataSchema), defaultValues: { ...(current ?? { versionLabel: "", name: originalClient?.name ?? "", minecraftVersion: "", javaVersion: 0, summary: "", description: "" }), mods: initialMods } });
  const appliedInspection = useRef<string | null>(null);
  const runtimeBaseline = useRef({ minecraftVersion: form.getValues("minecraftVersion"), javaVersion: form.getValues("javaVersion") });
  const version = useWatch({ control: form.control, name: "versionLabel" }); const description = useWatch({ control: form.control, name: "description" }); const uploadId = upload?.id; const uploadStatus = upload?.status;
  const mods = upload ? upload.detectedMods : file ? [] : initialMods;
  useEffect(() => () => { controller.current?.abort(); }, []);
  useEffect(() => {
    const info = upload?.detectedInfo;
    if (!upload || !info || info.requiresSelection) return;
    const key = `${upload.id}:${info.instanceId ?? "root"}`;
    if (appliedInspection.current === key) return;
    appliedInspection.current = key;
    const values = runtimeAutofill(info, form.getValues(), runtimeBaseline.current);
    if (values.minecraftVersion !== undefined) form.setValue("minecraftVersion", values.minecraftVersion, { shouldDirty: true, shouldValidate: true });
    if (values.javaVersion !== undefined) form.setValue("javaVersion", values.javaVersion, { shouldDirty: true, shouldValidate: true });
    form.setValue("mods", upload.detectedMods, { shouldDirty: true });
  }, [upload, form]);
  useEffect(() => {
    if (!uploadId || !uploadStatus || !["QUEUED", "PROCESSING"].includes(uploadStatus)) return;
    let active = true; let fetching = false;
    const timer = setInterval(() => { if (fetching) return; fetching = true; void api<UploadView>(`/api/v1/clients/uploads/${uploadId}`).then(next => {
      if (!active) return; setUpload(next);
      if (next.status === "READY") { form.setValue("mods", next.detectedMods, { shouldDirty: true }); toast.success("完整客户端处理完成，请核对资料并提交审核"); }
    }).catch(error => { if (active) setError(error instanceof Error ? error.message : "读取任务失败"); }).finally(() => { fetching = false; }); }, 1500);
    return () => { active = false; clearInterval(timer); };
  }, [uploadId, uploadStatus, form]);
  async function startUpload(selected: File) {
    if (!/\.zip$/i.test(selected.name) || selected.size <= 0 || selected.size > 20 * 1024 ** 3) { setError("请选择 20 GiB 以内的完整 .minecraft ZIP"); return; }
    if (!organizationId) { setError("请先选择所属组织"); return; }
    if (!form.getValues("name").trim()) { setError("请先填写客户端名称，再点击“开始上传”"); return; }
    const target = serverId === "none" ? undefined : targets.find(target => target.serverId === serverId && target.organizationId === organizationId);
    if (!identity && !target && !organizations.find(org => org.id === organizationId)?.canUnbound) { setError("此账号仅有服务器授权，请选择管理范围内的服务器"); return; }
    let replaceConfirmed = false;
    if (!identity && target?.boundClientId) {
      replaceConfirmed = window.confirm(`服务器“${target.displayName}”已绑定“${target.boundClientName}”。是否在新客户端审核发布后重新绑定到新客户端？原客户端与历史版本会保留。`);
      if (!replaceConfirmed) return;
    }
    runtimeBaseline.current = { minecraftVersion: form.getValues("minecraftVersion"), javaVersion: form.getValues("javaVersion") };
    appliedInspection.current = null;
    setUploading(true); setError(""); setPercent(0); const abort = new AbortController(); controller.current = abort;
    try {
      let activeClient = identity;
      if (!activeClient) {
        const created = await api<{ clientId: string; name: string }>("/api/v1/clients", "POST", { organizationId, name: form.getValues("name"),
          serverId: target?.serverId ?? null, ...(target ? { publicationRevision: target.publicationRevision, expectedClientId: target.boundClientId, replaceConfirmed } : {}) });
        activeClient = { ...created, organizationId, currentReleaseId: null, publicationRevision: 0 }; setIdentity(activeClient); form.setValue("name", created.name); await refresh();
      }
      if (selectedUpload.current) { await api(`/api/v1/clients/uploads/${selectedUpload.current}/cancel`, "POST", {}); selectedUpload.current = null; setUpload(null); }
      const next = await api<UploadView>("/api/v1/clients/uploads", "POST", { clientId: activeClient.clientId, fileName: selected.name, size: selected.size,
        baseReleaseId: activeClient.currentReleaseId, basePublicationRevision: activeClient.publicationRevision });
      setUpload(next); selectedUpload.current = next.id;
      const parts: { partNumber: number; etag: string }[] = [];
      for (let offset = 0, number = 1; offset < selected.size; offset += next.partSize, number++) {
        abort.signal.throwIfAborted(); const part = selected.slice(offset, offset + next.partSize); let etag = "";
        for (let attempt = 0; attempt < 3; attempt++) {
          try { const signed = await api<{ url: string }>(`/api/v1/clients/uploads/${next.id}/parts`, "POST", { partNumber: number });
            etag = await putPart(signed.url, part, loaded => setPercent(Math.floor((offset + loaded) / selected.size * 100)), abort.signal); break;
          } catch (error) { if (attempt === 2 || abort.signal.aborted) throw error; }
        }
        parts.push({ partNumber: number, etag });
      }
      setUpload(await api<UploadView>(`/api/v1/clients/uploads/${next.id}/complete`, "POST", { parts })); setPercent(100);
    } catch (error) { setError(error instanceof Error ? error.message : "上传失败"); }
    finally { setUploading(false); }
  }
  function chooseFile(next: File | undefined) { if (!next || uploading || upload?.status === "PROCESSING") return; setFile(next); if (organizationId && form.getValues("name").trim()) void startUpload(next); }
  const processing = !!upload && ["QUEUED", "PROCESSING"].includes(upload.status); const submitting = form.formState.isSubmitting;
  return <Form {...form}><form className="space-y-6" onSubmit={form.handleSubmit(async metadata => {
    if (!upload || upload.status !== "READY") { setError("请先上传并等待解析完成"); return; }
    if (current && metadata.versionLabel === current.versionLabel) { form.setError("versionLabel", { message: "更新必须设置一个新的版本号" }); return; }
    if (await run(() => api(`/api/v1/clients/uploads/${upload.id}/submit`, "POST", metadata), "客户端已提交审核，当前发布版本保持可用")) onDone();
  })}>
    <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><label className="text-sm font-medium" htmlFor="upload-organization">所属组织</label>
      <Select value={organizationId} disabled={!!identity || uploading || processing} onValueChange={value => { setOrganizationId(value); setServerId("none"); }}><SelectTrigger id="upload-organization" className="w-full"><SelectValue placeholder="选择所属组织" /></SelectTrigger><SelectContent>{organizations.map(org => <SelectItem key={org.id} value={org.id}>{org.displayName}</SelectItem>)}</SelectContent></Select></div>
      {!fixedClient && <div className="space-y-2"><label className="text-sm font-medium" htmlFor="upload-server">绑定服务器（可选）</label>
      <Select value={serverId} disabled={!!identity || uploading || processing} onValueChange={setServerId}><SelectTrigger id="upload-server" className="w-full"><SelectValue /></SelectTrigger><SelectContent>
        <SelectItem value="none" disabled={!organizations.find(org => org.id === organizationId)?.canUnbound}>暂不绑定</SelectItem>
        {targets.filter(target => target.organizationId === organizationId).map(target => <SelectItem key={target.serverId} value={target.serverId}>{target.displayName} ({target.serverId}){target.boundClientName ? ` · 已绑定 ${target.boundClientName}` : ""}</SelectItem>)}
      </SelectContent></Select></div>}</div>
    <input ref={input} className="hidden" type="file" accept=".zip,application/zip" disabled={uploading || processing} onChange={event => chooseFile(event.target.files?.[0])} />
    <button type="button" disabled={uploading || processing} className={`flex min-h-52 w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-6 text-center transition-colors ${dragging ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/60 hover:bg-muted/40"} disabled:cursor-wait`}
      onClick={() => input.current?.click()} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); chooseFile(event.dataTransfer.files[0]); }}>
      {uploading || processing ? <LoaderCircle className="size-10 animate-spin text-primary" /> : upload || file ? <FileArchive className="size-10 text-primary" /> : <UploadCloud className="size-10 text-muted-foreground" />}
      <span className="font-medium" role="status" aria-live="polite">{uploading ? `上传中 ${percent}%` : processing ? uploadProcessingLabel(upload!) : upload?.status === "READY" ? "处理完成 · 点击更换完整整合包" : file?.name ?? "拖拽 ZIP 到这里，或点击选择文件"}</span>
      <span className="text-sm text-muted-foreground">{upload ? `${upload.fileName} · ${formatBytes(upload.size)}` : ".minecraft 目录或目录内文件的完整 ZIP · 最大 20 GiB"}</span>
      {uploading && <span className="h-2 w-64 overflow-hidden rounded-full bg-muted"><span className="block h-full bg-primary" style={{ width: `${percent}%` }} /></span>}
    </button>
    {upload?.processingPhase === "SELECT_INSTANCE" && upload.detectedInfo && <Alert><AlertDescription className="space-y-3"><p>整合包包含多个实例，请选择要发布的客户端。选择后继续识别与文件处理。</p>
      <Select onValueChange={instanceId => void run(async () => {
        appliedInspection.current = null;
        runtimeBaseline.current = { minecraftVersion: form.getValues("minecraftVersion"), javaVersion: form.getValues("javaVersion") };
        setUpload(await api<UploadView>(`/api/v1/clients/uploads/${upload.id}/select-instance`, "POST", { instanceId }));
      }, "已选择实例，等待 Worker 继续处理", false)}><SelectTrigger className="w-full" aria-label="选择客户端实例"><SelectValue placeholder="选择要发布的实例" /></SelectTrigger><SelectContent>
        {upload.detectedInfo.candidates.map(candidate => <SelectItem key={candidate.instanceId} value={candidate.instanceId!}>{candidate.instanceId} · MC {candidate.minecraftVersion ?? "待确认"} · Java {candidate.javaVersion ?? "待确认"}{candidate.loader ? ` · ${candidate.loader}` : ""}</SelectItem>)}
      </SelectContent></Select>
    </AlertDescription></Alert>}
    {upload?.detectedInfo && !upload.detectedInfo.requiresSelection && <Alert><AlertDescription className="space-y-1"><p>{upload.detectedInfo.minecraftVersion && upload.detectedInfo.javaVersion ? "客户端信息已识别并填充，请核对 MC 与 Java 环境。" : "客户端信息识别完成，缺失或冲突的 MC／Java 信息请手动确认。"}</p>
      {upload.detectedInfo.instanceId && <p>目标实例：{upload.detectedInfo.instanceId}{upload.detectedInfo.loader ? ` · ${upload.detectedInfo.loader} ${upload.detectedInfo.loaderVersion ?? ""}` : ""}</p>}
      {upload.detectedInfo.minecraftSource && <p className="break-all text-xs text-muted-foreground">MC 来源：{upload.detectedInfo.minecraftSource}</p>}
      {upload.detectedInfo.javaSource && <p className="break-all text-xs text-muted-foreground">Java 来源：{upload.detectedInfo.javaSource}</p>}
    </AlertDescription></Alert>}
    {file && !uploading && !processing && !upload && <Button type="button" onClick={() => void startUpload(file)}>开始上传</Button>}
    {upload?.status === "FAILED" && <Alert variant="destructive"><AlertDescription>{upload.error}<Button className="ml-3" type="button" size="sm" variant="outline" onClick={() => void run(async () => setUpload(await api<UploadView>(`/api/v1/clients/uploads/${upload.id}/retry`, "POST", {})), "已重新排队", false)}>重新分析</Button></AlertDescription></Alert>}
    {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
    {current && <Alert><AlertDescription>原版本为 {current.versionLabel}。必须上传完整客户端并设置新的版本号；发布内容不能原地修改。</AlertDescription></Alert>}
    <fieldset disabled={submitting || uploading} className="grid gap-5 sm:grid-cols-2">
      {([ ["name", "客户端名称", "NPUcraft"], ["versionLabel", "客户端版本", "1.4.3"], ["minecraftVersion", "MC 版本", "1.21.1 / 26.1"] ] as const).map(([name, label, placeholder]) => <FormField key={name} control={form.control} name={name} render={({ field }) => <FormItem><FormLabel>{label}</FormLabel><FormControl><Input {...field} placeholder={placeholder} readOnly={name === "name" && !!identity} /></FormControl><FormMessage /></FormItem>} />)}
      <FormField control={form.control} name="javaVersion" render={({ field }) => <FormItem><FormLabel>Java 版本</FormLabel><Select value={field.value ? String(field.value) : ""} disabled={uploading || submitting} onValueChange={value => field.onChange(Number(value))}><FormControl><SelectTrigger className="w-full"><SelectValue placeholder="等待识别或手动选择" /></SelectTrigger></FormControl><SelectContent>{Array.from({ length: 19 }, (_, i) => i + 7).map(version => <SelectItem key={version} value={String(version)}>Java {version}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>} />
      <div className="space-y-3 sm:col-span-2"><h3 className="text-sm font-medium">模组列表 · {mods.length}</h3>
        <p className="text-xs text-muted-foreground">{!upload && current && !file ? "以下为原版本的模组列表；上传新 ZIP 后自动替换。" : "从目标实例的 mods 文件夹自动识别，支持版本隔离目录；列表只读。"}</p>
        <ModTable key={upload?.id ?? (file ? "selected-file" : "previous-version")} mods={mods} empty={upload?.status === "READY" ? "mods 文件夹内未识别到 JAR 文件" : processing || uploading ? "正在解析，完成后自动显示模组列表" : "上传完整 ZIP，解析后自动生成模组列表"} />
      </div>
      <FormField control={form.control} name="summary" render={({ field }) => <FormItem className="sm:col-span-2"><FormLabel>提交标题 Summary</FormLabel><FormControl><Input {...field} placeholder="更新客户端配置与模组" /></FormControl><FormMessage /></FormItem>} />
      <FormField control={form.control} name="description" render={({ field }) => <FormItem className="sm:col-span-2"><FormLabel>说明 Description · Markdown</FormLabel><Tabs defaultValue="edit"><TabsList><TabsTrigger value="edit">编辑</TabsTrigger><TabsTrigger value="preview">预览</TabsTrigger></TabsList><TabsContent value="edit"><FormControl><Textarea {...field} rows={7} placeholder="说明本次客户端的内容、更新原因和注意事项…" /></FormControl></TabsContent><TabsContent value="preview" className="min-h-40 rounded-md border p-4"><MarkdownText value={description} /></TabsContent></Tabs><FormMessage /></FormItem>} />
    </fieldset>
    {upload?.statistics && <UpdateStats statistics={upload.statistics} version={version} />}
    {!!upload?.warnings.length && <Alert><AlertDescription>{upload.warnings.map(warning => <p key={warning}>{warning}</p>)}</AlertDescription></Alert>}
    <div className="flex items-center justify-between gap-4 border-t pt-5"><p className="text-xs text-muted-foreground">MC 与 Java 自动识别后可核对调整；客户端发布版本仍需填写。完整校验完成后可提交审核。</p><Button type="submit" disabled={upload?.status !== "READY" || uploading || submitting}>{submitting && <LoaderCircle className="size-4 animate-spin" />}提交审核</Button></div>
  </form></Form>;
}
