"use client";
import { useState } from "react";
import { useI18n } from "@/components/preferences";
import { Button } from "@/components/ui/button";
import { api } from "@/components/admin/provider";
export function LauncherConfirm({ id, name }: { id: string; name: string }) {
  const { t } = useI18n(); const [done, setDone] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  return <main className="mx-auto max-w-lg space-y-5 p-8"><h1 className="text-xl font-semibold">{t("确认 Launcher 登录")}</h1><p>{name}</p><p>{t("仅在你刚刚从自己的 Launcher 发起登录时确认。")}</p>{error && <p role="alert">{t(error)}</p>}{done ? <p>{t("登录已确认，请返回 Launcher。")}</p> : <Button disabled={busy} onClick={async () => { setBusy(true); try { await api("/api/auth/launcher/approve", "POST", { id }); setDone(true); } catch(e){setError(e instanceof Error?e.message:"请求失败");}finally{setBusy(false);} }}>{t("确认登录")}</Button>}</main>;
}
