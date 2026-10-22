"use client";
import { useI18n } from "@/components/preferences";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { LoaderCircle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { api, useAdmin } from "./provider";
import { diagnosticText } from "@/lib/diagnostics";
export type Values = Record<string, string | boolean | string[]>;
export type Field = { visibleWhen?: { name: string; value: string }; name: string; label: string; type?: "datetime-local" | "text" | "password" | "textarea" | "number" | "checkbox" | "select" | "roles"; hint?: string; placeholder?: string; options?: { value: string; label: string; disabled?: boolean; translate?: boolean }[]; autoComplete?: string };
export const nameSchema = z.string().trim().min(1, "form.enterAName").max(200, "form.atMost200Characters");
export const textSchema = (max = 5000) => z.string().trim().max(max, diagnosticText("validation.maxCharacters", { max }));
export const passwordSchema = z.string().min(12, "form.passwordMustHaveAtLeast12Characters").max(128, "form.passwordCanHaveAtMost128Characters");
const subscribe = () => () => {};
const clientReady = () => true;
const serverReady = () => false;
export function SchemaForm({ schema, fields, defaults, onSubmit, action, disabled = false, label = "common.actions.save" }: { schema: z.ZodType<Values>; fields: Field[]; defaults: Values; onSubmit: (values: Values) => Promise<boolean>; action?: string; disabled?: boolean; label?: string }) {
  const { t } = useI18n();
  const ready = useSyncExternalStore(subscribe, clientReady, serverReady);
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: defaults });
  const values = useWatch({ control: form.control });
  // These forms submit through their JSON handlers. Never fall back to GET,
  // including before hydration or when scripts fail to load.
  return <Form {...form}><form method="post" action={action} onSubmit={form.handleSubmit(async values => { await onSubmit(values); })} className="space-y-5">
    <fieldset disabled={!ready || disabled || form.formState.isSubmitting} className="space-y-5">
      {fields.filter(spec => !spec.visibleWhen || values[spec.visibleWhen.name] === spec.visibleWhen.value).map(spec => <FormField key={spec.name} control={form.control} name={spec.name} render={({ field }) => <FormItem>
        {spec.type !== "checkbox" && <FormLabel>{t(spec.label)}</FormLabel>}
        {spec.type === "checkbox" ? <div className="flex items-center gap-2"><FormControl><Checkbox checked={!!field.value} onCheckedChange={field.onChange} disabled={disabled || form.formState.isSubmitting} /></FormControl><FormLabel>{t(spec.label)}</FormLabel></div>
          : spec.type === "roles" ? <div className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2">{spec.options?.map(option => <label key={option.value} className="flex items-center gap-2 text-sm"><Checkbox checked={Array.isArray(field.value) && field.value.includes(option.value)} disabled={disabled || form.formState.isSubmitting || option.disabled} onCheckedChange={checked => field.onChange(checked ? [...(Array.isArray(field.value) ? field.value : []), option.value] : (Array.isArray(field.value) ? field.value : []).filter(value => value !== option.value))} />{option.translate === false ? option.label : t(option.label)}</label>)}</div>
          : spec.type === "select" ? <Select value={String(field.value ?? "")} onValueChange={field.onChange} disabled={disabled || form.formState.isSubmitting}><FormControl><SelectTrigger className="w-full"><SelectValue placeholder={t("common.select.placeholder")} /></SelectTrigger></FormControl><SelectContent>{spec.options?.map(option => <SelectItem key={option.value} value={option.value} disabled={option.disabled}>{option.translate === false ? option.label : t(option.label)}</SelectItem>)}</SelectContent></Select>
          : spec.type === "textarea" ? <FormControl><Textarea {...field} value={String(field.value ?? "")} rows={4} placeholder={spec.placeholder ? t(spec.placeholder) : undefined} /></FormControl>
          : <FormControl><Input {...field} value={String(field.value ?? "")} type={spec.type || "text"} step={spec.type === "datetime-local" ? 1 : undefined} autoComplete={spec.autoComplete} placeholder={spec.placeholder ? t(spec.placeholder) : undefined} /></FormControl>}
        {spec.hint && <FormDescription>{t(spec.hint)}</FormDescription>}<FormMessage />
      </FormItem>} />)}
      <Button type="submit" disabled={disabled || form.formState.isSubmitting}>{form.formState.isSubmitting && <LoaderCircle className="size-4 animate-spin" />}{t(label)}</Button>
    </fieldset>
  </form></Form>;
}
export function EditorDialog({ title, description = "form.changesTakeEffectImmediatelyAndAreRecordedInThe", trigger, children, disabled = false }: { title: string; description?: string; trigger?: ReactNode; children: (close: () => void) => ReactNode; disabled?: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild>{trigger ?? <Button disabled={disabled}><Plus className="size-4" />{t(title)}</Button>}</DialogTrigger><DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl"><DialogHeader><DialogTitle>{t(title)}</DialogTitle><DialogDescription>{t(description)}</DialogDescription></DialogHeader>{open && children(() => setOpen(false))}</DialogContent></Dialog>;
}
export function ArchiveButton({ kind, id, archived, disabled = false }: { kind: "organizations" | "servers" | "clients"; id: string; archived: boolean; disabled?: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const { busy, run } = useAdmin();
  const label = archived ? t("form.restore") : t("form.archive");
  return <AlertDialog open={open} onOpenChange={setOpen}><AlertDialogTrigger asChild><Button variant="outline" size="sm" disabled={disabled || busy}>{t(label)}</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t("form.archiveConfirmation", { action: label })}</AlertDialogTitle><AlertDialogDescription>{archived ? t("form.restoreTheRetainedRecordListingAndCurrentVersionBindings") : t("form.archivingStopsDistributionAndClearsTheCurrentVersionBinding")}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={busy}>{t("common.actions.cancel")}</AlertDialogCancel><Button disabled={busy} variant={archived ? "default" : "destructive"} onClick={async () => { if (await run(() => api(`/api/admin/${kind}/${id}/archive`, "POST", { archived: !archived }), archived ? t("form.restored") : t("clients.archived"))) setOpen(false); }}>{t(label)}</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>;
}
