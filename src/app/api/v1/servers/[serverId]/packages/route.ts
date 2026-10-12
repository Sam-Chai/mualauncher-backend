import { connection } from "next/server";
import { publicDatabase } from "@/lib/public-database";
import { serverId } from "@/lib/input";
import { publicPackage } from "@/lib/client-download";
import { json, failure } from "@/lib/http";
export async function GET(request: Request, context: { params: Promise<{ serverId: string }> }) {
  await connection();
  try { const params = await context.params; const query = new URL(request.url).searchParams;
    return json(await publicPackage(await publicDatabase(serverId(params.serverId)), serverId(params.serverId), query.get("platform"), query.get("baseReleaseId"), query.get("acceptedFormatVersions"), query.get("baseManifestSha256"))); }
  catch (error) { return failure(error); }
}
