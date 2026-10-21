import { memberRead, requestMemberToken } from "@/lib/member-access";
import { authPrisma, validateDatabase } from "@/lib/prisma";
import { tokenDigest } from "@/lib/auth";
import { invariant } from "@/lib/errors";
import { failure, json } from "@/lib/http";
export async function POST(request: Request) { try { const credential = requestMemberToken(request); invariant(credential.launcher, 401, "Launcher 登录凭据无效"); await memberRead(request, async () => undefined); await validateDatabase("auth"); await authPrisma.session.deleteMany({ where: { tokenHash: tokenDigest(credential.token!), kind: "LAUNCHER" } }); return json({ ok: true }); } catch (error) { return failure(error); } }
