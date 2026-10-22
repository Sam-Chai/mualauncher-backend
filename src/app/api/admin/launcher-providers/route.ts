import { diagnosticText } from "@/lib/diagnostics";
import { cookies } from "next/headers";
import { authorized, COOKIE_NAME } from "@/lib/auth";
import { listGameProvidersAdmin, saveGameProvider } from "@/lib/launcher-game-auth";
import { failure, json, readJson, sameOrigin } from "@/lib/http";
import { invariant } from "@/lib/errors";
export async function GET(request: Request) {
  try { invariant(!request.headers.has("authorization"), 401, diagnosticText("diagnostics.route.useAnAdministratorSession"));
    return json(await authorized((await cookies()).get(COOKIE_NAME)?.value, false, listGameProvidersAdmin)); } catch (error) { return failure(error); }
}
export async function PUT(request: Request) {
  try { invariant(!request.headers.has("authorization"), 401, diagnosticText("diagnostics.route.useAnAdministratorSession")); sameOrigin(request); const body = await readJson(request);
    return json(await authorized((await cookies()).get(COOKIE_NAME)?.value, true, (db, actor) => saveGameProvider(db, actor, body))); } catch (error) { return failure(error); }
}
