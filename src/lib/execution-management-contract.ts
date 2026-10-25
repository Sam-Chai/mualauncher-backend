import { z } from "zod";
export const executionModeSchema = z.enum(["DOCKER_GVISOR", "BARE"]);
export type ExecutionMode = z.infer<typeof executionModeSchema>;
export const executionSettingsInput = z.object({ mode: executionModeSchema, revision: z.number().int().nonnegative() }).strict();
export const executionHostSchema = z.object({ sampledAt: z.string().datetime(), platform: z.string(), architecture: z.string(),
  docker: z.object({ installed: z.boolean(), connected: z.boolean(), version: z.string().nullable(), linux: z.boolean() }).strict(),
  gvisor: z.object({ registered: z.boolean(), verified: z.boolean(), imageConfigured: z.boolean(), ready: z.boolean(), reason: z.string().nullable() }).strict(),
  bare: z.object({ ready: z.boolean(), version: z.string().nullable() }).strict(),
}).strict();
export type ExecutionHost = z.infer<typeof executionHostSchema>;
export const executionSettingsSchema = z.object({ mode: executionModeSchema, revision: z.number().int().nonnegative(), dockerAvailable: z.boolean(), bareAvailable: z.boolean(),
  workers: z.array(z.object({ id: z.string(), lastSeen: z.string().datetime(), fresh: z.boolean(), status: executionHostSchema.nullable() }).strict()) }).strict();
export type ExecutionSettings = z.infer<typeof executionSettingsSchema>;
export const executionContainerSchema = z.object({ id: z.string(), name: z.string(), role: z.enum(["executor", "input"]),
  state: z.enum(["CREATED", "RUNNING", "EXITED", "REMOVED", "UNKNOWN"]), createdAt: z.string().datetime() }).strict();
export type ExecutionContainer = z.infer<typeof executionContainerSchema>;
export const executionLimitsSchema = z.object({ cpus: z.number().nullable(), memoryMiB: z.number().nullable(), heapMiB: z.number(),
  workspaceMiB: z.number().nullable(), tmpMiB: z.number().nullable(), pids: z.number().nullable(), deadlineSeconds: z.number(),
  network: z.enum(["none", "host"]), readOnlyRoot: z.boolean(), runtime: z.enum(["runsc", "host"]) }).strict();
export const executionRunSchema = z.object({ id: z.string().uuid(), workerId: z.string(), daemonId: z.string().nullable(), buildId: z.string().uuid().nullable(), mode: executionModeSchema,
  adapter: z.string(), state: z.enum(["PREPARING", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED", "INTERRUPTED", "CLEANUP_FAILED"]),
  planSha256: z.string(), image: z.string(), architecture: z.string(), limits: executionLimitsSchema, containers: z.array(executionContainerSchema),
  error: z.string().nullable(), startedAt: z.string().datetime(), updatedAt: z.string().datetime(), finishedAt: z.string().datetime().nullable() }).strict();
export const executionInstancesSchema = z.object({ runs: z.array(executionRunSchema), limit: z.literal(100) }).strict();
export type ExecutionRuns = z.infer<typeof executionInstancesSchema>;
