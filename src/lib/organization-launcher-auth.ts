import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { resolveYggdrasilApi } from "./yggdrasil-api";
import { gameTransport } from "./launcher-game-network";
import type { SiteReader } from "./union-site-icons";
import { organizationLauncherAllowed } from "./organization-launcher-policy";

export type OrganizationProviderDiscovery = { code: string; bsRoot: string; authApiRoot: string; organizationId: string | null;
  organizationRevision: number; siteRevision: number; settingsRevision: number };
export const launcherMetadataReader: SiteReader = async (url, _limit, signal, options) =>
  gameTransport(new URL(url), undefined, signal, options?.followAli ? "ali" : "metadata");

// No credentials are used. The SQL apply function rechecks authorization, revisions and the directory lease.
export async function discoverOrganizationProviders(db: PrismaClient, incoming: { code: string; bsRoot: string; bsRootAliases?: string[] }[],
  signal: AbortSignal, read: SiteReader = launcherMetadataReader) {
  const [settings, saved] = await Promise.all([db.platformSettings.findUnique({ where: { id: "platform" } }),
    db.unionSkinSite.findMany({ include: { organization: true } })]);
  const existing = new Map(saved.map(site => [site.code, site]));
  const candidates = saved.filter(site => !site.organization.archivedAt && site.enabled && (!site.managedBySync || site.upstreamPresent))
    .map(site => ({ code: site.code, roots: [site.bsRoot, ...site.bsRootAliases].filter(root => organizationLauncherAllowed(site.organization, site.code, root)), organizationId: site.organizationId as string | null,
      organizationRevision: site.organization.launcherLoginRevision, siteRevision: site.revision, settingsRevision: settings?.unionAuthorizationRevision ?? 0 }));
  if (settings?.autoAuthorizeNewOrganizations) for (const site of incoming) if (!existing.has(site.code)) candidates.push({ code: site.code,
    roots: [site.bsRoot, ...(site.bsRootAliases ?? [])], organizationId: null, organizationRevision: 0, siteRevision: 0, settingsRevision: settings.unionAuthorizationRevision });
  const tasks = candidates.flatMap(({ roots, ...candidate }) => [...new Set(roots)].map(bsRoot => ({ ...candidate, bsRoot })));
  const providers: OrganizationProviderDiscovery[] = [], failures = new Set<string>(); let next = 0;
  await Promise.all(Array.from({ length: Math.min(6, tasks.length) }, async () => {
    while (next < tasks.length) {
      const task = tasks[next++];
      try {
        const result = await resolveYggdrasilApi(task.bsRoot, read, AbortSignal.any([signal, AbortSignal.timeout(8_000)]));
        const metadata = result.metadata as Record<string, unknown>;
        if (typeof metadata.signaturePublickey !== "string" || !metadata.signaturePublickey || !Array.isArray(metadata.skinDomains)) throw Error("INVALID_METADATA");
        providers.push({ ...task, authApiRoot: result.apiRoot });
      } catch { failures.add(task.code); }
    }
  }));
  return { providers, issues: [...failures].sort().map(code => ({ code, issue: "LAUNCHER_API_UNAVAILABLE" })) };
}
