import { cookies } from "next/headers";
import { authorized, COOKIE_NAME } from "@/lib/auth";
import { failure, json } from "@/lib/http";
import { accessCandidates } from "@/lib/organization-access";
import { uuid } from "@/lib/input";
export async function GET(request:Request){try{const q=new URL(request.url).searchParams;return json(await authorized((await cookies()).get(COOKIE_NAME)?.value,false,db=>accessCandidates(db,uuid(q.get("sourceOrganizationId")??""),q.has("targetOrganizationId")?uuid(q.get("targetOrganizationId")!):null)));}catch(error){return failure(error);}}
