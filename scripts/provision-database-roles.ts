import "dotenv/config";
import { randomBytes } from "node:crypto";
import { readFile, writeFile, copyFile } from "node:fs/promises";
import pg from "pg";

const roleNames = ["mua_owner", "mua_migrator", "mua_web", "mua_auth", "mua_public", "mua_worker", "mua_lookup"];
async function main() {
  const adminUrl = process.env.DATABASE_ADMIN_URL;
  if (!adminUrl) throw new Error("DATABASE_ADMIN_URL is required; no implicit privileged fallback");
  const source = new URL(adminUrl);
  const schema = process.env.DATABASE_SCHEMA ?? "public";
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error("Invalid database schema");
  const pool = new pg.Pool({ connectionString: adminUrl });
  const db = await pool.connect(); const settings = new Map<string, string>();
  const keys = { mua_web: "DATABASE_URL", mua_auth: "DATABASE_AUTH_URL", mua_public: "DATABASE_PUBLIC_URL", mua_worker: "DATABASE_WORKER_URL", mua_migrator: "DATABASE_MIGRATION_URL" };
  try {
    await db.query("BEGIN");
    for (const name of roleNames) {
      const key = keys[name as keyof typeof keys];
      let password: string | undefined;
      if (key) {
        const existingUrl = process.env[key];
        const existing = existingUrl ? new URL(existingUrl) : null;
        password = existing?.username === name ? decodeURIComponent(existing.password) : randomBytes(32).toString("hex");
        const url = new URL(source); url.username = name; url.password = password;
        if (name === "mua_migrator") url.searchParams.set("options", "-c role=mua_owner");
        else url.searchParams.delete("options");
        settings.set(key, url.toString());
      }
      const found = await db.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [name]);
      const literal = password ? " PASSWORD '" + password.replaceAll("'", "''") + "'" : "";
      await db.query(`${found.rowCount ? "ALTER" : "CREATE"} ROLE ${name} ${key ? "LOGIN" : "NOLOGIN"} NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT${literal}`);
    }
    await db.query('GRANT mua_owner TO mua_migrator');
    await db.query('GRANT mua_lookup TO mua_owner WITH INHERIT TRUE');
    const database = (await db.query('SELECT current_database() AS name')).rows[0].name as string;
    await db.query(`GRANT CREATE ON DATABASE "${database.replaceAll('"','""')}" TO mua_owner`);
    await db.query(`GRANT USAGE,CREATE ON SCHEMA "${schema}" TO mua_owner,mua_lookup`);
    await db.query('COMMIT');
    if (process.argv.includes("--adopt")) {
      await db.query("BEGIN");
      const tables = await db.query("SELECT tablename FROM pg_tables WHERE schemaname=$1", [schema]);
      for (const row of tables.rows) await db.query(`ALTER TABLE "${schema}"."${String(row.tablename).replaceAll('"','""')}" OWNER TO mua_owner`);
      const sequences = await db.query("SELECT sequencename FROM pg_sequences WHERE schemaname=$1", [schema]);
      for (const row of sequences.rows) await db.query(`ALTER SEQUENCE "${schema}"."${String(row.sequencename).replaceAll('"','""')}" OWNER TO mua_owner`);
      const types = await db.query("SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname=$1 AND t.typtype='e'", [schema]);
      for (const row of types.rows) await db.query(`ALTER TYPE "${schema}"."${String(row.typname).replaceAll('"','""')}" OWNER TO mua_owner`);
      const functions = await db.query("SELECT p.oid::regprocedure::text AS name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 AND pg_get_userbyid(p.proowner)<>'mua_lookup'", [schema]);
      for (const row of functions.rows) await db.query(`ALTER FUNCTION ${row.name} OWNER TO mua_owner`);
      await db.query("COMMIT");
    }
    if (process.argv.includes("--write-env")) {
      const path = ".env"; let content = await readFile(path, "utf8");
      const backup = `.local/env-before-rls-${Date.now()}.backup`; await copyFile(path, backup);
      for (const [key, value] of settings) { const line = `${key}=${JSON.stringify(value)}`; const regex = new RegExp(`^${key}=.*$`, "m"); content = regex.test(content) ? content.replace(regex, line) : content.trimEnd() + "\n" + line + "\n"; }
      await writeFile(path, content); console.log("Database connection settings saved; backup:", backup);
    }
    console.log("Database roles provisioned. Passwords and connection strings are not printed.");
  } catch (error) { await db.query("ROLLBACK"); throw error; }
  finally { db.release(); await pool.end(); }
}
void main().catch(error => { console.error(error instanceof Error ? error.message : "Role provisioning failed"); process.exitCode = 1; });
