"use client";
import { useI18n } from "@/components/preferences";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import type { getState, getClients } from "@/lib/management";
import { AUTH_CHANGE_KEY, navigateAfterAuthChange } from "@/lib/auth-navigation";
export type State = Awaited<ReturnType<typeof getState>>;
export type Organization = State["organizations"][number];
export type Server = Organization["servers"][number];
export type ClientData = Awaited<ReturnType<typeof getClients>>;
export type Account = State["accounts"][number];
export class RequestError extends Error { constructor(message: string, public status: number) { super(message); } }
export async function api<T = { ok: boolean; id?: string }>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(path, { method, cache: "no-store",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new RequestError(result.error ?? "请求失败", response.status);
  return result;
}
type Context = {
  state: State; organizationId: string; setOrganizationId: (id: string) => void;
  organizations: Organization[]; servers: Server[]; busy: boolean; epoch: number;
  run: (work: () => Promise<unknown>, message?: string, refresh?: boolean) => Promise<boolean>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};
const AdminContext = createContext<Context | null>(null);
export function AdminProvider({ initial, children }: { initial: State; children: ReactNode }) {
  const { t } = useI18n();
  const [state, setState] = useState(initial);
  const [organizationId, setOrganizationId] = useState("all");
  const [busy, setBusy] = useState(false);
  const [epoch, setEpoch] = useState(0);
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === AUTH_CHANGE_KEY) window.location.reload();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const organizations = state.organizations.filter(org => organizationId === "all" || org.id === organizationId);
  async function refresh() { setState(await api<State>("/api/admin/state")); setEpoch(value => value + 1); }
  async function run(work: () => Promise<unknown>, message = t("已保存"), refresh = true) {
    setBusy(true);
    try {
      await work();
      if (refresh) { setState(await api<State>("/api/admin/state")); setEpoch(value => value + 1); }
      if (message) toast.success(message);
      return true;
    } catch (error) {
      if (error instanceof RequestError && error.status === 401) navigateAfterAuthChange("/login");
      toast.error(error instanceof Error ? t(error.message) : t("操作失败"));
      return false;
    } finally { setBusy(false); }
  }
  async function logout() {
    await run(async () => { await api("/api/auth/logout", "POST", {}); navigateAfterAuthChange("/login"); }, "", false);
  }
  return <AdminContext.Provider value={{ state, organizationId, setOrganizationId, organizations,
    servers: organizations.flatMap(org => org.servers), busy, epoch, run, logout, refresh }}>{children}</AdminContext.Provider>;
}
export function useAdmin() {
  const value = useContext(AdminContext);
  if (!value) throw new Error("AdminProvider is required");
  return value;
}
export const formatDate = (value: unknown) => new Date(String(value)).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
