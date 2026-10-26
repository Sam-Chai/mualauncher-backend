import { z } from "zod";
import { hasMessage, translator, type MessageKey, type Translate } from "./i18n";

export const diagnosticSchema = z.object({ code: z.string(), message: z.string(), params: z.record(z.string(), z.union([z.string(), z.number()])) }).strict();
export type Diagnostic = z.infer<typeof diagnosticSchema>;
export type DisplayMessage = string | Diagnostic;
type DiagnosticFields = "error" | "phase" | "message" | "minecraftSource" | "javaSource";
export type DiagnosticView<T> = T extends Diagnostic | Date ? T : T extends readonly (infer Item)[] ? DiagnosticView<Item>[] : T extends object ? {
  [K in keyof T]: K extends DiagnosticFields ? T[K] extends string | null ? Diagnostic | Extract<T[K], null> : DiagnosticView<T[K]> : K extends "warnings" ? Diagnostic[] : DiagnosticView<T[K]>
} : T;
const english = translator("en-US");

export function diagnostic(code: MessageKey, params: Record<string, unknown> = {}): Diagnostic {
  const values = Object.fromEntries(Object.entries(params).map(([key, value]) => [key, typeof value === "number" ? value : plainDiagnosticText(String(value ?? ""))]));
  return { code, message: english(code, values), params: values };
}
/** Serialized, structured diagnostics fit existing text columns and Zod messages. */
export const diagnosticText = (code: MessageKey, params?: Record<string, unknown>): string => JSON.stringify(diagnostic(code, params));
export function parseDiagnostic(value: unknown): Diagnostic | null {
  if (typeof value === "string") {
    if (!value.startsWith('{"code":')) return null;
    try { value = JSON.parse(value); } catch { return null; }
  }
  const parsed = diagnosticSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
export const plainDiagnosticText = (value: DisplayMessage | null | undefined) => parseDiagnostic(value)?.message ?? String(value ?? "");
export function errorDiagnostic(error: unknown): Diagnostic {
  if (error && typeof error === "object" && "diagnostic" in error) {
    const value = parseDiagnostic(error.diagnostic); if (value) return value;
  }
  const raw = error instanceof Error ? error.message : error;
  const parsed = parseDiagnostic(raw); if (parsed) return parsed;
  if (typeof raw === "string" && hasMessage(raw)) return diagnostic(raw);
  return { code: "diagnostics.common.unexpectedError", message: typeof raw === "string" && raw ? raw : "An unexpected error occurred", params: {} };
}
export const serializeError = (error: unknown) => JSON.stringify(errorDiagnostic(error));
export function formatMessage(t: Translate, value: DisplayMessage): string {
  const message = parseDiagnostic(value);
  return message ? hasMessage(message.code) ? t(message.code, message.params) : message.message : t(String(value));
}
export function diagnosticView<T>(value: T): DiagnosticView<T> {
  const fields = new Set(["error", "phase", "message", "minecraftSource", "javaSource", "warnings"]);
  function visit(child: unknown, diagnosticField = false, fieldName = ""): unknown {
    if (parseDiagnostic(child) && typeof child === "object") return child;
    if (diagnosticField && typeof child === "string") return parseDiagnostic(child) ?? (
      fieldName === "minecraftSource" || fieldName === "javaSource" ? { code: "SOURCE_REFERENCE", message: child, params: {} } : diagnostic("diagnostics.common.detailsUnavailable")
    );
    if (Array.isArray(child)) return child.map(item => visit(item, diagnosticField, fieldName));
    if (child && typeof child === "object" && !(child instanceof Date)) {
      const envelope = "code" in child && "error" in child;
      return Object.fromEntries(Object.entries(child).map(([key, item]) => [key, visit(item, fields.has(key) && !(envelope && key === "error"), key)]));
    }
    return child;
  }
  return visit(value) as DiagnosticView<T>;
}
