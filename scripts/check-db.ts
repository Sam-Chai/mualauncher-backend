import "dotenv/config";
import { getPrisma, validateDatabase, disconnectDatabases } from "../src/lib/prisma";

async function main() {
  try {
    for (const purpose of ["web", "auth", "public", "worker"] as const) {
      await validateDatabase(purpose);
      const [result] = await getPrisma(purpose).$queryRaw<
        { database: string; user: string; ok: number }[]
      >`SELECT current_database() AS database, current_user AS "user", 1 AS ok`;

      if (result?.ok !== 1) {
        throw new Error("Unexpected database check result.");
      }

      console.log(
        `PostgreSQL ${purpose} connection and forced RLS OK (database: ${result.database}, user: ${result.user}).`,
      );
    }
  } catch (error) {
    console.error(
      "PostgreSQL connection failed:",
      error instanceof Error ? error.message : "Unknown error",
    );
    process.exitCode = 1;
  } finally {
    await disconnectDatabases();
  }
}

void main();
