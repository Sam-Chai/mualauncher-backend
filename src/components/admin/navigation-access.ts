import type { Permission } from "@/lib/roles";
import type { State } from "./provider";

type NavigationState = Pick<State, "actor" | "organizations">;

export function visiblePaths(state: NavigationState) {
  const superAdmin = state.actor.isSuperAdmin;
  const organizationPermission = (permission: Permission) => superAdmin ||
    state.organizations.some(organization => organization.permissions.includes(permission));
  const serverPermission = (permission: Permission) => superAdmin ||
    state.organizations.some(organization => organization.servers.some(server => server.permissions.includes(permission)));
  const canSee = {
    "/admin": true,
    "/admin/organizations": organizationPermission("ORG_EDIT"),
    "/admin/members": organizationPermission("ORG_MEMBERS_READ"),
    "/admin/permissions": organizationPermission("ORG_MEMBERS_READ"),
    "/admin/servers": serverPermission("SERVER_READ"),
    "/admin/listings": superAdmin,
    "/admin/servers/status": serverPermission("SERVER_READ"),
    "/admin/clients": serverPermission("DRAFT_READ") || serverPermission("RELEASE_READ"),
    "/admin/clients/releases": serverPermission("RELEASE_READ"),
    "/admin/clients/artifacts": serverPermission("DRAFT_CREATE") || serverPermission("DRAFT_EDIT"),
    "/admin/clients/runtime": serverPermission("DRAFT_EDIT"),
    "/admin/news": superAdmin,
    "/admin/events": superAdmin,
    "/admin/launcher-ui": superAdmin,
    "/admin/releases/review": serverPermission("DRAFT_REVIEW"),
    "/admin/releases/published": serverPermission("RELEASE_READ"),
    "/admin/releases/revoked": serverPermission("RELEASE_READ"),
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
