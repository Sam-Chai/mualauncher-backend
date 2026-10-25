import "server-only";
import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { workerPrisma } from "./prisma";
import type { Actor, Db } from "./auth";
import { superOnly } from "./rbac";
import { executionInstancesSchema, executionHostSchema, executionContainerSchema, type ExecutionHost, type ExecutionMode } from "./execution-management-contract";
import { executionPlanDigest, type ExecutionBackend, type ExecutionObserver } from "./execution-contract";
import { DockerExecutionBackend } from "./execution-docker";
import { DockerClient } from "./execution-docker-client";
import { BareExecutionBackend, barePolicy, bareProfileIdentity, probeBare } from "./execution-bare";
import { executionPolicy, executionProfileIdentity, ExecutionError } from "./execution-policy";
import { serializeError, diagnosticText } from "./diagnostics";
export type ExecutionContext = { mode: ExecutionMode; profile: string; workerId: string; buildId: string };
export async function executionContext(mode: ExecutionMode, workerId: string, buildId: string): Promise<ExecutionContext> {
  return { mode, workerId, buildId, profile: mode === "BARE" ? await bareProfileIdentity() : executionProfileIdentity() };
}
function discoveryPolicy() {
  return executionPolicy({ NODE_ENV: process.env.NODE_ENV, SANDBOX_JAVA_IMAGE: `sha256:${"0".repeat(64)}`, SANDBOX_DOCKER_BIN: process.env.SANDBOX_DOCKER_BIN,
    SANDBOX_DOCKER_CONTEXT: process.env.SANDBOX_DOCKER_CONTEXT, SANDBOX_NAMESPACE: process.env.SANDBOX_NAMESPACE });
}
export async function executionHostStatus(daemon?: (id: string) => void): Promise<ExecutionHost> {
  const status: ExecutionHost = { sampledAt: new Date().toISOString(), platform: process.platform, architecture: process.arch,
    docker: { installed: false, connected: false, version: null, linux: false },
    gvisor: { registered: false, verified: false, imageConfigured: false, ready: false, reason: null }, bare: await probeBare() };
  // Inspect Docker even when the executor image has not been configured yet.
  try {
    const docker = new DockerClient(discoveryPolicy());
    const version = await docker.run(["--version"], { timeoutMs: 5000 }); status.docker.installed = version.code === 0;
    const result = await docker.run(["info", "--format", "{{json .}}"], { timeoutMs: 5000, maxBytes: 1024 ** 2 });
    if (result.code === 0) {
      const info = JSON.parse(result.stdout) as { ID?: string; OSType: string; Architecture: string; ServerVersion: string; Runtimes?: Record<string, unknown> };
      if (info.ID) daemon?.(createHash("sha256").update(info.ID).digest("hex"));
      status.docker.connected = true; status.docker.version = info.ServerVersion; status.docker.linux = info.OSType === "linux";
      status.architecture = info.Architecture; status.gvisor.registered = !!info.Runtimes?.runsc;
    }
    const policy = executionPolicy(); status.gvisor.imageConfigured = true;
    if (status.docker.connected && status.docker.linux && status.gvisor.registered) {
      await new DockerExecutionBackend(policy).probe(AbortSignal.timeout(20000)); status.gvisor.verified = true; status.gvisor.ready = true;
    } else status.gvisor.reason = diagnosticText("diagnostics.execution.backendUnavailable");
  } catch (error) { status.gvisor.reason = error instanceof ExecutionError ? serializeError(error) : diagnosticText("diagnostics.execution.backendUnavailable"); }
  status.sampledAt = new Date().toISOString(); return executionHostSchema.parse(status);
}
export async function recordExecutionHost(workerId: string, client: PrismaClient = workerPrisma) {
  let daemonId: string | undefined;
  const status = await executionHostStatus(id => { daemonId = id; });
  await client.workerHeartbeat.update({ where: { id: workerId }, data: { executionStatus: status as unknown as Prisma.InputJsonObject } });
  if (daemonId && status.docker.connected) await (async () => {
    const snapshotStarted = new Date();
    const live = await new DockerExecutionBackend(discoveryPolicy()).containerSnapshot(AbortSignal.timeout(20000));
    const rows = await client.executionRun.findMany({ where: { daemonId, updatedAt: { lt: snapshotStarted }, startedAt: { gt: new Date(Date.now() - 86400000) } }, take: 100, orderBy: { startedAt: "desc" } });
    const owners = new Set((await client.workerHeartbeat.findMany({ where: { id: { in: rows.map(row => row.workerId) }, lastSeen: { gt: new Date(Date.now() - 120000) } }, select: { id: true } })).map(row => row.id));
    for (const row of rows) {
      const parsed = executionContainerSchema.array().safeParse(row.containers); if (!parsed.success) continue;
      const containers = parsed.data.map(container => ({ ...container, state: live.get(container.id) ?? "REMOVED" as const }));
      const interrupted = ["PREPARING", "RUNNING"].includes(row.state) && !owners.has(row.workerId);
      if (!interrupted && !["PREPARING", "RUNNING", "CLEANUP_FAILED"].includes(row.state) && containers.every(container => container.state === "REMOVED") && JSON.stringify(containers) === JSON.stringify(row.containers)) continue;
      await client.executionRun.updateMany({ where: { id: row.id, updatedAt: row.updatedAt }, data: { containers, ...(interrupted ? { state: "INTERRUPTED", finishedAt: new Date() } : {}) } });
    }
  })().catch(() => { /* An incomplete snapshot must never imply resource removal. */ });
  // An expired run is interrupted, not successful; cleanup is unknown until confirmed by the daemon.
  const stale = await client.executionRun.findMany({ where: { state: { in: ["PREPARING", "RUNNING"] }, startedAt: { lt: new Date(Date.now() - 7500 * 1000) } }, take: 100 });
  for (const run of stale) {
    const parsed = executionContainerSchema.array().safeParse(run.containers);
    await client.executionRun.updateMany({ where: { id: run.id, updatedAt: run.updatedAt, state: { in: ["PREPARING", "RUNNING"] } }, data: { state: "INTERRUPTED", finishedAt: new Date(),
      ...(parsed.success ? { containers: parsed.data.map(container => ({ ...container, state: container.state === "REMOVED" ? "REMOVED" : "UNKNOWN" })) } : {}) } });
  }
  return status;
}
export function managedExecution(context: ExecutionContext, client: PrismaClient = workerPrisma): ExecutionBackend {
  return async (plan, bindings, destination, signal, progress) => {
    let id: string | undefined, daemonId: string | null = null, architecture: string = process.arch;
    const p = context.mode === "BARE" ? barePolicy() : executionPolicy();
    const limits = { cpus: context.mode === "BARE" ? null : p.cpus, memoryMiB: context.mode === "BARE" ? null : p.memoryMiB, heapMiB: p.heapMiB,
      workspaceMiB: context.mode === "BARE" ? null : p.workspaceMiB, tmpMiB: context.mode === "BARE" ? null : p.tmpMiB, pids: context.mode === "BARE" ? null : p.pids,
      deadlineSeconds: p.deadlineSeconds, network: context.mode === "BARE" ? "host" : "none", readOnlyRoot: context.mode !== "BARE", runtime: context.mode === "BARE" ? "host" : "runsc" };
    const observer: ExecutionObserver = async event => {
      daemonId = event.daemonId ?? daemonId;
      architecture = event.architecture ?? architecture;
      const containers = structuredClone(event.containers) as unknown as Prisma.InputJsonArray;
      if (!id) {
        id = event.executionId;
        await client.executionRun.create({ data: { id, daemonId, workerId: context.workerId, buildId: context.buildId, mode: context.mode, adapter: plan.adapter, state: event.state,
          planSha256: executionPlanDigest(plan), image: context.mode === "BARE" ? `bare:${context.profile}` : p.image, architecture, limits, containers } });
      } else await client.executionRun.update({ where: { id }, data: { state: event.state, daemonId, architecture, containers } });
    };
    try {
      const backend = context.mode === "BARE" ? new BareExecutionBackend(observer) : new DockerExecutionBackend(p, undefined, observer);
      const result = await backend.execute(plan, bindings, destination, signal, progress);
      await client.executionRun.update({ where: { id: result.executionId }, data: { state: "SUCCEEDED", finishedAt: new Date(), architecture: result.architecture, image: result.image } });
      return result;
    } catch (error) {
      if (id) await client.executionRun.update({ where: { id }, data: { state: error instanceof ExecutionError && error.reason === "cleanup" ? "CLEANUP_FAILED" : signal.aborted ? "CANCELLED" : "FAILED", finishedAt: new Date(), error: serializeError(error) } }).catch(() => {});
      throw error;
    }
  };
}
export async function executionInstances(db: Db, actor: Actor) {
  superOnly(actor);
  const rows = await db.executionRun.findMany({ orderBy: [{ startedAt: "desc" }, { id: "desc" }], take: 100 });
  return executionInstancesSchema.parse({ runs: rows.map(row => ({ ...row, startedAt: row.startedAt.toISOString(), updatedAt: row.updatedAt.toISOString(), finishedAt: row.finishedAt?.toISOString() ?? null })), limit: 100 });
}
