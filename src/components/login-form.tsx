"use client";
import { useI18n } from "@/components/preferences";
import { PreferenceControls } from "@/components/preferences";
import { useState } from "react";
import { Hexagon, ShieldCheck } from "lucide-react";
import { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { SchemaForm } from "@/components/admin/form";
import { api } from "@/components/admin/provider";
import { navigateAfterAuthChange } from "@/lib/auth-navigation";
import { PROJECT_NAME } from "@/lib/branding";
import { Button } from "@/components/ui/button";
const schema = z.object({ username: z.string().trim().min(3, "请输入用户名").max(64), password: z.string().min(1, "请输入密码").max(128) });
export default function LoginForm({ unionEnabled = false, unionError = false, returnTo }: { unionEnabled?: boolean; unionError?: boolean; returnTo?: string }) {
  const { t } = useI18n();
  const [error, setError] = useState(unionError ? "Union 登录未完成，请重试或联系管理员检查皮肤站接入和账号状态。" : "");
  return <div className="w-full max-w-md space-y-6">
    <div className="flex justify-end"><PreferenceControls /></div>
    <div className="flex items-center justify-center gap-3"><div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Hexagon /></div><div><p className="text-lg font-semibold">{PROJECT_NAME}</p><p className="text-xs text-muted-foreground">{t("高校联盟管理平台")}</p></div></div>
    <Card><CardHeader><CardTitle className="text-xl">{t("登录管理平台")}</CardTitle><CardDescription>{t("使用 MUA 管理员分配的白名单账号。")}</CardDescription></CardHeader><CardContent className="space-y-5">
      {unionEnabled ? <Button className="w-full" asChild><a href={`/api/auth/union/start${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`}>{t("使用 Union 皮肤站登录")}</a></Button> : <p className="text-sm text-muted-foreground">{t("Union OAuth 尚未配置，请使用账号密码登录")}</p>}
      {error && <Alert variant="destructive" role="alert"><AlertDescription>{t(error)}</AlertDescription></Alert>}
      <SchemaForm schema={schema} defaults={{ username: "", password: "" }} label={t("登录")}
        fields={[{ name: "username", label: t("用户名"), autoComplete: "username", placeholder: "mua-admin" }, { name: "password", label: t("密码"), type: "password", autoComplete: "current-password" }]}
        onSubmit={async values => { setError(""); try { await api("/api/auth/login", "POST", values); navigateAfterAuthChange(returnTo ?? "/admin"); return true; } catch (error) { setError(error instanceof Error ? error.message : t("登录失败")); return false; } }} />
    </CardContent></Card><p className="flex items-center justify-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="size-3.5" />{t("仅对白名单成员开放 · 组织权限隔离")}</p>
  </div>;
}
