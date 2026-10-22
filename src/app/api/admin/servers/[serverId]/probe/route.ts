import { diagnosticText } from "@/lib/diagnostics";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { authorized, COOKIE_NAME } from "@/lib/auth";
import { requireServer } from "@/lib/rbac";
import { serverId as checkedServerId } from "@/lib/input";
import { failure, json } from "@/lib/http";
import { cachedMinecraftProbe, unknownProbe } from "@/lib/server-probe";

export async function GET(_request: Request, context: { params: Promise<{ serverId: string }> }) {
  await connection();
  try {
    const serverId = checkedServerId((await context.params).serverId), token = (await cookies()).get(COOKIE_NAME)?.value;
    const read = () => authorized(token, false, async (db, actor) => (await requireServer(db, actor, serverId, "SERVER_READ", false)).server);
    const server = await read();
    const result = server.archivedAt || server.organization.archivedAt ? unknownProbe(server.gameAddress, diagnosticText("diagnostics.route.serverOrOrganizationArchivedProbeSkipped"))
      : !server.gameAddress?.trim() ? unknownProbe(server.gameAddress, diagnosticText("diagnostics.route.noServerConnectionAddressConfigured")) : await cachedMinecraftProbe(server.gameAddress);
    const current = await read();
    return json({ serverId, ...(current.gameAddress !== server.gameAddress || !!current.archivedAt !== !!server.archivedAt || !!current.organization.archivedAt !== !!server.organization.archivedAt
      ? unknownProbe(current.gameAddress, diagnosticText("diagnostics.route.theServerAddressOrArchiveStateHasChangedRefreshAnd")) : result) });
  } catch (error) { return failure(error); }
}
