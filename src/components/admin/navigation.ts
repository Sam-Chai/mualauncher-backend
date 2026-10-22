import { LayoutDashboard, Building2, Users, ShieldCheck, Server, Boxes, ClipboardCheck, Send, Undo2, Workflow, HardDrive, KeyRound, ScrollText, Settings, Braces } from "lucide-react";
export const navigation = [
  { title: "", items: [{ title: "dashboard.overview", href: "/admin", icon: LayoutDashboard }, { title: "API", href: "/admin/api", icon: Braces }] },
  { title: "navigation.allianceManagement", items: [
    { title: "dashboard.organization", href: "/admin/organizations", icon: Building2 },
    { title: "members.members", href: "/admin/members", icon: Users },
    { title: "navigation.crossOrganizationAccess", href: "/admin/access", icon: ShieldCheck },
    { title: "members.permission", href: "/admin/permissions", icon: ShieldCheck }] },
  { title: "clients.server", items: [
    { title: "navigation.servers", href: "/admin/servers", icon: Server }] },
  { title: "clients.client", items: [
    { title: "navigation.clients", href: "/admin/clients", icon: Boxes }] },
  { title: "clients.publish", items: [
    { title: "clients.pendingReview", href: "/admin/releases/review", icon: ClipboardCheck },
    { title: "clients.published", href: "/admin/releases/published", icon: Send },
    { title: "clients.archived", href: "/admin/releases/archived", icon: Undo2 }] },
  { title: "navigation.system", items: [
    { title: "navigation.taskProcessing", href: "/admin/system/workers", icon: Workflow },
    { title: "navigation.storage", href: "/admin/system/storage", icon: HardDrive },
    { title: "navigation.signingKeys", href: "/admin/system/signing-keys", icon: KeyRound },
    { title: "navigation.auditLog", href: "/admin/system/audit", icon: ScrollText },
    { title: "navigation.settings", href: "/admin/system/settings", icon: Settings }] },
];

export function currentNavigation(pathname: string) {
  const items = navigation.flatMap(group => group.items.map(item => ({ ...item, group: group.title })));
  return items.filter(item => pathname === item.href || (item.href !== "/admin" && pathname.startsWith(item.href + "/")))
    .sort((a, b) => b.href.length - a.href.length)[0] ?? items[0];
}
