import { createHash } from "node:crypto";
import { z } from "zod";
import { safePackPath } from "./pack-path";

const path = z.string().min(1).max(1000).refine(value => { try { return safePackPath(value) === value; } catch { return false; } });
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const argument = z.string().max(4000).refine(value => !/[\x00-\x1f\x7f]/.test(value));
export const executionInputSchema = z.object({ path, sha256, size: z.number().int().nonnegative().max(2 * 1024 ** 3) }).strict();
export const executionOutputSchema = z.object({ path, expected: z.object({ algorithm: z.enum(["sha1", "sha256"]), hash: z.string() }).strict().refine(value => (value.algorithm === "sha1" ? /^[a-f0-9]{40}$/ : /^[a-f0-9]{64}$/).test(value.hash)).optional() }).strict();
export const executionPlanSchema = z.object({ protocolVersion: z.literal(1), adapter: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/), revision: z.number().int().positive(),
  directories: z.array(path).max(20000).default([]),
  inputs: z.array(executionInputSchema).min(1).max(20000), steps: z.array(z.object({ id: z.string().regex(/^[a-z0-9-]{1,64}$/),
    kind: z.literal("java"), classpath: z.array(path).min(1).max(100), mainClass: z.string().regex(/^[A-Za-z_$][A-Za-z0-9_$.]*$/), args: z.array(argument).max(128) }).strict()).min(1).max(32),
  outputs: z.array(executionOutputSchema).min(1).max(20000) }).strict().superRefine((value, ctx) => {
    for (const list of [value.inputs, value.outputs]) {
      const seen = new Set<string>();
      for (const file of list) { const key = file.path.toLowerCase(); if (seen.has(key)) ctx.addIssue({ code: "custom", message: "Duplicate execution path" }); seen.add(key); }
      for (const file of list) for (const prefix of file.path.toLowerCase().split("/").slice(0, -1).map((_, index, parts) => parts.slice(0, index + 1).join("/")))
        if (seen.has(prefix)) ctx.addIssue({ code: "custom", message: "Execution file/directory conflict" });
    }
    const inputs = new Set(value.inputs.map(file => file.path));
    const combined = new Map<string, string>();
    for (const file of [...value.inputs, ...value.outputs]) {
      const key = file.path.toLowerCase(), previous = combined.get(key);
      if (previous && previous !== file.path) ctx.addIssue({ code: "custom", message: "Ambiguous input/output alias" });
      combined.set(key, file.path);
    }
    for (const key of combined.keys()) {
      const parts = key.split("/");
      for (let i = 1; i < parts.length; i++) if (combined.has(parts.slice(0, i).join("/"))) ctx.addIssue({ code: "custom", message: "Input/output file/directory conflict" });
    }
    const directories = new Set<string>();
    for (const directory of value.directories) {
      const key = directory.toLowerCase(), parts = key.split("/");
      if (directories.has(key) || combined.has(key)) ctx.addIssue({ code: "custom", message: "Execution directory conflict" });
      directories.add(key);
      for (let i = 1; i < parts.length; i++) if (combined.has(parts.slice(0, i).join("/"))) ctx.addIssue({ code: "custom", message: "Execution directory parent is a file" });
    }
    if (new Set(value.steps.map(step => step.id)).size !== value.steps.length) ctx.addIssue({ code: "custom", message: "Duplicate execution step" });
    for (const step of value.steps) if (step.classpath.some(path => !inputs.has(path))) ctx.addIssue({ code: "custom", message: "Classpath must reference an immutable input" });
  });
export type ExecutionPlan = z.input<typeof executionPlanSchema>;
export type ExecutionInput = z.infer<typeof executionInputSchema>;
export type ExecutionOutput = z.infer<typeof executionOutputSchema>;
export type ExecutionArtifact = ExecutionInput & { local: string; sha1: string };
export type ExecutionResult = { protocolVersion: 1; executionId: string; planSha256: string; image: string; architecture: string; artifacts: ExecutionArtifact[] };
export type ExecutionBindings = ReadonlyMap<string, string>;
export type ExecutionObserver = (event: { executionId: string; daemonId?: string | null; architecture?: string; state: "PREPARING" | "RUNNING"; containers: import("./execution-management-contract").ExecutionContainer[] }) => Promise<void>;
export type ExecutionBackend = (plan: ExecutionPlan, bindings: ExecutionBindings, destination: string, signal: AbortSignal,
  progress?: (step: string) => Promise<void>) => Promise<ExecutionResult>;
export function executionPlanDigest(plan: ExecutionPlan) {
  return createHash("sha256").update(JSON.stringify(executionPlanSchema.parse(plan))).digest("hex");
}
