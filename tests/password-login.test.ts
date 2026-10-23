import assert from "node:assert/strict";
import { test } from "node:test";
import { login, tokenDigest } from "../src/lib/auth";
import { loginQuotas } from "../src/lib/login-policy";
import { hashPassword } from "../src/lib/password";
import { authPrisma } from "../src/lib/prisma";
import { AppError } from "../src/lib/errors";

test("actual password login isolates exhausted sources, ignores old global locks and commits failed-attempt quotas", async () => {
  // In-memory transaction fixture: exercises the real login and scrypt code
  // without opening connections or changing the developer's database.
  const rows = new Map<string, { key: string; attempts: number; resetAt: Date }>();
  const passwordHash = await hashPassword("isolated-valid-password");
  const credential = { accountId: "fixture-account", username: "valid-user", passwordHash, account: { status: "ACTIVE" } };
  let sessions = 0;
  type Quota = { key: string; attempts: number; resetAt: Date };
  const client = {
    $transaction: async (work: (db: unknown) => Promise<unknown>) => {
      const prior = new Map([...rows].map(([key, value]) => [key, { ...value }]));
      try { return await work(client); } catch (error) { rows.clear(); for (const [key, value] of prior) rows.set(key, value); throw error; }
    },
    $executeRaw: async () => 0,
    loginThrottle: {
      findUnique: async ({ where }: { where: { key: string } }) => rows.get(where.key) ?? null,
      upsert: async ({ where, create, update }: { where: { key: string }; create: Quota; update: { attempts: number | { increment: number }; resetAt?: Date } }) => {
        const old = rows.get(where.key);
        rows.set(where.key, old ? { ...old, ...update, attempts: typeof update.attempts === "number" ? update.attempts : old.attempts + update.attempts.increment } : create);
      },
      deleteMany: async () => ({ count: 0 }),
    },
    localCredential: { findUnique: async ({ where }: { where: { username?: string; accountId?: string } }) => where.username === credential.username || where.accountId === credential.accountId ? credential : null },
    session: { deleteMany: async () => ({ count: 0 }), create: async () => { sessions++; } },
    auditEvent: { createMany: async () => ({ count: 1 }) },
  };
  const fixture = client as unknown as typeof authPrisma;
  const blocked = loginQuotas("attacker", "valid-user");
  for (const [key, attempts] of [[blocked[0].key, 60], [tokenDigest("login:global"), 60], [tokenDigest("login:user:valid-user"), 10]] as const) rows.set(key, { key, attempts, resetAt: new Date(Date.now() + 60000) });
  await assert.rejects(login("valid-user", "isolated-valid-password", undefined, fixture, "attacker"), (e: unknown) => e instanceof AppError && e.status === 429);
  const session = await login("valid-user", "isolated-valid-password", undefined, fixture, "other-client");
  assert.match(session.token, /^[a-f0-9]{64}$/); assert.equal(sessions, 1);
  await assert.rejects(login("missing-user", "wrong", undefined, fixture, "other-client"), (e: unknown) => e instanceof AppError && e.status === 401);
  assert.equal(rows.get(loginQuotas("other-client", "missing-user")[1].key)?.attempts, 1);
});
