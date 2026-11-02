import "server-only";
import { isIP } from "node:net";
import { publicDownloadAddress } from "./remote-download";
import type { SiteReader, SiteResource } from "./union-site-icons";

const redirects = new Set([301, 302, 303, 307, 308]);
const limit = 64 * 1024;

// URL checks are repeated for every redirect/ALI target. Readers also pin public DNS answers.
export function yggdrasilApiUrl(value: string): URL {
  if (!value || value.length > 2048 || /[\x00-\x20\x7f]/.test(value)) throw new Error("UNSAFE_AUTH_ENDPOINT");
  const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.port && url.port !== "443"
    || host === "localhost" || host.endsWith(".localhost") || isIP(host) && !publicDownloadAddress(host)) throw new Error("UNSAFE_AUTH_ENDPOINT");
  return url;
}

// ALI is one address indication, not a recursive ALI chain. Fetch its target only for metadata.
// https://github.com/yushijinhun/authlib-injector/blob/develop/wiki/src/zh/启动器技术规范.md
export async function resolveYggdrasilApi(value: string, read: SiteReader, signal: AbortSignal) {
  let hops = 0;
  const visited = new Set<string>();
  async function get(value: string, followAli: boolean): Promise<{ url: URL; response: SiteResource }> {
    let url = yggdrasilApiUrl(value);
    for (;;) {
      signal.throwIfAborted();
      if (visited.has(url.href) || ++hops > 8) throw new Error("AUTH_DISCOVERY_REDIRECT_LIMIT");
      visited.add(url.href);
      const response = await read(url.href, limit, signal, { validate: yggdrasilApiUrl, followAli });
      signal.throwIfAborted();
      if (response.bytes.length > limit) throw new Error("AUTH_DISCOVERY_RESPONSE_LIMIT");
      // SiteReader may already have followed validated redirects; resolve relative ALI at the final URL.
      url = yggdrasilApiUrl(response.url ?? url.href);
      if (redirects.has(response.status ?? 200)) {
        if (!response.location) throw new Error("AUTH_DISCOVERY_INVALID_REDIRECT");
        url = yggdrasilApiUrl(new URL(response.location, url).href);
        continue;
      }
      if ((response.status ?? 200) !== 200 && !(followAli && response.apiLocation !== undefined)) throw new Error("AUTH_DISCOVERY_FAILED");
      return { url, response };
    }
  }
  let result = await get(value, true);
  if (result.response.apiLocation !== undefined) {
    if (!result.response.apiLocation.trim()) throw new Error("AUTH_DISCOVERY_INVALID_ALI");
    const target = yggdrasilApiUrl(new URL(result.response.apiLocation, result.url).href);
    if (target.href !== result.url.href) result = await get(target.href, false);
  }
  if ((result.response.status ?? 200) !== 200) throw new Error("AUTH_METADATA_INVALID");
  if (!/^application\/(?:[\w.+-]+\+)?json(?:\s*;|$)/i.test(result.response.contentType)) throw new Error("AUTH_METADATA_INVALID");
  const metadata: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(result.response.bytes));
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)
    || !("meta" in metadata) || !metadata.meta || typeof metadata.meta !== "object" || Array.isArray(metadata.meta)) throw new Error("AUTH_METADATA_INVALID");
  return { apiRoot: result.url.href, metadata };
}

export function yggdrasilEndpoint(apiRoot: string, path: string) {
  const root = yggdrasilApiUrl(apiRoot);
  if (!root.pathname.endsWith("/")) root.pathname += "/";
  return new URL(path, root);
}
