import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { LOCALE_COOKIE, messages, parseLocale } from "@/lib/i18n";

export default getRequestConfig(async () => {
  const locale = parseLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  return { locale, messages: messages[locale], timeZone: "Asia/Shanghai" };
});
