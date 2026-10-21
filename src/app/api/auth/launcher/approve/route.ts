import { cookies } from "next/headers";
import { approveLauncherLogin } from "@/lib/launcher-auth";
import { COOKIE_NAME } from "@/lib/auth";
import { fields, uuid } from "@/lib/input";
import { failure, json, readJson, sameOrigin } from "@/lib/http";
export async function POST(request: Request) { try { sameOrigin(request); const raw = fields(await readJson(request), ["id"]); return json(await approveLauncherLogin(uuid(typeof raw.id === "string" ? raw.id : ""), (await cookies()).get(COOKIE_NAME)?.value)); } catch (error) { return failure(error); } }
