import "dotenv/config";
import { randomBytes } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { locked } from "../src/lib/auth";
import { hashPassword } from "../src/lib/password";
import { password, username } from "../src/lib/input";
import { getPrisma } from "../src/lib/prisma";
import { PROJECT_NAME } from "../src/lib/branding";
const prisma = getPrisma("migration");

async function main() {
  const name = username(process.env.BOOTSTRAP_USERNAME ?? "mua-admin");
  const secret = password(process.env.BOOTSTRAP_PASSWORD ?? randomBytes(24).toString("base64url"));
  const hash = await hashPassword(secret);
  let credentialPath: string | undefined;
  let account;
  try { account = await locked(async db => {
    if (await db.account.count({ where: { isSuperAdmin: true, status: "ACTIVE" } })) return null;
    const account = await db.account.create({ data: { displayName: "MUA 管理员", isSuperAdmin: true,
      credential: { create: { username: name, passwordHash: hash } } } });
    await db.auditEvent.create({ data: { actorId: account.id, action: "ADMIN_BOOTSTRAP", targetType: "Account", targetId: account.id, details: {} } });
    if (!process.env.BOOTSTRAP_PASSWORD) {
      const directory = resolve(".local");
      await mkdir(directory, { recursive: true });
      const path = resolve(directory, `initial-admin-${Date.now()}.txt`);
      await writeFile(path, `${PROJECT_NAME} initial administrator\nUsername: ${name}\nPassword: ${secret}\n\nChange this password after login, then delete this file.\n`, { flag: "wx", mode: 0o600 });
      credentialPath = path;
    }
    return account;
  }, prisma); } catch (error) {
    if (credentialPath) await unlink(credentialPath);
    throw error;
  }
  if (!account) { console.log("An active super administrator already exists; no credentials changed."); return; }
  console.log(`Created initial super administrator: ${name}`);
  if (credentialPath) console.log(`Initial credentials saved to git-ignored file: ${credentialPath}`);
}

main().catch(error => { console.error("Bootstrap failed:", error instanceof Error ? error.message : "Unknown error"); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
