import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { workerPrisma, validateDatabase, disconnectDatabases } from "../src/lib/prisma";
import { workerDownloadSettings } from "../src/lib/download-settings";
import { siteReader, type SiteReader } from "../src/lib/union-site-icons";
import { gameTransport } from "../src/lib/launcher-game-network";
import { resolveYggdrasilApi } from "../src/lib/yggdrasil-api";

type Trace = { request: string; final: string; status: number; ali?: string };
type Check = { ok: boolean; apiRoot?: string; serverName?: string; implementation?: string; version?: string;
  publicKey?: boolean; skinDomains?: boolean; elapsedMs: number; error?: string; trace: Trace[] };

async function check(root: string, reader: SiteReader): Promise<Check> {
  const started = performance.now(), trace: Trace[] = [];
  try {
    const result = await resolveYggdrasilApi(root, async (url, limit, signal, options) => {
      const response = await reader(url, limit, signal, options);
      trace.push({ request: url, final: response.url ?? url, status: response.status ?? 200, ali: response.apiLocation });
      return response;
    }, AbortSignal.timeout(8_000));
    const data = result.metadata as Record<string, unknown>, meta = data.meta as Record<string, unknown>;
    const serverName = typeof meta.serverName === "string" ? meta.serverName : undefined;
    const publicKey = typeof data.signaturePublickey === "string" && !!data.signaturePublickey;
    const skinDomains = Array.isArray(data.skinDomains) && data.skinDomains.every(x => typeof x === "string");
    return { ok: publicKey && skinDomains, apiRoot: result.apiRoot, serverName,
      implementation: typeof meta.implementationName === "string" ? meta.implementationName : undefined,
      version: typeof meta.implementationVersion === "string" ? meta.implementationVersion : undefined,
      publicKey, skinDomains, elapsedMs: Math.round(performance.now() - started),
      error: publicKey && skinDomains ? undefined : "Missing Yggdrasil signaturePublickey or skinDomains", trace };
  } catch (error) {
    const cause = error instanceof Error ? error as Error & { code?: string; cause?: { code?: string } } : undefined;
    return { ok: false, elapsedMs: Math.round(performance.now() - started), error: cause?.code ?? cause?.cause?.code ?? cause?.message ?? "Unknown discovery failure", trace };
  }
}

