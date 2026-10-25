import { createHash } from "node:crypto";
import { AppError } from "./errors";
import { diagnosticText } from "./diagnostics";

export class ExecutionError extends AppError {
  constructor(public readonly reason: "configuration" | "unavailable" | "integrity" | "timeout" | "failed" | "cleanup", public readonly retryable = false, operation = "") {
    const codes = { configuration: "diagnostics.execution.configuration", unavailable: "diagnostics.execution.unavailable", integrity: "diagnostics.execution.integrity", timeout: "diagnostics.execution.timeout", failed: "diagnostics.execution.failed", cleanup: "diagnostics.execution.cleanup" } as const;
    super(reason === "configuration" || reason === "unavailable" ? 503 : 422, diagnosticText(codes[reason], { operation }));
  }
}
export type ExecutionPolicy = ReturnType<typeof executionPolicy>;
export function executionPolicy(env: NodeJS.ProcessEnv = process.env) {
  const integer = (key: string, fallback: number, min: number, max: number) => {
    const raw = env[key] ?? String(fallback);
    if (!/^\d+$/.test(raw) || Number(raw) < min || Number(raw) > max) throw new ExecutionError("configuration", false, key);
    return Number(raw);
  };
  const image = env.SANDBOX_JAVA_IMAGE ?? "";
  if (!/^(?:sha256:[a-f0-9]{64}|[a-zA-Z0-9][a-zA-Z0-9._:/-]*@sha256:[a-f0-9]{64})$/.test(image)) throw new ExecutionError("configuration", false, "SANDBOX_JAVA_IMAGE");
  const namespace = env.SANDBOX_NAMESPACE ?? "union-link";
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(namespace)) throw new ExecutionError("configuration", false, "SANDBOX_NAMESPACE");
  const context = env.SANDBOX_DOCKER_CONTEXT ?? "default";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,100}$/.test(context)) throw new ExecutionError("configuration", false, "SANDBOX_DOCKER_CONTEXT");
  return { protocolVersion: 1, policyRevision: "gvisor-java-1", image, namespace, context, docker: env.SANDBOX_DOCKER_BIN || "docker",
    slots: integer("SANDBOX_SLOTS", 1, 1, 8), memoryMiB: integer("SANDBOX_MEMORY_MIB", 6144, 1024, 65536),
    heapMiB: integer("SANDBOX_HEAP_MIB", 2048, 256, 32768), cpus: integer("SANDBOX_CPUS", 2, 1, 32),
    workspaceMiB: integer("SANDBOX_WORKSPACE_MIB", 2048, 64, 16384), tmpMiB: integer("SANDBOX_TMP_MIB", 256, 32, 4096),
    maxInputBytes: integer("SANDBOX_MAX_INPUT_MIB", 1024, 1, 16384) * 1024 ** 2,
    maxOutputBytes: integer("SANDBOX_MAX_OUTPUT_MIB", 1024, 1, 16384) * 1024 ** 2,
    maxFiles: integer("SANDBOX_MAX_FILES", 20000, 1, 100000), pids: integer("SANDBOX_PIDS", 256, 32, 2048),
    deadlineSeconds: integer("SANDBOX_DEADLINE_SECONDS", 1800, 10, 7200), stepSeconds: integer("SANDBOX_STEP_SECONDS", 600, 1, 1800),
    maxLogBytes: 65536, commandSeconds: 30 };
}
export function executionProfileIdentity(env: NodeJS.ProcessEnv = process.env) {
  try { const policy = Object.fromEntries(Object.entries(executionPolicy(env)).filter(([key]) => !["docker", "context", "namespace", "slots"].includes(key))); return createHash("sha256").update(JSON.stringify(policy)).digest("hex"); }
  catch { return "unconfigured"; }
}
