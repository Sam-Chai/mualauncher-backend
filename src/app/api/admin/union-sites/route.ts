import { cookies } from "next/headers";
import { authorized, COOKIE_NAME } from "@/lib/auth";
import { failure, json, readJson, sameOrigin } from "@/lib/http";
import { saveUnionSite } from "@/lib/organization-access";
import { superOnly } from "@/lib/rbac";
export async function GET() { try { return json(await authorized((await cookies()).get(COOKIE_NAME)?.value,false,async(db,actor)=> { superOnly(actor); return db.unionSkinSite.findMany({orderBy:{code:"asc"},select:{code:true,organizationId:true,bsRoot:true,enabled:true,revision:true,updatedAt:true}}); })); } catch(error){ return failure(error); } }
export async function PUT(request:Request) { try { sameOrigin(request); const raw=await readJson(request); return json(await authorized((await cookies()).get(COOKIE_NAME)?.value,true,(db,actor)=>saveUnionSite(db,actor,raw))); } catch(error){return failure(error);} }
