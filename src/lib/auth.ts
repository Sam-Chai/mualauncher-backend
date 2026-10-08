import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "./prisma";
import type { Prisma } from "@/generated/prisma/client";
import { AppError, invariant } from "./errors";
import { dummyHash, verifyPassword } from "./password";

export const COOKIE_NAME = "mua_session";
export const SESSION_SECONDS = 60 * 60 * 12;
export const tokenDigest = (token: string) => createHash("sha256").update(token).digest("hex");
export type Db = Prisma.TransactionClient;
export type Actor = { id: string; displayName: string; isSuperAdmin: boolean; username?: string };

export async function actorFromToken(db: Db, token: string | undefined): Promise<Actor> {
  invariant(token && /^[0-9a-f]{64}$/.test(token), 401, "请先登录");
  const session = await db.session.findUnique({ where: { tokenHash: tokenDigest(token) },
    include: { account: { include: { credential: { select: { username: true } } } } } });
  invariant(session && session.expiresAt > new Date() && session.account.status === "ACTIVE", 401, "会话已失效，请重新登录");
  return { id: session.account.id, displayName: session.account.displayName,
    isSuperAdmin: session.account.isSuperAdmin, username: session.account.credential?.username ?? "" };
}
export async function currentActor() {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  try { return await actorFromToken(prisma, token); }
  catch (error) { if (error instanceof AppError && error.status === 401) return null; throw error; }
}

// One lock order for all first-stage management writes, login and permission revocations.
// Deliberately coarse for the small whitelist; later split locks only with concurrency tests.
export async function locked<T>(work: (db: Db) => Promise<T>, client = prisma): Promise<T> {
  return client.$transaction(async db => {
    await db.$executeRaw`SELECT pg_advisory_xact_lock(731402, 1)`;
    return work(db);
  }, { maxWait: 10000, timeout: 15000 });
}
export async function authorized<T>(token: string | undefined, write: boolean, work: (db: Db, actor: Actor) => Promise<T>) {
  const run = async (db: Db) => work(db, await actorFromToken(db, token));
  return write ? locked(run) : prisma.$transaction(run);
}

export async function login(name: string, password: string, oldToken?: string, client = prisma) {
  const now = new Date();
  await locked(async db => {
    for (const [key, limit, seconds] of [["global", 60, 300], [`user:${name}`, 10, 900]] as const) {
      const digest = tokenDigest(`login:${key}`);
      const prior = await db.loginThrottle.findUnique({ where: { key: digest } });
      invariant(!prior || prior.resetAt <= now || prior.attempts < limit, 429, "登录尝试过多，请稍后重试");
      await db.loginThrottle.upsert({ where: { key: digest }, create: { key: digest, attempts: 1, resetAt: new Date(now.getTime() + seconds * 1000) },
        update: prior && prior.resetAt > now ? { attempts: { increment: 1 } } : { attempts: 1, resetAt: new Date(now.getTime() + seconds * 1000) } });
    }
    await db.loginThrottle.deleteMany({ where: { resetAt: { lt: now } } });
  }, client);
  const credential = await client.localCredential.findUnique({ where: { username: name }, include: { account: true } });
  const valid = await verifyPassword(password, credential?.passwordHash ?? dummyHash);
  invariant(valid && credential?.account.status === "ACTIVE", 401, "用户名或密码错误，或账号已停用");
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000);
  await locked(async db => {
    const fresh = await db.localCredential.findUnique({ where: { accountId: credential.accountId }, include: { account: true } });
    invariant(fresh?.account.status === "ACTIVE" && fresh.passwordHash === credential.passwordHash, 401, "账号状态已变化，请重新登录");
    if (oldToken) await db.session.deleteMany({ where: { tokenHash: tokenDigest(oldToken) } });
    await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    await db.session.create({ data: { tokenHash: tokenDigest(token), accountId: credential.accountId, expiresAt } });
    await db.auditEvent.create({ data: { actorId: credential.accountId, action: "AUTH_LOGIN", targetType: "Account", targetId: credential.accountId, details: {} } });
  }, client);
  return { token, expiresAt };
}
