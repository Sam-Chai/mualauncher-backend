import "dotenv/config";
import { locked } from "../src/lib/auth";
import { hashPassword } from "../src/lib/password";
import { password, username } from "../src/lib/input";
import { getPrisma } from "../src/lib/prisma";
const prisma = getPrisma("migration");

async function main() {
  if (!process.env.BOOTSTRAP_PASSWORD) throw new Error("Set BOOTSTRAP_PASSWORD in an external protected one-off environment file");
  const name = username(process.env.BOOTSTRAP_USERNAME ?? "mua-admin");
  const secret = password(process.env.BOOTSTRAP_PASSWORD);
  const hash = await hashPassword(secret);
  const account = await locked(async db => {
    if (await db.account.count({ where: { isSuperAdmin: true, status: "ACTIVE" } })) return null;
    const account = await db.account.create({ data: { displayName: "MUA 管理员", isSuperAdmin: true,
      credential: { create: { username: name, passwordHash: hash } } } });
    await db.auditEvent.create({ data: { actorId: account.id, action: "ADMIN_BOOTSTRAP", targetType: "Account", targetId: account.id, details: {} } });
    return account;
  }, prisma);
  if (!account) { console.log("An active super administrator already exists; no credentials changed."); return; }
  console.log(`Created initial super administrator: ${name}`);
}

main().catch(error => { console.error("Bootstrap failed:", error instanceof Error ? error.message : "Unknown error"); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
