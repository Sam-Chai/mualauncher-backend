"use client";
import type { ReactNode } from "react";
import { useI18n } from "@/components/preferences";
import { Construction, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
export function Heading({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  const { t } = useI18n();
  return <div className="flex flex-wrap items-start justify-between gap-4"><div className="space-y-2"><h1 className="text-2xl font-semibold tracking-tight">{t(title)}</h1><p className="text-sm text-muted-foreground">{t(description)}</p></div>{action}</div>;
}
export function Status({ archived, active = "启用中" }: { archived?: unknown; active?: string }) {
  const { t } = useI18n();
  return <Badge variant={archived ? "secondary" : "outline"} className="whitespace-nowrap">{archived ? t("已归档") : t(active)}</Badge>;
}
export function Planned({ title, description, items }: { title: string; description: string; items: string[] }) {
  const { t } = useI18n();
  return <><Heading title={title} description={description} /><Card><CardHeader><Construction className="mb-2 size-8 text-muted-foreground" /><CardTitle>{t("功能待接入")}</CardTitle><CardDescription>{t("页面入口已建立。服务接入后才会开放操作与统计数据。")}</CardDescription></CardHeader><CardContent><ul className="space-y-3 text-sm text-muted-foreground">{items.map(item => <li className="flex gap-3" key={item}><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground/50" />{t(item)}</li>)}</ul></CardContent></Card></>;
}
export function NoPermission() {
  const { t } = useI18n();
  return <Card><CardHeader><ShieldAlert className="size-8 text-muted-foreground" /><CardTitle>{t("没有此模块的访问权限")}</CardTitle><CardDescription>{t("请联系 MUA 管理员分配相应角色。")}</CardDescription></CardHeader></Card>;
}
