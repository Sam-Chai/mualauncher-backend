import "server-only";
import { randomUUID } from "node:crypto";
import type { PrismaClient, Prisma } from "@/generated/prisma/client";
import type { Actor, Db } from "./auth";
import { securityFunction } from "./database-security";
import { superOnly } from "./rbac";
import { workerDownloadSettings } from "./download-settings";
import { remoteSourceUrl } from "./remote-download";
import { fetchSiteIcon, siteReader, type SiteReader } from "./union-site-icons";
import { prepareOrganizationAvatar, readOrganizationAvatar, storeOrganizationAvatar } from "./organization-avatar";
import { isOrganizationAvatarKey } from "./organization-avatar-contract";
import { parseUnionDirectory, UNION_DIRECTORY_URL, UNION_SYNC_MS, unionSyncStatusSchema, type UnionSyncStatus } from "./union-directory-contract";
import { fetchUnionSiteName } from "./union-site-metadata";

type Applied = { created: number; synced: number; issues: { code: string; issue: string }[] };
export async function syncUnionDirectory(db: PrismaClient, read?: SiteReader) {
  const now = new Date(), lease = randomUUID();
  await db.unionSyncState.upsert({ where: { id: "union" }, create: { id: "union", nextSyncAt: now }, update: {} });
  const claimed = await db.unionSyncState.updateMany({ where: { id: "union", nextSyncAt: { lte: now }, OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
    data: { leaseToken: lease, leaseUntil: new Date(now.getTime() + 90_000), attemptedAt: now } });
  if (!claimed.count) return false;
  try {
    const settings = await workerDownloadSettings(db), network = read ?? siteReader(settings);
    const response = await network(UNION_DIRECTORY_URL, 1024 * 1024, AbortSignal.timeout(15_000));
    const parsed = parseUnionDirectory(JSON.parse(response.bytes.toString("utf8")));
    // Validate each address first. The shared reader pins DNS when fetching metadata or icons.
    const sites = parsed.sites.filter(site => { try { for (const root of [site.bsRoot, ...(site.bsRootAliases ?? [])]) remoteSourceUrl(root, { ...settings, remoteSourceWhitelistEnabled: false }); return true; }
      catch { parsed.issues.push({ code: site.code, issue: "INVALID_URL" }); return false; } });
    const existing = new Map((await db.unionSkinSite.findMany({ include: { organization: true } })).map(site => [site.code, site]));
    const names = new Map<string, string>(), nameIssues = new Set<string>();
    const candidates = sites.filter(site => {
      const saved = existing.get(site.code);
      return !saved || saved.enabled && !saved.organization.archivedAt && saved.organization.descriptionMode === "AUTO"
        && (saved.managedBySync || saved.bsRoot === site.bsRoot);
    }).sort((a, b) => Number(!!existing.get(a.code)?.organization.description) - Number(!!existing.get(b.code)?.organization.description) || a.code.localeCompare(b.code));
    // Bound the whole metadata pass as well as each site (including its aliases).
    // External requests finish before opening the database transaction.
    const budget = AbortSignal.timeout(60_000);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(6, candidates.length) }, async () => {
      while (next < candidates.length) {
        const site = candidates[next++];
        try {
          budget.throwIfAborted();
          names.set(site.code, await fetchUnionSiteName([site.bsRoot, ...(site.bsRootAliases ?? [])], network, AbortSignal.any([budget, AbortSignal.timeout(16_000)])));
        } catch { nameIssues.add(site.code); }
      }
    }));
    parsed.issues.push(...[...nameIssues].sort().map(code => ({ code, issue: "SITE_NAME_UNAVAILABLE" })));
    const payload = sites.map(site => ({ ...site, ...(names.has(site.code) ? { siteName: names.get(site.code) } : {}) }));
    const applied = await db.$transaction(async tx => {
      const rows = await tx.$queryRaw<{ value: Applied }[]>`SELECT ${securityFunction("union_apply_sites")}(${JSON.stringify(payload)}::jsonb,${lease}::uuid) AS value`;
      const issues = [...parsed.issues, ...rows[0].value.issues];
      await tx.unionSyncState.updateMany({ where: { id: "union", leaseToken: lease }, data: { syncedAt: new Date(), nextSyncAt: new Date(now.getTime() + UNION_SYNC_MS),
        leaseToken: null, leaseUntil: null, upstreamVersion: parsed.version, receivedCount: parsed.received, syncedCount: rows[0].value.synced,
        createdCount: rows[0].value.created, issues: issues as Prisma.InputJsonValue, error: null } });
      return { ...rows[0].value, issues };
    });
    return applied;
  } catch {
    await db.unionSyncState.updateMany({ where: { id: "union", leaseToken: lease }, data: { error: "DIRECTORY_SYNC_FAILED", nextSyncAt: new Date(now.getTime() + UNION_SYNC_MS), leaseToken: null, leaseUntil: null } });
    return false;
  }
}

