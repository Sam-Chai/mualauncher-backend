import { diagnosticText } from "@/lib/diagnostics";
import "server-only";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { IncomingMessage } from "node:http";
import { AppError, invariant } from "./errors";
import { remoteResponse } from "./remote-download";
import { DEFAULT_ENVIRONMENT_DOWNLOAD_SETTINGS } from "./download-sources";
import { environmentCandidates, environmentCandidateUrl, type EnvironmentCandidate, type EnvironmentSettings } from "./environment-source-policy";
export { trustedEnvironmentUrl, environmentCandidates, environmentCandidateUrl } from "./environment-source-policy";
export type EnvironmentExpected = { algorithm: "sha1" | "sha256"; hash: string; size?: number };
export type EnvironmentByteOptions = { expected?: EnvironmentExpected; validate?: (bytes: Buffer) => void };
export type EnvironmentTransport = (candidate: EnvironmentCandidate, signal: AbortSignal) => Promise<IncomingMessage>;
export function createEnvironmentDownloader(settings: EnvironmentSettings, transport?: EnvironmentTransport) {
  const failures = new Map<string, { count: number; until: number }>();
  const request: EnvironmentTransport = transport ?? ((candidate, signal) => remoteResponse(candidate.url,
    { ...settings, remoteSourceWhitelistEnabled: false, remoteSourceHosts: [], downloadProxyEnabled: candidate.proxy, dnsProxyEnabled: settings.downloadProxyEnabled }, signal,
    value => environmentCandidateUrl(value, candidate, settings), 20000));
  async function fallback<T>(url: string, signal: AbortSignal, work: (response: IncomingMessage, signal: AbortSignal) => Promise<T>) {
    let last: unknown;
    for (const candidate of environmentCandidates(url, settings)) {
      signal.throwIfAborted(); const key = `${candidate.source}/${candidate.category}`;
      if (candidate.mirror && (failures.get(key)?.until ?? 0) > Date.now()) continue;
      let response: IncomingMessage | undefined;
      const timeout = AbortSignal.any([signal, AbortSignal.timeout(candidate.mirror ? 5 * 60 * 1000 : 10 * 60 * 1000)]);
      try {
        response = await request(candidate, timeout);
        invariant(response.statusCode === 200, 422, diagnosticText("diagnostics.environmentDownload.environmentDownloadFailed0Http1", { arg0: candidate.source, arg1: response.statusCode }));
        invariant(!response.headers["content-encoding"] || response.headers["content-encoding"] === "identity", 422, diagnosticText("diagnostics.environmentDownload.transferCompressionIsNotAllowedForEnvironmentFiles"));
        const result = await work(response, timeout); failures.delete(key); return result;
      } catch (error) {
        response?.destroy(); signal.throwIfAborted(); last = error;
        if (candidate.mirror) { const count = (failures.get(key)?.count ?? 0) + 1;
          failures.set(key, { count, until: count >= 2 ? Date.now() + 60000 : 0 }); }
      }
    }
    throw new AppError(422, diagnosticText("diagnostics.environmentDownload.mirrorAndOfficialEnvironmentSourcesAreUnavailable0", { arg0: last instanceof AppError ? last.message : "Network failure or download timeout" }));
  }
  return {
    async bytes(url: string, signal: AbortSignal, maximum = 16 * 1024 ** 2, options: EnvironmentByteOptions = {}) {
      return fallback(url, signal, async (response, timeout) => {
        const chunks: Buffer[] = []; let length = 0;
        invariant(Number(response.headers["content-length"] ?? 0) <= maximum, 422, diagnosticText("diagnostics.environmentDownload.environmentMetadataIsTooLarge"));
        const abort = () => response.destroy(new Error(diagnosticText("diagnostics.environmentDownload.environmentDownloadWasInterrupted"))); timeout.addEventListener("abort", abort, { once: true });
        try { timeout.throwIfAborted(); for await (const bytes of response) {
          length += bytes.length; invariant(length <= maximum, 422, diagnosticText("diagnostics.environmentDownload.environmentMetadataIsTooLarge")); chunks.push(Buffer.from(bytes));
        } } finally { timeout.removeEventListener("abort", abort); }
        const bytes = Buffer.concat(chunks), expected = options.expected;
        invariant(!expected || createHash(expected.algorithm).update(bytes).digest("hex") === expected.hash && (expected.size === undefined || expected.size === bytes.length), 422, diagnosticText("diagnostics.environmentDownload.environmentMetadataHashOrSizeValidationFailed"));
        options.validate?.(bytes); return bytes;
      });
    },
    async download(url: string, path: string, signal: AbortSignal, expected?: EnvironmentExpected) {
      // Only remove retry files created by this call; never overwrite caller files.
      let owned = false;
      try { return await fallback(url, signal, async (response, timeout) => {
        if (owned) { await rm(path, { force: true }); owned = false; }
        invariant(Number(response.headers["content-length"] ?? 0) <= 2 * 1024 ** 3, 422, diagnosticText("diagnostics.environmentDownload.anEnvironmentFileExceeds2Gib"));
        let size = 0; const hash = createHash("sha256"), upstream = expected ? createHash(expected.algorithm) : null;
        const output = createWriteStream(path, { flags: "wx" }); output.once("open", () => { owned = true; });
        await pipeline(response, new Transform({ transform(chunk: Buffer, _, callback) {
          size += chunk.length; if (size > 2 * 1024 ** 3 || expected?.size !== undefined && size > expected.size) { callback(new Error(diagnosticText("diagnostics.environmentDownload.anEnvironmentFileExceedsItsDeclaredSize"))); return; }
          hash.update(chunk); upstream?.update(chunk); callback(null, chunk);
        } }), output, { signal: timeout });
        invariant(!expected || upstream?.digest("hex") === expected.hash && (expected.size === undefined || expected.size === size), 422, diagnosticText("diagnostics.environmentDownload.environmentFileHashOrSizeValidationFailed"));
        return { sha256: hash.digest("hex"), size };
      }); } catch (error) { if (owned) await rm(path, { force: true }); throw error; }
    },
  };
}
// Retained for inspection tools that explicitly want official-only downloads.
const official = () => createEnvironmentDownloader({ ...DEFAULT_ENVIRONMENT_DOWNLOAD_SETTINGS, minecraftDownloadSources: [], javaDownloadSources: [], downloadProxyEnabled: false, downloadProxyUrl: "" });
export const environmentBytes = (url: string, signal: AbortSignal, maximum?: number) => official().bytes(url, signal, maximum);
export const downloadEnvironment = (url: string, path: string, signal: AbortSignal, expected?: EnvironmentExpected) => official().download(url, path, signal, expected);
