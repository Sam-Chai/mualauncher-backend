import { cookies } from "next/headers";
import { connection } from "next/server";
import { authorized, COOKIE_NAME } from "@/lib/auth";
import { failure } from "@/lib/http";
import { adminOpenApi } from "@/lib/openapi/private-document";
import { parseLocale } from "@/lib/i18n";

export async function GET(request: Request) {
  await connection();
  try {
    await authorized((await cookies()).get(COOKIE_NAME)?.value, false, async () => undefined);
    const locale = parseLocale(new URL(request.url).searchParams.get("locale"));
    return Response.json(adminOpenApi(locale), { headers: { "Cache-Control": "private, no-store", "Vary": "Cookie", "Content-Language": locale, "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return failure(error); }
}
