-- The PLAYER enum value must be committed by migration 005 before it is used here.
DO $install$
DECLARE ds text:=current_schema(); az text:=CASE WHEN current_schema()='public' THEN 'authz' ELSE current_schema()||'_authz' END; f text;
BEGIN
EXECUTE replace(replace($ddl$
CREATE OR REPLACE FUNCTION __auth__.can_manage(account_id UUID) RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,__data__,__auth__,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM "Account" a WHERE a.id=$1 AND a.status='ACTIVE' AND (a."isSuperAdmin" OR EXISTS(
 SELECT 1 FROM "OrganizationMember" m JOIN "Organization" o ON o.id=m."organizationId" WHERE m."accountId"=a.id AND m.status='ACTIVE' AND o."archivedAt" IS NULL
 AND (EXISTS(SELECT 1 FROM role_permission p WHERE p.role=ANY(m.roles::text[])) OR EXISTS(
 SELECT 1 FROM "ServerGrant" g JOIN role_permission p ON p.role=ANY(g.roles::text[]) WHERE g."accountId"=a.id AND g."organizationId"=m."organizationId"))))) $$;

CREATE OR REPLACE FUNCTION __auth__.session_actor(hash text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,__data__,__auth__,pg_temp AS $$
 SELECT jsonb_build_object('id',a.id,'displayName',a."displayName",'isSuperAdmin',a."isSuperAdmin",'username',c.username,'unionSubject',i.subject,'sessionKind',s.kind,'canManage',__auth__.can_manage(a.id))
 FROM "Session" s JOIN "Account" a ON a.id=s."accountId" LEFT JOIN "LocalCredential" c ON c."accountId"=a.id LEFT JOIN "UnionIdentity" i ON i."accountId"=a.id
 WHERE s."tokenHash"=$1 AND s."expiresAt">now() AND a.status='ACTIVE' $$;

ALTER TABLE __data__."OrganizationMember" ALTER COLUMN roles SET DEFAULT ARRAY['PLAYER']::__data__."Role"[];
UPDATE __data__."OrganizationMember" SET roles=ARRAY['PLAYER']::__data__."Role"[],"updatedAt"=clock_timestamp() WHERE cardinality(roles)=0;

-- Reuse the existing directory's authorization/filtering. No credentials or OAuth tokens are exposed.
CREATE FUNCTION __auth__.account_identity_directory() RETURNS TABLE(id uuid,"displayName" text,status __data__."AccountStatus","isSuperAdmin" boolean,username text,"createdAt" timestamptz,"unionSubject" text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,__data__,__auth__,pg_temp AS $$
 SELECT d.*,i.subject FROM __auth__.account_directory() d LEFT JOIN __data__."UnionIdentity" i ON i."accountId"=d.id $$;
ALTER FUNCTION __auth__.account_identity_directory() OWNER TO mua_owner;
REVOKE ALL ON FUNCTION __auth__.account_identity_directory() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION __auth__.account_identity_directory() TO mua_web,mua_owner;
$ddl$,'__data__',quote_ident(ds)),'__auth__',quote_ident(az));
SELECT pg_get_functiondef(p.oid) INTO f FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=az AND p.proname='union_login';
-- Preserve all existing login validation, identity mapping, stop flags and audit handling.
IF position('ARRAY[]::' IN f)=0 THEN RAISE EXCEPTION 'Unexpected union_login definition'; END IF;
EXECUTE replace(f,'ARRAY[]::','ARRAY[''PLAYER'']::');
END $install$;
