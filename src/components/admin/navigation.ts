import { LayoutDashboard, Building2, Users, ShieldCheck, Server, ListOrdered, Activity, Boxes, Newspaper, CalendarDays, PanelsTopLeft, ClipboardCheck, Send, Undo2, Workflow, HardDrive, KeyRound, ScrollText, Settings } from "lucide-react";
export const navigation = [
  { title: "", items: [{ title: "总览", href: "/admin", icon: LayoutDashboard }] },
  { title: "联盟管理", items: [
    { title: "组织", href: "/admin/organizations", icon: Building2 },
    { title: "成员", href: "/admin/members", icon: Users },
    { title: "权限", href: "/admin/permissions", icon: ShieldCheck }] },
  { title: "服务器", items: [
    { title: "Server", href: "/admin/servers", icon: Server },
    { title: "Listing", href: "/admin/listings", icon: ListOrdered },
    { title: "状态", href: "/admin/servers/status", icon: Activity }] },
  { title: "客户端", items: [
    { title: "客户端管理", href: "/admin/clients", icon: Boxes }] },
  { title: "内容", items: [
    { title: "资讯", href: "/admin/news", icon: Newspaper },
    { title: "活动", href: "/admin/events", icon: CalendarDays },
    { title: "Launcher UI", href: "/admin/launcher-ui", icon: PanelsTopLeft }] },
  { title: "发布", items: [
    { title: "待审核", href: "/admin/releases/review", icon: ClipboardCheck },
    { title: "已发布", href: "/admin/releases/published", icon: Send },
    { title: "已撤销", href: "/admin/releases/revoked", icon: Undo2 }] },
  { title: "系统", items: [
    { title: "Worker", href: "/admin/system/workers", icon: Workflow },
    { title: "Storage", href: "/admin/system/storage", icon: HardDrive },
    { title: "Signing Keys", href: "/admin/system/signing-keys", icon: KeyRound },
    { title: "Audit Log", href: "/admin/system/audit", icon: ScrollText },
    { title: "Settings", href: "/admin/system/settings", icon: Settings }] },
];

export function currentNavigation(pathname: string) {
  const items = navigation.flatMap(group => group.items.map(item => ({ ...item, group: group.title })));
  return items.filter(item => pathname === item.href || (item.href !== "/admin" && pathname.startsWith(item.href + "/")))
    .sort((a, b) => b.href.length - a.href.length)[0] ?? items[0];
}
