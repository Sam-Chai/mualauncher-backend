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
    const result = server.archivedAt || server.organization.archivedAt ? unknownProbe(server.gameAddress, "服务器或所属组织已归档，未执行探测")
      : !server.gameAddress?.trim() ? unknownProbe(server.gameAddress, "尚未设置服务器连接地址") : await cachedMinecraftProbe(server.gameAddress);
    const current = await read();
    return json({ serverId, ...(current.gameAddress !== server.gameAddress || !!current.archivedAt !== !!server.archivedAt || !!current.organization.archivedAt !== !!server.organization.archivedAt
      ? unknownProbe(current.gameAddress, "服务器地址或归档状态已改变，请刷新后重试") : result) });
  } catch (error) { return failure(error); }
}
