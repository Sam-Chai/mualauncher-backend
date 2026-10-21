import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { Actor, Db } from "./auth";
export function securitySchema() { const schema = process.env.DATABASE_SCHEMA ?? "public"; return schema === "public" ? "authz" : `${schema}_authz`; }
export function securityFunction(name: string) {
  if (!/^[a-z_]+$/.test(name)) throw new Error("Invalid security function");
  return Prisma.raw(`"${securitySchema().replaceAll('"', '""')}"."${name}"`);
}
export async function setDatabaseActor(db: Db, actor: Actor) {
  await db.$queryRaw`SELECT set_config('mua.account_id',${actor.id},true), set_config('mua.auth_kind',${actor.sessionKind === "LAUNCHER" ? "launcher" : actor.apiScope ? "api" : "session"},true), set_config('mua.api_token_id',${actor.apiScope?.tokenId ?? ""},true)`;
}
export async function credentialCreate(db: Db, accountId: string, username: string, passwordHash: string) { await db.$executeRaw`SELECT ${securityFunction("create_credential")}(${accountId}::uuid,${username},${passwordHash})`; }
export async function credentialUpdate(db: Db, accountId: string, passwordHash: string, previous: string | null = null) { await db.$executeRaw`SELECT ${securityFunction("set_password")}(${accountId}::uuid,${passwordHash},${previous})`; }
export async function revokeAccountSessions(db: Db, accountId: string) { await db.$executeRaw`SELECT ${securityFunction("revoke_sessions")}(${accountId}::uuid)`; }
export async function accountDirectory(db: Db) { return db.$queryRaw<{ id: string; displayName: string; status: "ACTIVE" | "DISABLED"; isSuperAdmin: boolean; username: string | null; unionSubject: string | null; createdAt: Date }[]>`SELECT * FROM ${securityFunction("account_identity_directory")}()`; }
export async function serverSummaries(db: Db, ids: string[]) {
  if (!ids.length) return new Map<string, boolean>();
  const rows = await db.$queryRaw<{ id: string; summary: { currentReleaseActive: boolean } | null }[]>`SELECT id,${securityFunction("server_summary")}(id) AS summary FROM unnest(${ids}::text[]) id`;
  return new Map(rows.map(row => [row.id, row.summary?.currentReleaseActive ?? false]));
}
export async function clientSummary(db: Db, id: string) {
  const rows = await db.$queryRaw<{ summary: { initialPackageFormatVersion: 1 | 2 | null; processingPackages: number } | null }[]>`SELECT ${securityFunction("client_summary")}(${id}) AS summary`;
  return rows[0]?.summary ?? { initialPackageFormatVersion: null, processingPackages: 0 };
}
export async function uploadOptions(db: Db) {
  const rows = await db.$queryRaw<{ value: { enabledPackageFormats: number[]; maxUploadSizeMb: number; javaImageType: string } | null }[]>`SELECT ${securityFunction("upload_options")}() AS value`;
  return rows[0]?.value;
}
export type ReleaseDetails = { packageRevision: number; upload: { statistics: Prisma.JsonValue; comparisonStatistics: Prisma.JsonValue } | null; packageBuilds: { draftId: string; platform: string; revision: number; status: string; required: boolean; artifacts: Prisma.JsonValue }[] };
export async function releaseDetails(db: Db, id: string) {
  const rows = await db.$queryRaw<{ value: ReleaseDetails | null }[]>`SELECT ${securityFunction("release_details")}(${id}::uuid) AS value`;
  return rows[0]?.value ?? null;
}
