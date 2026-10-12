import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import http, { type IncomingMessage } from "node:http";
import https from "node:https";
import tls from "node:tls";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { AppError, invariant } from "./errors";
import type { DownloadSettings } from "./download-settings";
type NetworkSettings = DownloadSettings & { dnsProxyEnabled?: boolean };

export function publicDownloadAddress(address: string) {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 ||
      a === 192 && (b === 168 || b === 0 || b === 2 || b === 88 && c === 99) || a === 100 && b >= 64 && b <= 127 ||
      a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113);
  }
  // Only global unicast IPv6; exclude documentation, transition and special-purpose ranges.
  const ip = address.toLowerCase();
  return isIP(ip) === 6 && /^[23]/.test(ip) && !/^2001:(?:db8|0|10|20)(?::|$)/.test(ip) && !/^2002:/.test(ip) && !/^3fff:/.test(ip);
}
export function remoteSourceUrl(value: string, settings: DownloadSettings) {
  let url: URL; try { url = new URL(value); } catch { throw new AppError(422, "远程下载地址无效"); }
  invariant(url.protocol === "https:" && (!url.port || url.port === "443") && !url.username && !url.password && !url.hash && !/[\x00-\x20\x7f]/.test(value), 422, "远程文件仅支持无凭据的 HTTPS 地址（443）");
  invariant(!settings.remoteSourceWhitelistEnabled || settings.remoteSourceHosts.includes(url.hostname), 422, `远程来源未获允许：${url.hostname}`);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  invariant(!isIP(hostname) || publicDownloadAddress(hostname), 422, "禁止下载本机、私有网络或保留地址");
  return url;
}
const encryptedDnsCache = new Map<string, { expires: number; answers: { address: string; family: number }[] }>();
async function encryptedDns(hostname: string, settings: NetworkSettings, signal: AbortSignal) {
  const cached = encryptedDnsCache.get(hostname); if (cached && cached.expires > Date.now()) return cached.answers;
  const answers: { address: string; family: number }[] = []; let ttl = 300;
  for (const type of ["A", "AAAA"]) {
    const response = await requestHop(new URL(`https://1.1.1.1/dns-query?name=${encodeURIComponent(hostname)}&type=${type}`),
      { ...settings, downloadProxyEnabled: settings.dnsProxyEnabled ?? settings.downloadProxyEnabled }, signal, 20000, { Accept: "application/dns-json" });
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of response) { size += chunk.length; if (size > 32768) { response.destroy(); throw new AppError(422, "加密 DNS 响应过大"); } chunks.push(Buffer.from(chunk)); }
    invariant(response.statusCode === 200, 422, "加密 DNS 请求失败");
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { Status?: number; Answer?: { type: number; data: string; TTL: number }[] };
    invariant(value.Status === 0 && (!value.Answer || Array.isArray(value.Answer)), 422, "加密 DNS 解析失败");
    for (const answer of value.Answer ?? []) if (answer.type === 1 || answer.type === 28) {
      invariant(isIP(answer.data) === (answer.type === 1 ? 4 : 6) && publicDownloadAddress(answer.data), 422, "加密 DNS 解析到私有或保留地址");
      answers.push({ address: answer.data, family: answer.type === 1 ? 4 : 6 }); ttl = Math.min(ttl, Number.isFinite(answer.TTL) ? Math.max(0, answer.TTL) : 0);
    }
  }
  invariant(answers.length > 0, 422, "加密 DNS 未返回公开地址");
  if (encryptedDnsCache.size > 1000) encryptedDnsCache.clear(); encryptedDnsCache.set(hostname, { answers, expires: Date.now() + ttl * 1000 }); return answers;
}
async function pinnedAddress(url: URL, settings: NetworkSettings, signal: AbortSignal) {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const answers = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : process.env.DOWNLOAD_DNS_OVER_HTTPS === "true" ? await encryptedDns(hostname, settings, signal) : await lookup(hostname, { all: true });
  invariant(answers.length > 0 && answers.every(answer => publicDownloadAddress(answer.address)), 422, "远程域名解析到本机、私有网络或保留地址");
  // Many CONNECT proxies have IPv4-only outbound nodes. Check all answers for
  // safety first, then prefer a pinned IPv4 target through a proxy when present.
  return settings.downloadProxyEnabled ? answers.find(answer => answer.family === 4) ?? answers[0] : answers[0];
}
function proxyTunnel(url: URL, address: string, settings: DownloadSettings, signal: AbortSignal) {
  return new Promise<tls.TLSSocket>((resolve, reject) => {
    const proxy = new URL(settings.downloadProxyUrl); const authority = isIP(address) === 6 ? `[${address}]:443` : `${address}:443`;
    const connect = (proxy.protocol === "https:" ? https : http).request(proxy, { method: "CONNECT", path: authority, signal,
      headers: { Host: authority }, agent: false });
    connect.on("error", reject);
    connect.once("connect", (response, socket, head) => {
      if (response.statusCode !== 200) { socket.destroy(); reject(new AppError(422, `代理连接失败 HTTP ${response.statusCode}`)); return; }
      if (head.length) socket.unshift(head);
      const hostname = url.hostname.replace(/^\[|\]$/g, "");
      const secure = tls.connect({ socket, servername: isIP(hostname) ? undefined : hostname, rejectUnauthorized: true,
        checkServerIdentity: (_host, certificate) => tls.checkServerIdentity(hostname, certificate) });
      const abort = () => secure.destroy(new Error("下载已中断")); signal.addEventListener("abort", abort, { once: true });
      secure.once("close", () => signal.removeEventListener("abort", abort));
      secure.once("error", reject); secure.once("secureConnect", () => resolve(secure));
      if (signal.aborted) abort();
    });
    connect.end();
  });
}
async function requestHop(url: URL, settings: NetworkSettings, signal: AbortSignal, headersTimeout = 0, extraHeaders: Record<string, string> = {}): Promise<IncomingMessage> {
  const address = await pinnedAddress(url, settings, signal); signal.throwIfAborted();
  let agent: https.Agent | undefined;
  if (settings.downloadProxyEnabled) {
    agent = new https.Agent({ keepAlive: false });
    agent.createConnection = (_options, callback) => {
      void proxyTunnel(url, address.address, settings, signal).then(socket => callback?.(null, socket), error => callback?.(error, undefined as never));
      return undefined as never;
    };
  }
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const request = https.request(url, { agent: agent ?? false, signal,
      family: address.family,
      lookup: (_host, _options, callback) => callback(null, address.address, address.family),
      headers: { "User-Agent": "MUA-Import-Worker/1", "Accept-Encoding": "identity", ...extraHeaders } }, response => {
        clearTimeout(timer); response.once("close", () => agent?.destroy()); resolve(response);
      });
    request.once("error", error => { clearTimeout(timer); agent?.destroy(); reject(error); });
    if (headersTimeout) timer = setTimeout(() => request.destroy(new Error("下载源响应超时")), headersTimeout);
    request.end();
  });
}
export async function remoteResponse(value: string, settings: NetworkSettings, signal: AbortSignal,
  validate = (url: string) => remoteSourceUrl(url, settings), headersTimeout = 0): Promise<IncomingMessage> {
  let url = validate(value);
  for (let redirects = 0; redirects <= 5; redirects++) {
    const result = await requestHop(url, settings, signal, headersTimeout);
    if ([301, 302, 303, 307, 308].includes(result.statusCode!)) {
      const location = result.headers.location; result.destroy(); invariant(location && redirects < 5, 422, "远程文件重定向无效或过多");
      url = validate(new URL(location, url).href); continue;
    }
    if (result.statusCode !== 200) result.destroy();
    invariant(result.statusCode === 200, 422, `下载失败：${url.hostname} HTTP ${result.statusCode}`); return result;
  }
  throw new AppError(422, "远程重定向过多");
}
export type RemoteDeclaration = { path: string; downloads: string[]; fileSize: number; hashes: { sha1: string; sha512: string; sha256?: string } };
export async function downloadRemoteFile(file: RemoteDeclaration, path: string, settings: DownloadSettings, signal: AbortSignal,
  progress: (bytes: number) => void, request = remoteResponse) {
  let lastError = "下载失败";
  for (const url of file.downloads) for (let attempt = 0; attempt < 2; attempt++) {
    signal.throwIfAborted(); await rm(path, { force: true }); let response: IncomingMessage | undefined;
    const timeout = AbortSignal.any([signal, AbortSignal.timeout(10 * 60 * 1000)]);
    try {
      remoteSourceUrl(url, settings); response = await request(url, settings, timeout);
      const length = response.headers["content-length"];
      invariant(length === undefined || Number(length) === file.fileSize, 422, "远程文件声明大小不匹配");
      invariant(!response.headers["content-encoding"] || response.headers["content-encoding"] === "identity", 422, "远程文件不允许传输压缩");
      const sha1 = createHash("sha1"), sha512 = createHash("sha512"), sha256 = createHash("sha256"); let size = 0; progress(0);
      await pipeline(response, new Transform({ transform(chunk: Buffer, _, callback) {
        size += chunk.length;
        if (size > file.fileSize || size > 2 * 1024 ** 3) { callback(new AppError(422, "远程文件超过声明大小")); return; }
        sha1.update(chunk); sha512.update(chunk); sha256.update(chunk); progress(size); callback(null, chunk);
      } }), createWriteStream(path, { flags: "wx" }), { signal: timeout });
      invariant(size === file.fileSize && sha1.digest("hex") === file.hashes.sha1 && sha512.digest("hex") === file.hashes.sha512, 422, `远程文件哈希或大小不匹配：${file.path}`);
      const hash = sha256.digest("hex"); invariant(!file.hashes.sha256 || file.hashes.sha256 === hash, 422, `远程文件 SHA-256 不匹配：${file.path}`);
      return { sha256: hash, size };
    } catch (error) {
      response?.destroy(); signal.throwIfAborted();
      lastError = error instanceof AppError ? error.message : "网络连接失败或下载超时";
    }
  }
  await rm(path, { force: true }); throw new AppError(422, `${file.path}：${lastError}`);
}
