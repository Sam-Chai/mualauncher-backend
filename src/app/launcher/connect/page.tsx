import { Suspense } from "react";
import { connection } from "next/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { currentActor } from "@/lib/auth";
import { uuid } from "@/lib/input";
import { PreferenceProvider, LocalizedLoading } from "@/components/preferences";
import { LOCALE_COOKIE, parseLocale } from "@/lib/i18n";
import { LauncherConfirm } from "@/components/launcher-confirm";
export const instant = false;
async function Confirm({ searchParams }: { searchParams: Promise<{ id: string }> }) {
  await connection(); const id = uuid((await searchParams).id ?? ""); const actor = await currentActor();
  if (!actor) redirect(`/login?returnTo=${encodeURIComponent(`/launcher/connect?id=${id}`)}`);
  return <PreferenceProvider initialLocale={parseLocale((await cookies()).get(LOCALE_COOKIE)?.value)} withTheme={false}><LauncherConfirm id={id} name={actor.displayName} /></PreferenceProvider>;
}
export default function Page({ searchParams }: { searchParams: Promise<{ id: string }> }) { return <Suspense fallback={<LocalizedLoading />}><Confirm searchParams={searchParams} /></Suspense>; }
