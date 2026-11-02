import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import https from "node:https";
import { publicDownloadAddress } from "./remote-download";

export type GameTransport = (url: URL, body: string | undefined, signal: AbortSignal, discovery?: "ali" | "metadata") => Promise<{ status: number; contentType: string; bytes: Buffer; location?: string; apiLocation?: string }>;

// No proxy, automatic redirects, ambient cookies/Authorization or error bodies in logs.
export const gameTransport: GameTransport = async (url, body, signal, discovery) => {
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.search || url.port && url.port !== "443") throw new Error("UNSAFE_AUTH_ENDPOINT");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const resolution = isIP(hostname) ? Promise.resolve([{ address: hostname, family: isIP(hostname) }]) : lookup(hostname, { all: true });
  const answers = await new Promise<Awaited<typeof resolution>>((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => reject(new Error("AUTH_TIMEOUT"));
    signal.addEventListener("abort", abort, { once: true });
    void resolution.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
  if (!answers.length || !answers.every(a => publicDownloadAddress(a.address))) throw new Error("UNSAFE_AUTH_ADDRESS");
  signal.throwIfAborted();
  const address = answers.find(a => a.family === 4) ?? answers[0];
  return new Promise((resolve, reject) => {
    const request = https.request(url, { method: body === undefined ? "GET" : "POST", signal, agent: false,
      family: address.family,
      lookup: (_host, _options, callback) => callback(null, address.address, address.family),
      headers: { Accept: "application/json", "Accept-Encoding": "identity", "User-Agent": "Union-Link-Authentication/1",
        ...(body === undefined ? {} : { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }) },
    }, response => {
      const headers = { status: response.statusCode ?? 0, contentType: String(response.headers["content-type"] ?? ""),
        location: response.headers.location, apiLocation: response.headers["x-authlib-injector-api-location"] as string | undefined };
      let indicatedElsewhere = false;
      try { indicatedElsewhere = headers.apiLocation !== undefined && new URL(headers.apiLocation, url).href !== url.href; }
      catch { indicatedElsewhere = true; }
      // Discovery needs only headers from HTML landing pages/redirects; never buffer an arbitrary page.
      if (discovery && body === undefined && (discovery === "ali" && indicatedElsewhere || [301, 302, 303, 307, 308].includes(headers.status))) {
        response.destroy(); resolve({ ...headers, bytes: Buffer.alloc(0) }); return;
      }
      const chunks: Buffer[] = []; let size = 0;
      response.on("error", () => reject(new Error("AUTH_RESPONSE_FAILED")));
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 65536 || response.headers["content-encoding"] && response.headers["content-encoding"] !== "identity") {
          response.destroy(); request.destroy(); reject(new Error("AUTH_RESPONSE_LIMIT")); return;
        }
        chunks.push(Buffer.from(chunk));
      });
      response.on("end", () => resolve({ ...headers, bytes: Buffer.concat(chunks) }));
    });
    request.on("error", () => reject(new Error("AUTH_CONNECTION_FAILED")));
    request.end(body);
  });
};
