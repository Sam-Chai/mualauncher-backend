import "server-only";
import type { Db } from "./auth";

export async function publishedServers(db: Db) {
  const servers = await db.server.findMany({
    where: { isListed: true, archivedAt: null, organization: { archivedAt: null },
      publication: { client: { archivedAt: null }, release: { archivedAt: null } } },
    orderBy: [{ sortOrder: "asc" }, { serverId: "asc" }],
    select: { serverId: true, displayName: true, description: true, gameAddress: true, themeColor: true, sortOrder: true,
      organization: { select: { id: true, displayName: true } }, publication: { select: { revision: true, release: {
        select: { id: true, clientId: true, versionLabel: true, name: true, manifestSha256: true } } } } },
  });
  return servers.map(({ publication, ...server }) => ({ ...server, currentRelease: publication?.release ? { ...publication.release,
    manifestUrl: `/api/v1/servers/${server.serverId}/manifest` } : null, publicationRevision: publication?.revision }));
}
