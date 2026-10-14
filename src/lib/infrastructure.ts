import "server-only";

import type { Actor, Db } from "./auth";
import { superOnly } from "./rbac";
import { storageClient, packagesBucket, casBucket, environmentsBucket } from "./storage";
import { signingIdentity } from "./signing";
export async function infrastructureStatus(db: Db, actor: Actor) {
  superOnly(actor);
  let storageReady = false; let signing: { keyId: string; publicKey: string } | null = null;
  try { for (const Bucket of [packagesBucket(), casBucket(), environmentsBucket()]) await storageClient().headBucket({ Bucket }); storageReady = true; } catch { /* Report disconnected state without exposing credentials. */ }
  try { const identity = await signingIdentity(); signing = { keyId: identity.keyId, publicKey: identity.publicKey }; } catch { /* A missing key must block publishing, not viewing status. */ }
  const queue = await db.clientUpload.groupBy({ by: ["status"], _count: { _all: true } });
  const workers = await db.workerHeartbeat.findMany({ where: { lastSeen: { gt: new Date(Date.now() - 30000) } }, select: { id: true, lastSeen: true } });
  const packages = await db.packageBuild.groupBy({ by: ["status"], where: { required: true, draft: { client: { deletedAt: null } } }, _count: { _all: true } });
  return { storageReady, packagesBucket: packagesBucket(), casBucket: casBucket(), environmentsBucket: environmentsBucket(), signing,
    queue: queue.map(row => ({ status: row.status, count: row._count._all })), packageQueue: packages.map(row => ({ status: row.status, count: row._count._all })), workers };
}
