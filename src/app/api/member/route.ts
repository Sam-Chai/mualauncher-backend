import { memberState } from "@/lib/member-access";
import { failure, json } from "@/lib/http";
export async function GET(request: Request) { try { return json(await memberState(request)); } catch (error) { return failure(error); } }
