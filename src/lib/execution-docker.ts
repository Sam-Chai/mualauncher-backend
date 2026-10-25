import "server-only";
import { randomUUID, createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join, posix } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { DockerClient, type DockerOptions, type DockerTransport } from "./execution-docker-client";
import { executionPlanSchema, executionPlanDigest, type ExecutionBackend, type ExecutionResult, type ExecutionObserver } from "./execution-contract";
import type { ExecutionContainer } from "./execution-management-contract";
import { executionPolicy, ExecutionError, type ExecutionPolicy } from "./execution-policy";
import { writeExecutionArchive, readExecutionArchive } from "./execution-archive";

const LABEL = "org.unionlink.execution";
const UID = "65532:65532";
type Container = { Config: { User: string; Labels: Record<string, string> }; HostConfig: { Runtime: string; ReadonlyRootfs: boolean; NetworkMode: string; Privileged: boolean;
  Memory: number; MemorySwap: number; NanoCpus: number; PidsLimit: number; CapAdd: string[]; CapDrop: string[]; SecurityOpt: string[]; Tmpfs: Record<string, string> }; Mounts: { Type: string; Destination: string; RW: boolean }[] };
function decode<T>(value: string): T { try { return JSON.parse(value) as T; } catch { throw new ExecutionError("unavailable", true, "docker-response"); } }

