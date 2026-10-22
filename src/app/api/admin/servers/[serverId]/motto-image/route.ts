import { diagnosticText } from "@/lib/diagnostics";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { authorized, COOKIE_NAME } from "@/lib/auth";
import { failure, json, readJson, sameOrigin } from "@/lib/http";
import { AppError, invariant } from "@/lib/errors";
import { serverId as checkedServerId } from "@/lib/input";
import { requireServer } from "@/lib/rbac";
import { MAX_MOTTO_UPLOAD_BYTES } from "@/lib/server-motto-contract";
import { prepareMottoImage, storeMottoImage, saveServerMotto, readServerMotto } from "@/lib/server-motto";
import { z } from "zod";

type Context = { params: Promise<{ serverId: string }> };
const expectedKeySchema = z.string().max(500).nullable();
async function boundedForm(request: Request) {
  invariant(request.headers.get("content-type")?.startsWith("multipart/form-data;") && request.body, 415, diagnosticText("diagnostics.organizationAvatar.useTheImageUploadForm"));
  const maximum = MAX_MOTTO_UPLOAD_BYTES + 65536;
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    length += value.byteLength;
    if (length > maximum) { await reader.cancel(); throw new AppError(413, diagnosticText("diagnostics.organizationAvatar.theImageMustNotExceed8Mib")); }
    chunks.push(value);
  }
  try { return await new Request(request.url, { method: "POST", headers: { "Content-Type": request.headers.get("content-type")! }, body: Buffer.concat(chunks) }).formData(); }
  catch { throw new AppError(400, diagnosticText("diagnostics.organizationAvatar.invalidImageUploadForm")); }
}

export async function GET(request: Request, context: Context) {
  await connection();
  try {
    const serverId = checkedServerId((await context.params).serverId), token = (await cookies()).get(COOKIE_NAME)?.value;
    const variant = new URL(request.url).searchParams.get("variant") ?? "image";
    invariant(["image", "source", "metadata"].includes(variant), 400, diagnosticText("diagnostics.route.invalidImageType"));
    const server = await authorized(token, false, async (db, actor) => (await requireServer(db, actor, serverId, "SERVER_READ", false)).server);
    const version = new URL(request.url).searchParams.get("version");
    invariant(version === null || version === server.iconObjectKey?.split("/").at(-2), 409, diagnosticText("diagnostics.serverMotto.theServerMottoHasChangedRefreshAndRetry"));
    const result = await readServerMotto(server.iconObjectKey, server.organizationId, serverId, variant as "image" | "source" | "metadata");
    if (!result.bytes) return json(result.metadata);
    return new Response(new Uint8Array(result.bytes), { headers: { "Content-Type": "image/webp", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request, context: Context) {
  await connection();
  try {
    sameOrigin(request);
    const serverId = checkedServerId((await context.params).serverId), token = (await cookies()).get(COOKIE_NAME)?.value;
    const server = await authorized(token, false, async (db, actor) => (await requireServer(db, actor, serverId, "SERVER_EDIT")).server);
    const form = await boundedForm(request);
    const seen = new Set<string>();
    for (const key of form.keys()) { invariant(["source", "crop", "expectedIconObjectKey"].includes(key) && !seen.has(key), 400, diagnosticText("diagnostics.route.theUploadContainsUnsupportedOrDuplicateFields")); seen.add(key); }
    let rawCrop: unknown, expectedKey: string | null;
    try { rawCrop = JSON.parse(String(form.get("crop"))); expectedKey = expectedKeySchema.parse(JSON.parse(String(form.get("expectedIconObjectKey")))); }
    catch { throw new AppError(400, diagnosticText("diagnostics.route.invalidImageCropOrRevision")); }
    invariant(expectedKey === server.iconObjectKey, 409, diagnosticText("diagnostics.serverMotto.theServerMottoHasChangedRefreshAndRetry"));
    const file = form.get("source");
    invariant(file === null || file instanceof File, 400, diagnosticText("diagnostics.route.invalidImageFile"));
    invariant(!file || ["image/png", "image/jpeg", "image/webp"].includes(file.type), 415, diagnosticText("diagnostics.organizationAvatar.uploadAStaticPngJpegOrWebpImage"));
    const source = file ? Buffer.from(await file.arrayBuffer()) : (await readServerMotto(server.iconObjectKey, server.organizationId, serverId, "source")).bytes!;
    const prepared = await prepareMottoImage(source, rawCrop, !file);
    const stored = await storeMottoImage(server.organizationId, serverId, prepared);
    // Decode and S3 writes happen before acquiring the business lock. Recheck the live session, scope, archive and revision at commit.
    return json(await authorized(token, true, (db, actor) => saveServerMotto(db, actor, serverId, expectedKey, stored)));
  } catch (error) { return failure(error); }
}

export async function DELETE(request: Request, context: Context) {
  await connection();
  try {
    sameOrigin(request);
    const serverId = checkedServerId((await context.params).serverId), token = (await cookies()).get(COOKIE_NAME)?.value;
    const data = z.object({ expectedIconObjectKey: expectedKeySchema }).strict().safeParse(await readJson(request));
    invariant(data.success, 400, diagnosticText("diagnostics.route.invalidImageRevision"));
    return json(await authorized(token, true, (db, actor) => saveServerMotto(db, actor, serverId, data.data.expectedIconObjectKey, null)));
  } catch (error) { return failure(error); }
}
