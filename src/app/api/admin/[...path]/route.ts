import { diagnosticText } from "@/lib/diagnostics";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { authorized, COOKIE_NAME } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { failure, json, readJson, sameOrigin } from "@/lib/http";
import { serverId, uuid } from "@/lib/input";
import * as management from "@/lib/management";
import { createApiToken, revokeApiToken, tokenSelect } from "@/lib/api-auth";
import { infrastructureStatus } from "@/lib/infrastructure";
import { storageTelemetry } from "@/lib/storage-telemetry";
import { recycleSettings, updateRecycleSettings } from "@/lib/recycle-storage";
import { downloadSettings, updateDownloadSettings } from "@/lib/download-settings";
import { packageFormatSettings, updatePackageFormatSettings } from "@/lib/package-format-settings";
import { uploadSizeSettings, updateUploadSizeSettings } from "@/lib/upload-size-settings";

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
        if (path.length === 1 && kind === "upload-size-settings") return uploadSizeSettings(db, actor);
        if (path.length === 1 && kind === "package-format-settings") return packageFormatSettings(db, actor);
        if (path.length === 1 && kind === "download-settings") return downloadSettings(db, actor);
        if (path.length === 1 && kind === "recycle-settings") return recycleSettings(db, actor);
        if (path.length === 1 && kind === "tokens") return db.apiToken.findMany({ where: { accountId: actor.id }, select: tokenSelect, orderBy: { createdAt: "desc" } });
        if (path.length === 1 && kind === "pipeline") return infrastructureStatus(db, actor);
        if (path.length === 1 && kind === "storage-telemetry") return storageTelemetry(db, actor);
        if (path.length === 1 && kind === "state") return management.getState(db, actor);
        if (path.length === 3 && kind === "organizations" && action === "account-search") return management.searchAccounts(db, actor, uuid(id), new URL(request.url).searchParams.get("q") ?? "");
      }
      if (request.method === "POST") {
        if (path.length === 1 && kind === "tokens") return createApiToken(db, actor, raw);
        if (path.length === 3 && kind === "tokens" && action === "revoke") return revokeApiToken(db, actor, uuid(id));
        if (path.length === 1 && kind === "organizations") return management.createOrganization(db, actor, raw);
        if (path.length === 1 && kind === "servers") return management.createServer(db, actor, raw);
        if (path.length === 1 && kind === "accounts") return management.createAccount(db, actor, raw);
        if (path.length === 3 && action === "archive" && ["organizations", "servers"].includes(kind))
          return management.archiveResource(db, actor, kind as "organizations" | "servers", kind === "organizations" ? uuid(id) : serverId(id), raw);
      }
      if (request.method === "PATCH" && path.length === 1 && kind === "recycle-settings") return updateRecycleSettings(db, actor, raw);
      if (request.method === "PATCH" && path.length === 1 && kind === "download-settings") return updateDownloadSettings(db, actor, raw);
      if (request.method === "PATCH" && path.length === 1 && kind === "package-format-settings") return updatePackageFormatSettings(db, actor, raw);
      if (request.method === "PATCH" && path.length === 1 && kind === "upload-size-settings") return updateUploadSizeSettings(db, actor, raw);
      if (request.method === "PATCH" && path.length === 2) {
        if (kind === "organizations") return management.updateOrganization(db, actor, uuid(id), raw);
        if (kind === "servers") return management.updateServer(db, actor, serverId(id), raw);
        if (kind === "accounts") return management.updateAccount(db, actor, uuid(id), raw);
      }
      if (request.method === "PUT" && kind === "organizations" && action === "members") {
        if (path.length === 4) return management.setMember(db, actor, uuid(id), uuid(accountId), raw);
        if (path.length === 6 && grant === "servers") return management.setGrant(db, actor, uuid(id), uuid(accountId), serverId(sid), raw);
      }
      throw new AppError(404, diagnosticText("diagnostics.route.endpointNotFound"));
    });
    return json(result, request.method === "POST" && path.length === 1 ? 201 : 200);
  } catch (error) { return failure(error); }
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
