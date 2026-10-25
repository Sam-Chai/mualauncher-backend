import "server-only";
import { spawn } from "node:child_process";
import { copyFile, mkdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { delimiter, dirname, join } from "node:path";
import { executionPlanSchema, executionPlanDigest, type ExecutionBackend, type ExecutionObserver } from "./execution-contract";
import { executionPolicy, ExecutionError } from "./execution-policy";
import { executionInputs } from "./execution-archive";
export function barePolicy() {
  const resources = executionPolicy({ ...process.env, SANDBOX_JAVA_IMAGE: `sha256:${"0".repeat(64)}`, SANDBOX_DOCKER_CONTEXT: "default", SANDBOX_NAMESPACE: "bare" });
  return { ...resources, java: process.env.FORGE_PROCESSOR_JAVA || (process.env.JAVA_HOME ? join(process.env.JAVA_HOME, "bin", process.platform === "win32" ? "java.exe" : "java") : "java") };
}
function hostEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV };
  for (const key of ["PATH", "Path", "SystemRoot", "WINDIR", "HOME", "USERPROFILE", "TMP", "TEMP", "LANG"]) if (process.env[key]) env[key] = process.env[key];
  return env;
}
async function hostCommand(java: string, args: string[], signal: AbortSignal, directory?: string) {
  signal.throwIfAborted();
  const child = spawn(java, args, { cwd: directory, env: hostEnv(), shell: false, windowsHide: true, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
  let bytes = 0, output = "";
  const stop = async () => {
    if (!child.pid) return;
    if (process.platform === "win32" && child.exitCode === null && child.signalCode === null) await new Promise<void>(yes => {
      const killer = spawn(join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe"), ["/PID", String(child.pid), "/T", "/F"], { shell: false, windowsHide: true, stdio: "ignore" });
      const finish = () => { clearTimeout(timer); if (child.exitCode === null) child.kill("SIGKILL"); yes(); };
      const timer = setTimeout(() => { killer.kill("SIGKILL"); finish(); }, 5000);
      killer.on("error", finish); killer.on("close", finish);
    });
    else if (process.platform !== "win32") { try { process.kill(-child.pid, "SIGKILL"); } catch { /* Process group already exited. */ } }
  };
  const abort = () => { void stop(); child.stdout.destroy(); child.stderr.destroy(); }; signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) abort();
  let rejectAbort: (() => void) | undefined;
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes > 65536) void stop(); else output += chunk.toString(); });
  try {
    const code = await Promise.race([new Promise<number | null>((yes, no) => { child.once("error", () => no(new ExecutionError("configuration", true, "host-java"))); child.once("close", yes); }),
      new Promise<never>((_, no) => { rejectAbort = () => no(signal.reason); signal.addEventListener("abort", rejectAbort, { once: true }); if (signal.aborted) rejectAbort(); })]);
    signal.throwIfAborted(); if (bytes > 65536) throw new ExecutionError("failed", false, "log-limit");
    return { code, output };
  } finally { signal.removeEventListener("abort", abort); if (rejectAbort) signal.removeEventListener("abort", rejectAbort); await stop(); }
}
export async function probeBare() {
  try {
    const result = await hostCommand(barePolicy().java, ["-version"], AbortSignal.timeout(5000));
    const match = /(?:openjdk|java) version "(\d+)[^"\r\n]*"/i.exec(result.output);
    return { ready: result.code === 0 && !!match && Number(match[1]) >= 21, version: match?.[0].slice(0, 150) ?? null };
  } catch { return { ready: false, version: null }; }
}
export async function bareProfileIdentity() {
  const policy = barePolicy(), java = await probeBare();
  return createHash("sha256").update(JSON.stringify({ revision: "bare-java-2", platform: process.platform, architecture: process.arch, java: policy.java, version: java.version, heap: policy.heapMiB })).digest("hex");
}
export class BareExecutionBackend {
  constructor(private readonly observer?: ExecutionObserver) {}
  readonly execute: ExecutionBackend = async (raw, bindings, destination, external, progress) => {
    const plan = executionPlanSchema.parse(raw), policy = barePolicy(), id = randomUUID();
    const signal = AbortSignal.any([external, AbortSignal.timeout(policy.deadlineSeconds * 1000)]);
    const image = `bare:${await bareProfileIdentity()}`;
    await this.observer?.({ executionId: id, state: "PREPARING", containers: [] });
    try {
      if (!(await probeBare()).ready) throw new ExecutionError("configuration", true, "host-java-21");
      await mkdir(destination, { mode: 0o700 }); const work = join(destination, "workspace"); await mkdir(work);
      if (bindings.size !== plan.inputs.length || plan.inputs.reduce((size, file) => size + file.size, 0) > policy.maxInputBytes) throw new ExecutionError("integrity", false, "input-limit");
      for (const directory of plan.directories) await mkdir(join(work, directory), { recursive: true });
      for (const input of plan.inputs) {
        signal.throwIfAborted(); const local = bindings.get(input.path); if (!local) throw new ExecutionError("integrity", false, "input-binding");
        const target = join(work, input.path); await mkdir(dirname(target), { recursive: true }); await copyFile(local, target);
      }
      const originals = await executionInputs(work, signal);
      if (originals.inputs.length !== plan.inputs.length || plan.inputs.some(file => !originals.inputs.some(actual => actual.path === file.path && actual.sha256 === file.sha256 && actual.size === file.size))) throw new ExecutionError("integrity", false, "input-digest");
      for (const file of plan.outputs) await mkdir(dirname(join(work, file.path)), { recursive: true });
      await this.observer?.({ executionId: id, state: "RUNNING", containers: [] });
      for (const step of plan.steps) {
        await progress?.(step.id);
        const stepSignal = AbortSignal.any([signal, AbortSignal.timeout(policy.stepSeconds * 1000)]);
        const result = await hostCommand(policy.java, [`-Xmx${policy.heapMiB}m`, `-XX:ActiveProcessorCount=${policy.cpus}`, `-Djava.io.tmpdir=${destination}`, "-Djava.awt.headless=true", "-cp",
          step.classpath.map(path => join(work, path)).join(delimiter), step.mainClass,
          ...step.args.map(arg => arg.replace(/\/workspace(?=\/|$)/g, () => work))], stepSignal, work)
          .catch(error => { if (stepSignal.aborted && !signal.aborted) throw new ExecutionError("timeout", false, step.id); throw error; });
        if (result.code !== 0) throw new ExecutionError("failed", false, step.id);
      }
      await progress?.("collecting"); const collected = await executionInputs(work, signal), current = new Map(collected.inputs.map(file => [file.path, file]));
      if (plan.inputs.some(file => current.get(file.path)?.sha256 !== file.sha256 || current.get(file.path)?.size !== file.size)) throw new ExecutionError("integrity", false, "modified-input");
      let size = 0; const artifacts = [];
      for (const output of plan.outputs) {
        const file = current.get(output.path); if (!file || (size += file.size) > policy.maxOutputBytes) throw new ExecutionError("integrity", false, "output-limit");
        const local = join(destination, `artifact-${artifacts.length}`); await copyFile(collected.bindings.get(output.path)!, local);
        const { createReadStream } = await import("node:fs"); const hash = createHash("sha256"), sha1 = createHash("sha1");
        for await (const chunk of createReadStream(local, { signal })) { hash.update(chunk); sha1.update(chunk); }
        const digest = hash.digest("hex"), short = sha1.digest("hex");
        if (digest !== file.sha256 || output.expected && output.expected.hash !== (output.expected.algorithm === "sha1" ? short : digest)) throw new ExecutionError("integrity", false, "output-digest");
        artifacts.push({ ...file, local, sha1: short });
      }
      return { protocolVersion: 1, executionId: id, planSha256: executionPlanDigest(plan), image, architecture: process.arch, artifacts };
    } catch (error) {
      if (external.aborted) throw external.reason;
      if (signal.aborted) throw new ExecutionError("timeout", false, "execution-deadline"); throw error;
    }
  };
}
