import type { Permission } from "@/lib/roles";
import type { State } from "./provider";

type NavigationState = Pick<State, "actor" | "organizations">;

export function visiblePaths(state: NavigationState) {
  const superAdmin = state.actor.isSuperAdmin;
  const organizationPermission = (permission: Permission) => superAdmin ||
    state.organizations.some(organization => organization.permissions.includes(permission));
  const serverPermission = (permission: Permission) => superAdmin ||
    state.organizations.some(organization => organization.permissions.includes(permission) || organization.servers.some(server => server.permissions.includes(permission)));
  const canSee = {
    "/admin": true,
    "/admin/api": true,
    "/admin/organizations": organizationPermission("ORG_EDIT"),
    "/admin/members": organizationPermission("ORG_MEMBERS_READ"),
    "/admin/access": organizationPermission("ORG_MEMBERS_MANAGE"),
    "/admin/permissions": organizationPermission("ORG_MEMBERS_READ"),
    "/admin/servers": serverPermission("SERVER_READ"),
    "/admin/clients": serverPermission("DRAFT_READ") || serverPermission("RELEASE_READ"),
    "/admin/releases/review": serverPermission("DRAFT_REVIEW") || serverPermission("RELEASE_PUBLISH"),
    "/admin/releases/published": serverPermission("RELEASE_READ"),
    "/admin/releases/archived": serverPermission("RELEASE_READ"),
    "/admin/system/workers": superAdmin,
    "/admin/system/storage": superAdmin,
    "/admin/system/signing-keys": superAdmin,
    "/admin/system/audit": superAdmin,
    "/admin/system/settings": true,
  };
  return new Set(Object.entries(canSee).filter(([, allowed]) => allowed).map(([href]) => href));
}

export function visibleNavigation<TItem extends { href: string }>(groups: readonly { title: string; items: readonly TItem[] }[], state: NavigationState) {
  const paths = visiblePaths(state);
  return groups.map(group => ({ ...group, items: group.items.filter(item => paths.has(item.href)) }))
    .filter(group => group.items.length > 0);
}
