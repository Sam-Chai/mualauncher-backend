import "server-only";
import { z } from "zod";
import type { SiteReader } from "./union-site-icons";

const metadata = z.object({ meta: z.object({ serverName: z.string().trim().min(1).max(200)
  .refine(value => !/[\p{Cc}\p{Cf}]/u.test(value), "Invalid site name") }) });

// The Union authorization page obtains its labels from this public Yggdrasil metadata.
// Only read the display name. No game login, cookies or OAuth credentials are involved.
export async function fetchUnionSiteName(roots: string[], read: SiteReader, signal: AbortSignal) {
  for (const root of roots) {
    try {
      const result = await read(`${root}/api/yggdrasil`, 64 * 1024, AbortSignal.any([signal, AbortSignal.timeout(8_000)]));
      if (!/^application\/(?:[\w.+-]+\+)?json(?:\s*;|$)/i.test(result.contentType) || result.bytes.length > 64 * 1024) continue;
      const parsed = metadata.safeParse(JSON.parse(result.bytes.toString("utf8")));
      if (parsed.success) return parsed.data.meta.serverName;
    } catch { signal.throwIfAborted(); }
  }
  throw new Error("SITE_NAME_UNAVAILABLE");
}
