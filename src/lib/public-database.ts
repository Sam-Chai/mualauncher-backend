import "server-only";
import type { Db } from "./auth";
import { publicPrisma, validateDatabase } from "./prisma";
import { securityFunction } from "./database-security";
import { AppError } from "./errors";
import { uuid } from "./input";
import type { ClientDraft, ClientRelease, ClientUpload, PackageBuild } from "@/generated/prisma/client";

type Snapshot = { server: unknown; releases: ClientRelease[]; drafts: ClientDraft[]; uploads: ClientUpload[]; builds: PackageBuild[] };
export async function publicDirectory() {
  await validateDatabase("public");
  const rows = await publicPrisma.$queryRaw<{ servers: unknown[] }[]>`SELECT ${securityFunction("public_servers")}() AS servers`;
  return rows[0]?.servers ?? [];
}
/** Read-only adapter for the existing verified download resolver; never exposes base tables. */
export async function publicDatabase(serverId: string, releaseId: string | null = null): Promise<Db> {
  if (releaseId !== null) uuid(releaseId);
  await validateDatabase("public");
  const rows = await publicPrisma.$queryRaw<{ facts: Snapshot | null }[]>`SELECT ${securityFunction("public_snapshot")}(${serverId},${releaseId}::uuid) AS facts`;
  const facts = rows[0]?.facts;
  type Where = { where: { id?: string; draftId?: string; draftId_platform_revision?: { draftId: string; platform: string; revision: number } } };
  function delegate<T extends { id?: string; draftId?: string | null }>(values: T[]) {
    const findUnique = async ({ where }: Where) => values.find(value => where.id !== undefined ? value.id === where.id : value.draftId === where.draftId) ?? null;
    return { findUnique, findUniqueOrThrow: async (input: Where) => { const value = await findUnique(input); if (!value) throw new AppError(404, "发布关联记录不可用"); return value; } };
  }
  return {
    server: { findFirst: async () => facts?.server ?? null },
    clientRelease: delegate(facts?.releases ?? []), clientDraft: delegate(facts?.drafts ?? []), clientUpload: delegate(facts?.uploads ?? []),
    packageBuild: { findUnique: async ({ where }: Where) => { const key = where.draftId_platform_revision; return facts?.builds.find(build => key && build.draftId === key.draftId && build.platform === key.platform && build.revision === key.revision) ?? null; } },
  } as unknown as Db;
}
