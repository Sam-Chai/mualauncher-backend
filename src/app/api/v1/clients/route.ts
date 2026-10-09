import { cookies } from "next/headers";
import { connection } from "next/server";
import { COOKIE_NAME } from "@/lib/auth";
import { authorizeApi } from "@/lib/api-auth";
import { clientList, createClient } from "@/lib/client-service";
import { json, failure, readJson } from "@/lib/http";
export async function GET(request: Request) {
  await connection();
  try { return json(await authorizeApi(request, (await cookies()).get(COOKIE_NAME)?.value, false, clientList)); }
  catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  await connection();
  try {
    const raw = await readJson(request);
    return json(await authorizeApi(request, (await cookies()).get(COOKIE_NAME)?.value, true, (db, actor) => createClient(db, actor, raw)), 201);
  } catch (error) { return failure(error); }
}
