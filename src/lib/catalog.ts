import "server-only";
import type { Db } from "./auth";

export async function publishedServers(db: Db, now = new Date()) {
  const servers = await db.server.findMany({
    where: { OR: [{ displayMode: "PERMANENT" }, { displayMode: "RANGE", displayStartsAt: { lte: now }, displayEndsAt: { gt: now } }], isListed: true, archivedAt: null, organization: { archivedAt: null },
      publication: { client: { archivedAt: null, deletedAt: null }, release: { archivedAt: null } } },
    orderBy: [{ sortOrder: "asc" }, { serverId: "asc" }],
    select: { displayMode: true, displayStartsAt: true, displayEndsAt: true, serverId: true, displayName: true, description: true, gameAddress: true, themeColor: true, sortOrder: true,
      organization: { select: { id: true, displayName: true } }, publication: { select: { revision: true, release: {
        select: { id: true, clientId: true, versionLabel: true, name: true, manifestSha256: true, packageFormatVersion: true } } } } },
  });
  return servers.map(({ publication, ...server }) => ({ ...server, currentRelease: publication?.release ? { ...publication.release,
    manifestUrl: `/api/v1/servers/${server.serverId}/manifest?acceptedFormatVersions=${publication.release.packageFormatVersion}`, packagesUrl: `/api/v1/servers/${server.serverId}/packages?acceptedFormatVersions=${publication.release.packageFormatVersion}` } : null, publicationRevision: publication?.revision }));
}
