"use client";
import { useState } from "react";
import { UserPlus } from "lucide-react";
import { z } from "zod";
import { useI18n } from "@/components/preferences";
import { Button } from "@/components/ui/button";
import { api, useAdmin, type Account, type Organization } from "./provider";
import { EditorDialog, SchemaForm } from "./form";
import { AccountIdentity } from "./account-identity";

export function AddOrganizationMember({ org }: { org: Organization }) {
  const { t } = useI18n();
  const { state, busy, run } = useAdmin();
  const [candidates, setCandidates] = useState<Account[] | null>(null);
  if (!state.actor.isSuperAdmin && !org.permissions.includes("ORG_MEMBERS_MANAGE")) return null;
  const disabled = busy || !!org.archivedAt;
  return <EditorDialog title={t("organizationMemberAdd.addMember")} disabled={disabled}
    trigger={<Button size="sm" disabled={disabled} className="bg-black text-white hover:bg-black/90 dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary/90"><UserPlus className="size-3.5" />{t("organizationMemberAdd.addMember")}</Button>}
    description={`${org.displayName} · ${t("organizationMemberAdd.searchExistingAllowlistedAccountsAddThemToTheOrganization")}`}>
    {close => <div className="space-y-4"><SchemaForm schema={z.object({ query: z.string().trim().min(3, t("organizationMemberAdd.enterAtLeast3Characters")).max(64) })} fields={[{ name: "query", label: t("organizationMemberAdd.usernameOrDisplayName") }]} defaults={{ query: "" }} disabled={disabled} label={t("organizationMemberAdd.searchAccounts")}
      onSubmit={values => run(async () => { setCandidates(await api<Account[]>(`/api/admin/organizations/${org.id}/account-search?q=${encodeURIComponent(String(values.query))}`)); }, "", false)} />
      {candidates?.length === 0 && <p className="text-sm text-muted-foreground">{t("organizationMemberAdd.noMatchingActiveAccounts")}</p>}
      {candidates?.map(account => <div key={account.id} className="flex items-center justify-between gap-3 rounded-lg border p-3"><div className="text-sm"><p className="font-medium">{account.displayName}</p><AccountIdentity {...account} /></div><Button size="sm" disabled={disabled || (!state.actor.isSuperAdmin && account.isSuperAdmin) || org.members.some(member => member.account.id === account.id)} onClick={async () => { if (await run(() => api(`/api/admin/organizations/${org.id}/members/${account.id}`, "PUT", { roles: ["PLAYER"], status: "ACTIVE" }), t("organizationMemberAdd.addedToOrganizationAssignRolesNext"))) { setCandidates(null); close(); } }}>{org.members.some(member => member.account.id === account.id) ? t("organizationMemberAdd.joined") : t("organizationMemberAdd.joinOrganization")}</Button></div>)}</div>}
  </EditorDialog>;
}
