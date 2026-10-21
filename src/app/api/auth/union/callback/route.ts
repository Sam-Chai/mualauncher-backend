import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { completeUnionLogin, UNION_COOKIE } from "@/lib/union-oauth";
import { COOKIE_NAME, SESSION_SECONDS } from "@/lib/auth";
import { appOrigin } from "@/lib/http";
export async function GET(request: Request) {
  const store = await cookies();
  let response: NextResponse;
  try {
    const session = await completeUnionLogin(new URL(request.url), store.get(UNION_COOKIE)?.value);
    response = NextResponse.redirect(new URL(session.returnTo, appOrigin()), 303);
    response.cookies.set(COOKIE_NAME, session.token, { httpOnly: true, secure: appOrigin().startsWith("https://"), sameSite: "lax", path: "/", maxAge: SESSION_SECONDS, expires: session.expiresAt });
  } catch { response = NextResponse.redirect(new URL("/login?unionError=1", appOrigin()), 303); }
  response.cookies.set(UNION_COOKIE, "", { httpOnly: true, secure: appOrigin().startsWith("https://"), sameSite: "lax", path: "/api/auth/union", maxAge: 0 });
  response.headers.set("Cache-Control", "private, no-store"); response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
