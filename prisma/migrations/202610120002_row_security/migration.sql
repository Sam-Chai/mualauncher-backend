-- Roles are provisioned separately; no passwords or cluster-wide role creation in migrations.
DO $install$
DECLARE data_schema text := current_schema();
        security_schema text := CASE WHEN current_schema() = 'public' THEN 'authz' ELSE current_schema() || '_authz' END;
        statement text;
        table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['mua_owner','mua_migrator','mua_web','mua_auth','mua_public','mua_worker','mua_lookup'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = table_name) THEN
      RAISE EXCEPTION 'Provision database roles before deploying RLS: missing %', table_name;
    END IF;
  END LOOP;
  EXECUTE format('CREATE SCHEMA %I AUTHORIZATION mua_owner', security_schema);
  EXECUTE format('REVOKE CREATE ON SCHEMA %I FROM PUBLIC', data_schema);
  EXECUTE format('GRANT USAGE ON SCHEMA %I, %I TO mua_web,mua_auth,mua_worker,mua_lookup,mua_public,mua_owner', data_schema, security_schema);
  EXECUTE format('GRANT CREATE ON SCHEMA %I,%I TO mua_lookup',data_schema,security_schema);
  statement := $definitions$
CREATE TABLE "__auth__".role_permission (role text NOT NULL, permission text NOT NULL, PRIMARY KEY(role,permission));
ALTER TABLE "__auth__".role_permission OWNER TO mua_owner;
-- Generated from src/lib/roles.ts; tested against that source on every RLS regression.
INSERT INTO "__auth__".role_permission
SELECT role, unnest(permissions) FROM (VALUES
 ('ORG_ADMIN',ARRAY['SERVER_READ','SERVER_EDIT','DRAFT_READ','DRAFT_CREATE','DRAFT_EDIT','DRAFT_SUBMIT','DRAFT_ARCHIVE','RELEASE_READ','ORG_EDIT','ORG_MEMBERS_READ','ORG_MEMBERS_MANAGE','CLIENT_ARCHIVE','CLIENT_DELETE','CLIENT_BIND']),
 ('SERVER_ADMIN',ARRAY['SERVER_READ','SERVER_EDIT','DRAFT_READ','DRAFT_CREATE','DRAFT_EDIT','DRAFT_SUBMIT','DRAFT_ARCHIVE','RELEASE_READ','CLIENT_ARCHIVE','CLIENT_DELETE','CLIENT_BIND']),
 ('CLIENT_EDITOR',ARRAY['SERVER_READ','DRAFT_READ','DRAFT_CREATE','DRAFT_EDIT','DRAFT_SUBMIT','DRAFT_ARCHIVE','RELEASE_READ']),
 ('SERVER_EDITOR',ARRAY['SERVER_READ','SERVER_EDIT']),
 ('REVIEWER',ARRAY['SERVER_READ','DRAFT_READ','RELEASE_READ','DRAFT_REVIEW']),
 ('PUBLISHER',ARRAY['SERVER_READ','DRAFT_READ','RELEASE_READ','RELEASE_PUBLISH']),
 ('RELEASE_OPERATOR',ARRAY['SERVER_READ','RELEASE_READ','RELEASE_ACTIVATE']),
 ('READ_ONLY',ARRAY['SERVER_READ','DRAFT_READ','RELEASE_READ'])
) AS mapping(role,permissions);
GRANT SELECT ON "__auth__".role_permission TO mua_lookup,mua_web,mua_auth,mua_public,mua_worker;

