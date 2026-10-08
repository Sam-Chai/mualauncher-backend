import { Suspense, type ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { authorized, COOKIE_NAME } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { getState } from "@/lib/management";
import { AdminProvider } from "@/components/admin/provider";
import { AdminShell } from "@/components/admin/shell";
async function AuthenticatedAdmin({ children }: { children: ReactNode }) {
  await connection();
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  let initial;
  try { initial = await authorized(token, false, getState); }
  catch (error) { if (error instanceof AppError && error.status === 401) redirect("/login"); throw error; }
  return <AdminProvider key={initial.actor.id} initial={initial}><AdminShell>{children}</AdminShell></AdminProvider>;
}
export default function AdminLayout({ children }: { children: ReactNode }) {
  return <Suspense fallback={<main className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">正在加载管理平台…</main>}><AuthenticatedAdmin>{children}</AuthenticatedAdmin></Suspense>;
}
