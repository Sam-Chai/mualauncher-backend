import type { ReactNode } from "react";
import { Construction, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
export function Heading({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="flex flex-wrap items-start justify-between gap-4"><div className="space-y-2"><h1 className="text-2xl font-semibold tracking-tight">{title}</h1><p className="text-sm text-muted-foreground">{description}</p></div>{action}</div>;
}
export function Status({ archived, active = "启用中" }: { archived?: unknown; active?: string }) {
  return <Badge variant={archived ? "secondary" : "outline"} className="whitespace-nowrap">{archived ? "已归档" : active}</Badge>;
}
export function Planned({ title, description, items }: { title: string; description: string; items: string[] }) {
  return <><Heading title={title} description={description} /><Card><CardHeader><Construction className="mb-2 size-8 text-muted-foreground" /><CardTitle>功能待接入</CardTitle><CardDescription>页面入口已建立。服务接入后才会开放操作与统计数据。</CardDescription></CardHeader><CardContent><ul className="space-y-3 text-sm text-muted-foreground">{items.map(item => <li className="flex gap-3" key={item}><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground/50" />{item}</li>)}</ul></CardContent></Card></>;
}
export function NoPermission() {
  return <Card><CardHeader><ShieldAlert className="size-8 text-muted-foreground" /><CardTitle>没有此模块的访问权限</CardTitle><CardDescription>请联系 MUA 管理员分配相应角色。</CardDescription></CardHeader></Card>;
}
