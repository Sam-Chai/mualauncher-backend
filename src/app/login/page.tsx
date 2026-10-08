import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { currentActor } from "@/lib/auth";
import LoginForm from "@/components/login-form";

async function Login() {
  await connection();
  if (await currentActor()) redirect("/admin");
  return <LoginForm />;
}
export default function LoginPage() {
  return <main className="flex min-h-svh items-center justify-center bg-muted/30 p-6"><Suspense fallback={<p>正在加载…</p>}><Login /></Suspense></main>;
}
