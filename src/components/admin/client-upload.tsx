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
import { clientMetadataSchema, formatBytes, uploadProcessingLabel, runtimeAutofill, type ClientMetadata, type UploadView, type PackageFormatVersion } from "@/lib/client-contract";
import { UpdateStats, RecipeImportStats, MarkdownText, ModTable } from "./client-shared";
import { PackageBuildOptions } from "./package-platforms";
import { PackageFormatChoice } from "./package-format-choice";
import { defaultMuaPlatforms } from "@/lib/muapack-contract";
import { defaultUploadPackageFormat } from "@/lib/package-format-policy";
import { uploadFileError } from "@/lib/upload-size-policy";

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
type Props = { targets: Target[]; organizations: { id: string; displayName: string; canUnbound: boolean }[]; client?: ClientIdentity; current?: ClientMetadata; clientId?: string; defaultPackageFormatVersion?: PackageFormatVersion | null; comparisonDrafts?: { id: string; versionLabel: string | null }[]; resume?: UploadView; disabled?: boolean; onDone: () => void };
export function ClientUploadDialog(props: Props) {
  const { refresh } = useAdmin();
  const [open, setOpen] = useState(false);
  const [editorProps, setEditorProps] = useState<Props | null>(null);
  function changeOpen(next: boolean) { if (next) { setEditorProps(props); void refresh().catch(() => toast.error("无法刷新上传设置，请刷新页面后重试")); } setOpen(next); }
  return <Dialog open={open} onOpenChange={changeOpen}><DialogTrigger asChild><Button variant={props.clientId ? "outline" : "default"} size={props.clientId ? "sm" : "default"} disabled={props.disabled}>
    {!props.clientId && <Plus className="size-4" />}{props.resume ? "继续填写" : props.clientId ? "更新" : "添加客户端"}
  </Button></DialogTrigger><DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl" onInteractOutside={event => event.preventDefault()}><DialogHeader>
    <DialogTitle>{props.clientId ? "更新客户端" : "添加客户端"}</DialogTitle><DialogDescription>上传完整 .minecraft ZIP、Modrinth mrpack 或 PCL 导出包，识别并填写资料后提交审核。审核并发布后才会切换服务器当前版本。</DialogDescription>
  </DialogHeader>{open && editorProps && <UploadEditor {...editorProps} onDone={() => { props.onDone(); setOpen(false); }} />}</DialogContent></Dialog>;
}
function UploadEditor({ targets, organizations, client: originalClient, current, clientId: fixedClient, defaultPackageFormatVersion, comparisonDrafts = [], resume, onDone }: Props) {
  const { run, refresh, state } = useAdmin();
  const enabledFormats = state.enabledPackageFormats;
  const [organizationId, setOrganizationId] = useState(originalClient?.organizationId ?? (organizations.length === 1 ? organizations[0].id : ""));
  const [serverId, setServerId] = useState("none");
  const [comparisonDraftId, setComparisonDraftId] = useState(resume ? resume.comparisonDraftId ?? "none" : comparisonDrafts[0]?.id ?? "none");
  const [platforms, setPlatforms] = useState(defaultMuaPlatforms);
  const [chosenFormat, setPackageFormatVersion] = useState<PackageFormatVersion | null>(() => defaultUploadPackageFormat(enabledFormats, fixedClient ? defaultPackageFormatVersion ?? null : null));
  const [identity, setIdentity] = useState<ClientIdentity | null>(originalClient ?? null);
  const [file, setFile] = useState<File | null>(null); const [upload, setUpload] = useState<UploadView | null>(resume ?? null);
  const packageFormatVersion = upload?.packageFormatVersion ?? defaultUploadPackageFormat(enabledFormats, chosenFormat);
  const [uploading, setUploading] = useState(false); const [percent, setPercent] = useState(0); const [error, setError] = useState(""); const [dragging, setDragging] = useState(false);
  const initialMods = resume?.detectedMods ?? current?.mods ?? [];
  const input = useRef<HTMLInputElement>(null); const controller = useRef<AbortController | null>(null); const selectedUpload = useRef<string | null>(resume?.id ?? null);
  const form = useForm<ClientMetadata>({ resolver: zodResolver(clientMetadataSchema), defaultValues: { ...(current ?? { versionLabel: "", name: originalClient?.name ?? "", minecraftVersion: "", javaVersion: 0, summary: "", description: "" }), mods: initialMods } });
  const appliedInspection = useRef<string | null>(null);
  const runtimeBaseline = useRef({ minecraftVersion: form.getValues("minecraftVersion"), javaVersion: form.getValues("javaVersion") });
  const packBaseline = useRef({ name: form.getValues("name"), versionLabel: form.getValues("versionLabel"), summary: form.getValues("summary") });
  const version = useWatch({ control: form.control, name: "versionLabel" }); const description = useWatch({ control: form.control, name: "description" }); const uploadId = upload?.id; const uploadStatus = upload?.status;
  const mods = upload ? upload.detectedMods : file ? [] : initialMods;
  // Older uploads can retain this warning from before Forge/NeoForge support.
  const warnings = (upload?.warnings ?? []).filter(warning => warning !== "已识别 Forge／NeoForge，但当前环境组装尚不支持该加载器，无法完成 muapack 发布。");
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
    if (info.pack) {
      if (!fixedClient && form.getValues("name") === packBaseline.current.name) form.setValue("name", info.pack.name, { shouldDirty: true, shouldValidate: true });
      if (form.getValues("versionLabel") === packBaseline.current.versionLabel) form.setValue("versionLabel", info.pack.version, { shouldDirty: true, shouldValidate: true });
      if (info.pack.summary && form.getValues("summary") === packBaseline.current.summary) form.setValue("summary", info.pack.summary, { shouldDirty: true, shouldValidate: true });
    }
    form.setValue("mods", upload.detectedMods, { shouldDirty: true });
  }, [upload, form, fixedClient]);
  useEffect(() => {
    if (!uploadId || !uploadStatus || !["QUEUED", "PROCESSING"].includes(uploadStatus)) return;
    let active = true; let fetching = false;
    const timer = setInterval(() => { if (fetching) return; fetching = true; void api<UploadView>(`/api/v1/clients/uploads/${uploadId}`).then(next => {
      if (!active) return; setUpload(next);
      if (next.status === "READY") { form.setValue("mods", next.detectedMods, { shouldDirty: true }); toast.success(next.packageFormatVersion === 2 ? "v2 信息识别与本地校验完成，请核对资料并提交审核" : "完整客户端处理完成，请核对资料并提交审核"); }
    }).catch(error => { if (active) setError(error instanceof Error ? error.message : "读取任务失败"); }).finally(() => { fetching = false; }); }, 1500);
    return () => { active = false; clearInterval(timer); };
  }, [uploadId, uploadStatus, form]);
  async function startUpload(selected: File) {
    if (!packageFormatVersion) { setError("请先选择制作 muapack v1 还是 v2"); return; }
    const fileError = uploadFileError(selected.name, selected.size, state.maxUploadSizeMb);
    if (fileError) { setError(fileError); return; }
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
    packBaseline.current = { name: form.getValues("name"), versionLabel: form.getValues("versionLabel"), summary: form.getValues("summary") };
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
        packageFormatVersion,
        baseReleaseId: activeClient.currentReleaseId, basePublicationRevision: activeClient.publicationRevision,
        comparisonDraftId: comparisonDraftId === "none" ? null : comparisonDraftId });
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
  function chooseFile(next: File | undefined) {
    if (!next || !packageFormatVersion || uploading || upload?.status === "PROCESSING") return;
    const fileError = uploadFileError(next.name, next.size, state.maxUploadSizeMb);
    if (fileError) { setError(fileError); return; }
    setError("");
    setFile(next);
    if (!fixedClient && !form.getValues("name").trim()) form.setValue("name", next.name.replace(/\.(zip|mrpack)$/i, "").slice(0, 200), { shouldDirty: true });
    if (organizationId && form.getValues("name").trim()) void startUpload(next);
  }
  const processing = !!upload && ["QUEUED", "PROCESSING"].includes(upload.status); const submitting = form.formState.isSubmitting;
  return <Form {...form}><form className="space-y-6" onSubmit={form.handleSubmit(async metadata => {
    if (!upload || upload.status !== "READY") { setError("请先上传并等待解析完成"); return; }
    if (current && metadata.versionLabel === current.versionLabel) { form.setError("versionLabel", { message: "更新必须设置一个新的版本号" }); return; }
    if (await run(() => api(`/api/v1/clients/uploads/${upload.id}/submit`, "POST", { ...metadata, ...(packageFormatVersion === 1 ? { platforms } : {}) }), "客户端已提交审核，组包任务将在后台继续")) onDone();
  })}>
    <PackageFormatChoice value={packageFormatVersion} onChange={setPackageFormatVersion} enabledFormats={enabledFormats} locked={!!upload} busy={uploading || submitting} />
    <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><label className="text-sm font-medium" htmlFor="upload-organization">所属组织</label>
      <Select value={organizationId} disabled={!!identity || uploading || processing} onValueChange={value => { setOrganizationId(value); setServerId("none"); }}><SelectTrigger id="upload-organization" className="w-full"><SelectValue placeholder="选择所属组织" /></SelectTrigger><SelectContent>{organizations.map(org => <SelectItem key={org.id} value={org.id}>{org.displayName}</SelectItem>)}</SelectContent></Select></div>
      {!fixedClient && <div className="space-y-2"><label className="text-sm font-medium" htmlFor="upload-server">绑定服务器（可选）</label>
      <Select value={serverId} disabled={!!identity || uploading || processing} onValueChange={setServerId}><SelectTrigger id="upload-server" className="w-full"><SelectValue /></SelectTrigger><SelectContent>
        <SelectItem value="none" disabled={!organizations.find(org => org.id === organizationId)?.canUnbound}>暂不绑定</SelectItem>
        {targets.filter(target => target.organizationId === organizationId).map(target => <SelectItem key={target.serverId} value={target.serverId}>{target.displayName} ({target.serverId}){target.boundClientName ? ` · 已绑定 ${target.boundClientName}` : ""}</SelectItem>)}
      </SelectContent></Select></div>}</div>
    {fixedClient && comparisonDrafts.length > 0 && <div className="space-y-2"><label className="text-sm font-medium" htmlFor="upload-comparison">对比并替代未发布版本</label>
      <Select value={comparisonDraftId} onValueChange={setComparisonDraftId} disabled={uploading || !!upload}><SelectTrigger id="upload-comparison" className="w-full"><SelectValue /></SelectTrigger><SelectContent>
        <SelectItem value="none">独立提交，不替代旧草稿</SelectItem>{comparisonDrafts.map(draft => <SelectItem key={draft.id} value={draft.id}>{draft.versionLabel ?? "未填写版本"}</SelectItem>)}
      </SelectContent></Select><p className="text-xs text-muted-foreground">用于查看上次上传的差异。本版本成功发布后，才归档所选旧草稿及其替代链。玩家更新仍以已发布版本为基准。</p></div>}
    <input ref={input} className="hidden" type="file" accept=".zip,.mrpack,application/zip,application/x-modrinth-modpack+zip" disabled={!packageFormatVersion || uploading || processing} onChange={event => chooseFile(event.target.files?.[0])} />
    <button type="button" disabled={!packageFormatVersion || uploading || processing} className={`flex min-h-52 w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-6 text-center transition-colors ${dragging ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/60 hover:bg-muted/40"} disabled:cursor-not-allowed`}
      onClick={() => input.current?.click()} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); chooseFile(event.dataTransfer.files[0]); }}>
      {uploading || processing ? <LoaderCircle className="size-10 animate-spin text-primary" /> : upload || file ? <FileArchive className="size-10 text-primary" /> : <UploadCloud className="size-10 text-muted-foreground" />}
      <span className="font-medium" role="status" aria-live="polite">{!packageFormatVersion ? "请先选择 v1 或 v2" : uploading ? `上传中 ${percent}%` : processing || upload?.status === "WAITING_PROCESSOR" ? uploadProcessingLabel(upload!) : upload?.status === "READY" ? "处理完成 · 点击更换完整整合包" : file?.name ?? "拖拽 ZIP／mrpack 到这里，或点击选择文件"}</span>
      <span className="text-sm text-muted-foreground">{upload ? `${upload.fileName} · ${formatBytes(upload.size)}` : `.minecraft ZIP／Modrinth mrpack／PCL 导出 ZIP · 最大 ${state.maxUploadSizeMb} MB`}</span>
      {uploading && <span className="h-2 w-64 overflow-hidden rounded-full bg-muted"><span className="block h-full bg-primary" style={{ width: `${percent}%` }} /></span>}
    </button>
    {upload?.status === "WAITING_PROCESSOR" && <Alert><AlertDescription>v2 源包已上传保存，等待 v2 处理器接入。当前不会下载远程模组或运行环境，也不能提交审核；已发布版本继续可用。</AlertDescription></Alert>}
    {upload?.packageFormatVersion === 2 && upload.status === "READY" && <Alert><AlertDescription>v2 信息识别与本地文件校验完成，远程声明已保存。核对并提交审核后，Worker 会在后台生成跨平台完整 .muapack；审核、签名和产物校验完成后才可发布。</AlertDescription></Alert>}
    {upload && ["UPLOADING", "WAITING_PROCESSOR", "QUEUED", "READY", "FAILED"].includes(upload.status) && !uploading && <Button type="button" variant="outline" onClick={() => void run(async () => {
      await api(`/api/v1/clients/uploads/${upload.id}/cancel`, "POST", {});
      selectedUpload.current = null; setUpload(null); setFile(null); setPackageFormatVersion(null); setError(""); if (input.current) input.current.value = "";
    }, "已取消上传，可以重新选择格式", false)}>取消上传／重新选择格式</Button>}
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
      {upload.detectedInfo.pack && <p>包内名称：{upload.detectedInfo.pack.name} · 版本 {upload.detectedInfo.pack.version}{upload.detectedInfo.pack.wrapper ? " · PCL 封装" : " · Modrinth"}</p>}
      {upload.detectedInfo.instanceId && <p>目标实例：{upload.detectedInfo.instanceId}</p>}
      {upload.detectedInfo.loader && <p>模组加载器：{upload.detectedInfo.loader} {upload.detectedInfo.loaderVersion}</p>}
      {upload.detectedInfo.minecraftSource && <p className="break-all text-xs text-muted-foreground">MC 来源：{upload.detectedInfo.minecraftSource}</p>}
      {upload.detectedInfo.javaSource && <p className="break-all text-xs text-muted-foreground">Java 来源：{upload.detectedInfo.javaSource}</p>}
    </AlertDescription></Alert>}
    {file && !uploading && !processing && !upload && <Button type="button" onClick={() => void startUpload(file)}>开始上传</Button>}
    {upload?.status === "FAILED" && <Alert variant="destructive"><AlertDescription>{upload.error}<Button className="ml-3" type="button" size="sm" variant="outline" onClick={() => void run(async () => setUpload(await api<UploadView>(`/api/v1/clients/uploads/${upload.id}/retry`, "POST", {})), "已重新排队", false)}>重新分析</Button></AlertDescription></Alert>}
    {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
    {current && <Alert><AlertDescription>原版本为 {current.versionLabel}。必须上传完整客户端并设置新的版本号；发布内容不能原地修改。</AlertDescription></Alert>}
    <fieldset disabled={submitting || uploading} className="grid gap-5 sm:grid-cols-2">
      {([ ["name", "客户端名称", "NPUcraft"], ["versionLabel", "客户端版本", "1.4.3"], ["minecraftVersion", "MC 版本", "1.21.1 / 26.1"] ] as const).map(([name, label, placeholder]) => <FormField key={name} control={form.control} name={name} render={({ field }) => <FormItem><FormLabel>{label}</FormLabel><FormControl><Input {...field} placeholder={placeholder} readOnly={name === "name" && !!fixedClient} /></FormControl><FormMessage /></FormItem>} />)}
      <FormField control={form.control} name="javaVersion" render={({ field }) => <FormItem><FormLabel>Java 版本</FormLabel><Select value={field.value ? String(field.value) : ""} disabled={uploading || submitting} onValueChange={value => field.onChange(Number(value))}><FormControl><SelectTrigger className="w-full"><SelectValue placeholder="等待识别或手动选择" /></SelectTrigger></FormControl><SelectContent>{Array.from({ length: 19 }, (_, i) => i + 7).map(version => <SelectItem key={version} value={String(version)}>Java {version}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>} />
      <div className="space-y-3 sm:col-span-2"><h3 className="text-sm font-medium">模组列表 · {mods.length}</h3>
        <p className="text-xs text-muted-foreground">{!upload && current && !file ? "以下为原版本的模组列表；上传新包后自动替换。" : packageFormatVersion === 2 ? "v2 保留本地模组和远程下载声明；远程模组由 Launcher 下载。optional 标记保留，列表由识别结果生成。" : "自动识别本地和远程模组。optional 模组全部打包，玩家在 Launcher 选择启用；列表只读。"}</p>
        <ModTable key={upload?.id ?? (file ? "selected-file" : "previous-version")} mods={mods} details={upload?.detectedInfo?.importFiles ?? current?.modDetails} empty={upload?.status === "READY" ? "未识别到模组 JAR 文件" : processing || uploading ? "正在解析，完成后自动显示模组列表" : "上传完整 ZIP／mrpack，解析后自动生成模组列表"} />
      </div>
      <FormField control={form.control} name="summary" render={({ field }) => <FormItem className="sm:col-span-2"><FormLabel>提交标题 Summary</FormLabel><FormControl><Input {...field} placeholder="更新客户端配置与模组" /></FormControl><FormMessage /></FormItem>} />
      <FormField control={form.control} name="description" render={({ field }) => <FormItem className="sm:col-span-2"><FormLabel>说明 Description · Markdown</FormLabel><Tabs defaultValue="edit"><TabsList><TabsTrigger value="edit">编辑</TabsTrigger><TabsTrigger value="preview">预览</TabsTrigger></TabsList><TabsContent value="edit"><FormControl><Textarea {...field} rows={7} placeholder="说明本次客户端的内容、更新原因和注意事项…" /></FormControl></TabsContent><TabsContent value="preview" className="min-h-40 rounded-md border p-4"><MarkdownText value={description} /></TabsContent></Tabs><FormMessage /></FormItem>} />
    </fieldset>
    {upload?.statistics && <UpdateStats statistics={upload.statistics} comparison={upload.comparisonStatistics} version={version} updating={!!fixedClient} />}
    {upload?.recipeStatistics && <RecipeImportStats statistics={upload.recipeStatistics} />}
    {!!warnings.length && <Alert><AlertDescription>{warnings.map(warning => <p key={warning}>{warning}</p>)}</AlertDescription></Alert>}
    <PackageBuildOptions packageFormatVersion={packageFormatVersion} value={platforms} onChange={setPlatforms} disabled={uploading || submitting} />
    <div className="flex items-center justify-between gap-4 border-t pt-5"><p className="text-xs text-muted-foreground">{packageFormatVersion === 2 ? "v2 完整包仅包含本地载荷和远程配方，环境由 Launcher 准备。" : "MC 与 Java 自动识别后可核对调整；客户端发布版本仍需填写。完整校验完成后可提交审核。"}</p><Button type="submit" disabled={packageFormatVersion === 1 && !platforms.length || upload?.status !== "READY" || uploading || submitting}>{submitting && <LoaderCircle className="size-4 animate-spin" />}提交审核</Button></div>
  </form></Form>;
}
