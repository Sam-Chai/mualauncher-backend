import "server-only";
import { NextResponse } from "next/server";
import { AppError, invariant } from "./errors";

export function appOrigin() {
  const value = process.env.APP_ORIGIN ?? "http://localhost:3000";
  const url = new URL(value);
  invariant(["http:", "https:"].includes(url.protocol) && url.origin === value, 500, "APP_ORIGIN 必须是完整站点 origin");
  return url.origin;
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const expected = appOrigin();
  invariant(origin === expected || localOriginAlias(request, origin, expected), 403, "请求来源不被允许");
  invariant(!request.headers.get("sec-fetch-site") || ["same-origin", "none"].includes(request.headers.get("sec-fetch-site")!), 403, "禁止跨站修改");
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
  invariant(request.headers.get("content-type")?.split(";")[0].trim() === "application/json", 415, "请使用 application/json");
  invariant(request.body, 400, "请求内容不能为空");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maximumBytes) { await reader.cancel(); throw new AppError(413, `请求内容超过 ${maximumBytes / 1024} KiB`); }
    chunks.push(value);
  }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw new AppError(400, "无效的 JSON"); }
}
export function json(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
export function failure(error: unknown) {
  if (error instanceof AppError) return json({ error: error.message }, error.status);
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : undefined;
  if (["P2002", "23505"].includes(code ?? "")) return json({ error: "标识或用户名已存在，归档记录的标识也不能重复使用" }, 409);
  if (["P2003", "P2004", "P2010", "P2025", "23503", "23514"].includes(code ?? "")) return json({ error: "操作不符合数据库约束或资源状态，请刷新后重试" }, 409);
  console.error("MUA request failed", { name: error instanceof Error ? error.name : "UnknownError", code });
  return json({ error: "服务暂时不可用，请稍后重试" }, 500);
}
