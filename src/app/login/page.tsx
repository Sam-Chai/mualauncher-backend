import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { currentActor } from "@/lib/auth";
import LoginForm from "@/components/login-form";
import { LocalizedLoading, PreferenceProvider } from "@/components/preferences";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, parseLocale } from "@/lib/i18n";

async function Login() {
  await connection();
  if (await currentActor()) redirect("/admin");
  return <PreferenceProvider initialLocale={parseLocale((await cookies()).get(LOCALE_COOKIE)?.value)} withTheme={false}><LoginForm /></PreferenceProvider>;
}
// Session validation can redirect authenticated requests to /admin.
export const instant = false;
export default function LoginPage() {
  return <main className="flex min-h-svh items-center justify-center bg-muted/30 p-6"><Suspense fallback={<LocalizedLoading />}><Login /></Suspense></main>;
}
