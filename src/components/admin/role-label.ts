import type { State } from "./provider";

export function roleLabel(state: Pick<State, "actor" | "organizations">) {
  if (state.actor.isSuperAdmin) return "MUA 超级管理员";
  const managedOrganizations = state.organizations.filter(org => org.permissions.includes("ORG_EDIT"));
  if (managedOrganizations.length === 1) return `${managedOrganizations[0].displayName} · 组织管理员`;
  if (managedOrganizations.length > 1) return `${managedOrganizations.length} 个组织 · 管理员`;
  return "组织成员";
}
