import "server-only";
import type { Db } from "./auth";
import { invariant } from "./errors";
import { digest, readObject, casBucket, casKey, signedDownload } from "./storage";
import type { ReleaseManifest } from "./client-contract";
export async function publicManifest(db: Db, serverId: string) {
  const server = await db.server.findFirst({ where: { serverId, isListed: true, archivedAt: null,
    organization: { archivedAt: null }, publication: { client: { archivedAt: null }, release: { archivedAt: null } } },
    include: { publication: { include: { release: true } } } });
  const release = server?.publication?.release; invariant(release, 404, "此服务器没有可分发的客户端");
  const bytes = await readObject(release.manifestObjectKey); invariant(digest(bytes) === release.manifestSha256, 503, "已发布 Manifest 校验失败");
  const manifest = JSON.parse(bytes.toString("utf8")) as ReleaseManifest;
  invariant(manifest.organizationId === server!.organizationId &&
    (manifest.schemaVersion === 2 ? manifest.clientId === release.clientId : manifest.schemaVersion === 1 && manifest.serverId === serverId),
    503, "发布清单与服务器绑定不一致");
  return { bytes, release };
}
export async function publicFile(db: Db, serverId: string, sha256: string) {
  invariant(/^[0-9a-f]{64}$/.test(sha256), 404, "文件不存在");
  const { bytes } = await publicManifest(db, serverId); const manifest = JSON.parse(bytes.toString("utf8")) as ReleaseManifest;
  invariant(manifest.files.some(file => file.sha256 === sha256), 404, "文件不属于当前发布版本");
  return { url: await signedDownload(casKey(sha256), casBucket()), expiresIn: 300 };
}
