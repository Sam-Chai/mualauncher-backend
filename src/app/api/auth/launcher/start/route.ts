import { startLauncherLogin } from "@/lib/launcher-auth";
import { failure, json, readJson } from "@/lib/http";
export async function POST(request: Request) { try { return json(await startLauncherLogin(await readJson(request)), 201); } catch (error) { return failure(error); } }
