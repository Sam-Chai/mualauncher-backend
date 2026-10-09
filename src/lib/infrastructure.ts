import "server-only";
import { HeadBucketCommand } from "@aws-sdk/client-s3";
import type { Actor, Db } from "./auth";
import { superOnly } from "./rbac";
import { storageClient, packagesBucket, casBucket } from "./storage";
import { signingIdentity } from "./signing";
export async function infrastructureStatus(db: Db, actor: Actor) {
  superOnly(actor);
  let storageReady = false; let signing: { keyId: string; publicKey: string } | null = null;
  try { for (const Bucket of [packagesBucket(), casBucket()]) await storageClient().send(new HeadBucketCommand({ Bucket })); storageReady = true; } catch { /* Report disconnected state without exposing credentials. */ }
  try { const identity = await signingIdentity(); signing = { keyId: identity.keyId, publicKey: identity.publicKey }; } catch { /* A missing key must block publishing, not viewing status. */ }
  const queue = await db.clientUpload.groupBy({ by: ["status"], _count: { _all: true } });
  const workers = await db.workerHeartbeat.findMany({ where: { lastSeen: { gt: new Date(Date.now() - 30000) } }, select: { id: true, lastSeen: true } });
  return { storageReady, packagesBucket: packagesBucket(), casBucket: casBucket(), signing, queue: queue.map(row => ({ status: row.status, count: row._count._all })), workers };
}