export async function importUnionAvatars(db: PrismaClient, read?: SiteReader) {
  const lease = randomUUID(), now = new Date();
  const claim = await db.unionSyncState.updateMany({ where: { id: "union", OR: [{ avatarLeaseUntil: null }, { avatarLeaseUntil: { lt: now } }] },
    data: { avatarLeaseToken: lease, avatarLeaseUntil: new Date(now.getTime() + 60_000) } });
  if (!claim.count) return false;
  try {
    const sites = await db.unionSkinSite.findMany({ where: { enabled: true, upstreamPresent: true }, orderBy: { code: "asc" }, include: { organization: true } });
    const seen = new Set<string>();
    const selected = sites.filter(site => { if (seen.has(site.organizationId)) return false; seen.add(site.organizationId);
      return site.avatarNextAt <= now && !site.organization.archivedAt; }).slice(0, 6);
    const reader = read ?? siteReader(await workerDownloadSettings(db));
    for (let i = 0; i < selected.length; i += 3) await Promise.all(selected.slice(i, i + 3).map(async site => {
      let key: string | null = null, issue: string | null = null;
      if (site.organization.avatarMode === "AUTO") {
        try {
          const signal = AbortSignal.timeout(12_000);
          let bytes: Buffer | undefined;
          for (const root of [site.bsRoot, ...site.bsRootAliases]) {
            try { bytes = await fetchSiteIcon(root, reader, signal); break; } catch { if (signal.aborted) break; }
          }
          if (!bytes) throw new Error("No usable skin-site icon");
          const prepared = await prepareOrganizationAvatar(bytes);
          const previous = isOrganizationAvatarKey(site.organization.avatarObjectKey, site.organizationId)
            ? await readOrganizationAvatar(site.organization.avatarObjectKey, site.organizationId, "metadata").catch(() => null) : null;
          if (previous?.metadata.imageSha256 !== prepared.metadata.imageSha256) key = await storeOrganizationAvatar(site.organizationId, prepared);
        } catch { issue = "ICON_IMPORT_FAILED"; }
      }
      await db.$queryRaw`SELECT ${securityFunction("union_avatar_result")}(${site.code},${site.bsRoot},${site.organization.avatarRevision},${key},${issue},${lease}::uuid)`;
    }));
    return selected.length;
  } finally { await db.unionSyncState.updateMany({ where: { id: "union", avatarLeaseToken: lease }, data: { avatarLeaseToken: null, avatarLeaseUntil: null } }); }
}

export async function unionDirectoryStatus(db: Db, actor: Actor): Promise<UnionSyncStatus> {
  superOnly(actor);
  const state = await db.unionSyncState.findUnique({ where: { id: "union" } });
  const sites = await db.unionSkinSite.findMany({ where: { upstreamPresent: true, enabled: true }, include: { organization: true } });
  const unique = [...new Map(sites.map(s => [s.organizationId, s])).values()];
  const issues = Array.isArray(state?.issues) ? state.issues : [];
  return unionSyncStatusSchema.parse({ endpoint: UNION_DIRECTORY_URL, intervalSeconds: 60,
    status: state?.leaseUntil && state.leaseUntil > new Date() ? "RUNNING" : state?.error ? "ERROR" : !state?.syncedAt ? "WAITING" : Date.now() - state.syncedAt.getTime() > 180_000 ? "STALE" : issues.length ? "PARTIAL" : "SYNCED",
    attemptedAt: state?.attemptedAt?.toISOString() ?? null, syncedAt: state?.syncedAt?.toISOString() ?? null, nextSyncAt: state?.nextSyncAt.toISOString() ?? null,
    upstreamVersion: state?.upstreamVersion ?? null, receivedCount: state?.receivedCount ?? 0, syncedCount: state?.syncedCount ?? 0, createdCount: state?.createdCount ?? 0,
    error: state?.error ?? null, issues, avatars: {
      imported: unique.filter(s => s.organization.avatarMode === "AUTO" && isOrganizationAvatarKey(s.organization.avatarObjectKey, s.organizationId)).length,
      manual: unique.filter(s => s.organization.avatarMode === "MANUAL").length,
      failed: unique.filter(s => s.organization.avatarMode === "AUTO" && !!s.avatarError).length,
      pending: unique.filter(s => s.organization.avatarMode === "AUTO" && !s.avatarCheckedAt).length,
    } });
}
export async function requestUnionSync(db: Db, actor: Actor) {
  superOnly(actor);
  // A request only advances the due time. Network and automatic organization writes remain Worker-only.
  const row = await db.unionSyncState.findUnique({ where: { id: "union" } });
  if (row?.leaseUntil && row.leaseUntil > new Date()) return { ok: true as const };
  await db.$executeRaw`SELECT ${securityFunction("union_request_sync")}()`;
  return { ok: true as const };
}