async function main() {
  const target = new URL(process.env.DATABASE_WORKER_URL!);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(target.hostname)) throw new Error("This check requires a local database");
  await validateDatabase("worker");
  const sites = await workerPrisma.unionSkinSite.findMany({ orderBy: { code: "asc" }, select: {
    code: true, bsRoot: true, bsRootAliases: true, enabled: true, upstreamPresent: true, organization: { select: { archivedAt: true } },
  } });
  const settings = await workerDownloadSettings(workerPrisma);
  const directoryReader = siteReader(settings);
  const authenticationReader: SiteReader = async (url, _limit, signal, options) =>
    gameTransport(new URL(url), undefined, signal, options?.followAli ? "ali" : "metadata");
  const entries = sites.flatMap(site => [...new Set([site.bsRoot, ...site.bsRootAliases])].map((root, index) => ({
    code: site.code, root, alias: index > 0, enabled: site.enabled, upstreamPresent: site.upstreamPresent, organizationArchived: !!site.organization.archivedAt,
  })));
  let next = 0;
  type Row = typeof entries[number] & { directory: Check; authentication: Check; sameApiRoot: boolean; previousAttempt?: { directory: Check; authentication: Check } };
  const results: Row[] = [];
  const retryArgument = process.argv.indexOf("--retry-report");
  const previousReport: string | undefined = retryArgument >= 0 ? process.argv[retryArgument + 1] : undefined;
  if (retryArgument >= 0 && !previousReport) throw new Error("--retry-report requires a report JSON path");
  const previous = new Map<string, Row>();
  if (previousReport) {
    const saved = JSON.parse(await readFile(previousReport, "utf8")) as { results: Row[] };
    for (const row of saved.results) previous.set(`${row.code}:${row.root}`, row);
  }
  await Promise.all(Array.from({ length: Math.min(4, entries.length) }, async () => {
    while (next < entries.length) {
      const entry = entries[next++];
      const prior = previous.get(`${entry.code}:${entry.root}`);
      if (prior?.sameApiRoot) { results.push({ ...prior, ...entry }); continue; }
      const [directory, authentication] = await Promise.all([
        prior?.directory.ok ? prior.directory : check(entry.root, directoryReader),
        prior?.authentication.ok ? prior.authentication : check(entry.root, authenticationReader),
      ]);
      const result: Row = { ...entry, directory, authentication, sameApiRoot: directory.ok && authentication.ok && directory.apiRoot === authentication.apiRoot,
        previousAttempt: prior ? { directory: prior.directory, authentication: prior.authentication } : undefined };
      results.push(result);
      console.log(JSON.stringify({ code: entry.code, alias: entry.alias, directory: directory.ok ? directory.apiRoot : directory.error,
        authentication: authentication.ok ? authentication.apiRoot : authentication.error }));
    }
  }));
  results.sort((a, b) => a.code.localeCompare(b.code) || Number(a.alias) - Number(b.alias));
  const successfulSites = sites.filter(site => results.some(row => row.code === site.code && row.sameApiRoot)).length;
  const summary = { registeredSites: sites.length, roots: results.length, directorySuccess: results.filter(x => x.directory.ok).length,
    authenticationSuccess: results.filter(x => x.authentication.ok).length, matchingRoots: results.filter(x => x.sameApiRoot).length,
    sitesWithDirectoryRoot: sites.filter(site => results.some(row => row.code === site.code && row.directory.ok)).length,
    sitesWithAuthenticationRoot: sites.filter(site => results.some(row => row.code === site.code && row.authentication.ok)).length,
    sitesWithAnyRoot: sites.filter(site => results.some(row => row.code === site.code && (row.directory.ok || row.authentication.ok))).length,
    sitesWithMatchingRoot: successfulSites, sitesWithoutMatchingRoot: sites.length - successfulSites };
  const report = { generatedAt: new Date().toISOString(), previousReport, database: { host: target.hostname, port: target.port, schema: process.env.DATABASE_SCHEMA ?? "public" },
    network: { directoryProxyEnabled: settings.downloadProxyEnabled, authenticationProxyEnabled: false, timeoutMs: 8000, concurrency: 4 },
    scope: "Read-only local directory inventory and anonymous production-reader ALI discovery. No provider approval, credentials, game-token exchange, or database updates.",
    summary, results };
  const directory = resolve(".local/reports"); await mkdir(directory, { recursive: true });
  const base = join(directory, `yggdrasil-ali-${report.generatedAt.replace(/[:.]/g, "-")}`);
  await writeFile(base + ".json", JSON.stringify(report, null, 2) + "\n", "utf8");
  const cell = (value: string) => value.replaceAll("|", "\\|").replaceAll("\n", " ");
  await writeFile(base + ".md", ["# Union Link ALI live discovery check", "", report.generatedAt, "", report.scope, "",
    "```json", JSON.stringify(summary, null, 2), "```", "",
    "Both production readers are exercised: Worker directory settings and direct authentication transport. Success confirms JSON metadata, signaturePublickey and skinDomains; it does not verify game-token compatibility or UID mapping.", "",
    ...(previousReport ? [`Failed paths were retried using ${previousReport}; previously successful paths are retained and earlier failures are preserved in JSON.`, ""] : []),
    "| CODE | Registered root | Worker API root / error | Authentication API root / error | Name | Same |",
    "| --- | --- | --- | --- | --- | --- |", ...results.map(row => `| ${row.code}${row.alias ? " (alias)" : ""} | ${cell(row.root)} | ${cell(row.directory.apiRoot ?? row.directory.error ?? "")} | ${cell(row.authentication.apiRoot ?? row.authentication.error ?? "")} | ${cell(row.directory.serverName ?? row.authentication.serverName ?? "")} | ${row.sameApiRoot ? "yes" : "no"} |`),
    "", "See the companion JSON for elapsed times, ALI headers, final response URLs, metadata checks and failures.", ""].join("\n"), "utf8");
  console.log(JSON.stringify({ summary, json: base + ".json", markdown: base + ".md" }, null, 2));
  if (summary.sitesWithoutMatchingRoot) process.exitCode = 1;
}
void main().catch(error => { console.error(error instanceof Error ? error.message : "ALI check failed"); process.exitCode = 1; }).finally(disconnectDatabases);
