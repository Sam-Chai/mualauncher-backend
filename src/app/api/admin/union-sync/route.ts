import { diagnosticText } from "@/lib/diagnostics";
import { cookies } from "next/headers";
import { authorized, COOKIE_NAME } from "@/lib/auth";
import { failure, json, readJson, sameOrigin } from "@/lib/http";
import { requestUnionSync, unionDirectoryStatus, updateUnionAuthorization } from "@/lib/union-directory";
import { z } from "zod";
import { invariant } from "@/lib/errors";
export async function GET() {
  try { return json(await authorized((await cookies()).get(COOKIE_NAME)?.value, false, unionDirectoryStatus)); } catch (e) { return failure(e); }
}
export async function POST(request: Request) {
  try { sameOrigin(request); invariant(z.object({}).strict().safeParse(await readJson(request)).success,400,diagnosticText("diagnostics.route.invalidRequestParameters"));
    return json(await authorized((await cookies()).get(COOKIE_NAME)?.value, true, requestUnionSync)); } catch (e) { return failure(e); }
}
export async function PATCH(request: Request) {
  try { sameOrigin(request); const body = await readJson(request);
    return json(await authorized((await cookies()).get(COOKIE_NAME)?.value, true, (db, actor) => updateUnionAuthorization(db, actor, body))); } catch (e) { return failure(e); }
}
