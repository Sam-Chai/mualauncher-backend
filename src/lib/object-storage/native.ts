import { createHash } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { invariant } from "../errors";
import type { CompleteInput, ObjectHead, PutInput, StorageOptions } from "./types";

export class StorageError extends Error {
  readonly $metadata: { httpStatusCode?: number };
  constructor(readonly provider: string, status?: number, readonly code?: string) {
    super(`${provider} object storage operation failed${status ? ` (${status})` : ""}`);
    this.$metadata = { httpStatusCode: status };
  }
}
export function nativeError(provider: string, error: unknown): Error {
  if (error instanceof StorageError || (error instanceof Error && error.name === "AbortError")) return error;
  const row = error as { status?: number; statusCode?: number; code?: string; Code?: string; error?: { Code?: string } } | null;
  const code = row?.code ?? row?.Code ?? row?.error?.Code;
  const status = row?.statusCode ?? row?.status;
  return new StorageError(provider, status === 409 && ["FileAlreadyExists", "ObjectAlreadyExists", "AlreadyExists"].includes(code ?? "") ? 412 : status, code);
}
export const truncated = (value: unknown) => value === true || value === "true";
export const array = <T>(value: T | T[] | undefined): T[] => value === undefined ? [] : Array.isArray(value) ? value : [value];
export function headerHead(headers: Record<string, string>, prefix: string): ObjectHead {
  const lower = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  const length = lower["content-length"];
  return { ContentLength: length === undefined ? undefined : Number(length), ContentType: lower["content-type"], ETag: lower.etag,
    Metadata: Object.fromEntries(Object.entries(lower).filter(([key]) => key.startsWith(prefix)).map(([key, value]) => [key.slice(prefix.length), value])) };
}
export function noVersioning(status: string | undefined) {
  invariant(!status || status === "Disabled", 503, "云存储桶必须关闭且从未启用版本控制，以确保禁止覆盖已签名对象");
}
export async function createdUpload(operation: () => Promise<{ UploadId?: string }>, options: StorageOptions | undefined, cleanup: (id: string) => Promise<unknown>) {
  options?.abortSignal?.throwIfAborted();
  const result = await operation();
  if (options?.abortSignal?.aborted) {
    if (result.UploadId) await cleanup(result.UploadId);
    options.abortSignal.throwIfAborted();
  }
  return result;
}
export function nativePut(input: PutInput) {
  if (Buffer.isBuffer(input.Body)) {
    if (input.ChecksumSHA256) invariant(createHash("sha256").update(input.Body).digest("base64") === input.ChecksumSHA256, 422, "对象上传 SHA-256 不匹配");
    return { body: input.Body, md5: createHash("md5").update(input.Body).digest("base64") };
  }
  if (!input.ChecksumSHA256) return { body: input.Body };
  const hash = createHash("sha256");
  const verified = new Transform({ transform(chunk, _, done) { hash.update(chunk); done(null, chunk); },
    flush(done) { done(hash.digest("base64") === input.ChecksumSHA256 ? null : new Error("对象上传 SHA-256 不匹配")); } });
  const source = input.Body;
  source.on("error", error => verified.destroy(error));
  verified.once("close", () => source.destroy());
  return { body: source.pipe(verified) };
}
export type NativeSignature = { url: string; headers?: Record<string, string> };
export async function signedRequest(provider: string, signature: NativeSignature, method: string, body?: Buffer | Readable, options?: StorageOptions) {
  options?.abortSignal?.throwIfAborted();
  let response: Response;
  try {
    response = await fetch(signature.url, { method, headers: signature.headers, body: body as unknown as BodyInit | undefined,
      ...(body instanceof Readable ? { duplex: "half" } : {}), signal: options?.abortSignal, redirect: "error" });
  } catch (error) { if (options?.abortSignal?.aborted) throw options.abortSignal.reason; throw nativeError(provider, error); }
  if (!response.ok) {
    const text = (await response.text()).slice(0, 65536), code = /<Code>([^<]{1,100})<\/Code>/.exec(text)?.[1];
    throw nativeError(provider, { status: response.status, code });
  }
  return response;
}
export async function signedRead(provider: string, url: string, prefix: string, options?: StorageOptions) {
  const response = await signedRequest(provider, { url }, "GET", undefined, options);
  return { ...headerHead(Object.fromEntries(response.headers), prefix), Body: response.body ? Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]) : undefined };
}
export const xmlEscape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
export function completeXml(input: CompleteInput) {
  return Buffer.from(`<CompleteMultipartUpload>${input.MultipartUpload.Parts.map(part => `<Part><PartNumber>${part.PartNumber}</PartNumber><ETag>${xmlEscape(part.ETag)}</ETag></Part>`).join("")}</CompleteMultipartUpload>`);
}
export async function completedResponse(provider: string, response: Response) {
  // Completion APIs can return HTTP 200 with an embedded Error body.
  const text = await response.text();
  if (/<Error[\s>]/.test(text)) throw nativeError(provider, { status: 500, code: /<Code>([^<]+)<\/Code>/.exec(text)?.[1] });
  return {};
}
