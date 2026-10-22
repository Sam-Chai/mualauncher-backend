import { diagnosticText } from "@/lib/diagnostics";
import "server-only";
import { randomBytes, createHash } from "node:crypto";
import { authPrisma, validateDatabase } from "./prisma";
import { actorFromToken, locked, SESSION_SECONDS, tokenDigest } from "./auth";
import { launcherClaimInput, launcherStartInput } from "./union-contract";
import { invariant } from "./errors";
import { appOrigin } from "./http";

export async function startLauncherLogin(raw: unknown) {
  const input = launcherStartInput.safeParse(raw); invariant(input.success, 400, diagnosticText("diagnostics.launcherAuth.invalidLauncherLoginParameters"));
  await validateDatabase("auth");
  const attempt = await locked(async db => {
    const key = tokenDigest("launcher-start"), now = new Date(), old = await db.loginThrottle.findUnique({ where: { key } });
    invariant(!old || old.resetAt <= now || old.attempts < 120, 429, diagnosticText("diagnostics.auth.tooManySignInAttemptsTryAgainLater"));
    await db.loginThrottle.upsert({ where: { key }, create: { key, attempts: 1, resetAt: new Date(Date.now() + 300_000) }, update: old && old.resetAt > now ? { attempts: { increment: 1 } } : { attempts: 1, resetAt: new Date(Date.now() + 300_000) } });
    await db.launcherLoginAttempt.deleteMany({ where: { expiresAt: { lt: now } } });
    return db.launcherLoginAttempt.create({ data: { challenge: input.data.challenge, expiresAt: new Date(Date.now() + 300_000) } });
  }, authPrisma);
  return { id: attempt.id, loginUrl: `${appOrigin()}/launcher/connect?id=${attempt.id}`, expiresAt: attempt.expiresAt };
}
export async function approveLauncherLogin(id: string, cookie: string | undefined) {
  await validateDatabase("auth");
  return locked(async db => {
    const actor = await actorFromToken(db, cookie); invariant(actor.sessionKind !== "LAUNCHER", 403, diagnosticText("diagnostics.launcherAuth.confirmTheSignInInYourBrowser"));
    const result = await db.launcherLoginAttempt.updateMany({ where: { id, accountId: null, expiresAt: { gt: new Date() } }, data: { accountId: actor.id } });
    invariant(result.count === 1, 409, diagnosticText("diagnostics.launcherAuth.theLauncherLoginAttemptHasExpiredOrWasAlreadyUsed")); return { ok: true };
  }, authPrisma);
}
export async function claimLauncherLogin(raw: unknown) {
  const input = launcherClaimInput.safeParse(raw); invariant(input.success, 400, diagnosticText("diagnostics.launcherAuth.invalidLauncherLoginParameters"));
  const { id, verifier } = input.data; const challenge = createHash("sha256").update(verifier).digest("base64url");
  await validateDatabase("auth");
  // Commit quota independently: a rejected verifier must not roll its attempt counter back.
  await locked(async db => {
    const now = new Date();
    for (const [name, limit] of [["launcher-claim", 3000], [`launcher-claim:${id}`, 120]] as const) {
      const key = tokenDigest(name), throttle = await db.loginThrottle.findUnique({ where: { key } });
      invariant(!throttle || throttle.resetAt <= now || throttle.attempts < limit, 429, diagnosticText("diagnostics.auth.tooManySignInAttemptsTryAgainLater"));
      await db.loginThrottle.upsert({ where: { key }, create: { key, attempts: 1, resetAt: new Date(Date.now() + 300_000) },
        update: throttle && throttle.resetAt > now ? { attempts: { increment: 1 } } : { attempts: 1, resetAt: new Date(Date.now() + 300_000) } });
    }
    await db.loginThrottle.deleteMany({ where: { resetAt: { lt: now } } });
  }, authPrisma);
  return locked(async db => {
    const attempt = await db.launcherLoginAttempt.findUnique({ where: { id } });
    invariant(attempt && attempt.expiresAt > new Date() && attempt.challenge === challenge, 400, diagnosticText("diagnostics.launcherAuth.theLauncherLoginAttemptHasExpiredOrWasAlreadyUsed"));
    if (!attempt.accountId) return { pending: true as const };
    const account = await db.account.findUnique({ where: { id: attempt.accountId } }); invariant(account?.status === "ACTIVE", 403, diagnosticText("diagnostics.launcherAuth.theAccountIsDisabled"));
    await db.launcherLoginAttempt.delete({ where: { id } });
    const token = randomBytes(32).toString("hex"), expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000);
    await db.session.create({ data: { tokenHash: tokenDigest(token), accountId: account.id, kind: "LAUNCHER", authMethod: "BROWSER_BRIDGE", expiresAt } });
    return { pending: false as const, token: `mul_${token}`, expiresAt };
  }, authPrisma);
}
