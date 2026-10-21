import "server-only";
import type { Db } from "./auth";
import { AppError } from "./errors";
import type { ClientDraft, ClientRelease, ClientUpload, PackageBuild } from "@/generated/prisma/client";

export type Snapshot = { server: unknown; releases: ClientRelease[]; drafts: ClientDraft[]; uploads: ClientUpload[]; builds: PackageBuild[] };
/** Read-only adapter for the existing verified download resolver; never exposes base tables. */
export function distributionDatabase(facts: Snapshot | null | undefined): Db {
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
