import { claimLauncherLogin } from "@/lib/launcher-auth";
import { failure, json, readJson } from "@/lib/http";
export async function POST(request: Request) { try { const result = await claimLauncherLogin(await readJson(request)); return json(result, result.pending ? 202 : 200); } catch (error) { return failure(error); } }
