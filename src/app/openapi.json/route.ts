import { publicOpenApi } from "@/lib/openapi/document";
import { parseLocale } from "@/lib/i18n";

export function GET(request: Request) {
  const locale = parseLocale(new URL(request.url).searchParams.get("locale"));
  return Response.json(publicOpenApi(locale), { headers: { "Cache-Control": "no-store", "Content-Language": locale, "X-Content-Type-Options": "nosniff" } });
}
