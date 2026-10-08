import { cookies } from "next/headers";
import { connection } from "next/server";
import { authorized, COOKIE_NAME } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { failure, json, readJson, sameOrigin } from "@/lib/http";
import { serverId, uuid } from "@/lib/input";
import * as management from "@/lib/management";

type Context = { params: Promise<{ path: string[] }> };
async function handle(request: Request, context: Context) {
  await connection();
  try {
    const { path } = await context.params;
    const token = (await cookies()).get(COOKIE_NAME)?.value;
    const write = request.method !== "GET";
    if (write) sameOrigin(request);
    const raw = write ? await readJson(request) : undefined;
    const result = await authorized(token, write, async (db, actor) => {
      const [kind, id, action, accountId, grant, sid] = path;
      if (request.method === "GET") {
        if (path.length === 1 && kind === "state") return management.getState(db, actor);
        if (path.length === 3 && kind === "servers" && action === "clients") return management.getClients(db, actor, serverId(id));
        if (path.length === 3 && kind === "organizations" && action === "account-search") return management.searchAccounts(db, actor, uuid(id), new URL(request.url).searchParams.get("q") ?? "");
      }
      if (request.method === "POST") {
        if (path.length === 1 && kind === "organizations") return management.createOrganization(db, actor, raw);
        if (path.length === 1 && kind === "servers") return management.createServer(db, actor, raw);
        if (path.length === 1 && kind === "accounts") return management.createAccount(db, actor, raw);
        if (path.length === 3 && action === "archive" && ["organizations", "servers", "clients"].includes(kind))
          return management.archiveResource(db, actor, kind as "organizations" | "servers" | "clients", kind === "organizations" ? uuid(id) : serverId(id), raw);
        if (kind === "servers" && action === "drafts") {
          if (path.length === 3) return management.saveDraft(db, actor, serverId(id), raw);
          if (path.length === 5 && grant === "archive") return management.archiveDraft(db, actor, serverId(id), uuid(accountId), raw);
        }
      }
      if (request.method === "PATCH" && path.length === 2) {
        if (kind === "organizations") return management.updateOrganization(db, actor, uuid(id), raw);
        if (kind === "servers") return management.updateServer(db, actor, serverId(id), raw);
        if (kind === "accounts") return management.updateAccount(db, actor, uuid(id), raw);
      }
      if (request.method === "PATCH" && path.length === 4 && kind === "servers" && action === "drafts") return management.saveDraft(db, actor, serverId(id), raw, uuid(accountId));
      if (request.method === "PUT" && kind === "organizations" && action === "members") {
        if (path.length === 4) return management.setMember(db, actor, uuid(id), uuid(accountId), raw);
        if (path.length === 6 && grant === "servers") return management.setGrant(db, actor, uuid(id), uuid(accountId), serverId(sid), raw);
      }
      throw new AppError(404, "接口不存在");
    });
    return json(result, request.method === "POST" && path.length === 1 ? 201 : 200);
  } catch (error) { return failure(error); }
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
