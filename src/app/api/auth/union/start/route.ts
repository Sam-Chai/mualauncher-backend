import { NextResponse } from "next/server";
import { beginUnionLogin, unionReturnTo, UNION_COOKIE, UNION_LOGIN_SECONDS } from "@/lib/union-oauth";
import { appOrigin, failure } from "@/lib/http";
export async function GET(request: Request) {
  try {
    const result = await beginUnionLogin(unionReturnTo(new URL(request.url).searchParams.get("returnTo")));
    const response = NextResponse.redirect(result.url, 303);
    response.headers.set("Cache-Control", "no-store"); response.headers.set("Referrer-Policy", "no-referrer");
    response.cookies.set(UNION_COOKIE, result.browser, { httpOnly: true, secure: appOrigin().startsWith("https://"), sameSite: "lax", path: "/api/auth/union", maxAge: UNION_LOGIN_SECONDS });
    return response;
  } catch (error) { return failure(error); }
}
