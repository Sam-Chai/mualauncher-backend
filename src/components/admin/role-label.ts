import type { State } from "./provider";
import { translator, type Translate } from "@/lib/i18n";

export function roleLabel(state: Pick<State, "actor" | "organizations">, t: Translate = translator("zh-CN")) {
  if (state.actor.isSuperAdmin) return t("members.muaSuperadmin");
  const managedOrganizations = state.organizations.filter(org => org.permissions.includes("ORG_EDIT"));
  if (managedOrganizations.length === 1) return t("auth.roles.organizationAdministrator", { "organization": managedOrganizations[0].displayName });
  if (managedOrganizations.length > 1) return t("auth.roles.multipleOrganizationAdministrator", { "count": managedOrganizations.length });
  return t("members.organizationMember");
}
