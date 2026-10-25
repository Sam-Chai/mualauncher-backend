import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile, link } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import tar, { type Headers } from "tar-stream";
import { executionPlanSchema, executionPlanDigest, type ExecutionPlan, type ExecutionObserver } from "../src/lib/execution-contract";
import { executionPolicy, executionProfileIdentity, ExecutionError } from "../src/lib/execution-policy";
import { executionInputs, writeExecutionArchive, readExecutionArchive } from "../src/lib/execution-archive";
import { DockerExecutionBackend, executeIsolated } from "../src/lib/execution-docker";
import { DockerClient, type DockerOptions, type DockerReply, type DockerTransport } from "../src/lib/execution-docker-client";

const image = `sha256:${"a".repeat(64)}`, policy = executionPolicy({ NODE_ENV: "test", SANDBOX_JAVA_IMAGE: image });
const digest = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const input = Buffer.from("verified processor"), output = Buffer.from("generated artifact");
const plan = (): ExecutionPlan => ({ protocolVersion: 1, adapter: "test-adapter", revision: 1,
  inputs: [{ path: "processor.jar", size: input.length, sha256: digest(input) }],
  steps: [{ id: "generate", kind: "java", mainClass: "example.Main", classpath: ["processor.jar"], args: ["/workspace/result.jar"] }],
  outputs: [{ path: "result.jar", expected: { algorithm: "sha256", hash: digest(output) } }] });
async function folder(work: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "unionlink-execution-test-"));
  try { await work(root); } finally { await rm(root, { recursive: true, force: true }); }
}
async function archive(entries: { name: string; data?: Buffer; type?: Headers["type"]; linkname?: string }[]) {
  const pack = tar.pack(), buffers: Buffer[] = [];
  const completion = (async () => { for await (const chunk of pack) buffers.push(Buffer.from(chunk)); })();
  for (const entry of entries) await new Promise<void>((yes, no) => pack.entry({ name: entry.name, type: entry.type ?? "file", linkname: entry.linkname }, entry.data ?? Buffer.alloc(0), error => error ? no(error) : yes()));
  pack.finalize(); await completion; return Buffer.concat(buffers);
}
const regular = () => [{ name: "./processor.jar", data: input }, { name: "./result.jar", data: output }];

