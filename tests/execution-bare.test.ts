import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { BareExecutionBackend } from "../src/lib/execution-bare";
import { executionInputs } from "../src/lib/execution-archive";
import { ExecutionError } from "../src/lib/execution-policy";
import { environmentCacheIdentity } from "../src/lib/environment-resolver";
import type { ExecutionPlan } from "../src/lib/execution-contract";
const javaHome = process.env.MUA_TEST_JAVA_HOME || process.env.JAVA_HOME;
test("Bare host adapter runs the unified plan, strips credentials and enforces output, log, timeout and cancellation checks", { skip: !javaHome }, async () => {
  const root = await mkdtemp(join(tmpdir(), "mua-bare-test-")), run = promisify(execFile), suffix = process.platform === "win32" ? ".exe" : "";
  const saved = { FORGE_PROCESSOR_JAVA: process.env.FORGE_PROCESSOR_JAVA, SANDBOX_STEP_SECONDS: process.env.SANDBOX_STEP_SECONDS, HOST_TEST_SECRET: process.env.HOST_TEST_SECRET };
  process.env.FORGE_PROCESSOR_JAVA = join(javaHome!, "bin", "java" + suffix); process.env.SANDBOX_STEP_SECONDS = "1"; process.env.HOST_TEST_SECRET = "do-not-forward";
  try {
    const input = join(root, "input"); await mkdir(input);
    await run(join(javaHome!, "bin", "javac" + suffix), ["--release", "21", "-d", root, resolve("tests/fixtures/execution/BareProbe.java")]);
    await run(join(javaHome!, "bin", "jar" + suffix), ["--create", "--file", join(input, "probe.jar"), "-C", root, "BareProbe.class"]);
    await writeFile(join(input, "input.txt"), "original"); const files = await executionInputs(input, AbortSignal.timeout(5000));
    for (const mode of ["normal", "mutate", "logs", "timeout", "cancel"]) {
      const control = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
      const plan: ExecutionPlan = { protocolVersion: 1, adapter: "bare-probe", revision: 1, inputs: files.inputs, directories: ["scratch/empty"],
        steps: [{ id: "probe", kind: "java", classpath: ["probe.jar"], mainClass: "BareProbe", args: ["/workspace/out/result.txt", mode === "cancel" ? "timeout" : mode] }], outputs: [{ path: "out/result.txt" }] };
      const job = new BareExecutionBackend().execute(plan, files.bindings, join(root, mode), control.signal, async step => { if (step === "probe" && mode === "cancel") timer = setTimeout(() => control.abort(new Error("cancelled")), 200); });
      try {
        if (mode === "normal") { const result = await job; assert.equal(await readFile(result.artifacts[0].local, "utf8"), "OK"); assert.match(result.image, /^bare:/); }
        else if (mode === "cancel") await assert.rejects(job, /cancelled/);
        else await assert.rejects(job, error => error instanceof ExecutionError && error.reason === (mode === "mutate" ? "integrity" : mode === "timeout" ? "timeout" : "failed"));
      } finally { if (timer) clearTimeout(timer); }
    }
  } finally {
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await rm(root, { recursive: true, force: true });
  }
});
test("Cache identities separate bare and Docker modes while preserving reuse across workers and task IDs", () => {
  const base = { minecraft: "1.20.1", javaMajor: 17, loader: { type: "forge" as const, version: "47.4.0" }, platform: "linux-amd64" as const };
  const context = { mode: "DOCKER_GVISOR" as const, profile: "abc", workerId: "one", buildId: "first" };
  assert.equal(environmentCacheIdentity({ ...base, execution: context }, "jre"), environmentCacheIdentity({ ...base, execution: { ...context, workerId: "two", buildId: "next" } }, "jre"));
  assert.notEqual(environmentCacheIdentity({ ...base, execution: context }, "jre"), environmentCacheIdentity({ ...base, execution: { ...context, mode: "BARE" } }, "jre"));
});
