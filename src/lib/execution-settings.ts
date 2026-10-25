import "server-only";
import { executionModeSchema, executionSettingsInput, executionHostSchema, type ExecutionSettings } from "./execution-management-contract";
import type { Actor, Db } from "./auth";
import { superOnly } from "./rbac";
import { invariant } from "./errors";
import { diagnosticText } from "./diagnostics";
import { audit } from "./management";
export async function workerExecutionMode(db: Db) {
  return executionModeSchema.parse((await db.platformSettings.findUnique({ where: { id: "platform" } }))?.executionMode ?? "DOCKER_GVISOR");
}
export async function executionSettings(db: Db, actor: Actor): Promise<ExecutionSettings> {
  superOnly(actor); const row = await db.platformSettings.findUnique({ where: { id: "platform" } });
  const now = Date.now();
  const workers = (await db.workerHeartbeat.findMany({ where: { lastSeen: { gt: new Date(now - 86400000) } }, orderBy: { lastSeen: "desc" }, take: 100 })).map(worker => {
    const parsed = executionHostSchema.safeParse(worker.executionStatus), status = parsed.success ? parsed.data : null;
    return { id: worker.id, lastSeen: worker.lastSeen.toISOString(), status,
      fresh: worker.lastSeen.getTime() > now - 30000 && !!status && new Date(status.sampledAt).getTime() > now - 90000 && new Date(status.sampledAt).getTime() <= now + 10000 };
  });
  return { mode: executionModeSchema.parse(row?.executionMode ?? "DOCKER_GVISOR"), revision: row?.executionRevision ?? 0, workers,
    dockerAvailable: workers.some(({ fresh, status }) => fresh && status?.docker.installed && status.docker.connected && status.docker.linux && status.gvisor.registered && status.gvisor.verified && status.gvisor.imageConfigured && status.gvisor.ready),
    bareAvailable: workers.some(worker => worker.fresh && worker.status?.bare.ready) };
}
export async function updateExecutionSettings(db: Db, actor: Actor, raw: unknown) {
  superOnly(actor); const parsed = executionSettingsInput.safeParse(raw);
  invariant(parsed.success, 400, diagnosticText("diagnostics.execution.invalidSettings"));
  await db.$executeRaw`SELECT pg_advisory_xact_lock(731402,1)`;
  const previous = await executionSettings(db, actor), { mode, revision } = parsed.data;
  invariant(previous.revision === revision, 409, diagnosticText("diagnostics.execution.settingsChanged"));
  invariant(mode === previous.mode || (mode === "DOCKER_GVISOR" ? previous.dockerAvailable : previous.bareAvailable), 409, diagnosticText("diagnostics.execution.backendUnavailable"));
  await db.platformSettings.upsert({ where: { id: "platform" }, create: { id: "platform", executionMode: mode, executionRevision: revision + 1 }, update: { executionMode: mode, executionRevision: revision + 1 } });
  await audit(db, actor, "EXECUTION_MODE_UPDATE", "PlatformSettings", "platform", undefined, undefined, { previousMode: previous.mode, mode, revision: revision + 1 });
  return executionSettings(db, actor);
}
