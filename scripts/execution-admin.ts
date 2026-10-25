import { config } from "dotenv";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname, sep } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { DockerClient } from "../src/lib/execution-docker-client";
import { DockerExecutionBackend } from "../src/lib/execution-docker";
import { ExecutionError, executionPolicy } from "../src/lib/execution-policy";
import { executionInputs } from "../src/lib/execution-archive";
import type { ExecutionPlan } from "../src/lib/execution-contract";

const run = promisify(execFile);
config({ path: process.env.SANDBOX_ENV_FILE ?? ".env", quiet: true });
async function main() {
  const command = process.argv[2] ?? "check";
  if (command === "image") {
    const pinned = /^(?:[a-zA-Z0-9][a-zA-Z0-9._:/-]*@sha256:[a-f0-9]{64})$/;
    const node = process.env.SANDBOX_NODE_BASE ?? "", java = process.env.SANDBOX_JAVA_BASE ?? "";
    if (!pinned.test(node) || !pinned.test(java)) throw new Error("SANDBOX_NODE_BASE and SANDBOX_JAVA_BASE must be digest-pinned Node 24 and Temurin 21 JRE images");
    const docker = new DockerClient(executionPolicy({ ...process.env, SANDBOX_JAVA_IMAGE: `sha256:${"0".repeat(64)}` }));
    const folder = await mkdtemp(join(tmpdir(), "unionlink-image-"));
    try {
      const iid = join(folder, "image-id");
      const result = await docker.run(["build", "--pull", "--iidfile", iid, "--build-arg", `NODE_IMAGE=${node}`, "--build-arg", `JAVA_IMAGE=${java}`, resolve("deploy/execution")], { timeoutMs: 600000, maxBytes: 1024 ** 2 });
      if (result.code) throw new Error("Executor image build failed; check base image compatibility and Docker build logs");
      const image = (await readFile(iid, "utf8")).trim();
      if (!/^sha256:[a-f0-9]{64}$/.test(image)) throw new Error("Invalid built image identity");
      console.log(`SANDBOX_JAVA_IMAGE=${image}`);
    } finally { await rm(folder, { recursive: true, force: true }); }
    return;
  }
  const policy = executionPolicy(), backend = new DockerExecutionBackend(policy);
  if (command === "check") { console.log(JSON.stringify(await backend.probe())); return; }
  if (command === "reap") { console.log(JSON.stringify({ removed: await backend.reap() })); return; }
  if (command !== "verify") throw new Error("Usage: execution-admin.ts check|reap|image|verify");
  // A missing runsc or failed attestation is an error, never a skipped acceptance test.
  console.log(JSON.stringify({ runtime: await backend.probe(), platform: process.platform }));
  const acceptance = new DockerExecutionBackend({ ...policy, namespace: `${policy.namespace.slice(0, 16)}-v-${randomUUID().slice(0, 8)}`,
    slots: 1, memoryMiB: 1024, heapMiB: 256, workspaceMiB: 64, tmpMiB: 32, maxInputBytes: 16 * 1024 ** 2, maxOutputBytes: 16 * 1024 ** 2,
    pids: 48, cpus: 1, stepSeconds: 12, deadlineSeconds: 60 });
  const folder = await mkdtemp(join(tmpdir(), "unionlink-acceptance-"));
  try {
    const javac = process.env.SANDBOX_JAVAC_BIN || "javac";
    const jar = process.env.SANDBOX_JAR_BIN || (javac.includes(sep) ? join(dirname(javac), process.platform === "win32" ? "jar.exe" : "jar") : "jar");
    const env = { NODE_ENV: process.env.NODE_ENV, PATH: process.env.PATH, Path: process.env.Path, SystemRoot: process.env.SystemRoot, HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
    // Only this checked-in, trusted source is compiled on the host. Installers never use host Java.
    await run(javac, ["--release", "21", "-d", folder, resolve("tests/fixtures/execution/IsolationProbe.java")], { env, timeout: 30000, windowsHide: true });
    const input = join(folder, "input");
    const { mkdir } = await import("node:fs/promises"); await mkdir(input);
    await run(jar, ["--create", "--file", join(input, "probe.jar"), "-C", folder, "IsolationProbe.class"], { env, timeout: 30000, windowsHide: true });
    const bindings = await executionInputs(input, new AbortController().signal);
    const modes = ["boundaries", "descendants", "disk", "pids", "symlink", "mutate", "timeout", "memory", "logs", "cancel"];
    for (const mode of modes) {
      const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
      const plan: ExecutionPlan = { protocolVersion: 1, adapter: "isolation-probe", revision: 1, inputs: bindings.inputs,
        steps: [{ id: mode, kind: "java", classpath: ["probe.jar"], mainClass: "IsolationProbe", args: [mode] }], outputs: [{ path: "result.txt" }] };
      const rejected = ["symlink", "mutate", "timeout", "memory", "logs", "cancel"].includes(mode);
      let failed = false;
      try {
        const result = await acceptance.execute(plan, bindings.bindings, join(folder, mode), controller.signal,
          async () => { if (mode === "cancel") timer = setTimeout(() => controller.abort(new Error("Acceptance cancellation")), 500); });
        if (rejected || (await readFile(result.artifacts[0].local, "utf8")) !== "OK") throw new Error(`Unexpected acceptance result: ${mode}`);
      } catch (error) {
        failed = true;
        const expectedReason = mode === "symlink" || mode === "mutate" ? "integrity" : mode === "timeout" ? "timeout" : "failed";
        if (!rejected || (mode === "cancel" ? error !== controller.signal.reason : !(error instanceof ExecutionError) || error.reason !== expectedReason)) throw error;
      } finally { if (timer) clearTimeout(timer); }
      if (failed !== rejected) throw new Error(`Acceptance did not enforce ${mode}`);
      const remaining = await new DockerClient(acceptance.policy).run(["ps", "-aq", "--filter", `label=org.unionlink.execution.namespace=${acceptance.policy.namespace}`]);
      const volumes = await new DockerClient(acceptance.policy).run(["volume", "ls", "-q", "--filter", `label=org.unionlink.execution.namespace=${acceptance.policy.namespace}`]);
      if (remaining.code || volumes.code || remaining.stdout.trim() || volumes.stdout.trim()) throw new Error(`Resources leaked after ${mode}`);
      console.log(JSON.stringify({ mode, passed: true }));
    }
  } finally {
    if (!resolve(folder).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unsafe acceptance temporary directory");
    await rm(folder, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Execution administration failed"); process.exitCode = 1; });
