import "server-only";
import type { ExecutionBackend, ExecutionObserver } from "./execution-contract";
import { executionPolicy, ExecutionError } from "./execution-policy";
// Retain legacy mode identifiers for history and database compatibility only.
export function barePolicy() {
  return executionPolicy({ ...process.env, SANDBOX_JAVA_IMAGE: `sha256:${"0".repeat(64)}`, SANDBOX_DOCKER_CONTEXT: "default", SANDBOX_NAMESPACE: "bare" });
}
export async function probeBare() { return { ready: false, version: null }; }
export async function bareProfileIdentity() { return "disabled-in-release-0.1.0"; }
export class BareExecutionBackend {
  constructor(observer?: ExecutionObserver) { void observer; }
  readonly execute: ExecutionBackend = async () => {
    throw new ExecutionError("configuration", false, "docker-gvisor-required");
  };
}
