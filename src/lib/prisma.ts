import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Prisma } from "@/generated/prisma/client";
import * as modelEnums from "@/generated/prisma/enums";
import { rolePermissions } from "./roles";

export type DatabasePurpose = "web" | "auth" | "public" | "worker" | "migration";
const urls: Record<DatabasePurpose, string> = { web: "DATABASE_URL", auth: "DATABASE_AUTH_URL", public: "DATABASE_PUBLIC_URL", worker: "DATABASE_WORKER_URL", migration: "DATABASE_MIGRATION_URL" };
const roles = { web: "mua_web", auth: "mua_auth", public: "mua_public", worker: "mua_worker", migration: "mua_migrator" };
const globalDb = globalThis as unknown as { muaClients?: Map<DatabasePurpose, PrismaClient>; muaChecked?: WeakSet<PrismaClient>; muaClientSchemas?: Map<DatabasePurpose, string> };
const clients: Map<DatabasePurpose, PrismaClient> = globalDb.muaClients ??= new Map<DatabasePurpose, PrismaClient>();
const clientSchemas = globalDb.muaClientSchemas ??= new Map<DatabasePurpose, string>();
// Next dev preserves global pools across hot reloads, including after prisma generate.
// Invalidate pools when generated models, scalar fields or enum values change. Prisma 7's
// prisma-client generator exposes field enums rather than runtime DMMF.
const currentSchema = JSON.stringify([Object.entries(Prisma)
  .filter(([name]) => name === "ModelName" || name === "prismaVersion" || name.endsWith("ScalarFieldEnum"))
  .sort(([a], [b]) => a.localeCompare(b)), modelEnums]);
const checked = globalDb.muaChecked ??= new WeakSet();
const pending = new WeakMap<PrismaClient, Promise<void>>();
export function getPrisma(purpose: DatabasePurpose): PrismaClient {
  let client = clients.get(purpose);
  if (client && clientSchemas.get(purpose) !== currentSchema) {
    const stale = client;
    clients.delete(purpose);
    clientSchemas.delete(purpose);
    void stale.$disconnect().catch(() => console.error("Failed to close stale Prisma pool", { purpose }));
    client = undefined;
  }
  if (!client) {
    const connectionString = process.env[urls[purpose]];
    if (!connectionString) throw new Error(`${urls[purpose]} is required for ${purpose}; privileged fallback is disabled`);
    const schema = process.env.DATABASE_SCHEMA ?? "public";
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) throw new Error("Invalid DATABASE_SCHEMA");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString, options: `-c search_path=${schema},pg_catalog`, connectionTimeoutMillis: 5000, pipeline: true }, { schema }) });
    clients.set(purpose, client);
    clientSchemas.set(purpose, currentSchema);
  }
  return client;
}
function lazy(purpose: DatabasePurpose): PrismaClient {
  return new Proxy({} as PrismaClient, { get(_target, property) {
    if (property === "then") return undefined;
    const client = getPrisma(purpose); const value = Reflect.get(client, property);
    return typeof value === "function" ? value.bind(client) : value;
  } });
}
export const prisma = lazy("web");
export const authPrisma = lazy("auth");
export const publicPrisma = lazy("public");
export const workerPrisma = lazy("worker");
export async function validateDatabase(purpose: Exclude<DatabasePurpose, "migration">) {
  const client = getPrisma(purpose);
  if (checked.has(client)) return;
  if (pending.has(client)) return pending.get(client)!;
  const validation = (async () => {
    const rows = await client.$queryRaw<{ name: string; login: string; superuser: boolean; bypass: boolean; tables: number; unsafe: number; policies: number; privileged: boolean; ddl: boolean; owners: number }[]>`
      SELECT current_user AS name, session_user AS login, r.rolsuper AS superuser, r.rolbypassrls AS bypass,
      (r.rolcreaterole OR r.rolcreatedb OR EXISTS(SELECT 1 FROM pg_roles privileged_role WHERE privileged_role.rolname<>current_user
       AND (privileged_role.rolsuper OR privileged_role.rolbypassrls OR privileged_role.rolcreaterole OR privileged_role.rolcreatedb OR privileged_role.rolname LIKE 'mua_%')
       AND pg_has_role(current_user,privileged_role.oid,'MEMBER'))) AS privileged,
      has_schema_privilege(current_user,${process.env.DATABASE_SCHEMA ?? "public"},'CREATE') AS ddl,
      (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=${process.env.DATABASE_SCHEMA ?? "public"} AND c.relkind='r' AND c.relname<>'_prisma_migrations' AND pg_get_userbyid(c.relowner)<>'mua_owner') AS owners,
      (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=${process.env.DATABASE_SCHEMA ?? "public"} AND c.relkind='r' AND c.relname<>'_prisma_migrations') AS tables,
      (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=${process.env.DATABASE_SCHEMA ?? "public"} AND c.relkind='r' AND c.relname<>'_prisma_migrations' AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)) AS unsafe,
      (SELECT count(DISTINCT tablename)::int FROM pg_policies WHERE schemaname=${process.env.DATABASE_SCHEMA ?? "public"}) AS policies
      FROM pg_roles r WHERE r.rolname=current_user`;
    const row = rows[0];
    const expectedTables = Object.keys(Prisma.ModelName).length;
    if (!row || row.name !== roles[purpose] || row.login !== roles[purpose] || row.superuser || row.bypass || row.privileged || row.ddl || row.owners || row.tables !== expectedTables || row.unsafe || row.policies < expectedTables) throw new Error(`Unsafe ${purpose} database identity or missing RLS policies`);
    const dataSchema = process.env.DATABASE_SCHEMA ?? "public";
    const securitySchema = dataSchema === "public" ? "authz" : `${dataSchema}_authz`;
    const publicGrants = await client.$queryRaw<{ unsafe: boolean }[]>`SELECT
      has_function_privilege(current_user,${`"${securitySchema}".distribution_servers()`},'EXECUTE') OR
      has_function_privilege(current_user,${`"${securitySchema}".distribution_snapshot(text,uuid)`},'EXECUTE') AS unsafe`;
    if (publicGrants[0]?.unsafe) throw new Error("Runtime roles must not execute unscoped distribution functions");
    const mapping = await client.$queryRaw<{ role: string; permission: string }[]>`SELECT role,permission FROM ${Prisma.raw(`"${securitySchema}".role_permission`)} ORDER BY role,permission`;
    const expected = Object.entries(rolePermissions).flatMap(([role, permissions]) => permissions.map(permission => `${role}:${permission}`)).sort();
    if (JSON.stringify(mapping.map(row => `${row.role}:${row.permission}`)) !== JSON.stringify(expected)) throw new Error("Database role-permission mapping differs from application RBAC; deploy matching migration");
    const unsafe = await client.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname=${securitySchema} AND (pg_get_userbyid(p.proowner) NOT IN ('mua_owner','mua_lookup') OR
      p.prosecdef AND (p.proconfig IS NULL OR NOT EXISTS(SELECT 1 FROM unnest(p.proconfig) config WHERE config LIKE 'search_path=pg_catalog,%' AND config LIKE '%, pg_temp'))) `;
    if (unsafe[0]?.count) throw new Error("Unsafe database authorization function ownership or search path");
    checked.add(client);
  })();
  pending.set(client, validation);
  try { await validation; } finally { pending.delete(client); }
}
export async function disconnectDatabases() { await Promise.all([...clients.values()].map(client => client.$disconnect())); clients.clear(); clientSchemas.clear(); }
