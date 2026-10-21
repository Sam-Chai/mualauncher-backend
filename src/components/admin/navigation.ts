import { LayoutDashboard, Building2, Users, ShieldCheck, Server, Boxes, ClipboardCheck, Send, Undo2, Workflow, HardDrive, KeyRound, ScrollText, Settings, Braces } from "lucide-react";
export const navigation = [
  { title: "", items: [{ title: "总览", href: "/admin", icon: LayoutDashboard }, { title: "API", href: "/admin/api", icon: Braces }] },
  { title: "联盟管理", items: [
    { title: "组织", href: "/admin/organizations", icon: Building2 },
    { title: "成员", href: "/admin/members", icon: Users },
    { title: "跨组织访问", href: "/admin/access", icon: ShieldCheck },
    { title: "权限", href: "/admin/permissions", icon: ShieldCheck }] },
  { title: "服务器", items: [
    { title: "服务器管理", href: "/admin/servers", icon: Server }] },
  { title: "客户端", items: [
    { title: "客户端管理", href: "/admin/clients", icon: Boxes }] },
  { title: "发布", items: [
    { title: "待审核", href: "/admin/releases/review", icon: ClipboardCheck },
    { title: "已发布", href: "/admin/releases/published", icon: Send },
    { title: "已归档", href: "/admin/releases/archived", icon: Undo2 }] },
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
