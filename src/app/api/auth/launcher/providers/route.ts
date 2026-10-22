import { gameFailure, gameRequestPolicy, listGameProviders } from "@/lib/launcher-game-auth";
import { json } from "@/lib/http";
export async function GET(request: Request) {
  try { gameRequestPolicy(request); return json(await listGameProviders()); } catch (error) { return gameFailure(error); }
}
