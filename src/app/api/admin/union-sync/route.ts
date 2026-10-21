import { cookies } from "next/headers";
import { authorized, COOKIE_NAME } from "@/lib/auth";
import { failure, json, readJson, sameOrigin } from "@/lib/http";
import { requestUnionSync, unionDirectoryStatus } from "@/lib/union-directory";
import { z } from "zod";
import { invariant } from "@/lib/errors";
export async function GET() {
  try { return json(await authorized((await cookies()).get(COOKIE_NAME)?.value, false, unionDirectoryStatus)); } catch (e) { return failure(e); }
}
export async function POST(request: Request) {
  try { sameOrigin(request); invariant(z.object({}).strict().safeParse(await readJson(request)).success,400,"请求参数无效");
    return json(await authorized((await cookies()).get(COOKIE_NAME)?.value, true, requestUnionSync)); } catch (e) { return failure(e); }
}
