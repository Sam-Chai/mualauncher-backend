import type { Role } from "@/generated/prisma/client";
export type Permission = "ORG_EDIT" | "ORG_MEMBERS_READ" | "ORG_MEMBERS_MANAGE" | "SERVER_READ" | "SERVER_EDIT" | "CLIENT_ARCHIVE" | "CLIENT_DELETE" | "CLIENT_BIND" |
  "DRAFT_READ" | "DRAFT_CREATE" | "DRAFT_EDIT" | "DRAFT_SUBMIT" | "DRAFT_ARCHIVE" | "RELEASE_READ" | "DRAFT_REVIEW" | "RELEASE_PUBLISH" | "RELEASE_ACTIVATE";
const base: Permission[] = ["SERVER_READ", "SERVER_EDIT", "DRAFT_READ", "DRAFT_CREATE", "DRAFT_EDIT", "DRAFT_SUBMIT", "DRAFT_ARCHIVE", "RELEASE_READ"];
export const rolePermissions: Record<Role, readonly Permission[]> = {
  PLAYER: [],
  ORG_ADMIN: [...base, "ORG_EDIT", "ORG_MEMBERS_READ", "ORG_MEMBERS_MANAGE", "CLIENT_ARCHIVE", "CLIENT_DELETE", "CLIENT_BIND"],
  SERVER_ADMIN: [...base, "CLIENT_ARCHIVE", "CLIENT_DELETE", "CLIENT_BIND"],
  CLIENT_EDITOR: base.filter(permission => permission !== "SERVER_EDIT"),
  SERVER_EDITOR: ["SERVER_READ", "SERVER_EDIT"],
  REVIEWER: ["SERVER_READ", "DRAFT_READ", "RELEASE_READ", "DRAFT_REVIEW"],
  PUBLISHER: ["SERVER_READ", "DRAFT_READ", "RELEASE_READ", "RELEASE_PUBLISH"],
  RELEASE_OPERATOR: ["SERVER_READ", "RELEASE_READ", "RELEASE_ACTIVATE"],
  READ_ONLY: ["SERVER_READ", "DRAFT_READ", "RELEASE_READ"],
};
export const reservedRoles: readonly Role[] = ["ORG_ADMIN", "REVIEWER", "PUBLISHER", "RELEASE_OPERATOR"];
export const roleLabels: Record<Role, string> = {
  PLAYER: "roles.player",
  ORG_ADMIN: "roles.organizationAdministrator", SERVER_ADMIN: "roles.serverAdministrator", CLIENT_EDITOR: "roles.clientEditor", SERVER_EDITOR: "roles.serverEditor",
  REVIEWER: "roles.reviewer", PUBLISHER: "roles.publisher", RELEASE_OPERATOR: "roles.releaseOperator", READ_ONLY: "roles.readOnlyMember",
};
