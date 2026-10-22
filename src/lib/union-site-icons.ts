import { diagnosticText } from "@/lib/diagnostics";
import "server-only";
import sharp from "sharp";
import type { DownloadSettings } from "./download-settings";
import { remoteResponse, remoteSourceUrl } from "./remote-download";
import { invariant } from "./errors";
export type SiteResource = { bytes: Buffer; contentType: string };
export type SiteReader = (url: string, maxBytes: number, signal: AbortSignal) => Promise<SiteResource>;
export function siteReader(settings: DownloadSettings): SiteReader {
  const network = { ...settings, remoteSourceWhitelistEnabled: false };
  return async (url, limit, signal) => {
    const response = await remoteResponse(url, network, signal, value => remoteSourceUrl(value, network), 6000);
    const chunks: Buffer[] = []; let size = 0;
    try {
      for await (const chunk of response) { size += chunk.length; invariant(size <= limit, 422, diagnosticText("diagnostics.unionSiteIcons.theSiteResponseExceedsTheSizeLimit")); chunks.push(Buffer.from(chunk)); }
      return { bytes: Buffer.concat(chunks), contentType: String(response.headers["content-type"] ?? "") };
    } finally { response.destroy(); }
  };
}
export function siteIconCandidates(html: string, root: string) {
  const result: string[] = [];
  for (const tag of html.match(/<link\b[^>]{0,4096}>/gi) ?? []) {
    const attrs = Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)].map(m => [m[1].toLowerCase(), (m[2] ?? m[3] ?? m[4]).replace(/&amp;/g, "&")]));
    if (!(attrs.rel ?? "").toLowerCase().split(/\s+/).some(r => r === "icon" || r === "apple-touch-icon") || !attrs.href) continue;
    try { const u = new URL(attrs.href, root + "/"); if (u.protocol === "https:" && !u.username && !u.password) result.push(u.href); } catch { /* Ignore malformed untrusted markup. */ }
  }
  result.push(new URL("favicon.ico", root + "/").href, new URL("/favicon.ico", root).href);
  return [...new Set(result)].slice(0, 6);
}
// ICO is a container, not an image format accepted from manual uploads. Decode one bounded raster entry only.
export async function iconRaster(bytes: Buffer) {
  if (bytes.length < 6 || bytes.readUInt32LE(0) !== 0x10000) return bytes;
  const count = bytes.readUInt16LE(4); invariant(count > 0 && count <= 256 && bytes.length >= 6 + count * 16, 422, diagnosticText("diagnostics.unionSiteIcons.invalidSiteIcon"));
  const entries = Array.from({ length: count }, (_, i) => { const at = 6 + i * 16; return { width: bytes[at] || 256, height: bytes[at + 1] || 256, size: bytes.readUInt32LE(at + 8), offset: bytes.readUInt32LE(at + 12) }; }).sort((a, b) => b.width * b.height - a.width * a.height);
  for (const e of entries) {
    if (e.offset < 6 + count * 16 || e.size > 8 * 1024 * 1024 || e.offset + e.size > bytes.length) continue;
    const data = bytes.subarray(e.offset, e.offset + e.size);
    if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return data;
    if (data.length < 40 || data.readUInt32LE(0) !== 40 || data.readUInt32LE(16) !== 0) continue;
    const bits = data.readUInt16LE(14); if (bits !== 24 && bits !== 32) continue;
    if (data.readInt32LE(4) !== e.width || data.readInt32LE(8) !== e.height * 2) continue;
    const stride = Math.ceil(e.width * bits / 32) * 4, maskStride = Math.ceil(e.width / 32) * 4;
    if (data.length < 40 + stride * e.height + maskStride * e.height) continue;
    const rgba = Buffer.alloc(e.width * e.height * 4); let hasAlpha = false;
    for (let y = 0; y < e.height; y++) for (let x = 0; x < e.width; x++) {
      const source = 40 + (e.height - 1 - y) * stride + x * (bits / 8), target = (y * e.width + x) * 4;
      rgba[target] = data[source + 2]; rgba[target + 1] = data[source + 1]; rgba[target + 2] = data[source]; rgba[target + 3] = bits === 32 ? data[source + 3] : 255;
      if (rgba[target + 3]) hasAlpha = true;
    }
    for (let y = 0; y < e.height; y++) for (let x = 0; x < e.width; x++) {
      const hidden = data[40 + stride * e.height + (e.height - 1 - y) * maskStride + (x >> 3)] & (128 >> (x & 7));
      const at = (y * e.width + x) * 4 + 3; if (hidden) rgba[at] = 0; else if (!hasAlpha) rgba[at] = 255;
    }
    return sharp(rgba, { raw: { width: e.width, height: e.height, channels: 4 } }).png().toBuffer();
  }
  throw new Error("UNSUPPORTED_ICON");
}
export async function fetchSiteIcon(root: string, read: SiteReader, signal: AbortSignal) {
  let html = "";
  try { const page = await read(root, 512 * 1024, signal); if (page.contentType.includes("text/html")) html = page.bytes.toString("utf8"); } catch { signal.throwIfAborted(); }
  for (const url of siteIconCandidates(html, root)) {
    try {
      const response = await read(url, 8 * 1024 * 1024, signal), image = await iconRaster(response.bytes);
      const metadata = await sharp(image, { limitInputPixels: 16_000_000, failOn: "warning" }).metadata();
      invariant(["png", "jpeg", "webp"].includes(metadata.format ?? "") && (metadata.pages ?? 1) === 1, 422, "UNSUPPORTED_ICON");
      return image;
    } catch { signal.throwIfAborted(); }
  }
  throw new Error("ICON_UNAVAILABLE");
}
