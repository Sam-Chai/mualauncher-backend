import { z } from "zod";
export const UNION_DIRECTORY_URL = "https://skin.mualliance.ltd/api/union";
export const UNION_SYNC_MS = 60_000;
// These retained domains belong to the same merged organization, as confirmed by its operator.
export const YITUEM_ROOTS = ["https://skin.yitmc.cn", "https://skin.uemcraft.cn"] as const;
export const unionCode = z.string().regex(/^[A-Z][A-Z0-9]{0,5}$/);
export const unionSyncStatusSchema = z.object({ status: z.enum(["WAITING", "RUNNING", "SYNCED", "PARTIAL", "ERROR", "STALE"]),
  endpoint: z.literal(UNION_DIRECTORY_URL), intervalSeconds: z.literal(60), attemptedAt: z.string().nullable(), syncedAt: z.string().nullable(), nextSyncAt: z.string().nullable(),
  upstreamVersion: z.string().nullable(), receivedCount: z.number().int(), syncedCount: z.number().int(), createdCount: z.number().int(), error: z.string().nullable(),
  issues: z.array(z.object({ code: z.string(), issue: z.string() }).strict()), avatars: z.object({ imported: z.number().int(), pending: z.number().int(), failed: z.number().int(), manual: z.number().int() }).strict() }).strict();
export type UnionSyncStatus = z.infer<typeof unionSyncStatusSchema>;
export function parseUnionDirectory(raw: unknown) {
  const value = z.object({ servers: z.array(z.object({ code: z.string().max(100), bs_root: z.string().max(2000) })).min(1).max(1000), version: z.union([z.string().max(100), z.number().finite()]).optional() }).parse(raw);
  const groups = new Map<string, Set<string>>(), issues: { code: string; issue: string }[] = [];
  for (const row of value.servers) {
    if (!unionCode.safeParse(row.code).success) { issues.push({ code: row.code.slice(0, 6), issue: "INVALID_CODE" }); continue; }
    let u: URL; try { u = new URL(row.bs_root); } catch { issues.push({ code: row.code, issue: "INVALID_URL" }); continue; }
    if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash || u.port && u.port !== "443") { issues.push({ code: row.code, issue: "INVALID_URL" }); continue; }
    const normalized = u.href.replace(/\/$/, ""); const group = groups.get(row.code) ?? new Set<string>(); group.add(normalized); groups.set(row.code, group);
  }
  const sites: { code: string; bsRoot: string; bsRootAliases?: string[] }[] = [];
  for (const [code, roots] of groups) {
    if (code === "YITUEM" && roots.size === 2 && YITUEM_ROOTS.every(root => roots.has(root))) {
      sites.push({ code, bsRoot: YITUEM_ROOTS[0], bsRootAliases: [YITUEM_ROOTS[1]] });
    } else if (roots.size > 1) issues.push({ code, issue: "DUPLICATE_CODE" });
    else sites.push({ code, bsRoot: [...roots][0] });
  }
  return { sites: sites.sort((a, b) => a.code.localeCompare(b.code)), issues, version: value.version === undefined ? null : String(value.version), received: value.servers.length };
}
