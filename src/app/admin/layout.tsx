import { Suspense, type ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { authorized, COOKIE_NAME } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { getState } from "@/lib/management";
import { AdminProvider } from "@/components/admin/provider";
import { AdminShell } from "@/components/admin/shell";
import { LocalizedLoading, PreferenceProvider } from "@/components/preferences";
import { LOCALE_COOKIE, parseLocale } from "@/lib/i18n";
// Session validation may redirect. Each admin page also opts out because instant is per segment.
export const instant = false;
async function AuthenticatedAdmin({ children }: { children: ReactNode }) {
  await connection();
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  let initial;
  try { initial = await authorized(token, false, getState); }
  catch (error) { if (error instanceof AppError && error.status === 401) redirect("/login"); throw error; }
  return <PreferenceProvider initialLocale={parseLocale(cookieStore.get(LOCALE_COOKIE)?.value)} withTheme={false}><AdminProvider key={initial.actor.id} initial={initial}><AdminShell>{children}</AdminShell></AdminProvider></PreferenceProvider>;
}
export default function AdminLayout({ children }: { children: ReactNode }) {
  return <Suspense fallback={<main className="flex min-h-svh items-center justify-center text-sm text-muted-foreground"><LocalizedLoading /></main>}><AuthenticatedAdmin>{children}</AuthenticatedAdmin></Suspense>;
}
