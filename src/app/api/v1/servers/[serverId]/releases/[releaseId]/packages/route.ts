import { connection } from "next/server";
import { memberDistribution } from "@/lib/member-access";
import { serverId, uuid } from "@/lib/input";
import { publicPackage } from "@/lib/client-download";
import { json, failure } from "@/lib/http";

export async function GET(request: Request, context: { params: Promise<{ serverId: string; releaseId: string }> }) {
  await connection();
  try {
    const params = await context.params, query = new URL(request.url).searchParams;
    return json(await memberDistribution(request, serverId(params.serverId), uuid(params.releaseId), db => publicPackage(db, serverId(params.serverId), query.get("platform"), query.get("baseReleaseId"),
      query.get("acceptedFormatVersions"), query.get("baseManifestSha256"), uuid(params.releaseId), query.get("packageSha256"))));
  } catch (error) { return failure(error); }
}
