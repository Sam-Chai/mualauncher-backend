"use client";
import { useI18n } from "@/components/preferences";
import { PreferenceControls } from "@/components/preferences";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronsUpDown, LogOut, Settings, Hexagon, RefreshCw } from "lucide-react";
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel, SidebarGroupContent, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarInset, SidebarProvider, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbPage, BreadcrumbSeparator, BreadcrumbLink } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { useAdmin } from "./provider";
import { currentNavigation, navigation } from "./navigation";
import { visibleNavigation } from "./navigation-access";
import { roleLabel } from "./role-label";
import type { ReactNode } from "react";
function AppSidebar() {
  const { t } = useI18n();
  const pathname = usePathname();
  const current = currentNavigation(pathname);
  const { state, busy, logout } = useAdmin();
  const { isMobile, setOpenMobile } = useSidebar();
  return <Sidebar variant="inset" collapsible="icon">
    <SidebarHeader><SidebarMenu><SidebarMenuItem><SidebarMenuButton size="lg" asChild>
      <Link href="/admin" onClick={() => setOpenMobile(false)}><div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground"><Hexagon className="size-5" /></div>
        <div className="grid flex-1 text-left text-sm leading-tight"><span className="truncate font-semibold">MUA Platform</span><span className="truncate text-xs text-muted-foreground">{t("高校联盟管理平台")}</span></div></Link>
    </SidebarMenuButton></SidebarMenuItem></SidebarMenu></SidebarHeader>
    <SidebarContent>{visibleNavigation(navigation, state).map(group => <SidebarGroup key={group.title || "overview"}>
      {group.title && <SidebarGroupLabel>{t(group.title)}</SidebarGroupLabel>}
      <SidebarGroupContent><SidebarMenu>{group.items.map(item => <SidebarMenuItem key={item.href}>
        <SidebarMenuButton asChild isActive={current.href === item.href} tooltip={t(item.title)}>
          <Link href={item.href} aria-current={current.href === item.href ? "page" : undefined} onClick={() => setOpenMobile(false)}><item.icon /><span>{t(item.title)}</span></Link>
        </SidebarMenuButton></SidebarMenuItem>)}</SidebarMenu></SidebarGroupContent>
    </SidebarGroup>)}</SidebarContent>
    <SidebarFooter><SidebarMenu><SidebarMenuItem><DropdownMenu>
      <DropdownMenuTrigger asChild><SidebarMenuButton size="lg">
        <Avatar className="size-8 rounded-lg"><AvatarFallback className="rounded-lg">{state.actor.displayName.slice(0, 2)}</AvatarFallback></Avatar>
        <div className="grid flex-1 text-left text-sm"><span className="truncate font-medium">{state.actor.displayName}</span><span className="truncate text-xs text-muted-foreground">{t(roleLabel(state))}</span></div><ChevronsUpDown className="ml-auto size-4" />
      </SidebarMenuButton></DropdownMenuTrigger>
      <DropdownMenuContent side={isMobile ? "bottom" : "right"} align="end" className="w-56">
        <DropdownMenuLabel>{state.actor.username ? `@${state.actor.username}` : t("白名单账号")}</DropdownMenuLabel><DropdownMenuSeparator />
        <DropdownMenuItem asChild><Link href="/admin/system/settings"><Settings />{t("账号设置")}</Link></DropdownMenuItem>
        <DropdownMenuItem disabled={busy} onSelect={() => void logout()}><LogOut />{t("退出登录")}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu></SidebarMenuItem></SidebarMenu></SidebarFooter>
  </Sidebar>;
}
export function AdminShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const current = currentNavigation(usePathname());
  const { state, organizationId, setOrganizationId, busy, run } = useAdmin();
  return <SidebarProvider style={{ "--sidebar-width": "16rem", "--header-height": "3.5rem" } as React.CSSProperties}>
    <AppSidebar /><SidebarInset className="min-w-0">
      <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur lg:px-6">
        <SidebarTrigger className="-ml-1" /><Separator orientation="vertical" className="mx-2 data-[orientation=vertical]:h-4" />
        <Breadcrumb className="hidden min-w-0 sm:block"><BreadcrumbList><BreadcrumbItem className="hidden sm:block"><BreadcrumbLink asChild><Link href="/admin">{t(current.group || "MUA Platform")}</Link></BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator className="hidden sm:block" /><BreadcrumbItem><BreadcrumbPage>{t(current.title)}</BreadcrumbPage></BreadcrumbItem></BreadcrumbList></Breadcrumb>
        <div className="ml-auto flex items-center gap-2">
          <PreferenceControls />
          <Select value={organizationId} onValueChange={setOrganizationId}><SelectTrigger className="w-32 sm:w-44" aria-label={t("筛选组织")}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">{t("全部可访问组织")}</SelectItem>{state.organizations.map(org => <SelectItem key={org.id} value={org.id}>{org.displayName}{org.archivedAt ? t(" · 已归档") : ""}</SelectItem>)}</SelectContent></Select>
          <Button variant="ghost" size="icon" disabled={busy} aria-label={t("刷新数据")} onClick={() => void run(async () => {}, t("数据已刷新"))}><RefreshCw className={busy ? "size-4 animate-spin" : "size-4"} /></Button>
        </div>
      </header>
      <main className="@container/main flex flex-1 flex-col gap-6 p-4 md:p-6">{children}</main>
    </SidebarInset><Toaster richColors position="top-right" />
  </SidebarProvider>;
}
