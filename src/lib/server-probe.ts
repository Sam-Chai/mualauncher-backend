import { diagnosticText } from "@/lib/diagnostics";
import "server-only";
import { isIP } from "node:net";
import { lookup, resolveSrv } from "node:dns/promises";
import { domainToASCII } from "node:url";
import { publicDownloadAddress } from "./remote-download";
import { MinecraftProbeError, minecraftStatus, type MinecraftStatus } from "./minecraft-status";
import { DEFAULT_HIGH_LATENCY_MS, SERVER_PROBE_CACHE_MS, type ServerProbeResult } from "./server-probe-contract";

type Target = { hostname: string; port: number; addresses: { address: string; family: number }[] };
export function parseMinecraftAddress(value: string) {
  const input = value.trim();
  if (!input || input.length > 255 || /[\s\x00-\x1f\x7f\/@?#\\]/.test(input)) throw new Error(diagnosticText("diagnostics.serverProbe.invalidAddressUseAHostnameOrHostnamePort"));
  let hostname = input, port = 25565, explicitPort = false;
  if (input.startsWith("[")) {
    const match = /^\[([^\]]+)\](?::([0-9]+))?$/.exec(input);
    if (!match || isIP(match[1]) !== 6) throw new Error(diagnosticText("diagnostics.serverProbe.invalidIpv6AddressUseIpv6Port"));
    hostname = match[1]; if (match[2]) { port = Number(match[2]); explicitPort = true; }
  } else if (isIP(input) !== 6 && input.includes(":")) {
    const match = /^([^:]+):([0-9]+)$/.exec(input); if (!match) throw new Error(diagnosticText("diagnostics.serverProbe.invalidAddressOrPort"));
    hostname = match[1]; port = Number(match[2]); explicitPort = true;
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(diagnosticText("diagnostics.serverProbe.serverPortMustBe165535"));
  if (!isIP(hostname)) {
    hostname = domainToASCII(hostname).toLowerCase().replace(/\.$/, "");
    if (!hostname || hostname.length > 253 || !hostname.split(".").every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) throw new Error(diagnosticText("diagnostics.serverProbe.invalidServerHostname"));
  }
  return { hostname, port, explicitPort };
}

type DnsAdapters = {
  srv?: (name: string) => Promise<{ name: string; port: number; priority: number; weight: number }[]>;
  addresses?: (name: string) => Promise<{ address: string; family: number }[]>;
};
export async function resolveMinecraftTarget(value: string, dns: DnsAdapters = {}): Promise<Target> {
  const parsed = parseMinecraftAddress(value); let hostname = parsed.hostname, port = parsed.port;
  if (isIP(hostname) && !publicDownloadAddress(hostname)) throw new Error(diagnosticText("diagnostics.serverProbe.probesRequirePublicAddressesLocalhostPrivateAndReservedAddressesAre"));
  if (!parsed.explicitPort && !isIP(hostname)) {
    try {
      const records = await (dns.srv ?? resolveSrv)(`_minecraft._tcp.${hostname}`);
      const priority = Math.min(...records.map(record => record.priority));
      const group = records.filter(record => record.priority === priority);
      const sum = group.reduce((total, record) => total + record.weight, 0); let draw = Math.random() * sum;
      const record = sum ? group.find(record => (draw -= record.weight) < 0) : group[Math.floor(Math.random() * group.length)];
      if (record) {
        hostname = record.name.replace(/\.$/, ""); port = record.port;
        if (!hostname || !port || port > 65535) throw new Error(diagnosticText("diagnostics.serverProbe.invalidMinecraftSrvRecord"));
      }
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : null;
      if (!["ENODATA", "ENOTFOUND", "ESERVFAIL", "ETIMEOUT", "ECONNREFUSED"].includes(String(code))) throw error;
    }
  }
  let addresses: Target["addresses"];
  try { addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : dns.addresses ? await dns.addresses(hostname) : await lookup(hostname, { all: true }); }
  catch { throw new Error(diagnosticText("diagnostics.serverProbe.serverDnsResolutionFailed")); }
  if (!addresses.length) throw new Error(diagnosticText("diagnostics.serverProbe.serverHostnameHasNoUsableAddresses"));
  if (addresses.some(record => !publicDownloadAddress(record.address))) throw new Error(diagnosticText("diagnostics.serverProbe.serverResolvesToPrivateOrReservedAddressesProbeStopped"));
  const v4 = addresses.filter(record => record.family === 4), v6 = addresses.filter(record => record.family === 6);
  const ordered = Array.from({ length: Math.max(v4.length, v6.length) }, (_, index) => [v4[index], v6[index]].filter(Boolean)).flat();
  return { hostname: parsed.hostname, port, addresses: ordered.slice(0, 4) };
}

export function highLatencyThreshold() {
  const value = Number(process.env.SERVER_PROBE_HIGH_LATENCY_MS ?? DEFAULT_HIGH_LATENCY_MS);
  return Number.isFinite(value) && value >= 1 && value <= 60000 ? value : DEFAULT_HIGH_LATENCY_MS;
}
export function unknownProbe(address: string | null, message: string): ServerProbeResult {
  return { state: "UNKNOWN", address, checkedAt: null, latencyMs: null, latencyKind: null, highLatencyMs: highLatencyThreshold(), message, version: null, playersOnline: null };
}
export function onlineProbe(address: string, status: MinecraftStatus, threshold = highLatencyThreshold()): ServerProbeResult {
  const high = status.latencyMs >= threshold;
  return { state: high ? "HIGH_LATENCY" : "ONLINE", address, checkedAt: new Date().toISOString(), highLatencyMs: threshold,
    message: high ? diagnosticText("diagnostics.serverProbe.minecraftServerOnlineWithHighLatency") : diagnosticText("diagnostics.serverProbe.minecraftServerOnline"), ...status };
}

export async function probeMinecraftAddress(address: string, dependencies: { resolve?: typeof resolveMinecraftTarget; status?: typeof minecraftStatus; timeoutMs?: number } = {}): Promise<ServerProbeResult> {
  const timeoutMs = dependencies.timeoutMs ?? 6000;
  let expired = false;
  const run = async () => {
    const started = Date.now();
    const target = await (dependencies.resolve ?? resolveMinecraftTarget)(address);
    let last: unknown;
    for (const destination of target.addresses) {
      if (expired) throw new MinecraftProbeError("TIMEOUT", diagnosticText("diagnostics.serverProbe.serverProbeTimedOut"));
      // Let the socket return an already verified status before the outer DNS/task watchdog fires.
      const remaining = timeoutMs - (Date.now() - started) - Math.min(25, timeoutMs / 10);
      if (remaining <= 0) throw new MinecraftProbeError("TIMEOUT", diagnosticText("diagnostics.serverProbe.serverProbeTimedOut"));
      try { return onlineProbe(address, await (dependencies.status ?? minecraftStatus)({ ...destination, port: target.port, hostname: target.hostname }, target.addresses.length > 1 ? Math.min(2000, remaining) : remaining)); }
      catch (error) { last = error; }
    }
    throw last ?? new MinecraftProbeError("UNREACHABLE", diagnosticText("diagnostics.serverProbe.noConnectableServerAddresses"));
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([run(), new Promise<never>((_, reject) => { timer = setTimeout(() => { expired = true; reject(new MinecraftProbeError("TIMEOUT", diagnosticText("diagnostics.serverProbe.serverProbeTimedOutWithoutMinecraftStatus"))); }, timeoutMs); })]);
  } catch (error) {
    return { ...unknownProbe(address, error instanceof Error ? error.message : diagnosticText("diagnostics.serverProbe.serverConnectionFailed")), state: "OFFLINE", checkedAt: new Date().toISOString() };
  } finally { clearTimeout(timer); }
}

export function createProbeCache(probe: (address: string) => Promise<ServerProbeResult> = probeMinecraftAddress, ttl = SERVER_PROBE_CACHE_MS) {
  const cache = new Map<string, { expires: number; value: ServerProbeResult }>(), pending = new Map<string, Promise<ServerProbeResult>>();
  let active = 0; const waiters: (() => void)[] = [];
  async function execute(address: string) {
    if (active >= 4) {
      if (waiters.length >= 64) return unknownProbe(address, diagnosticText("diagnostics.serverProbe.probeServiceBusyRefreshLater"));
      const acquired = await new Promise<boolean>(resolve => {
        const ready = () => { clearTimeout(timer); resolve(true); };
        const timer = setTimeout(() => { const index = waiters.indexOf(ready); if (index >= 0) waiters.splice(index, 1); resolve(false); }, 8000);
        waiters.push(ready);
      });
      if (!acquired) return unknownProbe(address, diagnosticText("diagnostics.serverProbe.probeQueueTimedOutRefreshLater"));
    } else active++;
    try {
      const value = await probe(address);
      for (const [key, entry] of cache) if (entry.expires <= Date.now()) cache.delete(key);
      if (cache.size >= 512) cache.delete(cache.keys().next().value!);
      cache.set(address, { value, expires: Date.now() + ttl }); return value;
    } finally { const next = waiters.shift(); if (next) next(); else active--; }
  }
  return (address: string) => {
    const found = cache.get(address); if (found && found.expires > Date.now()) return Promise.resolve(found.value);
    if (pending.has(address)) return pending.get(address)!;
    const task = execute(address).finally(() => pending.delete(address)); pending.set(address, task); return task;
  };
}
export const cachedMinecraftProbe = createProbeCache();
