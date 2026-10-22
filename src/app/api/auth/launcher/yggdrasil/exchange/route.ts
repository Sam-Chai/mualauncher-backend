import { exchangeGameLogin, gameClientKey, gameFailure, gameRequestPolicy } from "@/lib/launcher-game-auth";
import { json, readJson } from "@/lib/http";
export async function POST(request: Request) {
  try { gameRequestPolicy(request); return json(await exchangeGameLogin(await readJson(request), undefined, gameClientKey(request))); } catch (error) { return gameFailure(error); }
}
