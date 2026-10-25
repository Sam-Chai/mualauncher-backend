import "server-only";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import { ExecutionError, type ExecutionPolicy } from "./execution-policy";

export type DockerOptions = { signal?: AbortSignal; timeoutMs?: number; execution?: boolean; input?: Readable; consume?: (source: Readable) => Promise<void>; maxBytes?: number };
export type DockerReply = { code: number; stdout: string; stderr: string };
export type DockerTransport = { run(args: string[], options?: DockerOptions): Promise<DockerReply> };
export class DockerClient implements DockerTransport {
  constructor(private readonly policy: ExecutionPolicy) {}
  async run(args: string[], options: DockerOptions = {}): Promise<DockerReply> {
    const env: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV };
    for (const key of ["PATH", "Path", "SystemRoot", "WINDIR", "HOME", "USERPROFILE", "DOCKER_CONFIG", "SSH_AUTH_SOCK"]) if (process.env[key]) env[key] = process.env[key];
    const signal = AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(options.timeoutMs ?? this.policy.commandSeconds * 1000)]);
    signal.throwIfAborted();
    const child = spawn(this.policy.docker, ["--context", this.policy.context, ...args], { env, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "", bytes = 0; const max = options.maxBytes ?? this.policy.maxLogBytes;
    const abort = () => { child.kill("SIGKILL"); child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    const closed = new Promise<number>((resolve, reject) => { child.once("error", () => reject(new ExecutionError("unavailable", true, args[0]))); child.once("close", code => resolve(code ?? -1)); });
    const jobs: Promise<unknown>[] = [];
    if (options.input) jobs.push(pipeline(options.input, child.stdin)); else child.stdin.end();
    if (options.consume) jobs.push(options.consume(child.stdout)); else child.stdout.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes > max) abort(); else stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes > max) abort(); else stderr += chunk.toString(); });
    try {
      // Kill the CLI promptly on a stream validator failure; finally in the backend kills the container.
      const code = await Promise.all([closed, ...jobs.map(job => job.catch(error => { abort(); throw error; }))]).then(values => values[0]);
      if (options.signal?.aborted) throw options.signal.reason;
      if (signal.aborted) throw new ExecutionError(options.execution ? "timeout" : "unavailable", !options.execution, args[0]);
      if (bytes > max) throw new ExecutionError("failed", false, "log-limit");
      return { code, stdout, stderr };
    } catch (error) {
      if (options.signal?.aborted) throw options.signal.reason;
      if (signal.aborted) throw new ExecutionError(options.execution ? "timeout" : "unavailable", !options.execution, args[0]);
      if (bytes > max) throw new ExecutionError("failed", false, "log-limit");
      throw error;
    } finally { signal.removeEventListener("abort", abort); if (child.exitCode === null && child.signalCode === null) abort(); await closed.catch(() => {}); }
  }
}