CREATE FUNCTION "__auth__".actor_id() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('mua.account_id',true),'')::uuid $$;
CREATE FUNCTION "__auth__".panel() RETURNS boolean LANGUAGE sql STABLE
AS $$ SELECT coalesce(current_setting('mua.auth_kind',true)='session',false) $$;
CREATE FUNCTION "__auth__".maintenance() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, "__data__", "__auth__", pg_temp
AS $$ SELECT session_user='mua_migrator' OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname=session_user AND rolsuper) $$;
CREATE FUNCTION "__auth__".active_actor() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, "__data__", "__auth__", pg_temp
AS $$ SELECT EXISTS(SELECT 1 FROM "__data__"."Account" WHERE id="__auth__".actor_id() AND status='ACTIVE') $$;
CREATE FUNCTION "__auth__".super_actor() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, "__data__", "__auth__", pg_temp
AS $$ SELECT EXISTS(SELECT 1 FROM "__data__"."Account" WHERE id="__auth__".actor_id() AND status='ACTIVE' AND "isSuperAdmin") $$;
CREATE FUNCTION "__auth__".super_panel() RETURNS boolean LANGUAGE sql STABLE
AS $$ SELECT "__auth__".super_actor() AND "__auth__".panel() $$;
CREATE FUNCTION "__auth__".token_allows(permission text, server_id text DEFAULT NULL) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, "__data__", "__auth__", pg_temp
AS $$ SELECT CASE WHEN "__auth__".panel() THEN true ELSE EXISTS (
 SELECT 1 FROM "__data__"."ApiToken" t WHERE t.id=nullif(current_setting('mua.api_token_id',true),'')::uuid
 AND t."accountId"="__auth__".actor_id() AND t."revokedAt" IS NULL AND t."expiresAt">now()
 AND permission=ANY(t.permissions) AND (cardinality(t."serverIds")=0 OR server_id=ANY(t."serverIds"))
) END $$;
CREATE FUNCTION "__auth__".org_permission(org_id uuid, permission text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, "__data__", "__auth__", pg_temp
AS $$ SELECT "__auth__".active_actor() AND "__auth__".token_allows(permission) AND (
 "__auth__".super_actor() OR EXISTS(SELECT 1 FROM "__data__"."OrganizationMember" m
 JOIN "__auth__".role_permission p ON p.role=ANY(m.roles::text[]) AND p.permission=$2
 WHERE m."organizationId"=$1 AND m."accountId"="__auth__".actor_id() AND m.status='ACTIVE')) $$;
CREATE FUNCTION "__auth__".org_visible(org_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, "__data__", "__auth__", pg_temp
AS $$ SELECT "__auth__".maintenance() OR "__auth__".active_actor() AND (
 "__auth__".super_actor() OR EXISTS(SELECT 1 FROM "__data__"."OrganizationMember"
 WHERE "organizationId"=$1 AND "accountId"="__auth__".actor_id() AND status='ACTIVE'))
 AND ("__auth__".panel() OR EXISTS(SELECT 1 FROM "__data__"."Server" s WHERE s."organizationId"=$1 AND "__auth__".token_allows('SERVER_READ',s."serverId"))) $$;
CREATE FUNCTION "__auth__".server_permission(server_id text, permission text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, "__data__", "__auth__", pg_temp
AS $$ SELECT "__auth__".maintenance() OR "__auth__".active_actor() AND "__auth__".token_allows($2,$1) AND (
 "__auth__".super_actor() OR EXISTS(SELECT 1 FROM "__data__"."Server" s
 JOIN "__data__"."OrganizationMember" m ON m."organizationId"=s."organizationId"
 LEFT JOIN "__data__"."ServerGrant" g ON g."serverId"=s."serverId" AND g."accountId"=m."accountId"
 JOIN "__auth__".role_permission p ON p.role=ANY(m.roles::text[] || coalesce(g.roles::text[],ARRAY[]::text[])) AND p.permission=$2
 WHERE s."serverId"=$1 AND m."accountId"="__auth__".actor_id() AND m.status='ACTIVE')) $$;
CREATE FUNCTION "__auth__".client_permission(client_id text, permission text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, "__data__", "__auth__", pg_temp
AS $$ SELECT "__auth__".maintenance() OR EXISTS(SELECT 1 FROM "__data__"."Client" c
 LEFT JOIN "__data__"."ServerPublication" b ON b."clientId"=c.id
 WHERE c.id=$1 AND c."deletedAt" IS NULL AND CASE WHEN coalesce(b."serverId",c."scopeServerId") IS NOT NULL
 THEN "__auth__".server_permission(coalesce(b."serverId",c."scopeServerId"),$2)
 ELSE "__auth__".org_permission(c."organizationId",$2) END) $$;
CREATE FUNCTION "__auth__".draft_client(draft_id uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, "__data__", "__auth__", pg_temp
AS $$ SELECT "clientId" FROM "__data__"."ClientDraft" WHERE id=$1 $$;
-- Use NEW row values: a SQL function cannot look up an INSERT RETURNING row in its older snapshot.
CREATE FUNCTION "__auth__".client_row_permission(client_id text, org_id uuid, scope_id text, deleted_at timestamptz, permission text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, "__data__", "__auth__", pg_temp
AS $$ SELECT $4 IS NULL AND CASE WHEN coalesce((SELECT "serverId" FROM "__data__"."ServerPublication" WHERE "clientId"=$1),$3) IS NOT NULL
 THEN "__auth__".server_permission(coalesce((SELECT "serverId" FROM "__data__"."ServerPublication" WHERE "clientId"=$1),$3),$5)
 ELSE "__auth__".org_permission($2,$5) END $$;
CREATE FUNCTION "__auth__".client_write(client_id text, permissions text[]) RETURNS boolean LANGUAGE sql STABLE
AS $$ SELECT EXISTS(SELECT 1 FROM unnest($2) p WHERE "__auth__".client_permission($1,p)) $$;
CREATE FUNCTION "__auth__".directory_reader() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, "__data__", "__auth__", pg_temp
AS $$ SELECT "__auth__".maintenance() OR "__auth__".super_panel() OR EXISTS(
 SELECT 1 FROM "__data__"."OrganizationMember" m WHERE m."accountId"="__auth__".actor_id()
 AND m.status='ACTIVE' AND "__auth__".org_permission(m."organizationId",'ORG_MEMBERS_READ')) $$;

CREATE FUNCTION "__auth__".session_actor(hash text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, "__data__", "__auth__", pg_temp
AS $$ SELECT jsonb_build_object('id',a.id,'displayName',a."displayName",'isSuperAdmin',a."isSuperAdmin",'username',c.username)
 FROM "__data__"."Session" s JOIN "__data__"."Account" a ON a.id=s."accountId"
 LEFT JOIN "__data__"."LocalCredential" c ON c."accountId"=a.id
 WHERE s."tokenHash"=$1 AND s."expiresAt">now() AND a.status='ACTIVE' $$;
CREATE FUNCTION "__auth__".api_actor(hash text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, "__data__", "__auth__", pg_temp
AS $$ SELECT jsonb_build_object('id',a.id,'displayName',a."displayName",'isSuperAdmin',a."isSuperAdmin",
 'apiScope',jsonb_build_object('tokenId',t.id,'permissions',t.permissions,'serverIds',t."serverIds"))
 FROM "__data__"."ApiToken" t JOIN "__data__"."Account" a ON a.id=t."accountId"
 WHERE t."tokenHash"=$1 AND t."revokedAt" IS NULL AND t."expiresAt">now() AND a.status='ACTIVE' $$;
CREATE FUNCTION "__auth__".account_directory() RETURNS TABLE(id uuid,"displayName" text,status "__data__"."AccountStatus","isSuperAdmin" boolean,username text,"createdAt" timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, "__data__", "__auth__", pg_temp
AS $$ SELECT a.id,a."displayName",a.status,a."isSuperAdmin",c.username::text,a."createdAt"
 FROM "__data__"."Account" a LEFT JOIN "__data__"."LocalCredential" c ON c."accountId"=a.id
 WHERE "__auth__".directory_reader() AND (a.status='ACTIVE' OR "__auth__".super_panel() OR "__auth__".maintenance()
 OR EXISTS(SELECT 1 FROM "__data__"."OrganizationMember" m WHERE m."accountId"=a.id AND "__auth__".org_permission(m."organizationId",'ORG_MEMBERS_READ'))) $$;
CREATE FUNCTION "__auth__".server_summary(server_id text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, "__data__", "__auth__", pg_temp
AS $$ SELECT jsonb_build_object('currentReleaseActive',r.id IS NOT NULL AND r."archivedAt" IS NULL)
 FROM "__data__"."ServerPublication" b LEFT JOIN "__data__"."ClientRelease" r ON r.id=b."releaseId"
 WHERE b."serverId"=$1 AND "__auth__".server_permission($1,'SERVER_READ') $$;
CREATE FUNCTION "__auth__".client_summary(client_id text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, "__data__", "__auth__", pg_temp
AS $$ SELECT jsonb_build_object('initialPackageFormatVersion',(SELECT r."packageFormatVersion" FROM "__data__"."ClientRelease" r WHERE r."clientId"=$1 ORDER BY r."publishedAt",r.id LIMIT 1),
 'processingPackages',(SELECT count(*) FROM "__data__"."PackageBuild" b JOIN "__data__"."ClientDraft" d ON d.id=b."draftId" WHERE d."clientId"=$1 AND b.status='PROCESSING'))
 WHERE "__auth__".client_permission($1,'SERVER_READ') $$;
CREATE FUNCTION "__auth__".upload_options() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, "__data__", "__auth__", pg_temp
AS $$ SELECT jsonb_build_object('enabledPackageFormats',coalesce((SELECT "enabledPackageFormats" FROM "__data__"."PlatformSettings" WHERE id='platform'),ARRAY[1,2]),
 'maxUploadSizeMb',coalesce((SELECT "maxUploadSizeMb" FROM "__data__"."PlatformSettings" WHERE id='platform'),1024),
 'javaImageType',coalesce((SELECT "javaImageType" FROM "__data__"."PlatformSettings" WHERE id='platform'),'jre'))
 WHERE "__auth__".active_actor() OR "__auth__".maintenance() OR session_user='mua_worker' $$;
CREATE FUNCTION "__auth__".release_details(release_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, "__data__", "__auth__", pg_temp
AS $$ SELECT jsonb_build_object('supportedPlatforms',d."supportedPlatforms",'packageRevision',d."packageRevision",
 'upload',(SELECT jsonb_build_object('statistics',u.statistics,'comparisonStatistics',u."comparisonStatistics") FROM "__data__"."ClientUpload" u WHERE u."draftId"=d.id),
 'packageBuilds',coalesce((SELECT jsonb_agg(jsonb_build_object('draftId',p."draftId",'platform',p.platform,'revision',p.revision,'status',p.status,'required',p.required,'artifacts',p.artifacts) ORDER BY p.platform)
 FROM "__data__"."PackageBuild" p WHERE p."draftId"=d.id AND p.required),'[]'::jsonb))
 FROM "__data__"."ClientRelease" r JOIN "__data__"."ClientDraft" d ON d.id=r."sourceDraftId"
 WHERE r.id=$1 AND "__auth__".client_permission(r."clientId",'RELEASE_READ') $$;

-- These mutations preserve the caller's transaction and the existing advisory lock.
CREATE FUNCTION "__auth__".create_credential(account_id uuid, username text, password_hash text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, "__data__", "__auth__", pg_temp AS $$ BEGIN
 IF NOT ("__auth__".maintenance() OR "__auth__".super_panel()) THEN RAISE insufficient_privilege; END IF;
 INSERT INTO "__data__"."LocalCredential"("accountId",username,"passwordHash","updatedAt") VALUES($1,$2,$3,now());
END $$;
CREATE FUNCTION "__auth__".set_password(account_id uuid, password_hash text, expected_hash text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, "__data__", "__auth__", pg_temp AS $$ BEGIN
 IF NOT ("__auth__".maintenance() OR "__auth__".super_panel() OR "__auth__".panel() AND $1="__auth__".actor_id() AND $3 IS NOT NULL) THEN RAISE insufficient_privilege; END IF;
 UPDATE "__data__"."LocalCredential" SET "passwordHash"=$2,"updatedAt"=now() WHERE "accountId"=$1 AND ($3 IS NULL OR "passwordHash"=$3);
 IF NOT FOUND THEN RAISE EXCEPTION 'Password changed concurrently' USING ERRCODE='40001'; END IF;
END $$;
CREATE FUNCTION "__auth__".revoke_sessions(account_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, "__data__", "__auth__", pg_temp AS $$ BEGIN
 IF NOT ("__auth__".maintenance() OR "__auth__".super_panel() OR "__auth__".panel() AND $1="__auth__".actor_id()) THEN RAISE insufficient_privilege; END IF;
 DELETE FROM "__data__"."Session" WHERE "accountId"=$1;
END $$;
CREATE FUNCTION "__auth__".delete_client(client_id text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, "__data__", "__auth__", pg_temp AS $$ BEGIN
 IF NOT "__auth__".client_permission($1,'CLIENT_DELETE') THEN RAISE insufficient_privilege; END IF;
 UPDATE "__data__"."Client" SET "deletedAt"=now(),"updatedAt"=now() WHERE id=$1;
END $$;
CREATE FUNCTION "__auth__".archive_binding(client_id text, server_id text, account_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, "__data__", "__auth__", pg_temp AS $$ BEGIN
 IF NOT ("__auth__".maintenance() OR $3="__auth__".actor_id()) OR NOT "__auth__".client_permission($1,'CLIENT_ARCHIVE') OR NOT EXISTS(SELECT 1 FROM "__data__"."Client" c
 JOIN "__data__"."ServerPublication" b ON b."clientId"=c.id WHERE c.id=$1 AND c."archivedAt" IS NOT NULL AND b."serverId"=$2) THEN RAISE insufficient_privilege; END IF;
 UPDATE "__data__"."ServerPublication" SET "clientId"=NULL,"releaseId"=NULL,revision=revision+1,"changedById"=$3,"updatedAt"=now() WHERE "serverId"=$2;
 UPDATE "__data__"."Server" SET "isListed"=false,"updatedAt"=now() WHERE "serverId"=$2;
END $$;

-- Public functions expose only distribution facts for an online, listed binding.
CREATE FUNCTION "__auth__".public_servers() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, "__data__", "__auth__", pg_temp AS $$
SELECT coalesce(jsonb_agg(jsonb_build_object('serverId',s."serverId",'displayName',s."displayName",'description',s.description,
 'gameAddress',s."gameAddress",'themeColor',s."themeColor",'sortOrder',s."sortOrder",'organization',jsonb_build_object('id',o.id,'displayName',o."displayName"),
 'publicationRevision',b.revision,'currentRelease',jsonb_build_object('id',r.id,'clientId',r."clientId",'versionLabel',r."versionLabel",'name',r.name,
 'manifestSha256',r."manifestSha256",'packageFormatVersion',r."packageFormatVersion",'manifestUrl','/api/v1/servers/'||s."serverId"||'/manifest','packagesUrl','/api/v1/servers/'||s."serverId"||'/packages')) ORDER BY s."sortOrder",s."serverId"),'[]'::jsonb)
 FROM "__data__"."Server" s JOIN "__data__"."Organization" o ON o.id=s."organizationId"
 JOIN "__data__"."ServerPublication" b ON b."serverId"=s."serverId" JOIN "__data__"."Client" c ON c.id=b."clientId"
 JOIN "__data__"."ClientRelease" r ON r.id=b."releaseId"
 WHERE s."isListed" AND s."archivedAt" IS NULL AND o."archivedAt" IS NULL AND c."archivedAt" IS NULL AND c."deletedAt" IS NULL AND r."archivedAt" IS NULL $$;
CREATE FUNCTION "__auth__".public_snapshot(server_id text, release_id uuid DEFAULT NULL) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, "__data__", "__auth__", pg_temp AS $$
WITH binding AS (
 SELECT s."organizationId",b."clientId",b."releaseId" FROM "__data__"."Server" s
 JOIN "__data__"."Organization" o ON o.id=s."organizationId" JOIN "__data__"."ServerPublication" b ON b."serverId"=s."serverId"
 JOIN "__data__"."Client" c ON c.id=b."clientId" JOIN "__data__"."ClientRelease" r ON r.id=b."releaseId"
 WHERE s."serverId"=$1 AND s."isListed" AND s."archivedAt" IS NULL AND o."archivedAt" IS NULL AND c."archivedAt" IS NULL AND c."deletedAt" IS NULL AND r."archivedAt" IS NULL
), target AS (
 SELECT r.* FROM "__data__"."ClientRelease" r JOIN binding b ON r."clientId"=b."clientId" WHERE r.id=coalesce($2,b."releaseId") AND r."archivedAt" IS NULL
), releases AS (
 SELECT r.* FROM "__data__"."ClientRelease" r JOIN binding b ON r."clientId"=b."clientId"
 WHERE r.id=b."releaseId" OR r.id IN(SELECT id FROM target) OR r.id IN(
 SELECT u."baseReleaseId" FROM "__data__"."ClientUpload" u JOIN target t ON t."sourceDraftId"=u."draftId")
), builds AS (
 SELECT p.* FROM "__data__"."PackageBuild" p JOIN releases r ON r."sourceDraftId"=p."draftId" WHERE p.required AND p.status='READY'
)
SELECT jsonb_build_object('server',jsonb_build_object('organizationId',b."organizationId",'publication',jsonb_build_object('release',
 (SELECT jsonb_build_object('id',r.id,'clientId',r."clientId",'sourceDraftId',r."sourceDraftId",'versionLabel',r."versionLabel",'packageFormatVersion',r."packageFormatVersion",'manifestObjectKey',r."manifestObjectKey",'manifestSha256',r."manifestSha256",'signingKeyId',r."signingKeyId",'signature',r.signature,'archivedAt',r."archivedAt") FROM releases r WHERE r.id=b."releaseId"))),
 'releases',coalesce((SELECT jsonb_agg(jsonb_build_object('id',r.id,'clientId',r."clientId",'sourceDraftId',r."sourceDraftId",'versionLabel',r."versionLabel",'packageFormatVersion',r."packageFormatVersion",'manifestObjectKey',r."manifestObjectKey",'manifestSha256',r."manifestSha256",'signingKeyId',r."signingKeyId",'signature',r.signature,'archivedAt',r."archivedAt")) FROM releases r),'[]'),
 'builds',coalesce((SELECT jsonb_agg(jsonb_build_object('draftId',p."draftId",'platform',p.platform,'revision',p.revision,'required',p.required,'status',p.status,'targetSha256',p."targetSha256",'targetObjectKey',p."targetObjectKey",'artifacts',p.artifacts)) FROM builds p),'[]'),
 'drafts',coalesce((SELECT jsonb_agg(jsonb_build_object('id',d.id,'packageRevision',d."packageRevision")) FROM "__data__"."ClientDraft" d JOIN releases r ON r."sourceDraftId"=d.id),'[]'),
 'uploads',coalesce((SELECT jsonb_agg(jsonb_build_object('draftId',u."draftId",'baseReleaseId',u."baseReleaseId")) FROM "__data__"."ClientUpload" u JOIN target t ON t."sourceDraftId"=u."draftId"),'[]')) FROM binding b $$;
$definitions$;
  EXECUTE replace(replace(statement,'__data__',replace(data_schema,'"','""')),'__auth__',replace(security_schema,'"','""'));

  -- Every policy expression uses fixed, schema-qualified helpers.
  FOREACH table_name IN ARRAY ARRAY['Account','LocalCredential','Session','LoginThrottle','ApiToken','Organization','OrganizationMember','Server','ServerGrant','ServerPublication','Client','ClientDraft','ClientRelease','ClientUpload','PackageBuild','AuditEvent','CasObject','CasReference','RecycleObject','WorkerHeartbeat','PlatformSettings'] LOOP
    EXECUTE format('ALTER TABLE %I.%I OWNER TO mua_owner',data_schema,table_name);
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY',data_schema,table_name);
    EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY',data_schema,table_name);
    EXECUTE format('REVOKE ALL ON %I.%I FROM PUBLIC',data_schema,table_name);
    EXECUTE format('CREATE POLICY maintenance ON %I.%I TO mua_owner USING(true) WITH CHECK(true)',data_schema,table_name);
    EXECUTE format('CREATE POLICY lookup_read ON %I.%I FOR SELECT TO mua_lookup USING(true)',data_schema,table_name);
  END LOOP;
  EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO mua_lookup',data_schema);
  -- Integrity triggers lock referenced rows. Permit the locks, never actual helper UPDATEs.
  FOREACH table_name IN ARRAY ARRAY['Client','ClientDraft','ClientUpload','PackageBuild'] LOOP
    EXECUTE format('GRANT UPDATE(id) ON %I.%I TO mua_lookup',data_schema,table_name);
    EXECUTE format('CREATE POLICY lookup_lock ON %I.%I FOR UPDATE TO mua_lookup USING(true) WITH CHECK(false)',data_schema,table_name);
  END LOOP;
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I."LocalCredential",%I."Session",%I."LoginThrottle" TO mua_auth',data_schema,data_schema,data_schema);
  EXECUTE format('GRANT SELECT ON %I."Account" TO mua_auth',data_schema);
  EXECUTE format('GRANT INSERT ON %I."AuditEvent" TO mua_auth',data_schema);
  FOREACH table_name IN ARRAY ARRAY['LocalCredential','Session','LoginThrottle','Account'] LOOP
    EXECUTE format('CREATE POLICY authentication ON %I.%I TO mua_auth USING(true) WITH CHECK(true)',data_schema,table_name);
  END LOOP;
  EXECUTE format('CREATE POLICY authentication_audit ON %I."AuditEvent" FOR INSERT TO mua_auth WITH CHECK(action=''AUTH_LOGIN'')',data_schema);

  FOREACH table_name IN ARRAY ARRAY['Organization','OrganizationMember','Server','ServerGrant','ServerPublication','Client','ClientDraft','ClientRelease','ClientUpload','PackageBuild','AuditEvent','CasObject','CasReference','RecycleObject','WorkerHeartbeat','PlatformSettings','Account'] LOOP
    EXECUTE format('GRANT SELECT ON %I.%I TO mua_worker',data_schema,table_name);
    EXECUTE format('CREATE POLICY worker_read ON %I.%I FOR SELECT TO mua_worker USING(true)',data_schema,table_name);
  END LOOP;
  FOREACH table_name IN ARRAY ARRAY['ClientUpload','PackageBuild','CasObject','CasReference','RecycleObject','WorkerHeartbeat'] LOOP
    EXECUTE format('GRANT INSERT,UPDATE ON %I.%I TO mua_worker',data_schema,table_name);
    EXECUTE format('CREATE POLICY worker_work ON %I.%I TO mua_worker USING(true) WITH CHECK(true)',data_schema,table_name);
  END LOOP;
  EXECUTE format('GRANT UPDATE("storageIndexedAt","recycledAt","updatedAt") ON %I."Client" TO mua_worker',data_schema);
  EXECUTE format('CREATE POLICY worker_index ON %I."Client" FOR UPDATE TO mua_worker USING(true) WITH CHECK(true)',data_schema);
  EXECUTE format('GRANT UPDATE("candidateManifestKey","candidateManifestSha256","updatedAt") ON %I."ClientDraft" TO mua_worker',data_schema);
  EXECUTE format('CREATE POLICY worker_manifest ON %I."ClientDraft" FOR UPDATE TO mua_worker USING(true) WITH CHECK(true)',data_schema);
  EXECUTE format('GRANT INSERT ON %I."AuditEvent" TO mua_worker',data_schema);
  EXECUTE format('CREATE POLICY worker_audit ON %I."AuditEvent" FOR INSERT TO mua_worker WITH CHECK(true)',data_schema);

  statement := $policies$
GRANT SELECT,INSERT,UPDATE ON "__data__"."Account","__data__"."ApiToken","__data__"."Organization","__data__"."OrganizationMember","__data__"."Server","__data__"."ServerGrant","__data__"."ServerPublication","__data__"."Client","__data__"."ClientDraft","__data__"."ClientRelease","__data__"."ClientUpload","__data__"."PackageBuild","__data__"."PlatformSettings" TO mua_web;
GRANT SELECT,INSERT ON "__data__"."AuditEvent" TO mua_web;
GRANT SELECT ON "__data__"."WorkerHeartbeat" TO mua_web;
CREATE POLICY web_account_read ON "__data__"."Account" FOR SELECT TO mua_web USING(id="__auth__".actor_id() OR "__auth__".directory_reader());
CREATE POLICY web_account_write ON "__data__"."Account" TO mua_web USING("__auth__".super_panel()) WITH CHECK("__auth__".super_panel());
CREATE POLICY web_token ON "__data__"."ApiToken" TO mua_web USING("__auth__".panel() AND "accountId"="__auth__".actor_id() AND "__auth__".active_actor()) WITH CHECK("__auth__".panel() AND "accountId"="__auth__".actor_id() AND "__auth__".active_actor());
CREATE POLICY web_org_read ON "__data__"."Organization" FOR SELECT TO mua_web USING("__auth__".org_visible(id));
CREATE POLICY web_org_write ON "__data__"."Organization" TO mua_web USING("__auth__".org_permission(id,'ORG_EDIT')) WITH CHECK("__auth__".super_panel() OR "__auth__".org_permission(id,'ORG_EDIT'));
CREATE POLICY web_member_read ON "__data__"."OrganizationMember" FOR SELECT TO mua_web USING("accountId"="__auth__".actor_id() OR "__auth__".org_permission("organizationId",'ORG_MEMBERS_READ'));
CREATE POLICY web_member_write ON "__data__"."OrganizationMember" TO mua_web USING("__auth__".org_permission("organizationId",'ORG_MEMBERS_MANAGE')) WITH CHECK("__auth__".org_permission("organizationId",'ORG_MEMBERS_MANAGE'));
CREATE POLICY web_grant_read ON "__data__"."ServerGrant" FOR SELECT TO mua_web USING("accountId"="__auth__".actor_id() OR "__auth__".org_permission("organizationId",'ORG_MEMBERS_READ'));
CREATE POLICY web_grant_write ON "__data__"."ServerGrant" TO mua_web USING("__auth__".org_permission("organizationId",'ORG_MEMBERS_MANAGE')) WITH CHECK("__auth__".org_permission("organizationId",'ORG_MEMBERS_MANAGE'));
CREATE POLICY web_server_read ON "__data__"."Server" FOR SELECT TO mua_web USING("__auth__".server_permission("serverId",'SERVER_READ'));
CREATE POLICY web_server_write ON "__data__"."Server" TO mua_web USING("__auth__".server_permission("serverId",'SERVER_EDIT')) WITH CHECK("__auth__".super_panel() OR "__auth__".server_permission("serverId",'SERVER_EDIT'));
CREATE POLICY web_publication_read ON "__data__"."ServerPublication" FOR SELECT TO mua_web USING("__auth__".server_permission("serverId",'SERVER_READ'));
CREATE POLICY web_publication_write ON "__data__"."ServerPublication" TO mua_web USING("__auth__".server_permission("serverId",'CLIENT_BIND') OR "__auth__".server_permission("serverId",'RELEASE_ACTIVATE')) WITH CHECK("__auth__".super_panel() OR "__auth__".server_permission("serverId",'CLIENT_BIND') OR "__auth__".server_permission("serverId",'RELEASE_ACTIVATE'));
CREATE POLICY web_client_read ON "__data__"."Client" FOR SELECT TO mua_web USING("__auth__".client_row_permission(id,"organizationId","scopeServerId","deletedAt",'SERVER_READ'));
CREATE POLICY web_client_insert ON "__data__"."Client" FOR INSERT TO mua_web WITH CHECK("__auth__".super_panel() OR CASE WHEN "scopeServerId" IS NULL THEN "__auth__".org_permission("organizationId",'DRAFT_CREATE') ELSE "__auth__".server_permission("scopeServerId",'DRAFT_CREATE') END);
CREATE POLICY web_client_update ON "__data__"."Client" FOR UPDATE TO mua_web USING("__auth__".client_write(id,ARRAY['DRAFT_CREATE','DRAFT_EDIT','CLIENT_ARCHIVE','CLIENT_BIND','RELEASE_ACTIVATE'])) WITH CHECK("__auth__".client_write(id,ARRAY['DRAFT_CREATE','DRAFT_EDIT','CLIENT_ARCHIVE','CLIENT_BIND','RELEASE_ACTIVATE']));
CREATE POLICY web_draft_read ON "__data__"."ClientDraft" FOR SELECT TO mua_web USING("__auth__".client_permission("clientId",'DRAFT_READ'));
CREATE POLICY web_draft_insert ON "__data__"."ClientDraft" FOR INSERT TO mua_web WITH CHECK("__auth__".client_permission("clientId",'DRAFT_CREATE'));
CREATE POLICY web_draft_update ON "__data__"."ClientDraft" FOR UPDATE TO mua_web USING("__auth__".client_write("clientId",ARRAY['DRAFT_EDIT','DRAFT_SUBMIT','DRAFT_REVIEW','DRAFT_ARCHIVE','RELEASE_PUBLISH'])) WITH CHECK("__auth__".client_write("clientId",ARRAY['DRAFT_EDIT','DRAFT_SUBMIT','DRAFT_REVIEW','DRAFT_ARCHIVE','RELEASE_PUBLISH']));
CREATE POLICY web_release_read ON "__data__"."ClientRelease" FOR SELECT TO mua_web USING("__auth__".client_permission("clientId",'RELEASE_READ'));
CREATE POLICY web_release_insert ON "__data__"."ClientRelease" FOR INSERT TO mua_web WITH CHECK("__auth__".client_permission("clientId",'RELEASE_PUBLISH'));
CREATE POLICY web_release_update ON "__data__"."ClientRelease" FOR UPDATE TO mua_web USING("__auth__".super_panel()) WITH CHECK("__auth__".super_panel());
CREATE POLICY web_upload_read ON "__data__"."ClientUpload" FOR SELECT TO mua_web USING("__auth__".client_permission("clientId",'DRAFT_READ'));
CREATE POLICY web_upload_write ON "__data__"."ClientUpload" TO mua_web USING("__auth__".client_write("clientId",ARRAY['DRAFT_CREATE','DRAFT_EDIT','DRAFT_ARCHIVE','CLIENT_DELETE']) AND ("createdById"="__auth__".actor_id() OR "__auth__".super_actor() OR "__auth__".client_permission("clientId",'CLIENT_DELETE'))) WITH CHECK("__auth__".client_write("clientId",ARRAY['DRAFT_CREATE','DRAFT_EDIT','DRAFT_ARCHIVE','CLIENT_DELETE']) AND ("createdById"="__auth__".actor_id() OR "__auth__".super_actor() OR "__auth__".client_permission("clientId",'CLIENT_DELETE')));
CREATE POLICY web_build_read ON "__data__"."PackageBuild" FOR SELECT TO mua_web USING("__auth__".client_permission("__auth__".draft_client("draftId"),'DRAFT_READ'));
CREATE POLICY web_build_write ON "__data__"."PackageBuild" TO mua_web USING("__auth__".client_write("__auth__".draft_client("draftId"),ARRAY['DRAFT_EDIT','DRAFT_REVIEW','DRAFT_ARCHIVE','RELEASE_PUBLISH'])) WITH CHECK("__auth__".client_write("__auth__".draft_client("draftId"),ARRAY['DRAFT_CREATE','DRAFT_EDIT','DRAFT_REVIEW','DRAFT_ARCHIVE','RELEASE_PUBLISH']));
CREATE POLICY web_settings_read ON "__data__"."PlatformSettings" FOR SELECT TO mua_web USING("__auth__".super_panel());
CREATE POLICY web_settings_write ON "__data__"."PlatformSettings" TO mua_web USING("__auth__".super_panel()) WITH CHECK("__auth__".super_panel());
CREATE POLICY web_audit_read ON "__data__"."AuditEvent" FOR SELECT TO mua_web USING("__auth__".super_panel());
-- Identity remains pinned for audit after a valid self-disable or password change.
CREATE POLICY web_audit_insert ON "__data__"."AuditEvent" FOR INSERT TO mua_web WITH CHECK("actorId"="__auth__".actor_id());
CREATE POLICY web_heartbeat_read ON "__data__"."WorkerHeartbeat" FOR SELECT TO mua_web USING("__auth__".super_panel());
$policies$;
  EXECUTE replace(replace(statement,'__data__',replace(data_schema,'"','""')),'__auth__',replace(security_schema,'"','""'));
  EXECUTE format('GRANT USAGE ON ALL SEQUENCES IN SCHEMA %I TO mua_web,mua_worker,mua_owner',data_schema);

  -- Function ownership, fixed paths and grants are installed atomically.
  FOR statement IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=security_schema LOOP
    EXECUTE 'ALTER FUNCTION '||statement||' OWNER TO mua_lookup';
    EXECUTE 'REVOKE ALL ON FUNCTION '||statement||' FROM PUBLIC';
    EXECUTE 'GRANT EXECUTE ON FUNCTION '||statement||' TO mua_web,mua_worker,mua_owner';
  END LOOP;
  FOREACH statement IN ARRAY ARRAY['create_credential(uuid,text,text)','set_password(uuid,text,text)','revoke_sessions(uuid)','delete_client(text)','archive_binding(text,text,uuid)'] LOOP
    EXECUTE format('ALTER FUNCTION %I.%s OWNER TO mua_owner',security_schema,statement);
    EXECUTE format('REVOKE ALL ON FUNCTION %I.%s FROM mua_worker',security_schema,statement);
  END LOOP;
  FOREACH statement IN ARRAY ARRAY['public_servers()','public_snapshot(text,uuid)'] LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.%s TO mua_public',security_schema,statement);
  END LOOP;
  -- Integrity checks must see referenced rows, including rows outside caller policies.
  FOR statement IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=data_schema AND p.prorettype='trigger'::regtype LOOP
    EXECUTE 'ALTER FUNCTION '||statement||' OWNER TO mua_lookup';
    EXECUTE 'ALTER FUNCTION '||statement||' SECURITY DEFINER';
    EXECUTE format('ALTER FUNCTION %s SET search_path=pg_catalog,%I,%I,pg_temp',statement,data_schema,security_schema);
    EXECUTE 'REVOKE ALL ON FUNCTION '||statement||' FROM PUBLIC';
  END LOOP;
END $install$;
