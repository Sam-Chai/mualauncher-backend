import "dotenv/config";
import { prisma } from "../src/lib/prisma";

async function main() {
  try {
    const [result] = await prisma.$queryRaw<
      { database: string; user: string; ok: number }[]
    >`SELECT current_database() AS database, current_user AS "user", 1 AS ok`;

    if (result?.ok !== 1) {
      throw new Error("Unexpected database check result.");
    }

    console.log(
      `PostgreSQL connection OK (database: ${result.database}, user: ${result.user}).`,
    );
  } catch (error) {
    console.error(
      "PostgreSQL connection failed:",
      error instanceof Error ? error.message : "Unknown error",
    );
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