test("Execution protocol rejects traversal, shell payloads, unknown commands, ambiguous paths and non-input classpaths", () => {
  assert.equal(executionPlanDigest(plan()), executionPlanDigest(structuredClone(plan())));
  const invalid = [
    { ...plan(), command: "sh" }, { ...plan(), protocolVersion: 2 },
    { ...plan(), inputs: [...plan().inputs, { ...plan().inputs[0], path: "PROCESSOR.jar" }] },
    { ...plan(), outputs: [{ path: "../escape" }] }, { ...plan(), outputs: [{ path: "x" }, { path: "x/y" }] },
    { ...plan(), outputs: [{ path: "PROCESSOR.jar" }] }, { ...plan(), outputs: [{ path: "processor.jar/nested" }] },
    { ...plan(), steps: [{ ...plan().steps[0], classpath: ["/host/processor.jar"] }] },
    { ...plan(), steps: [{ ...plan().steps[0], mainClass: "-javaagent:malicious" }] },
    { ...plan(), steps: [{ ...plan().steps[0], args: ["line\nbreak"] }] },
  ];
  for (const value of invalid) assert.equal(executionPlanSchema.safeParse(value).success, false);
});
test("Deployment policy requires an immutable image; cache identity includes image and limits but excludes context location", () => {
  assert.throws(() => executionPolicy({ NODE_ENV: "test", SANDBOX_JAVA_IMAGE: "executor:latest" }), ExecutionError);
  const env = { NODE_ENV: "test" as const, SANDBOX_JAVA_IMAGE: image };
  assert.equal(executionProfileIdentity(env), executionProfileIdentity({ ...env, SANDBOX_DOCKER_CONTEXT: "colima-union-link" }));
  assert.notEqual(executionProfileIdentity(env), executionProfileIdentity({ ...env, SANDBOX_HEAP_MIB: "4096" }));
  assert.equal(executionProfileIdentity({ NODE_ENV: "test" }), "unconfigured");
});
test("A missing Docker executable returns a retryable service error without crashing the worker", async () => folder(async root => {
  await assert.rejects(new DockerClient({ ...policy, docker: join(root, "missing-docker-executable") }).run(["info"]),
    error => error instanceof ExecutionError && error.reason === "unavailable" && error.retryable);
}));
test("Input bundle binds actual ordinary files and detects changed bytes or hard links before execution", async () => folder(async root => {
  const source = join(root, "input"); await mkdir(source); const local = join(source, "processor.jar"); await writeFile(local, input);
  const inputs = await executionInputs(source, AbortSignal.timeout(5000));
  assert.deepEqual(inputs.inputs, plan().inputs);
  await writeExecutionArchive(plan(), inputs.bindings, join(root, "valid.tar"), policy, AbortSignal.timeout(5000));
  await writeFile(local, Buffer.alloc(input.length));
  await assert.rejects(writeExecutionArchive(plan(), inputs.bindings, join(root, "invalid.tar"), policy, AbortSignal.timeout(5000)), ExecutionError);
  await link(local, join(source, "alias.jar"));
  await assert.rejects(executionInputs(source, AbortSignal.timeout(5000)), ExecutionError);
}));
test("Input transport preserves required empty directory trees without granting writable volume access", async () => folder(async root => {
  const source = join(root, "input"); await mkdir(join(source, "cache", "empty"), { recursive: true }); await writeFile(join(source, "processor.jar"), input);
  const files = await executionInputs(source, AbortSignal.timeout(5000));
  assert.deepEqual(files.directories, ["cache", "cache/empty"]);
  const bundle = join(root, "input.tar");
  await writeExecutionArchive({ ...plan(), directories: files.directories }, files.bindings, bundle, policy, AbortSignal.timeout(5000));
  const extract = tar.extract(), found: string[] = [];
  extract.on("entry", (header, stream, next) => {
    if (header.type === "directory") { assert.equal(header.mode! & 0o222, 0); found.push(header.name); }
    stream.resume(); next();
  });
  await pipeline(Readable.from(await readFile(bundle)), extract);
  assert.deepEqual(found, ["cache/", "cache/empty/"]);
  assert.equal(executionPlanSchema.safeParse({ ...plan(), directories: ["processor.jar/nested"] }).success, false);
}));
test("Output collector returns only declared artifacts with recomputed hashes", async () => folder(async root => {
  const artifacts = await readExecutionArchive(Readable.from(await archive([...regular(), { name: "unrequested.log", data: Buffer.from("log") }])), plan(), root, policy, AbortSignal.timeout(5000));
  assert.equal(artifacts.length, 1); assert.equal(artifacts[0].path, "result.jar");
  assert.equal(artifacts[0].sha256, digest(output)); assert.deepEqual(await readFile(artifacts[0].local), output);
}));
test("Output collector rejects links, special files, traversal, aliases, collisions, changed or missing inputs and wrong output hashes", async () => {
  const bad = [
    [...regular(), { name: "../escape", data: output }],
    [...regular(), { name: "PROCESSOR.jar", data: input }],
    [{ name: "processor.jar", data: Buffer.from("modified") }, regular()[1]],
    [regular()[1]], [regular()[0]], [regular()[0], { name: "result.jar", data: input }],
    [...regular(), { name: "link", type: "symlink" as const, linkname: "/etc/passwd" }],
    [...regular(), { name: "hard", type: "link" as const, linkname: "processor.jar" }],
    [...regular(), { name: "pipe", type: "fifo" as const }],
    [...regular(), { name: "parent/child", data: input }, { name: "parent", data: input }],
    [...regular(), { name: "parent", data: input }, { name: "parent/child", data: input }],
  ];
  for (const entries of bad) await folder(async root => {
    await assert.rejects(readExecutionArchive(Readable.from(await archive(entries)), plan(), root, policy, AbortSignal.timeout(5000)));
  });
});
test("Output collector enforces byte/file bounds and propagates cancellation without accepting partial output", async () => folder(async root => {
  const bytes = await archive(regular());
  await assert.rejects(readExecutionArchive(Readable.from(bytes), plan(), join(root, "bytes"), { ...policy, maxOutputBytes: 1 }, AbortSignal.timeout(5000)), ExecutionError);
  await assert.rejects(readExecutionArchive(Readable.from(await archive([...regular(), { name: "second.jar", data: output }])),
    { ...plan(), outputs: [...plan().outputs, { path: "second.jar" }] }, join(root, "total"), { ...policy, maxOutputBytes: output.length }, AbortSignal.timeout(5000)), ExecutionError);
  await assert.rejects(readExecutionArchive(Readable.from(await archive([...regular(), { name: "extra", data: input }])), plan(), join(root, "count"), { ...policy, maxFiles: 1 }, AbortSignal.timeout(5000)), ExecutionError);
  await assert.rejects(readExecutionArchive(Readable.from(bytes.subarray(0, 700)), plan(), join(root, "truncated"), policy, AbortSignal.timeout(5000)));
  await assert.rejects(readExecutionArchive(Readable.from(await archive([{ name: "processor.jar", data: output }])),
    { ...plan(), outputs: [{ path: "processor.jar", expected: { algorithm: "sha256", hash: digest(output) } }] }, join(root, "overwrite"), policy, AbortSignal.timeout(5000)), ExecutionError);
  await assert.rejects(executeIsolated(plan(), new Map(), root, AbortSignal.abort(new Error("cancelled"))), /cancelled/);
}));

