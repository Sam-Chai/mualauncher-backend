import { cookies } from "next/headers";
import { connection } from "next/server";
import { z } from "zod";
import { authorized, COOKIE_NAME } from "@/lib/auth";
import { failure, json, readJson, sameOrigin } from "@/lib/http";
import { AppError, invariant } from "@/lib/errors";
import { organizationScope, requireOrganization } from "@/lib/rbac";
import { avatarRevisionInput, isOrganizationAvatarKey } from "@/lib/organization-avatar-contract";
import { boundedAvatarForm, prepareOrganizationAvatar, readOrganizationAvatar, saveOrganizationAvatar, storeOrganizationAvatar } from "@/lib/organization-avatar";
type Context = { params: Promise<{ organizationId: string }> };
async function identity(context: Context) { const id=z.string().uuid().safeParse((await context.params).organizationId); invariant(id.success,400,"无效的组织 ID"); return id.data; }
export async function GET(request: Request, context: Context) {
  await connection();
  try {
    const id = await identity(context), token = (await cookies()).get(COOKIE_NAME)?.value;
    const parsedVariant = z.enum(["image", "metadata", "source"]).safeParse(new URL(request.url).searchParams.get("variant") ?? "image");
    invariant(parsedVariant.success,400,"无效的图片类型"); const variant=parsedVariant.data;
    const org = await authorized(token, false, async (db, actor) => (await organizationScope(db, actor, id)).organization);
    const version = new URL(request.url).searchParams.get("version");
    invariant(version === null || version === (isOrganizationAvatarKey(org.avatarObjectKey,id) ? org.avatarObjectKey.split("/").at(-2) : "none"), 409, "组织头像已改变，请刷新后重试");
    const result = variant === "metadata" && !isOrganizationAvatarKey(org.avatarObjectKey, id) ? null : await readOrganizationAvatar(org.avatarObjectKey, id, variant);
    await authorized(token, false, async (db, actor) => { const current = (await organizationScope(db, actor, id)).organization;
      invariant(current.avatarRevision === org.avatarRevision, 409, "组织头像已改变，请刷新后重试"); });
    if (variant === "metadata") return json({ revision: org.avatarRevision, mode: org.avatarMode, metadata: result?.metadata ?? null });
    return new Response(new Uint8Array(result!.bytes!), { headers: { "Content-Type": "image/webp", "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" } });
  } catch (e) { return failure(e); }
}
export async function POST(request: Request, context: Context) {
  await connection();
  try {
    sameOrigin(request); const id = await identity(context), token = (await cookies()).get(COOKIE_NAME)?.value;
    const org = await authorized(token, false, async (db, actor) => (await requireOrganization(db, actor, id, "ORG_EDIT")).organization);
    const form = await boundedAvatarForm(request), seen = new Set<string>();
    for (const name of form.keys()) { invariant(["source", "crop", "expectedRevision"].includes(name) && !seen.has(name), 400, "上传包含不允许或重复的字段"); seen.add(name); }
    const parsedRevision = z.coerce.number().int().nonnegative().safeParse(form.get("expectedRevision"));
    invariant(parsedRevision.success,400,"无效的图片修订"); const revision=parsedRevision.data;
    invariant(form.has("expectedRevision") && revision === org.avatarRevision, 409, "组织头像已改变，请刷新后重试");
    let crop: unknown; try { crop=JSON.parse(String(form.get("crop"))); } catch { throw new AppError(400,"无效的图片选区"); }
    const file = form.get("source");
    invariant(file === null || file instanceof File, 400, "无效的图片文件");
    invariant(!file || ["image/png", "image/jpeg", "image/webp"].includes(file.type), 415, "请上传静态 PNG、JPEG 或 WebP 图片");
    const bytes = file ? Buffer.from(await file.arrayBuffer()) : (await readOrganizationAvatar(org.avatarObjectKey, id, "source")).bytes!;
    const key = await storeOrganizationAvatar(id, await prepareOrganizationAvatar(bytes, crop, !file));
    return json(await authorized(token, true, (db, actor) => saveOrganizationAvatar(db, actor, id, revision, key)));
  } catch (e) { return failure(e); }
}
export async function DELETE(request: Request, context: Context) {
  try {
    sameOrigin(request); const id = await identity(context), token = (await cookies()).get(COOKIE_NAME)?.value;
    const parsed=avatarRevisionInput.safeParse(await readJson(request)); invariant(parsed.success,400,"无效的图片修订"); const {expectedRevision}=parsed.data;
    return json(await authorized(token, true, (db, actor) => saveOrganizationAvatar(db, actor, id, expectedRevision, null)));
  } catch (e) { return failure(e); }
}
