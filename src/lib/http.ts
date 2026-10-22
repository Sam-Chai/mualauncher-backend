import { diagnosticText } from "@/lib/diagnostics";
import "server-only";
import { NextResponse } from "next/server";
import { AppError, invariant } from "./errors";
import { diagnosticView } from "./diagnostics";

export function appOrigin() {
  const value = process.env.APP_ORIGIN ?? "http://localhost:3000";
  const url = new URL(value);
  invariant(["http:", "https:"].includes(url.protocol) && url.origin === value, 500, diagnosticText("diagnostics.http.appOriginMustBeACompleteSiteOrigin"));
  return url.origin;
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const expected = appOrigin();
  invariant(origin === expected || localOriginAlias(request, origin, expected), 403, diagnosticText("diagnostics.http.requestOriginNotAllowed"));
  invariant(!request.headers.get("sec-fetch-site") || ["same-origin", "none"].includes(request.headers.get("sec-fetch-site")!), 403, diagnosticText("diagnostics.http.crossSiteWritesAreNotAllowed"));
}

// Only a local deployment may use loopback aliases. Match the scheme and port
// against both the configured origin and this request; never trust arbitrary Host aliases.
function localOriginAlias(request: Request, origin: string | null, expected: string) {
  if (!origin) return false;
  try {
    const configured = new URL(expected);
    const source = new URL(origin);
    const target = new URL(request.url);
    const loopback = new Set(["localhost", "127.0.0.1", "[::1]"]);
    return origin === source.origin && [configured, source, target].every(url => loopback.has(url.hostname)) &&
      source.protocol === configured.protocol && source.port === configured.port &&
      source.protocol === target.protocol && source.port === target.port;
  } catch { return false; }
}
export async function readJson(request: Request, maximumBytes = 32768) {
  invariant(request.headers.get("content-type")?.split(";")[0].trim() === "application/json", 415, diagnosticText("diagnostics.http.useApplicationJson"));
  invariant(request.body, 400, diagnosticText("diagnostics.http.theRequestBodyMustNotBeEmpty"));
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maximumBytes) { await reader.cancel(); throw new AppError(413, diagnosticText("diagnostics.http.theRequestBodyExceeds0Kib", { arg0: maximumBytes / 1024 })); }
    chunks.push(value);
  }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw new AppError(400, diagnosticText("diagnostics.http.invalidJson")); }
}
export function json(value: unknown, status = 200) {
  return NextResponse.json(diagnosticView(value), { status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization", "X-Content-Type-Options": "nosniff" } });
}
export function failure(error: unknown) {
  if (error instanceof AppError) return json({ error: error.message, code: error.diagnostic.code, params: error.diagnostic.params }, error.status);
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : undefined;
  const meta = error && typeof error === "object" && "meta" in error ? error.meta : undefined;
  const sqlCode = meta && typeof meta === "object" && "code" in meta ? String(meta.code) : code;
  if (sqlCode === "42501") return failure(new AppError(403, diagnosticText("diagnostics.http.permissionDeniedForThisResourceOperation")));
  if (sqlCode === "40001") return failure(new AppError(409, diagnosticText("diagnostics.http.theResourceHasChangedRefreshAndRetry")));
  if (["P2002", "23505"].includes(code ?? "")) return failure(new AppError(409, diagnosticText("diagnostics.http.theIdentifierOrUsernameAlreadyExistsArchivedIdentifiersCannotBe")));
  if (["P2003", "P2004", "P2010", "P2025", "23503", "23514"].includes(code ?? "")) return failure(new AppError(409, diagnosticText("diagnostics.http.theOperationViolatesADatabaseConstraintOrResourceStateRefresh")));
  console.error("MUA request failed", { name: error instanceof Error ? error.name : "UnknownError", code });
  return failure(new AppError(500, diagnosticText("diagnostics.http.theServiceIsTemporarilyUnavailableTryAgainLater")));
}
