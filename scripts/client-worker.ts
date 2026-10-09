import "dotenv/config";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { runUploadWorker, expireIncompleteUploads } from "../src/lib/client-worker";
import { maintainRecycleBin } from "../src/lib/recycle-storage";

const workerId = randomUUID(); let running = true;
process.on("SIGINT", () => { running = false; }); process.on("SIGTERM", () => { running = false; });
async function main() {
  const heartbeat = setInterval(() => { void prisma.workerHeartbeat.upsert({ where: { id: workerId }, create: { id: workerId }, update: { lastSeen: new Date() } }).catch(() => console.error("Worker heartbeat failed")); }, 10000);
  await prisma.workerHeartbeat.create({ data: { id: workerId } });
  console.log(`MUA client Worker ready (${workerId})`);
  let maintenance: Promise<void> | undefined;
  try {
    let lastMaintenance = 0;
    while (running) {
      try {
        if (Date.now() - lastMaintenance > 60000) {
          await expireIncompleteUploads(); lastMaintenance = Date.now();
          // A recycling error must not stop the upload queue. Retry next minute.
          if (!maintenance) maintenance = maintainRecycleBin().catch(error => {
            console.error("Recycle maintenance failed", error instanceof Error ? error.message : "unknown");
          }).finally(() => { maintenance = undefined; });
        }
        if (!await runUploadWorker()) await new Promise(resolve => setTimeout(resolve, 1500));
      }
      catch (error) { console.error("Worker queue failed", error instanceof Error ? error.message : "unknown"); await new Promise(resolve => setTimeout(resolve, 3000)); }
    }
  } finally { await maintenance; clearInterval(heartbeat); await prisma.$disconnect(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Worker failed"); process.exitCode = 1; });
