"use client";
import { useI18n } from "@/components/preferences";
import { PreferenceControls } from "@/components/preferences";
import Link from "next/link";
import { PROJECT_NAME } from "@/lib/branding";
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
import { useEffect, useRef, type ReactNode } from "react";
function AppSidebar() {
  const { t } = useI18n();
  const pathname = usePathname();
  const current = currentNavigation(pathname);
  const { state, busy, logout } = useAdmin();
  const { isMobile, setOpenMobile } = useSidebar();
  return <Sidebar variant="inset" collapsible="icon">
    <SidebarHeader><SidebarMenu><SidebarMenuItem><SidebarMenuButton size="lg" asChild>
      <Link href="/admin" onClick={() => setOpenMobile(false)}><div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground"><Hexagon className="size-5" /></div>
        <div className="grid flex-1 text-left text-sm leading-tight"><span className="truncate font-semibold">{PROJECT_NAME}</span><span className="truncate text-xs opacity-75">{t("shell.universityAllianceManagement")}</span></div></Link>
    </SidebarMenuButton></SidebarMenuItem></SidebarMenu></SidebarHeader>
    <SidebarContent>{visibleNavigation(navigation, state).map(group => <SidebarGroup key={group.title || "overview"}>
      {group.title && <SidebarGroupLabel>{t(group.title)}</SidebarGroupLabel>}
      <SidebarGroupContent><SidebarMenu>{group.items.map(item => <SidebarMenuItem key={item.href}>
        <SidebarMenuButton asChild isActive={current.href === item.href} tooltip={t(item.title)}>
          <Link href={item.href} aria-current={current.href === item.href ? "page" : undefined} onClick={() => setOpenMobile(false)}><item.icon /><span>{t(item.title)}</span></Link>
        </SidebarMenuButton></SidebarMenuItem>)}</SidebarMenu></SidebarGroupContent>
    </SidebarGroup>)}</SidebarContent>
    <SidebarFooter><SidebarMenu><SidebarMenuItem><DropdownMenu>
      <DropdownMenuTrigger asChild><SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground">
        <Avatar className="size-8 rounded-lg"><AvatarFallback className="rounded-lg">{state.actor.displayName.slice(0, 2)}</AvatarFallback></Avatar>
        <div className="grid flex-1 text-left text-sm"><span className="truncate font-medium">{state.actor.displayName}</span><span data-slot="sidebar-user-role" className="truncate text-xs opacity-75">{roleLabel(state, t)}</span></div><ChevronsUpDown className="ml-auto size-4" />
      </SidebarMenuButton></DropdownMenuTrigger>
      <DropdownMenuContent side={isMobile ? "bottom" : "right"} align="end" className="w-56">
        <DropdownMenuLabel>{state.actor.unionSubject ? `Union · ${state.actor.unionSubject}` : state.actor.username ? `@${state.actor.username}` : t("members.allowlistedAccount")}</DropdownMenuLabel><DropdownMenuSeparator />
        <DropdownMenuItem asChild><Link href="/admin/system/settings"><Settings />{t("shell.accountSettings")}</Link></DropdownMenuItem>
        <DropdownMenuItem disabled={busy} onSelect={() => void logout()}><LogOut />{t("shell.signOut")}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu></SidebarMenuItem></SidebarMenu></SidebarFooter>
  </Sidebar>;
}
export function AdminShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const current = currentNavigation(pathname);
  const embeddedPage = current.href === "/admin/api";
  const contentRef = useRef<HTMLElement>(null);
  useEffect(() => { contentRef.current?.scrollTo(0, 0); }, [pathname]);
  const { state, organizationId, setOrganizationId, busy, run } = useAdmin();
  // Only admin-content scrolls. Unlike hidden, clip prevents focus and
  // scrollIntoView (including route navigation) from scrolling away the header.
  return <SidebarProvider className="h-svh overflow-clip" style={{ "--sidebar-width": "16rem", "--header-height": "3.5rem" } as React.CSSProperties}>
    <AppSidebar /><SidebarInset className="m-2 min-h-0 min-w-0 gap-2 overflow-clip rounded-xl bg-transparent">
      <header data-slot="admin-header" className="z-20 flex h-14 shrink-0 items-center gap-2 rounded-xl border bg-background/70 px-4 backdrop-blur-xl dark:text-foreground lg:px-6">
        <SidebarTrigger className="-ml-1" /><Separator orientation="vertical" className="mx-2 data-[orientation=vertical]:h-4" />
        <Breadcrumb className="hidden min-w-0 sm:block"><BreadcrumbList><BreadcrumbItem className="hidden sm:block"><BreadcrumbLink asChild><Link href="/admin">{current.group ? t(current.group) : PROJECT_NAME}</Link></BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator className="hidden sm:block" /><BreadcrumbItem><BreadcrumbPage>{t(current.title)}</BreadcrumbPage></BreadcrumbItem></BreadcrumbList></Breadcrumb>
        <div className="ml-auto flex items-center gap-2">
          <PreferenceControls />
          <Select value={organizationId} onValueChange={setOrganizationId}><SelectTrigger className="w-32 sm:w-44" aria-label={t("shell.filterOrganization")}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">{t("dashboard.allAccessibleOrganizations")}</SelectItem>{state.organizations.map(org => <SelectItem key={org.id} value={org.id}>{org.displayName}{org.archivedAt ? t("shell.archived") : ""}</SelectItem>)}</SelectContent></Select>
          <Button variant="ghost" size="icon" disabled={busy} aria-label={t("shell.refreshData")} onClick={() => void run(async () => {}, t("shell.dataRefreshed"))}><RefreshCw className={busy ? "size-4 animate-spin" : "size-4"} /></Button>
        </div>
      </header>
      <div data-slot="admin-content-panel" className="flex min-h-0 flex-1 overflow-clip rounded-xl bg-background p-1">
        <main ref={contentRef} data-slot="admin-content" className={`@container/main flex min-h-0 min-w-0 flex-1 flex-col gap-6 rounded-lg p-3 md:p-5${embeddedPage ? " overflow-hidden" : " overflow-y-auto overscroll-contain [scrollbar-gutter:stable]"}`}>{children}</main>
      </div>
    </SidebarInset><Toaster richColors position="top-right" />
  </SidebarProvider>;
}
