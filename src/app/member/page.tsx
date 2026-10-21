import { Suspense } from "react";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { currentActor } from "@/lib/auth";
import { memberState } from "@/lib/member-access";
import { appOrigin } from "@/lib/http";
import { LOCALE_COOKIE, parseLocale } from "@/lib/i18n";
import { PreferenceProvider, LocalizedLoading } from "@/components/preferences";
import { MemberDirectory } from "@/components/member-directory";
export const instant = false;
async function Directory() {
  await connection(); if (!await currentActor()) redirect("/login");
  const cookie = await cookies();
  const state = await memberState(new Request(`${appOrigin()}/api/member`, { headers: { cookie: cookie.toString() } }));
  return <PreferenceProvider initialLocale={parseLocale(cookie.get(LOCALE_COOKIE)?.value)} withTheme={false}><MemberDirectory initial={state} /></PreferenceProvider>;
}
export default function MemberPage() { return <Suspense fallback={<LocalizedLoading />}><Directory /></Suspense>; }
