import { diagnosticText } from "@/lib/diagnostics";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { COOKIE_NAME } from "@/lib/auth";
import { authorizeApi } from "@/lib/api-auth";
import { AppError } from "@/lib/errors";
import { json, failure, readJson } from "@/lib/http";
import { uuid, clientId } from "@/lib/input";
import * as clients from "@/lib/client-service";
import { recipeDistributionStats } from "@/lib/recipe-distribution";
import { configurePackages, retryPackages, draftPlatformManifest, managementFullPackage } from "@/lib/package-build-service";

async function handle(request: Request, context: { params: Promise<{ path: string[] }> }) {
  await connection();
  try {
    const { path } = await context.params; const [kind, id, action, draftId] = path;
    const write = request.method !== "GET"; const token = (await cookies()).get(COOKIE_NAME)?.value;
    const raw = write ? await readJson(request, 256 * 1024) : undefined;
    if (request.method === "POST" && kind === "uploads" && path.length === 3 && action === "complete") {
      const uploadId = uuid(id);
      const prepared = await authorizeApi(request, token, true, (db, actor) => clients.prepareCompletion(db, actor, uploadId, raw));
      // Large S3 assembly runs outside the database transaction and management lock.
      await clients.transferCompletion(prepared);
      return json(await authorizeApi(request, token, true, (db, actor) => clients.queueCompletedUpload(db, actor, uploadId)));
    }
    const result = await authorizeApi(request, token, write, async (db, actor) => {
      if (request.method === "GET") {
        if (kind === "uploads" && path.length === 3 && action === "distribution-statistics") return recipeDistributionStats(db, actor, "uploads", uuid(id));
        if (path.length === 4 && (id === "drafts" || id === "releases") && draftId === "distribution-statistics") return recipeDistributionStats(db, actor, id, uuid(action), clientId(kind));
        if (kind === "uploads" && path.length === 2) return clients.uploadView(await clients.findUpload(db, actor, uuid(id)));
        if (path.length === 1) return clients.clientDetails(db, actor, clientId(kind));
        if (path.length === 4 && id === "drafts" && draftId === "manifest") return clients.draftManifest(db, actor, clientId(kind), uuid(action));
        if (path.length === 4 && id === "drafts" && draftId === "platform-manifest") return draftPlatformManifest(db, actor, clientId(kind), uuid(action), new URL(request.url).searchParams.get("platform"));
        if (path.length === 4 && (id === "drafts" || id === "releases") && draftId === "package") return managementFullPackage(db, actor, clientId(kind), id, uuid(action), new URL(request.url).searchParams.get("platform"));
      }
      if (request.method === "POST") {
        if (kind === "uploads" && path.length === 1) return clients.createUpload(db, actor, raw);
        if (kind === "uploads" && path.length === 3) {
          const uploadId = uuid(id);
          if (action === "parts") return clients.uploadPartUrl(db, actor, uploadId, raw);
          if (action === "submit") return clients.submitUpload(db, actor, uploadId, raw);
          if (action === "retry") return clients.retryUpload(db, actor, uploadId);
          if (action === "cancel") return clients.cancelUpload(db, actor, uploadId);
          if (action === "select-instance") return clients.selectUploadInstance(db, actor, uploadId, raw);
        }
        if (path.length === 2 && id === "bind") return clients.bindClient(db, actor, clientId(kind), raw);
        if (path.length === 2 && id === "unbind") return clients.unbindClient(db, actor, clientId(kind), raw);
        if (path.length === 2 && id === "archive") return clients.archiveClient(db, actor, clientId(kind), raw);
        if (path.length === 2 && id === "delete") return clients.deleteClient(db, actor, clientId(kind));
        if (path.length === 4 && id === "drafts") {
          if (draftId === "archive") return clients.archiveClientDraft(db, actor, clientId(kind), uuid(action), raw);
          if (draftId === "platforms") return configurePackages(db, actor, clientId(kind), uuid(action), raw);
          if (draftId === "retry-packages") return retryPackages(db, actor, clientId(kind), uuid(action));
          if (draftId === "review") return clients.reviewClient(db, actor, clientId(kind), uuid(action), raw);
          if (draftId === "publish") return clients.publishClient(db, actor, clientId(kind), uuid(action), raw);
        }
        if (path.length === 4 && id === "releases" && draftId === "activate") return clients.activateClient(db, actor, clientId(kind), uuid(action), raw);
      }
      throw new AppError(404, diagnosticText("diagnostics.route.theClientEndpointDoesNotExist"));
    });
    return json(result, write && kind === "uploads" && path.length === 1 ? 201 : 200);
  } catch (error) { return failure(error); }
}
export const GET = handle;
export const POST = handle;
