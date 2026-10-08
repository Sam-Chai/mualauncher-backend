import "server-only";
import type { Db } from "./auth";

export async function publishedServers(db: Db) {
  const servers = await db.server.findMany({
    where: { isListed: true, archivedAt: null, organization: { archivedAt: null }, client: { archivedAt: null },
      publication: { release: { archivedAt: null } } },
    orderBy: [{ sortOrder: "asc" }, { serverId: "asc" }],
    select: { serverId: true, displayName: true, description: true, gameAddress: true, themeColor: true, sortOrder: true,
      organization: { select: { id: true, displayName: true } }, publication: { select: { revision: true, release: {
        select: { id: true, versionLabel: true, name: true, manifestSha256: true } } } } },
  });
  return servers.map(({ publication, ...server }) => ({ ...server, currentRelease: publication?.release, publicationRevision: publication?.revision }));
}
