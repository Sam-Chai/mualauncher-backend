import { diagnosticText } from "@/lib/diagnostics";
import "server-only";
import { prisma, validateDatabase } from "./prisma";
import { actorFromToken, COOKIE_NAME, type Actor, type Db, tokenDigest } from "./auth";
import { securityFunction, setDatabaseActor } from "./database-security";
import { invariant } from "./errors";
import { distributionDatabase, type Snapshot } from "./public-database";
import type { MemberServer } from "./union-contract";

export function requestMemberToken(request: Request) {
  const bearer = request.headers.get("authorization");
  if (bearer !== null) { invariant(/^Bearer mul_[a-f0-9]{64}$/.test(bearer), 401, diagnosticText("diagnostics.memberAccess.invalidLauncherSessionCredential")); return { token: bearer.slice(11), launcher: true }; }
  const cookie = request.headers.get("cookie")?.split(";").map(value => value.trim()).find(value => value.startsWith(`${COOKIE_NAME}=`));
  return { token: cookie?.slice(COOKIE_NAME.length + 1), launcher: false };
}
export async function memberRead<T>(request: Request, work: (db: Db, actor: Actor) => Promise<T>) {
  const credential = requestMemberToken(request);
  await validateDatabase("web");
  return prisma.$transaction(async db => {
    const actor = await actorFromToken(db, credential.token);
    invariant(credential.launcher ? actor.sessionKind === "LAUNCHER" : actor.sessionKind !== "LAUNCHER", 401, diagnosticText("diagnostics.memberAccess.invalidLauncherSessionCredential"));
    await setDatabaseActor(db, actor); return work(db, actor);
  });
}
export async function memberState(request: Request) {
  return memberRead(request, async (db, actor) => {
    const rows = await db.$queryRaw<{ servers: MemberServer[]; organizations: { id: string; displayName: string }[] }[]>`SELECT ${securityFunction("member_servers")}() AS servers, ${securityFunction("member_organizations")}() AS organizations`;
    return { actor: { id: actor.id, displayName: actor.displayName, canManage: actor.sessionKind !== "LAUNCHER" && !!actor.canManage }, ...rows[0] };
  });
}
async function snapshot(request: Request, serverId: string, releaseId: string | null) {
  return memberRead(request, async db => {
    const rows = await db.$queryRaw<{ facts: Snapshot | null }[]>`SELECT ${securityFunction("member_snapshot")}(${serverId},${releaseId}::uuid) AS facts`;
    invariant(rows[0]?.facts, 404, diagnosticText("diagnostics.clientDownload.thisServerHasNoDistributableClient")); return rows[0].facts;
  });
}
export async function memberDistribution<T>(request: Request, serverId: string, releaseId: string | null, resolve: (db: Db) => Promise<T>) {
  const facts = await snapshot(request, serverId, releaseId);
  const result = await resolve(distributionDatabase(facts));
  // Network/OSS work is outside a database transaction. Recheck before returning a fresh capability.
  const fresh = await snapshot(request, serverId, releaseId);
  invariant(tokenDigest(JSON.stringify(facts)) === tokenDigest(JSON.stringify(fresh)), 409, diagnosticText("diagnostics.memberAccess.theServerReleaseChangedRefreshAndTryAgain"));
  return result;
}
