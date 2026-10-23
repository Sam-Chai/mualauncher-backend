import "server-only";
import { actorFromToken, locked, type Actor, type Db } from "./auth";
import { revokeAccountCredentials, setDatabaseActor } from "./database-security";
import { invariant } from "./errors";
import { diagnosticText } from "./diagnostics";
import { fields } from "./input";
import { audit } from "./management";
import { validateDatabase } from "./prisma";

export async function revokeCredentials(db: Db, actor: Actor, accountId: string, raw: unknown) {
  fields(raw, []);
  invariant(!actor.apiScope && actor.sessionKind !== "LAUNCHER" && (actor.id === accountId || actor.isSuperAdmin), 403,
    diagnosticText("diagnostics.credentials.cookieOwnerOrSuperadminRequired"));
  invariant(await db.account.findUnique({ where: { id: accountId }, select: { id: true } }), 404,
    diagnosticText("diagnostics.management.theAccountDoesNotExist"));
  const result = await revokeAccountCredentials(db, accountId);
  await audit(db, actor, "ACCOUNT_CREDENTIALS_REVOKE", "Account", accountId, undefined, undefined, result);
  return result;
}

export async function revokeOwnCredentials(token: string | undefined, raw: unknown) {
  await validateDatabase("web");
  return locked(async db => {
    const actor = await actorFromToken(db, token);
    await setDatabaseActor(db, actor);
    return revokeCredentials(db, actor, actor.id, raw);
  });
}
