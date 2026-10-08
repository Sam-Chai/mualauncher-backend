import { cookies } from "next/headers";
import { authorized, COOKIE_NAME, login, SESSION_SECONDS, tokenDigest } from "@/lib/auth";
import { AppError, invariant } from "@/lib/errors";
import { appOrigin, failure, json, readJson, sameOrigin } from "@/lib/http";
import * as input from "@/lib/input";
import { audit } from "@/lib/management";
import { hashPassword, verifyPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";

type Context = { params: Promise<{ action: string }> };
const cookieOptions = () => ({ httpOnly: true, secure: appOrigin().startsWith("https://"), sameSite: "strict" as const, path: "/" });

export async function POST(request: Request, context: Context) {
  try {
    sameOrigin(request);
    const { action } = await context.params;
    const token = (await cookies()).get(COOKIE_NAME)?.value;
    const raw = await readJson(request);
    if (action === "login") {
      const data = input.fields(raw, ["username", "password"]);
      const name = input.username(input.text(data, "username", 64));
      // Allow old passwords to fail uniformly, but cap work/input length.
      invariant(typeof data.password === "string" && data.password.length > 0 && data.password.length <= 128, 400, "请输入有效密码");
      const session = await login(name, data.password, token);
      const response = json({ ok: true });
      response.cookies.set(COOKIE_NAME, session.token, { ...cookieOptions(), maxAge: SESSION_SECONDS, expires: session.expiresAt });
      return response;
    }
    if (action === "logout") {
      input.fields(raw, []);
      if (token) await prisma.session.deleteMany({ where: { tokenHash: tokenDigest(token) } });
      const response = json({ ok: true });
      response.cookies.set(COOKIE_NAME, "", { ...cookieOptions(), maxAge: 0 });
      return response;
    }
    if (action === "password") {
      const data = input.fields(raw, ["currentPassword", "newPassword"]);
      invariant(typeof data.currentPassword === "string" && data.currentPassword.length <= 128, 400, "请输入当前密码");
      const nextPassword = input.password(data.newPassword);
      await authorized(token, true, async (db, actor) => {
        const credential = await db.localCredential.findUnique({ where: { accountId: actor.id } });
        invariant(credential && await verifyPassword(data.currentPassword as string, credential.passwordHash), 403, "当前密码错误");
        await db.localCredential.update({ where: { accountId: actor.id }, data: { passwordHash: await hashPassword(nextPassword) } });
        await db.session.deleteMany({ where: { accountId: actor.id } });
        await audit(db, actor, "AUTH_PASSWORD_CHANGE", "Account", actor.id);
      });
      const response = json({ ok: true });
      response.cookies.set(COOKIE_NAME, "", { ...cookieOptions(), maxAge: 0 });
      return response;
    }
    throw new AppError(404, "接口不存在");
  } catch (error) { return failure(error); }
}
