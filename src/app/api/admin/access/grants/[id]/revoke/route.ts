import { cookies } from "next/headers";
import { authorized, COOKIE_NAME } from "@/lib/auth";
import { failure, json, readJson, sameOrigin } from "@/lib/http";
import { revokeAccess } from "@/lib/organization-access";
import { uuid } from "@/lib/input";
export async function POST(request:Request,context:{params:Promise<{id:string}>}) { try{ sameOrigin(request);const {id}=await context.params;const raw=await readJson(request);return json(await authorized((await cookies()).get(COOKIE_NAME)?.value,true,db=>revokeAccess(db,uuid(id),raw))); }catch(error){return failure(error);} }
