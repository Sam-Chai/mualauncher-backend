import { gameClientKey, gameFailure, gameRequestPolicy, startGameLogin } from "@/lib/launcher-game-auth";
import { json, readJson } from "@/lib/http";
export async function POST(request: Request) {
  try { gameRequestPolicy(request); return json(await startGameLogin(await readJson(request), gameClientKey(request)), 201); } catch (error) { return gameFailure(error); }
}
