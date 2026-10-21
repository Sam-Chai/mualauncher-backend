DO $install$
DECLARE ds text:=current_schema(); az text:=CASE WHEN current_schema()='public' THEN 'authz' ELSE current_schema()||'_authz' END;
BEGIN
-- Scoped management state can project this organization's public skin-site addresses.
-- Mapping writes and the global mapping API remain superadmin-only.
EXECUTE replace(replace($policy$
CREATE POLICY site_organization_read ON __data__."UnionSkinSite" FOR SELECT TO mua_web USING (
 __auth__.panel() AND EXISTS(SELECT 1 FROM __data__."OrganizationMember" m
 WHERE m."organizationId"="UnionSkinSite"."organizationId" AND m."accountId"=__auth__.actor_id() AND m.status='ACTIVE'));
$policy$,'__data__',quote_ident(ds)),'__auth__',quote_ident(az));
END $install$;
