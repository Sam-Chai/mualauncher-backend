import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { currentActor } from "@/lib/auth";
import LoginForm from "@/components/login-form";
import { LocalizedLoading, PreferenceProvider } from "@/components/preferences";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, parseLocale } from "@/lib/i18n";
import { unionConfigured, unionReturnTo } from "@/lib/union-oauth";

async function Login({ searchParams }: { searchParams: Promise<{ returnTo?: string; unionError?: string }> }) {
  await connection();
  const query = await searchParams;
  const returnTo = query.returnTo ? unionReturnTo(query.returnTo) : undefined;
  const actor = await currentActor();
  if (actor && !query.unionError) redirect(returnTo ?? (actor.canManage ? "/admin" : "/member"));
  return <PreferenceProvider initialLocale={parseLocale((await cookies()).get(LOCALE_COOKIE)?.value)} withTheme={false}><LoginForm unionEnabled={unionConfigured()} unionError={!!query.unionError} returnTo={returnTo} /></PreferenceProvider>;
}
// Session validation can redirect authenticated requests to /admin.
export const instant = false;
export default function LoginPage({ searchParams }: { searchParams: Promise<{ returnTo?: string; unionError?: string }> }) {
  return <main className="flex min-h-svh items-center justify-center bg-muted/30 p-6"><Suspense fallback={<LocalizedLoading />}><Login searchParams={searchParams} /></Suspense></main>;
}
