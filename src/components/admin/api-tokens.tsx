"use client";
import { useI18n } from "@/components/preferences";
import { useEffect, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { EditorDialog, SchemaForm } from "./form";
import { api, useAdmin } from "./provider";
import { rolePermissions, type Permission } from "@/lib/roles";
type TokenRow = { id: string; name: string; expiresAt: string; revokedAt: string | null; serverIds: string[]; permissions: string[] };
const tokenSchema = z.object({ name: z.string().trim().min(1).max(100), serverIds: z.array(z.string()).min(1, "请至少选择一个服务器"), permissions: z.array(z.string()).min(1), expiresInDays: z.string().regex(/^([1-9]|[1-8][0-9]|90)$/, "有效期为 1–90 天") });
export function ApiTokens() {
  const { t, formatDate } = useI18n();
  const { state, busy, run, epoch } = useAdmin(); const [tokens, setTokens] = useState<TokenRow[]>([]); const [secret, setSecret] = useState(""); const [error, setError] = useState("");
  const servers = state.organizations.flatMap(org => org.servers.filter(server => !org.archivedAt && !server.archivedAt && !server.clientArchivedAt).map(server => ({ ...server, organizationName: org.displayName })));
  const permissionOptions = [...new Set(Object.values(rolePermissions).flat())].filter(permission => !permission.startsWith("ORG_") && permission !== "SERVER_EDIT" && servers.some(server => server.permissions.includes(permission as Permission)));
  useEffect(() => { let active = true; void api<TokenRow[]>("/api/admin/tokens").then(rows => { if (active) { setTokens(rows); setError(""); } }).catch(error => { if (active) setError(error instanceof Error ? error.message : t("读取 Token 失败")); }); return () => { active = false; }; }, [epoch, t]);
  return <Card className="min-w-0"><CardHeader><CardTitle>{t("API Token · 自动化")}</CardTitle><CardDescription>{t("GitHub Actions 与手动上传使用同一组客户端 API。Token 限定服务器与权限，账号撤权立即生效。")}</CardDescription></CardHeader><CardContent className="space-y-5">
    {servers.length > 0 && <EditorDialog title={t("创建 API Token")} description={t("Token 最长有效期 90 天，仅显示一次。选中的权限必须在每个选中的服务器上都已拥有。")}>{close => <SchemaForm schema={tokenSchema} fields={[
      { name: "name", label: t("名称"), placeholder: "GitHub Actions · NPU" }, { name: "serverIds", label: t("服务器范围"), type: "roles", options: servers.map(server => ({ value: server.serverId, label: `${server.organizationName} / ${server.displayName}` })) },
      { name: "permissions", label: t("权限范围"), type: "roles", options: permissionOptions.map(permission => ({ value: permission, label: permission })), hint: t("上传通常需要 SERVER_READ、DRAFT_READ、DRAFT_CREATE、DRAFT_EDIT、DRAFT_SUBMIT；审核和发布需要额外授权。") }, { name: "expiresInDays", label: t("有效期（天）"), type: "number" },
    ]} defaults={{ name: "", serverIds: [], permissions: ["SERVER_READ", "DRAFT_READ", "DRAFT_CREATE", "DRAFT_EDIT", "DRAFT_SUBMIT"].filter(permission => permissionOptions.includes(permission as Permission)), expiresInDays: "30" }} disabled={busy} label={t("创建 Token")}
      onSubmit={async values => { const ok = await run(async () => { const result = await api<{ token: string }>("/api/admin/tokens", "POST", { ...values, expiresInDays: Number(values.expiresInDays) }); setSecret(result.token); }, t("Token 已创建")); if (ok) close(); return ok; }} />}</EditorDialog>}
    {error && <Alert variant="destructive"><AlertDescription>{t(error)}</AlertDescription></Alert>}
    {secret && <Alert><AlertDescription className="w-full space-y-3"><p>{t("请保存 Token，关闭后无法再次查看。")}</p><Input readOnly value={secret} aria-label={t("新 API Token")} /><div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => void navigator.clipboard.writeText(secret)}>{t("复制")}</Button><Button variant="ghost" size="sm" onClick={() => setSecret("")}>{t("已保存，关闭")}</Button></div></AlertDescription></Alert>}
    {tokens.map(token => <div key={token.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"><div className="min-w-0 space-y-1 text-sm wrap-anywhere"><p className="font-medium">{token.name} · {token.revokedAt ? t("已撤销") : new Date(token.expiresAt) <= new Date() ? t("已过期") : t("启用")}</p><p className="text-xs text-muted-foreground">{token.serverIds.join(", ")} {" " + t("· 到期") + " "}{formatDate(token.expiresAt)}</p><p className="text-xs text-muted-foreground">{token.permissions.join(" / ")}</p></div>{!token.revokedAt && <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => api(`/api/admin/tokens/${token.id}/revoke`, "POST", {}), t("Token 已撤销"))}>{t("撤销")}</Button>}</div>)}
    {!tokens.length && <p className="text-sm text-muted-foreground">{t("暂无 API Token。")}</p>}
  </CardContent></Card>;
}
