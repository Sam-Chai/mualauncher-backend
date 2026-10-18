import "dotenv/config";
import { workerPrisma, validateDatabase, disconnectDatabases } from "../src/lib/prisma";
import { collectStorageTelemetry } from "../src/lib/storage-telemetry";

let running = true;
process.on("SIGINT", () => { running = false; });
process.on("SIGTERM", () => { running = false; });
async function main() {
  await validateDatabase("worker");
  do {
    const collected = await collectStorageTelemetry(workerPrisma);
    console.log(collected ? "Storage telemetry collected" : "Storage telemetry not due, disabled or unavailable");
    if (!process.argv.includes("--watch")) break;
    await new Promise(resolve => setTimeout(resolve, 30_000));
  } while (running);
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Storage telemetry failed"); process.exitCode = 1; }).finally(disconnectDatabases);
