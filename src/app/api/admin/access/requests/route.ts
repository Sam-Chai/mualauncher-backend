import { cookies } from "next/headers";
import { authorized, COOKIE_NAME } from "@/lib/auth";
import { failure, json, readJson, sameOrigin } from "@/lib/http";
import { accessState, submitAccess } from "@/lib/organization-access";
export async function GET() { try { return json(await authorized((await cookies()).get(COOKIE_NAME)?.value,false,db=>accessState(db))); } catch(error){return failure(error);} }
export async function POST(request:Request) { try { sameOrigin(request);const raw=await readJson(request);return json(await authorized((await cookies()).get(COOKIE_NAME)?.value,true,db=>submitAccess(db,raw)),201); } catch(error){return failure(error);} }
