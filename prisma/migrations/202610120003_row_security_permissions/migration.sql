-- Reduce repeated actor lookups per protected row without caching grants across statements.
DO $install$
DECLARE data_schema text := current_schema();
        security_schema text := CASE WHEN current_schema()='public' THEN 'authz' ELSE current_schema()||'_authz' END;
        statement text;
BEGIN
statement := $definitions$
CREATE OR REPLACE FUNCTION "__auth__".org_permission(org_id uuid, permission text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, "__data__", "__auth__", pg_temp
AS $$ SELECT "__auth__".token_allows($2) AND EXISTS(SELECT 1 FROM "__data__"."Account" a
 WHERE a.id="__auth__".actor_id() AND a.status='ACTIVE' AND (a."isSuperAdmin" OR EXISTS(
 SELECT 1 FROM "__data__"."OrganizationMember" m JOIN "__auth__".role_permission p ON p.role=ANY(m.roles::text[]) AND p.permission=$2
 WHERE m."organizationId"=$1 AND m."accountId"=a.id AND m.status='ACTIVE'))) $$;
CREATE OR REPLACE FUNCTION "__auth__".server_permission(server_id text, permission text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, "__data__", "__auth__", pg_temp
AS $$ SELECT "__auth__".maintenance() OR "__auth__".token_allows($2,$1) AND EXISTS(SELECT 1 FROM "__data__"."Account" a
 WHERE a.id="__auth__".actor_id() AND a.status='ACTIVE' AND (a."isSuperAdmin" OR EXISTS(
 SELECT 1 FROM "__data__"."Server" s JOIN "__data__"."OrganizationMember" m ON m."organizationId"=s."organizationId"
 LEFT JOIN "__data__"."ServerGrant" g ON g."serverId"=s."serverId" AND g."accountId"=m."accountId"
 JOIN "__auth__".role_permission p ON p.role=ANY(m.roles::text[]||coalesce(g.roles::text[],ARRAY[]::text[])) AND p.permission=$2
 WHERE s."serverId"=$1 AND m."accountId"=a.id AND m.status='ACTIVE'))) $$;
$definitions$;
EXECUTE replace(replace(statement,'__data__',replace(data_schema,'"','""')),'__auth__',replace(security_schema,'"','""'));
END $install$;