class FakeDocker implements DockerTransport {
  calls: string[][] = []; containers = new Map<string, string[]>(); volumes = new Set<string>(); counter = 0;
  runtime = "runsc"; fingerprint = "Starting gVisor"; effective = "0000000000000000"; javaCode = 0;
  onJava?: () => void;
  constructor(readonly p = policy) {}
  async run(args: string[], options: DockerOptions = {}): Promise<DockerReply> {
    this.calls.push(args); options.signal?.throwIfAborted();
    const reply = (stdout = "", code = 0) => ({ stdout, code, stderr: code ? "failure" : "" });
    if (args[0] === "info") return reply(JSON.stringify({ OSType: "linux", Architecture: "x86_64", Runtimes: { [this.runtime]: {} }, MemoryLimit: true, SwapLimit: true, PidsLimit: true, CpuCfsQuota: true }));
    if (args[0] === "image") return reply(JSON.stringify({ Architecture: "amd64", Os: "linux", Config: { Labels: { "org.unionlink.execution.protocol": "1" }, Env: ["PATH=/usr/bin"] } }));
    if (args[0] === "ps" || args[0] === "volume" && args[1] === "ls") return reply();
    if (args[0] === "volume") { const name = args.at(-1)!; if (args[1] === "create") this.volumes.add(name); else if (args[1] === "rm") this.volumes.delete(name); return reply(name); }
    if (args[0] === "create") { const id = (++this.counter).toString(16).padStart(64, "0"); this.containers.set(id, args); return reply(id); }
    const find = (id: string) => this.containers.get(id) ?? [...this.containers.values()].find(value => value[value.indexOf("--name") + 1] === id);
    if (args[0] === "inspect") {
      const create = find(args.at(-1)!); assert.ok(create);
      const h = { Runtime: "runsc", ReadonlyRootfs: true, NetworkMode: "none", Privileged: false, Memory: this.p.memoryMiB * 1024 ** 2, MemorySwap: this.p.memoryMiB * 1024 ** 2,
        NanoCpus: this.p.cpus * 1e9, PidsLimit: this.p.pids, CapAdd: ["CAP_KILL"], CapDrop: ["ALL"], SecurityOpt: ["no-new-privileges"],
        Tmpfs: { "/tmp": `rw,nosuid,nodev,noexec,size=${this.p.tmpMiB}m,mode=1777`, "/workspace": `rw,nosuid,nodev,size=${this.p.workspaceMiB}m,uid=65532,gid=65532,mode=0700` } };
      return reply(JSON.stringify({ Config: { User: "0:0", Labels: {} }, HostConfig: h, Mounts: [{ Type: "volume", Destination: "/input", RW: !create[create.indexOf("--mount") + 1].includes(",readonly") }] }));
    }
    if (args[0] === "rm") { const name = args.at(-1)!; for (const [id, create] of this.containers) if (id === name || create[create.indexOf("--name") + 1] === name) this.containers.delete(id); return reply(); }
    if (args[0] === "cp") { if (options.input) for await (const chunk of options.input) assert.ok(chunk); return reply(); }
    if (args.includes("/bin/dmesg")) return reply(this.fingerprint);
    if (args.includes("/proc/self/status")) return reply(`Uid:\t65532\t65532\t65532\t65532\nCapEff:\t${this.effective}\nCapPrm:\t0000000000000000\nNoNewPrivs:\t1\n`);
    if (args.includes("/opt/java/openjdk/bin/java")) { this.onJava?.(); options.signal?.throwIfAborted(); return reply("", this.javaCode); }
    if (args.includes("/opt/unionlink/seal.mjs")) return reply("SEALED\n");
    if (args.includes("/bin/tar")) { await options.consume!(Readable.from(await archive(regular()))); return reply(); }
    return reply();
  }
}
async function execution(fake: FakeDocker, root: string, observer?: ExecutionObserver) {
  const local = join(root, "processor.jar"); await writeFile(local, input);
  return new DockerExecutionBackend(fake.p, fake, observer).execute(plan(), new Map([["processor.jar", local]]), join(root, "result"), AbortSignal.timeout(10000));
}