export class DockerExecutionBackend {
  constructor(readonly policy: ExecutionPolicy, private readonly docker: DockerTransport = new DockerClient(policy), private readonly observer?: ExecutionObserver) {}
  private async must(args: string[], options: DockerOptions = {}) {
    const result = await this.docker.run(args, options);
    if (result.code !== 0) throw new ExecutionError("unavailable", true, args[0]);
    return result.stdout;
  }
  private labels(id: string, expires: number) {
    return ["--label", `${LABEL}.namespace=${this.policy.namespace}`, "--label", `${LABEL}.id=${id}`, "--label", `${LABEL}.expires=${expires}`];
  }
  private containerOptions(name: string, id: string, expires: number, input: string, seed = false) {
    const p = this.policy;
    return ["create", "--name", name, ...this.labels(id, expires), "--runtime=runsc", "--pull=never", "--init", "--restart=no", "--log-driver=none",
      "--network=none", "--read-only", "--user=0:0", "--cap-drop=ALL", "--cap-add=KILL", "--security-opt=no-new-privileges=true",
      `--memory=${p.memoryMiB}m`, `--memory-swap=${p.memoryMiB}m`, `--cpus=${p.cpus}`, `--pids-limit=${p.pids}`, "--ulimit=nofile=1024:1024", "--stop-timeout=2",
      "--tmpfs", `/tmp:rw,nosuid,nodev,noexec,size=${p.tmpMiB}m,mode=1777`,
      ...(!seed ? ["--tmpfs", `/workspace:rw,nosuid,nodev,size=${p.workspaceMiB}m,uid=65532,gid=65532,mode=0700`] : []),
      "--mount", `type=volume,source=${input},target=/input${seed ? "" : ",readonly"}`,
      "--env=HOME=/tmp", "--env=JAVA_TOOL_OPTIONS=", "--env=JDK_JAVA_OPTIONS=", "--env=_JAVA_OPTIONS=", "--env=CLASSPATH=",
      "--entrypoint=/usr/local/bin/node", p.image, "/opt/unionlink/keeper.mjs", String(Math.max(1, Math.ceil((expires - Date.now()) / 1000)))];
  }
  async check(signal?: AbortSignal) {
    const info = decode<{ ID?: string; OSType: string; Architecture: string; Runtimes: Record<string, unknown>; MemoryLimit: boolean; SwapLimit: boolean; PidsLimit: boolean; CpuCfsQuota: boolean }>(
      await this.must(["info", "--format", "{{json .}}"], { signal, maxBytes: 1024 ** 2 }));
    if (info.OSType !== "linux" || !info.Runtimes?.runsc || !info.MemoryLimit || !info.SwapLimit || !info.PidsLimit || !info.CpuCfsQuota) throw new ExecutionError("configuration", false, "docker-runtime-or-cgroups");
    const architecture = ({ x86_64: "amd64", aarch64: "arm64", amd64: "amd64", arm64: "arm64" } as Record<string, string>)[info.Architecture];
    const image = decode<{ Architecture: string; Os: string; Config: { Labels: Record<string, string>; Env: string[] } }>(await this.must(["image", "inspect", "--format", "{{json .}}", this.policy.image], { signal }));
    if (!architecture || architecture !== image.Architecture || image.Os !== "linux" || image.Config.Labels?.["org.unionlink.execution.protocol"] !== "1" ||
      image.Config.Env.some(value => /^(?:DATABASE_|OSS_|S3_|SIGNING_|AWS_|SSH_AUTH|.*(?:TOKEN|PASSWORD|SECRET)=)/i.test(value)))
      throw new ExecutionError("configuration", false, "executor-image");
    if (this.policy.heapMiB + this.policy.workspaceMiB + this.policy.tmpMiB + 512 > this.policy.memoryMiB) throw new ExecutionError("configuration", false, "memory-budget");
    return { architecture, image: this.policy.image, runtime: "runsc" as const, daemonId: info.ID ? createHash("sha256").update(info.ID).digest("hex") : null };
  }
  async containerSnapshot(signal: AbortSignal) {
    const ids = (await this.must(["ps", "-a", "--filter", `label=${LABEL}.namespace=${this.policy.namespace}`, "--format", "{{.ID}}"], { signal })).trim().split(/\s+/).filter(Boolean);
    const snapshot = new Map<string, ExecutionContainer["state"]>();
    for (const id of ids) {
      if (!/^[a-f0-9]{12,64}$/.test(id)) throw new ExecutionError("integrity", false, "container-id");
      const result = await this.docker.run(["inspect", "--format", "{{json .}}", id], { signal });
      if (result.code) throw new ExecutionError("unavailable", true, "container-snapshot");
      const info = decode<{ Id: string; Config: { Labels: Record<string, string> }; State: { Running: boolean; Status: string } }>(result.stdout);
      if (info.Config.Labels[`${LABEL}.namespace`] === this.policy.namespace) snapshot.set(info.Id, info.State.Running ? "RUNNING" : info.State.Status === "created" ? "CREATED" : "EXITED");
    }
    return snapshot;
  }
  private async attest(name: string, signal: AbortSignal, seed = false) {
    const value = decode<Container>(await this.must(["inspect", "--format", "{{json .}}", name], { signal })), h = value.HostConfig, p = this.policy;
    if (h.Runtime !== "runsc" || !h.ReadonlyRootfs || h.Privileged || h.NetworkMode !== "none" || value.Config.User !== "0:0" ||
      h.Memory !== p.memoryMiB * 1024 ** 2 || h.MemorySwap !== h.Memory || h.NanoCpus !== p.cpus * 1e9 || h.PidsLimit !== p.pids ||
      !h.CapDrop.includes("ALL") || h.CapAdd.length !== 1 || h.CapAdd[0].replace(/^CAP_/, "") !== "KILL" || !h.SecurityOpt.some(option => /^no-new-privileges(?:=true)?$/.test(option)) ||
      value.Mounts.some(mount => mount.Type === "bind" || !["/input", "/tmp", "/workspace"].includes(mount.Destination)) || !value.Mounts.some(mount => mount.Destination === "/input" && mount.Type === "volume" && mount.RW === seed) ||
      h.Tmpfs?.["/tmp"] !== `rw,nosuid,nodev,noexec,size=${p.tmpMiB}m,mode=1777` ||
      !seed && h.Tmpfs?.["/workspace"] !== `rw,nosuid,nodev,size=${p.workspaceMiB}m,uid=65532,gid=65532,mode=0700`)
      throw new ExecutionError("configuration", false, "container-policy");
    const fingerprint = await this.must(["exec", "--user=0:0", name, "/bin/dmesg"], { signal });
    if (!fingerprint.includes("Starting gVisor")) throw new ExecutionError("configuration", false, "gvisor-fingerprint");
    const status = await this.must(["exec", `--user=${UID}`, name, "/bin/cat", "/proc/self/status"], { signal });
    if (!/^Uid:\s+65532\s+65532\s+65532\s+65532\s*$/m.test(status) || !/^CapEff:\s+0+\s*$/m.test(status) || !/^CapPrm:\s+0+\s*$/m.test(status) || !/^NoNewPrivs:\s+1\s*$/m.test(status))
      throw new ExecutionError("configuration", false, "installer-identity");
  }
  async probe(signal: AbortSignal = AbortSignal.timeout(120000)) {
    const runtime = await this.check(signal), id = randomUUID(), expires = Date.now() + 120000;
    const volume = `ul-${this.policy.namespace}-input-${id}`, name = `ul-${this.policy.namespace}-probe-${id}`;
    // Track before creation: an interrupted Docker response may still have created the resource.
    try {
      await this.must(["volume", "create", ...this.labels(id, expires), volume], { signal });
      await this.must(this.containerOptions(name, id, expires, volume, true), { signal });
      await this.must(["start", name], { signal }); await this.attest(name, signal, true);
      await this.must(["exec", `--user=${UID}`, name, "/opt/java/openjdk/bin/java", "-version"], { signal });
      return runtime;
    } finally { await this.cleanup([name], volume); }
  }
  async reap(now = Date.now(), signal: AbortSignal = AbortSignal.timeout(120000)) {
    const selector = `label=${LABEL}.namespace=${this.policy.namespace}`;
    const containers = (await this.must(["ps", "-a", "--filter", selector, "--format", "{{.ID}}"], { signal })).trim().split(/\s+/).filter(Boolean);
    let removed = 0;
    for (const id of containers) {
      signal.throwIfAborted();
      if (!/^[a-f0-9]{12,64}$/.test(id)) throw new ExecutionError("integrity", false, "container-id");
      const reply = await this.docker.run(["inspect", "--format", "{{json .Config.Labels}}", id], { signal }); if (reply.code) continue;
      const labels = decode<Record<string, string>>(reply.stdout);
      if (this.ownedExpired(labels, now)) { await this.must(["rm", "--force", id], { signal }); removed++; }
    }
    const volumes = (await this.must(["volume", "ls", "--filter", selector, "--format", "{{.Name}}"], { signal })).trim().split(/\s+/).filter(Boolean);
    for (const name of volumes) {
      signal.throwIfAborted();
      if (!/^ul-[a-z0-9-]+-input-[a-f0-9-]{36}$/.test(name)) continue;
      const reply = await this.docker.run(["volume", "inspect", "--format", "{{json .Labels}}", name], { signal }); if (reply.code) continue;
      if (this.ownedExpired(decode(reply.stdout), now)) { const result = await this.docker.run(["volume", "rm", name], { signal }); if (!result.code) removed++; }
    }
    return removed;
  }
  private ownedExpired(labels: Record<string, string>, now: number) {
    return labels?.[`${LABEL}.namespace`] === this.policy.namespace && /^[a-f0-9-]{36}$/.test(labels[`${LABEL}.id`] ?? "") &&
      /^\d{13}$/.test(labels[`${LABEL}.expires`] ?? "") && Number(labels[`${LABEL}.expires`]) <= now;
  }
  private async cleanup(containers: string[], volume: string) {
    const signal = AbortSignal.timeout(60000);
    for (let attempt = 0; attempt < 3; attempt++) {
      let failed = false;
      for (const name of containers) {
        const result = await this.docker.run(["rm", "--force", name], { signal }).catch(() => null);
        if (!result || result.code && !/No such container/i.test(result.stderr)) failed = true;
      }
      const result = await this.docker.run(["volume", "rm", volume], { signal }).catch(() => null);
      if ((!result || result.code && !/No such volume/i.test(result.stderr))) failed = true;
      if (!failed) return;
      if (signal.aborted) break;
      if (attempt < 2) await delay(1000);
    }
    throw new ExecutionError("cleanup", true, "docker-resources");
  }
  readonly execute: ExecutionBackend = async (raw, bindings, destination, externalSignal, progress) => {
    externalSignal.throwIfAborted(); const plan = executionPlanSchema.parse(raw), p = this.policy;
    const id = randomUUID(), expires = Date.now() + p.deadlineSeconds * 1000;
    const signal = AbortSignal.any([externalSignal, AbortSignal.timeout(p.deadlineSeconds * 1000)]);
    const volume = `ul-${p.namespace}-input-${id}`, seed = `ul-${p.namespace}-seed-${id}`, containers: string[] = [];
    const tracked: ExecutionContainer[] = [];
    await this.observer?.({ executionId: id, state: "PREPARING", containers: tracked });
    await mkdir(destination, { mode: 0o700 });
    const archive = join(destination, "inputs.tar");
    let resources = false;
    try {
      await writeExecutionArchive(plan, bindings, archive, p, signal);
      const runtime = await this.check(signal); await this.reap(Date.now(), signal);
      await this.observer?.({ executionId: id, daemonId: runtime.daemonId, architecture: runtime.architecture, state: "PREPARING", containers: tracked });
      resources = true;
      await this.must(["volume", "create", ...this.labels(id, expires), volume], { signal });
      let container: string | undefined, containerName = "";
      while (!container) {
        signal.throwIfAborted();
        for (let slot = 0; slot < p.slots; slot++) {
          const name = `ul-${p.namespace}-slot-${slot}`;
          const result = await this.docker.run(this.containerOptions(name, id, expires, volume), { signal });
          if (!result.code) {
            // Fixed names arbitrate slots; immutable IDs fence cleanup against slot reuse.
            const created = result.stdout.trim();
            if (!/^[a-f0-9]{64}$/.test(created)) throw new ExecutionError("unavailable", true, "create-response");
            container = created; containerName = name; containers.push(created); break;
          }
          const prior = await this.docker.run(["inspect", "--format", "{{json .Config.Labels}}", name], { signal });
          if (prior.code) throw new ExecutionError("unavailable", true, "create");
          const labels = decode<Record<string, string>>(prior.stdout);
          if (labels[`${LABEL}.namespace`] !== p.namespace) throw new ExecutionError("configuration", false, "slot-owner");
          if (labels[`${LABEL}.id`] === id) throw new ExecutionError("unavailable", true, "create-response");
        }
        if (!container) { await delay(1500, undefined, { signal }); await this.reap(Date.now(), signal); }
      }
      tracked.push({ id: container, name: containerName, role: "executor", state: "CREATED", createdAt: new Date().toISOString() });
      await this.observer?.({ executionId: id, state: "PREPARING", containers: tracked });
      // Acquire a slot before populating the input volume so waiting jobs cannot fill VM disk.
      containers.push(seed);
      const seedId = (await this.must(this.containerOptions(seed, id, expires, volume, true), { signal })).trim();
      tracked.push({ id: seedId, name: seed, role: "input", state: "CREATED", createdAt: new Date().toISOString() });
      await this.observer?.({ executionId: id, state: "PREPARING", containers: tracked });
      await this.must(["start", seed], { signal }); tracked[1].state = "RUNNING";
      await this.observer?.({ executionId: id, state: "PREPARING", containers: tracked }); await this.attest(seed, signal, true);
      await this.must(["cp", "-", `${seed}:/input`], { signal, timeoutMs: 300000, input: createReadStream(archive) });
      await this.must(["rm", "--force", seed], { signal }); containers.pop();
      tracked[1].state = "REMOVED";
      await this.must(["start", container], { signal }); await this.attest(container, signal);
      tracked[0].state = "RUNNING"; await this.observer?.({ executionId: id, state: "RUNNING", containers: tracked });
      await this.must(["exec", `--user=${UID}`, container, "/bin/cp", "-R", "--no-preserve=mode,ownership", "/input/.", "/workspace"], { signal, timeoutMs: 300000 });
      const parents = [...new Set(plan.outputs.map(file => `/workspace/${posix.dirname(file.path)}`))];
      for (let offset = 0; offset < parents.length; offset += 64) await this.must(["exec", `--user=${UID}`, container, "/bin/mkdir", "-p", "--", ...parents.slice(offset, offset + 64)], { signal });
      for (const step of plan.steps) {
        await progress?.(step.id); signal.throwIfAborted(); const started = Date.now();
        const result = await this.docker.run(["exec", `--user=${UID}`, "--workdir=/workspace", container, "/usr/bin/timeout", "--signal=KILL", String(p.stepSeconds),
          "/opt/java/openjdk/bin/java", `-Xmx${p.heapMiB}m`, `-XX:ActiveProcessorCount=${p.cpus}`, "-Djava.io.tmpdir=/tmp", "-Djava.awt.headless=true", "-cp", step.classpath.map(path => `/workspace/${path}`).join(":"), step.mainClass, ...step.args],
        { signal, timeoutMs: (p.stepSeconds + 10) * 1000, execution: true });
        if (result.code !== 0) throw new ExecutionError(result.code === 124 || result.code === 137 && Date.now() - started >= p.stepSeconds * 1000 - 500 ? "timeout" : "failed", false, step.id);
      }
      await progress?.("collecting");
      const sealed = await this.must(["exec", "--user=0:0", container, "/usr/local/bin/node", "/opt/unionlink/seal.mjs"], { signal });
      if (sealed.trim() !== "SEALED") throw new ExecutionError("integrity", false, "seal");
      let artifacts: ExecutionResult["artifacts"] | undefined;
      await this.must(["exec", `--user=${UID}`, container, "/bin/tar", "--format=posix", "-C", "/workspace", "-cf", "-", "."], {
        signal, timeoutMs: 300000, consume: async stream => { artifacts = await readExecutionArchive(stream, plan, join(destination, "artifacts"), p, signal); },
      });
      if (!artifacts) throw new ExecutionError("integrity", false, "artifact-manifest");
      return { protocolVersion: 1, executionId: id, planSha256: executionPlanDigest(plan), image: runtime.image, architecture: runtime.architecture, artifacts };
    } catch (error) {
      if (error instanceof ExecutionError && error.reason === "cleanup") throw error;
      if (externalSignal.aborted) throw externalSignal.reason;
      if (signal.aborted) throw new ExecutionError("timeout", false, "execution-deadline");
      throw error;
    } finally {
      if (resources) {
        try { await this.cleanup(containers, volume); for (const entry of tracked) entry.state = "REMOVED"; }
        catch (error) { for (const entry of tracked) if (entry.state !== "REMOVED") entry.state = "UNKNOWN"; throw error; }
        finally { await this.observer?.({ executionId: id, state: "RUNNING", containers: tracked }); }
      }
    }
  };
}

export const executeIsolated: ExecutionBackend = async (...args) => { args[3].throwIfAborted(); return new DockerExecutionBackend(executionPolicy()).execute(...args); };
