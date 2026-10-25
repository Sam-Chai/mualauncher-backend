import "dotenv/config";
import { randomUUID } from "node:crypto";
import { workerPrisma as prisma, validateDatabase } from "../src/lib/prisma";
import { runUploadWorker, expireIncompleteUploads } from "../src/lib/client-worker";
import { maintainRecycleBin } from "../src/lib/recycle-storage";
import { runPackageWorker } from "../src/lib/package-worker";
import { collectStorageTelemetry } from "../src/lib/storage-telemetry";
import { syncUnionDirectory, importUnionAvatars } from "../src/lib/union-directory";
import { DockerExecutionBackend } from "../src/lib/execution-docker";
import { executionPolicy } from "../src/lib/execution-policy";
import { recordExecutionHost } from "../src/lib/execution-management";

const workerId = randomUUID(); let running = true;
const shutdown = new AbortController();
const stop = () => { running = false; shutdown.abort(); };
process.on("SIGINT", stop); process.on("SIGTERM", stop);
async function main() {
  await validateDatabase("worker");
  const heartbeat = setInterval(() => { void prisma.workerHeartbeat.upsert({ where: { id: workerId }, create: { id: workerId }, update: { lastSeen: new Date() } }).catch(() => console.error("Worker heartbeat failed")); }, 10000);
  await prisma.workerHeartbeat.create({ data: { id: workerId } });
  let executionReport: Promise<unknown> | undefined;
  const refreshExecution = () => {
    if (!executionReport) executionReport = recordExecutionHost(workerId, prisma).catch(() => console.error("Worker execution status report failed")).finally(() => { executionReport = undefined; });
  };
  refreshExecution(); const executionTimer = setInterval(refreshExecution, 30000);
  console.log(`MUA client Worker ready (${workerId})`);
  let telemetry: Promise<unknown> | undefined;
  const refreshTelemetry = () => {
    if (!telemetry) telemetry = collectStorageTelemetry(prisma).catch(() => console.error("Storage telemetry collection failed")).finally(() => { telemetry = undefined; });
  };
  refreshTelemetry();
  const telemetryTimer = setInterval(refreshTelemetry, 30_000);
  let directory: Promise<unknown> | undefined, avatars: Promise<unknown> | undefined;
  const refreshUnion = () => {
    if (!directory) directory = syncUnionDirectory(prisma).catch(() => console.error("Union directory sync failed")).finally(() => { directory = undefined; });
    if (!avatars) avatars = importUnionAvatars(prisma).catch(() => console.error("Union avatar import failed")).finally(() => { avatars = undefined; });
  };
  refreshUnion();
  const unionTimer = setInterval(refreshUnion, 10_000);
  let reaping: Promise<unknown> | undefined;
  const reap = () => {
    if (process.env.SANDBOX_JAVA_IMAGE && !reaping) reaping = Promise.resolve().then(() => new DockerExecutionBackend(executionPolicy()).reap())
      .catch(() => console.error("Execution resource cleanup failed; run sandbox:check and sandbox:reap"))
      .finally(() => { reaping = undefined; });
  };
  reap(); const reapTimer = setInterval(reap, 30_000);
  let maintenance: Promise<void> | undefined;
  const packages = (async () => {
    while (running) {
      try { if (!await runPackageWorker(prisma, undefined, shutdown.signal, workerId)) await new Promise(resolve => setTimeout(resolve, 1500)); }
      catch (error) { console.error("Package queue failed", error instanceof Error ? error.message : "unknown"); await new Promise(resolve => setTimeout(resolve, 3000)); }
    }
  })();
  try {
    let lastMaintenance = 0;
    while (running) {
      try {
        if (Date.now() - lastMaintenance > 60000) {
          await expireIncompleteUploads(prisma); lastMaintenance = Date.now();
          // A recycling error must not stop the upload queue. Retry next minute.
          if (!maintenance) maintenance = maintainRecycleBin(prisma).catch(error => {
            console.error("Recycle maintenance failed", error instanceof Error ? error.message : "unknown");
          }).finally(() => { maintenance = undefined; });
        }
        if (!await runUploadWorker(prisma)) await new Promise(resolve => setTimeout(resolve, 1500));
      }
      catch (error) { console.error("Worker queue failed", error instanceof Error ? error.message : "unknown"); await new Promise(resolve => setTimeout(resolve, 3000)); }
    }
  } finally { stop(); clearInterval(executionTimer); clearInterval(reapTimer); clearInterval(telemetryTimer); clearInterval(unionTimer); await executionReport; await reaping; await directory; await avatars; await telemetry; await packages; await maintenance; clearInterval(heartbeat); await prisma.$disconnect(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Worker failed"); process.exitCode = 1; });