test("Execution telemetry follows actual immutable container IDs and confirms cleanup on success or failure", async () => {
  for (const failed of [false, true]) await folder(async root => {
    const docker = new FakeDocker(); docker.javaCode = failed ? 9 : 0;
    const events: Parameters<ExecutionObserver>[0][] = [];
    const result = execution(docker, root, async event => { events.push(structuredClone(event)); });
    if (failed) await assert.rejects(result, ExecutionError); else await result;
    assert.equal(new Set(events.map(event => event.executionId)).size, 1);
    assert.deepEqual(events[0].containers, []);
    assert.ok(events.some(event => event.architecture === "amd64"));
    assert.ok(events.some(event => event.containers.some(container => container.role === "executor" && container.state === "RUNNING")));
    assert.ok(events.some(event => event.containers.some(container => container.role === "input" && container.state === "RUNNING")));
    const final = events.at(-1)!.containers;
    assert.equal(final.length, 2);
    for (const container of final) { assert.match(container.id, /^[a-f0-9]{64}$/); assert.equal(container.state, "REMOVED"); }
  });
});

test("Container snapshots stay inside the owned namespace and reject incomplete inspection", async () => {
  const id = "a".repeat(64), other = "b".repeat(64);
  let incomplete = false;
  const transport: DockerTransport = { async run(args) {
    if (args[0] === "ps") {
      assert.ok(args.includes(`label=org.unionlink.execution.namespace=${policy.namespace}`));
      return { code: 0, stdout: `${id}\n${other}`, stderr: "" };
    }
    if (incomplete) return { code: 1, stdout: "", stderr: "unavailable" };
    return { code: 0, stderr: "", stdout: JSON.stringify({ Id: args.at(-1), Config: { Labels: { "org.unionlink.execution.namespace": args.at(-1) === id ? policy.namespace : "unrelated" } }, State: { Running: true, Status: "running" } }) };
  } };
  const backend = new DockerExecutionBackend(policy, transport);
  assert.deepEqual([...await backend.containerSnapshot(AbortSignal.timeout(5000))], [[id, "RUNNING"]]);
  incomplete = true;
  await assert.rejects(backend.containerSnapshot(AbortSignal.timeout(5000)), ExecutionError);
});
test("Docker backend uses offline gVisor, fixed slots, bounded tmpfs, nonroot Java, sealing and immutable-ID cleanup", async () => folder(async root => {
  const docker = new FakeDocker(); const result = await execution(docker, root);
  assert.equal(result.image, image); assert.equal(result.planSha256, executionPlanDigest(plan()));
  assert.equal(docker.containers.size, 0); assert.equal(docker.volumes.size, 0);
  const creates = docker.calls.filter(args => args[0] === "create"); assert.equal(creates.length, 2);
  assert.match(creates[0][creates[0].indexOf("--name") + 1], /-slot-0$/);
  for (const args of creates) for (const flag of ["--runtime=runsc", "--network=none", "--read-only", "--cap-drop=ALL", "--cap-add=KILL", "--security-opt=no-new-privileges=true", "--pull=never"]) assert.ok(args.includes(flag));
  assert.ok(creates.every(args => !args.some(value => value.includes("type=bind"))));
  const java = docker.calls.find(args => args.includes("/usr/bin/timeout"))!;
  assert.ok(java.includes("--user=65532:65532")); assert.ok(java.includes("--workdir=/workspace")); assert.ok(java.includes("-Xmx2048m"));
  const sealed = docker.calls.findIndex(args => args.includes("/opt/unionlink/seal.mjs")), collect = docker.calls.findIndex(args => args.includes("/bin/tar")); assert.ok(sealed >= 0 && collect > sealed);
  assert.ok(docker.calls.some(args => args[0] === "rm" && /^[a-f0-9]{64}$/.test(args.at(-1)!)));
}));
test("Missing runtime never falls back; counterfeit runsc and capability leakage fail before Java and clean resources", async () => {
  for (const sabotage of ["runtime", "fingerprint", "effective"] as const) await folder(async root => {
    const docker = new FakeDocker(); docker[sabotage] = sabotage === "runtime" ? "runc" : sabotage === "effective" ? "0000000000000020" : "Linux";
    await assert.rejects(execution(docker, root), error => error instanceof ExecutionError && error.reason === "configuration");
    assert.equal(docker.calls.some(args => args.includes("/usr/bin/timeout")), false); assert.equal(docker.containers.size, 0); assert.equal(docker.volumes.size, 0);
  });
});
test("Processor failure never collects artifacts and always destroys its execution resources", async () => folder(async root => {
  const docker = new FakeDocker(); docker.javaCode = 9;
  await assert.rejects(execution(docker, root), error => error instanceof ExecutionError && error.reason === "failed");
  assert.equal(docker.calls.some(args => args.includes("/bin/tar")), false); assert.equal(docker.containers.size, 0); assert.equal(docker.volumes.size, 0);
}));
test("Cancellation retains its reason, fences cleanup and never accepts output", async () => folder(async root => {
  const docker = new FakeDocker(), stop = new AbortController(), reason = new Error("lease revoked");
  docker.onJava = () => stop.abort(reason);
  const local = join(root, "processor.jar"); await writeFile(local, input);
  await assert.rejects(new DockerExecutionBackend(policy, docker).execute(plan(), new Map([["processor.jar", local]]), join(root, "result"), stop.signal), error => error === reason);
  assert.equal(docker.containers.size, 0); assert.equal(docker.volumes.size, 0); assert.equal(docker.calls.some(args => args.includes("/bin/tar")), false);
}));
test("Janitor only removes expired owned resources, using immutable IDs rather than slot names", async () => {
  const calls: string[][] = [], now = Date.now(), expired = "a".repeat(64), active = "b".repeat(64), foreign = "c".repeat(64);
  const labels = (namespace: string, expires: number) => ({ "org.unionlink.execution.namespace": namespace, "org.unionlink.execution.id": "12345678-1234-4234-8234-123456789abc", "org.unionlink.execution.expires": String(expires) });
  const docker: DockerTransport = { async run(args) {
    calls.push(args); let stdout = "";
    if (args[0] === "ps") stdout = [expired, active, foreign].join("\n");
    if (args[0] === "inspect") stdout = JSON.stringify(args.at(-1) === expired ? labels(policy.namespace, now - 1) : args.at(-1) === active ? labels(policy.namespace, now + 10000) : labels("other", now - 1));
    return { code: 0, stdout, stderr: "" };
  } };
  assert.equal(await new DockerExecutionBackend(policy, docker).reap(now), 1);
  assert.deepEqual(calls.filter(args => args[0] === "rm"), [["rm", "--force", expired]]);
});
