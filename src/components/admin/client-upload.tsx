"use client";
import { serializeError } from "@/lib/diagnostics";
import { formatMessage } from "@/lib/diagnostics";

import { useI18n } from "@/components/preferences";
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
import { UpdateStats, RecipeImportStats, RecipeDistributionStats, MarkdownText, ModTable } from "./client-shared";
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
    xhr.onload = () => { const etag = xhr.getResponseHeader("ETag"); if (xhr.status >= 200 && xhr.status < 300 && etag) resolve(etag); else reject(new Error("clientUpload.partUploadFailedCheckObjectStorageConnectivity")); };
    xhr.onerror = () => reject(new Error("clientUpload.cannotConnectToObjectStorageCheckYourNetwork"));
    xhr.ontimeout = () => reject(new Error("clientUpload.partUploadTimedOut")); xhr.onabort = () => reject(new Error("clientUpload.uploadCancelled"));
    xhr.onloadend = () => signal.removeEventListener("abort", abort);
    signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) { reject(new Error("clientUpload.uploadCancelled")); return; }
    xhr.send(bytes);
  });
}
type Target = Server & { organizationName: string };
type ClientIdentity = { clientId: string; name: string; organizationId: string; currentReleaseId: string | null; publicationRevision: number };
type Props = { targets: Target[]; organizations: { id: string; displayName: string; canUnbound: boolean }[]; client?: ClientIdentity; current?: ClientMetadata; clientId?: string; defaultPackageFormatVersion?: PackageFormatVersion | null; comparisonDrafts?: { id: string; versionLabel: string | null }[]; resume?: UploadView; disabled?: boolean; onDone: () => void };
export function ClientUploadDialog(props: Props) {
  const { t } = useI18n();
  const { refresh } = useAdmin();
  const [open, setOpen] = useState(false);
  const [editorProps, setEditorProps] = useState<Props | null>(null);
  function changeOpen(next: boolean) { if (next) { setEditorProps(props); void refresh().catch(() => toast.error(t("clientUpload.couldNotRefreshUploadSettingsRefreshThePageAnd"))); } setOpen(next); }
  return <Dialog open={open} onOpenChange={changeOpen}><DialogTrigger asChild><Button variant={props.clientId ? "outline" : "default"} size={props.clientId ? "sm" : "default"} disabled={props.disabled}>
    {!props.clientId && <Plus className="size-4" />}{props.resume ? t("clientUpload.continueEditing") : props.clientId ? t("clientUpload.update") : t("clientUpload.addClient")}
  </Button></DialogTrigger><DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl" onInteractOutside={event => event.preventDefault()}><DialogHeader>
    <DialogTitle>{props.clientId ? t("clientUpload.updateClient") : t("clientUpload.addClient")}</DialogTitle><DialogDescription>{t("clientUpload.uploadACompleteMinecraftZipModrinthMrpackOrPcl")}</DialogDescription>
  </DialogHeader>{open && editorProps && <UploadEditor {...editorProps} onDone={() => { props.onDone(); setOpen(false); }} />}</DialogContent></Dialog>;
}
function UploadEditor({ targets, organizations, client: originalClient, current, clientId: fixedClient, defaultPackageFormatVersion, comparisonDrafts = [], resume, onDone }: Props) {
  const { t } = useI18n();
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
  const warnings = upload?.warnings ?? [];
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
      if (next.status === "READY") { form.setValue("mods", next.detectedMods, { shouldDirty: true }); toast.success(next.packageFormatVersion === 2 ? t("clientUpload.v2DetectionAndLocalValidationCompletedCheckDetailsAnd") : t("clientUpload.fullClientProcessingCompletedCheckDetailsAndSubmitFor")); }
    }).catch(error => { if (active) setError(error instanceof Error ? serializeError(error) : t("clientUpload.couldNotReadTask")); }).finally(() => { fetching = false; }); }, 1500);
    return () => { active = false; clearInterval(timer); };
  }, [uploadId, uploadStatus, form, t]);
  async function startUpload(selected: File) {
    if (!packageFormatVersion) { setError(t("clientUpload.chooseMuapackV1OrV2First")); return; }
    const fileError = uploadFileError(selected.name, selected.size, state.maxUploadSizeMb);
    if (fileError) { setError(formatMessage(t, fileError)); return; }
    if (!organizationId) { setError(t("clientUpload.selectAnOrganizationFirst")); return; }
    if (!form.getValues("name").trim()) { setError(t("clientUpload.enterTheClientNameBeforeStartingTheUpload")); return; }
    const target = serverId === "none" ? undefined : targets.find(target => target.serverId === serverId && target.organizationId === organizationId);
    if (!identity && !target && !organizations.find(org => org.id === organizationId)?.canUnbound) { setError(t("clientUpload.thisAccountOnlyHasServerPermissionsSelectAServer")); return; }
    let replaceConfirmed = false;
    if (!identity && target?.boundClientId) {
      replaceConfirmed = window.confirm(t("clients.binding.replaceConfirmation", { "server": target.displayName, "client": target.boundClientName }));
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
    } catch (error) { setError(error instanceof Error ? serializeError(error) : t("clientUpload.uploadFailed")); }
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
    if (!upload || upload.status !== "READY") { setError(t("clientUpload.uploadAndWaitForProcessingFirst")); return; }
    if (current && metadata.versionLabel === current.versionLabel) { form.setError("versionLabel", { message: t("clientUpload.anUpdateMustUseANewVersionNumber") }); return; }
    const { mods: _mods, modDetails: _modDetails, ...submission } = metadata;
    void _mods; void _modDetails;
    if (await run(() => api(`/api/v1/clients/uploads/${upload.id}/submit`, "POST", { ...submission, ...(packageFormatVersion === 1 ? { platforms } : {}) }), t("clientUpload.clientSubmittedForReviewPackagingWillContinueInThe"))) onDone();
  })}>
    <PackageFormatChoice value={packageFormatVersion} onChange={setPackageFormatVersion} enabledFormats={enabledFormats} locked={!!upload} busy={uploading || submitting} />
    <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><label className="text-sm font-medium" htmlFor="upload-organization">{t("clientUpload.organization")}</label>
      <Select value={organizationId} disabled={!!identity || uploading || processing} onValueChange={value => { setOrganizationId(value); setServerId("none"); }}><SelectTrigger id="upload-organization" className="w-full"><SelectValue placeholder={t("clientUpload.selectOrganization")} /></SelectTrigger><SelectContent>{organizations.map(org => <SelectItem key={org.id} value={org.id}>{org.displayName}</SelectItem>)}</SelectContent></Select></div>
      {!fixedClient && <div className="space-y-2"><label className="text-sm font-medium" htmlFor="upload-server">{t("clientUpload.bindServerOptional")}</label>
      <Select value={serverId} disabled={!!identity || uploading || processing} onValueChange={setServerId}><SelectTrigger id="upload-server" className="w-full"><SelectValue /></SelectTrigger><SelectContent>
        <SelectItem value="none" disabled={!organizations.find(org => org.id === organizationId)?.canUnbound}>{t("clientUpload.leaveUnbound")}</SelectItem>
        {targets.filter(target => target.organizationId === organizationId).map(target => <SelectItem key={target.serverId} value={target.serverId}>{target.displayName} ({target.serverId}){target.boundClientName ? t("clientUpload.boundServerSuffix", { "server": target.boundClientName }) : ""}</SelectItem>)}
      </SelectContent></Select></div>}</div>
    {fixedClient && comparisonDrafts.length > 0 && <div className="space-y-2"><label className="text-sm font-medium" htmlFor="upload-comparison">{t("clientUpload.compareAndReplaceAnUnpublishedVersion")}</label>
      <Select value={comparisonDraftId} onValueChange={setComparisonDraftId} disabled={uploading || !!upload}><SelectTrigger id="upload-comparison" className="w-full"><SelectValue /></SelectTrigger><SelectContent>
        <SelectItem value="none">{t("clientUpload.independentSubmissionKeepOldDrafts")}</SelectItem>{comparisonDrafts.map(draft => <SelectItem key={draft.id} value={draft.id}>{draft.versionLabel ?? t("clientUpload.versionNotEntered")}</SelectItem>)}
      </SelectContent></Select><p className="text-xs text-muted-foreground">{t("clientUpload.compareChangesAgainstThePreviousUploadTheSelectedDraft")}</p></div>}
    <input ref={input} className="hidden" type="file" accept=".zip,.mrpack,application/zip,application/x-modrinth-modpack+zip" disabled={!packageFormatVersion || uploading || processing} onChange={event => chooseFile(event.target.files?.[0])} />
    <button type="button" disabled={!packageFormatVersion || uploading || processing} className={`flex min-h-52 w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-6 text-center transition-colors ${dragging ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/60 hover:bg-muted/40"} disabled:cursor-not-allowed`}
      onClick={() => input.current?.click()} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); chooseFile(event.dataTransfer.files[0]); }}>
      {uploading || processing ? <LoaderCircle className="size-10 animate-spin text-primary" /> : upload || file ? <FileArchive className="size-10 text-primary" /> : <UploadCloud className="size-10 text-muted-foreground" />}
      <span className="font-medium" role="status" aria-live="polite">{!packageFormatVersion ? t("clientUpload.chooseV1OrV2First") : uploading ? t("clientUpload.uploadProgress", { "percent": percent }) : processing ? uploadProcessingLabel(upload!, t) : upload?.status === "READY" ? t("clientUpload.processingCompleteClickToReplaceTheFullPack") : file?.name ?? t("clientUpload.dropAZipMrpackHereOrClickToSelect")}</span>
      <span className="text-sm text-muted-foreground">{upload ? `${upload.fileName} · ${formatBytes(upload.size)}` : t("clientUpload.acceptedFiles", { "maxMb": state.maxUploadSizeMb })}</span>
      {uploading && <span className="h-2 w-64 overflow-hidden rounded-full bg-muted"><span className="block h-full bg-primary" style={{ width: `${percent}%` }} /></span>}
    </button>
    {upload?.packageFormatVersion === 2 && upload.status === "READY" && <Alert><AlertDescription>{t("clientUpload.v2DetectionAndLocalValidationCompletedRemoteDeclarationsSaved")}</AlertDescription></Alert>}
    {upload && ["UPLOADING", "QUEUED", "READY", "FAILED"].includes(upload.status) && !uploading && <Button type="button" variant="outline" onClick={() => void run(async () => {
      await api(`/api/v1/clients/uploads/${upload.id}/cancel`, "POST", {});
      selectedUpload.current = null; setUpload(null); setFile(null); setPackageFormatVersion(null); setError(""); if (input.current) input.current.value = "";
    }, t("clientUpload.uploadCancelledYouCanChooseADifferentFormat"), false)}>{t("clientUpload.cancelUploadChooseFormatAgain")}</Button>}
    {upload?.processingPhase === "SELECT_INSTANCE" && upload.detectedInfo && <Alert><AlertDescription className="space-y-3"><p>{t("clientUpload.thePackContainsMultipleInstancesSelectTheClientTo")}</p>
      <Select onValueChange={instanceId => void run(async () => {
        appliedInspection.current = null;
        runtimeBaseline.current = { minecraftVersion: form.getValues("minecraftVersion"), javaVersion: form.getValues("javaVersion") };
        setUpload(await api<UploadView>(`/api/v1/clients/uploads/${upload.id}/select-instance`, "POST", { instanceId }));
      }, t("clientUpload.instanceSelectedWaitingForWorkerToContinue"), false)}><SelectTrigger className="w-full" aria-label={t("clientUpload.selectClientInstance")}><SelectValue placeholder={t("clientUpload.selectInstanceToPublish")} /></SelectTrigger><SelectContent>
        {upload.detectedInfo.candidates.map(candidate => <SelectItem key={candidate.instanceId} value={candidate.instanceId!}>{candidate.instanceId} · MC {candidate.minecraftVersion ?? t("clientUpload.needsConfirmation")} · Java {candidate.javaVersion ?? t("clientUpload.needsConfirmation")}{candidate.loader ? ` · ${candidate.loader}` : ""}</SelectItem>)}
      </SelectContent></Select>
    </AlertDescription></Alert>}
    {upload?.detectedInfo && !upload.detectedInfo.requiresSelection && <Alert><AlertDescription className="space-y-1"><p>{upload.detectedInfo.minecraftVersion && upload.detectedInfo.javaVersion ? t("clientUpload.clientDetailsDetectedAndFilledInVerifyMinecraftAnd") : t("clientUpload.clientDetectionCompletedConfirmMissingOrConflictingMinecraftJava")}</p>
      {upload.detectedInfo.pack && <p>{t("clientUpload.packName")}{upload.detectedInfo.pack.name} {" " + t("clientUpload.version") + " "}{upload.detectedInfo.pack.version}{upload.detectedInfo.pack.wrapper ? t("clientUpload.pclArchive") : " · Modrinth"}</p>}
      {upload.detectedInfo.instanceId && <p>{t("clientUpload.targetInstance")}{upload.detectedInfo.instanceId}</p>}
      {upload.detectedInfo.loader && <p>{t("clientUpload.modLoader")}{upload.detectedInfo.loader} {upload.detectedInfo.loaderVersion}</p>}
      {upload.detectedInfo.minecraftSource && <p className="break-all text-xs text-muted-foreground">{t("clientUpload.minecraftSource")}{formatMessage(t, upload.detectedInfo.minecraftSource)}</p>}
      {upload.detectedInfo.javaSource && <p className="break-all text-xs text-muted-foreground">{t("clientUpload.javaSource")}{formatMessage(t, upload.detectedInfo.javaSource)}</p>}
    </AlertDescription></Alert>}
    {file && !uploading && !processing && !upload && <Button type="button" onClick={() => void startUpload(file)}>{t("clientUpload.startUpload")}</Button>}
    {upload?.status === "FAILED" && <Alert variant="destructive"><AlertDescription>{formatMessage(t, upload.error ?? "")}<Button className="ml-3" type="button" size="sm" variant="outline" onClick={() => void run(async () => setUpload(await api<UploadView>(`/api/v1/clients/uploads/${upload.id}/retry`, "POST", {})), t("clientUpload.requeued"), false)}>{t("clientUpload.analyzeAgain")}</Button></AlertDescription></Alert>}
    {error && <Alert variant="destructive" role="alert"><AlertDescription>{formatMessage(t, error)}</AlertDescription></Alert>}
    {current && <Alert><AlertDescription>{t("clientUpload.originalVersion") + " "}{current.versionLabel}{t("clientUpload.aCompleteClientAndANewVersionNumberAre")}</AlertDescription></Alert>}
    <fieldset disabled={submitting || uploading} className="grid gap-5 sm:grid-cols-2">
      {([ ["name", t("clientUpload.clientName"), "NPUcraft"], ["versionLabel", t("clientUpload.clientVersion"), "1.4.3"], ["minecraftVersion", t("clientUpload.minecraftVersion"), "1.21.1 / 26.1"] ] as const).map(([name, label, placeholder]) => <FormField key={name} control={form.control} name={name} render={({ field }) => <FormItem><FormLabel>{label}</FormLabel><FormControl><Input {...field} placeholder={placeholder} readOnly={name === "name" && !!fixedClient} /></FormControl><FormMessage /></FormItem>} />)}
      <FormField control={form.control} name="javaVersion" render={({ field }) => <FormItem><FormLabel>{t("clientUpload.javaVersion")}</FormLabel><Select value={field.value ? String(field.value) : ""} disabled={uploading || submitting} onValueChange={value => field.onChange(Number(value))}><FormControl><SelectTrigger className="w-full"><SelectValue placeholder={t("clientUpload.waitingForDetectionOrManualSelection")} /></SelectTrigger></FormControl><SelectContent>{Array.from({ length: 19 }, (_, i) => i + 7).map(version => <SelectItem key={version} value={String(version)}>Java {version}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>} />
      <div className="space-y-3 sm:col-span-2"><h3 className="text-sm font-medium">{t("clientUpload.modList") + " "}{mods.length}</h3>
        <p className="text-xs text-muted-foreground">{!upload && current && !file ? t("clientUpload.thisIsTheOriginalVersionSModListA") : packageFormatVersion === 2 ? t("clientUpload.v2KeepsLocalModsAndRemoteDownloadDeclarationsLauncher") : t("clientUpload.localAndRemoteModsAreDetectedAutomaticallyAllOptional")}</p>
        <ModTable key={upload?.id ?? (file ? "selected-file" : "previous-version")} mods={mods} details={upload?.detectedInfo?.importFiles ?? current?.modDetails} empty={upload?.status === "READY" ? t("clientShared.noModJarFilesDetected") : processing || uploading ? t("clientUpload.processingTheModListWillAppearWhenComplete") : t("clientUpload.uploadACompleteZipMrpackToGenerateTheMod")} />
      </div>
      <FormField control={form.control} name="summary" render={({ field }) => <FormItem className="sm:col-span-2"><FormLabel>{t("clientUpload.summary")}</FormLabel><FormControl><Input {...field} placeholder={t("clientUpload.updateClientConfigurationAndMods")} /></FormControl><FormMessage /></FormItem>} />
      <FormField control={form.control} name="description" render={({ field }) => <FormItem className="sm:col-span-2"><FormLabel>{t("clientUpload.descriptionMarkdown")}</FormLabel><Tabs defaultValue="edit"><TabsList><TabsTrigger value="edit">{t("clientUpload.edit")}</TabsTrigger><TabsTrigger value="preview">{t("clientUpload.preview")}</TabsTrigger></TabsList><TabsContent value="edit"><FormControl><Textarea {...field} rows={7} placeholder={t("clientUpload.describeTheClientReasonsForTheUpdateAndAny")} /></FormControl></TabsContent><TabsContent value="preview" className="min-h-40 rounded-md border p-4"><MarkdownText value={description} /></TabsContent></Tabs><FormMessage /></FormItem>} />
    </fieldset>
    {upload?.statistics && <UpdateStats statistics={upload.statistics} comparison={upload.comparisonStatistics} version={version} updating={!!fixedClient} />}
    {upload?.recipeStatistics && <RecipeImportStats statistics={upload.recipeStatistics} />}
    {upload?.recipeStatistics && <RecipeDistributionStats path={`/api/v1/clients/uploads/${upload.id}/distribution-statistics`} />}
    {!!warnings.length && <Alert><AlertDescription>{warnings.map((warning, index) => <p key={index}>{formatMessage(t, warning)}</p>)}</AlertDescription></Alert>}
    <PackageBuildOptions packageFormatVersion={packageFormatVersion} value={platforms} onChange={setPlatforms} disabled={uploading || submitting} />
    <div className="flex items-center justify-between gap-4 border-t pt-5"><p className="text-xs text-muted-foreground">{packageFormatVersion === 2 ? t("clientUpload.v2FullPackagesContainLocalPayloadsAndRemoteRecipes") : t("clientUpload.checkDetectedMinecraftAndJavaVersionsEnterTheRelease")}</p><Button type="submit" disabled={packageFormatVersion === 1 && !platforms.length || upload?.status !== "READY" || uploading || submitting}>{submitting && <LoaderCircle className="size-4 animate-spin" />}{t("clientUpload.submitForReview")}</Button></div>
  </form></Form>;
}
