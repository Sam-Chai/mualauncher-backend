DO $install$
DECLARE data_schema text := current_schema(); security_schema text := CASE WHEN current_schema()='public' THEN 'authz' ELSE current_schema()||'_authz' END; t text;
BEGIN
EXECUTE replace(replace($definitions$
ALTER TABLE __data__."Session" ADD COLUMN kind TEXT NOT NULL DEFAULT 'WEB' CHECK (kind IN ('WEB','LAUNCHER'));
ALTER TABLE __data__."OrganizationMember" ALTER COLUMN "grantedById" DROP NOT NULL;
ALTER TABLE __data__."OrganizationMember" ADD COLUMN source TEXT NOT NULL DEFAULT 'MANUAL';
ALTER TABLE __data__."OrganizationMember" ADD CONSTRAINT member_source CHECK ((source='MANUAL' AND "grantedById" IS NOT NULL) OR source='UNION');
CREATE TABLE __data__."UnionSkinSite" (
 code VARCHAR(6) PRIMARY KEY CHECK (code ~ '^[A-Z]{1,6}$'), "organizationId" UUID NOT NULL REFERENCES __data__."Organization"(id),
 "bsRoot" TEXT NOT NULL, enabled BOOLEAN NOT NULL DEFAULT true, revision INTEGER NOT NULL DEFAULT 1, "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now());
CREATE INDEX ON __data__."UnionSkinSite"("organizationId");
CREATE TABLE __data__."UnionIdentity" (
 subject TEXT PRIMARY KEY, "accountId" UUID NOT NULL UNIQUE REFERENCES __data__."Account"(id),
 "siteCode" VARCHAR(6) NOT NULL REFERENCES __data__."UnionSkinSite"(code), "organizationId" UUID NOT NULL REFERENCES __data__."Organization"(id), "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now());
CREATE TABLE __data__."UnionOAuthAttempt" (
 "stateHash" CHAR(64) PRIMARY KEY, "browserHash" CHAR(64) NOT NULL, verifier TEXT NOT NULL, "returnTo" TEXT NOT NULL, "expiresAt" TIMESTAMPTZ(6) NOT NULL);
CREATE INDEX ON __data__."UnionOAuthAttempt"("expiresAt");
CREATE TABLE __data__."OrganizationAccessRequest" (
 id UUID PRIMARY KEY, "sourceOrganizationId" UUID NOT NULL REFERENCES __data__."Organization"(id), "targetOrganizationId" UUID NOT NULL REFERENCES __data__."Organization"(id),
 "accountId" UUID NOT NULL REFERENCES __data__."Account"(id), "createdById" UUID NOT NULL REFERENCES __data__."Account"(id), "serverIds" TEXT[] NOT NULL,
 "autoIncludeNewServers" BOOLEAN NOT NULL DEFAULT false, reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
 revision INTEGER NOT NULL DEFAULT 1, "reviewedById" UUID REFERENCES __data__."Account"(id), "reviewedAt" TIMESTAMPTZ(6), note TEXT NOT NULL DEFAULT '', "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
 CHECK ("sourceOrganizationId"<>"targetOrganizationId" AND cardinality("serverIds") BETWEEN 1 AND 1000));
CREATE INDEX ON __data__."OrganizationAccessRequest"("sourceOrganizationId",status,"createdAt");
CREATE INDEX ON __data__."OrganizationAccessRequest"("targetOrganizationId",status,"createdAt");
CREATE TABLE __data__."OrganizationAccessGrant" (
 id UUID PRIMARY KEY, "requestId" UUID NOT NULL UNIQUE REFERENCES __data__."OrganizationAccessRequest"(id),
 "sourceOrganizationId" UUID NOT NULL REFERENCES __data__."Organization"(id), "targetOrganizationId" UUID NOT NULL REFERENCES __data__."Organization"(id),
 "accountId" UUID NOT NULL REFERENCES __data__."Account"(id), "serverIds" TEXT[] NOT NULL, "autoIncludeNewServers" BOOLEAN NOT NULL,
 "approvedAt" TIMESTAMPTZ(6) NOT NULL, "revokedAt" TIMESTAMPTZ(6), "revokedById" UUID REFERENCES __data__."Account"(id), "revokeReason" TEXT,
 FOREIGN KEY ("sourceOrganizationId","accountId") REFERENCES __data__."OrganizationMember"("organizationId","accountId"));
CREATE INDEX ON __data__."OrganizationAccessGrant"("accountId","targetOrganizationId","revokedAt");
CREATE TABLE __data__."ServerMemberVisibility" (
 "serverId" VARCHAR(5) PRIMARY KEY REFERENCES __data__."Server"("serverId"), "organizationId" UUID NOT NULL REFERENCES __data__."Organization"(id), "firstVisibleAt" TIMESTAMPTZ(6) NOT NULL);
CREATE INDEX ON __data__."ServerMemberVisibility"("organizationId","firstVisibleAt");
CREATE TABLE __data__."LauncherLoginAttempt" (
 id UUID PRIMARY KEY, challenge CHAR(43) NOT NULL, "accountId" UUID REFERENCES __data__."Account"(id), "expiresAt" TIMESTAMPTZ(6) NOT NULL);
CREATE INDEX ON __data__."LauncherLoginAttempt"("expiresAt");

CREATE FUNCTION __auth__.can_manage(account_id UUID) RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,__data__,__auth__,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM "Account" a WHERE a.id=$1 AND a.status='ACTIVE' AND (a."isSuperAdmin" OR EXISTS(
 SELECT 1 FROM "OrganizationMember" m JOIN "Organization" o ON o.id=m."organizationId" WHERE m."accountId"=a.id AND m.status='ACTIVE' AND o."archivedAt" IS NULL
 AND (cardinality(m.roles)>0 OR EXISTS(SELECT 1 FROM "ServerGrant" g WHERE g."accountId"=a.id AND g."organizationId"=m."organizationId" AND cardinality(g.roles)>0))))) $$;
CREATE OR REPLACE FUNCTION __auth__.session_actor(hash text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,__data__,__auth__,pg_temp AS $$
 SELECT jsonb_build_object('id',a.id,'displayName',a."displayName",'isSuperAdmin',a."isSuperAdmin",'username',c.username,'sessionKind',s.kind,'canManage',__auth__.can_manage(a.id))
 FROM "Session" s JOIN "Account" a ON a.id=s."accountId" LEFT JOIN "LocalCredential" c ON c."accountId"=a.id
 WHERE s."tokenHash"=$1 AND s."expiresAt">now() AND a.status='ACTIVE' $$;
CREATE OR REPLACE FUNCTION __auth__.super_actor() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,__data__,__auth__,pg_temp AS $$
 SELECT coalesce(current_setting('mua.auth_kind',true),'')<>'launcher' AND EXISTS(SELECT 1 FROM "Account" WHERE id=__auth__.actor_id() AND status='ACTIVE' AND "isSuperAdmin") $$;

CREATE FUNCTION __auth__.access_admin(org UUID) RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,__data__,__auth__,pg_temp AS $$
 SELECT __auth__.panel() AND EXISTS(SELECT 1 FROM "Organization" o WHERE o.id=$1 AND o."archivedAt" IS NULL) AND
 (__auth__.super_panel() OR EXISTS(SELECT 1 FROM "OrganizationMember" m WHERE m."organizationId"=$1 AND m."accountId"=__auth__.actor_id() AND m.status='ACTIVE' AND 'ORG_ADMIN'=ANY(m.roles::text[]))) $$;

-- Keep the checked distribution resolver, remove every runtime grant to the anonymous helpers.
ALTER FUNCTION __auth__.public_servers() RENAME TO distribution_servers;
ALTER FUNCTION __auth__.public_snapshot(text,uuid) RENAME TO distribution_snapshot;
REVOKE ALL ON FUNCTION __auth__.distribution_servers(), __auth__.distribution_snapshot(text,uuid) FROM PUBLIC,mua_public,mua_web,mua_worker;

CREATE FUNCTION __auth__.sync_member_visibility() RETURNS void LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,__data__,__auth__,pg_temp AS $$ BEGIN
 PERFORM pg_advisory_xact_lock(731402,1);
 -- Future windows are scheduled facts. Cancel only facts that have not happened yet.
 DELETE FROM "ServerMemberVisibility" WHERE "firstVisibleAt">clock_timestamp();
 INSERT INTO "ServerMemberVisibility"("serverId","organizationId","firstVisibleAt")
 SELECT s."serverId",s."organizationId",CASE WHEN s."displayMode"='RANGE' THEN greatest(clock_timestamp(),s."displayStartsAt") ELSE clock_timestamp() END
 FROM "Server" s JOIN "Organization" o ON o.id=s."organizationId" JOIN "ServerPublication" b ON b."serverId"=s."serverId"
 JOIN "Client" c ON c.id=b."clientId" JOIN "ClientRelease" r ON r.id=b."releaseId"
 WHERE s."isListed" AND s."archivedAt" IS NULL AND o."archivedAt" IS NULL AND c."archivedAt" IS NULL AND c."deletedAt" IS NULL AND r."archivedAt" IS NULL
 AND (s."displayMode"='PERMANENT' OR s."displayEndsAt">clock_timestamp()) ON CONFLICT ("serverId") DO NOTHING;
 END $$;
CREATE FUNCTION __auth__.visibility_changed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,__data__,__auth__,pg_temp AS $$ BEGIN PERFORM __auth__.sync_member_visibility(); RETURN NULL; END $$;
CREATE TRIGGER member_visibility AFTER INSERT OR UPDATE ON __data__."Server" FOR EACH STATEMENT EXECUTE FUNCTION __auth__.visibility_changed();
CREATE TRIGGER member_visibility AFTER INSERT OR UPDATE ON __data__."ServerPublication" FOR EACH STATEMENT EXECUTE FUNCTION __auth__.visibility_changed();
CREATE TRIGGER member_visibility AFTER UPDATE ON __data__."Client" FOR EACH STATEMENT EXECUTE FUNCTION __auth__.visibility_changed();
CREATE TRIGGER member_visibility AFTER UPDATE ON __data__."ClientRelease" FOR EACH STATEMENT EXECUTE FUNCTION __auth__.visibility_changed();
CREATE TRIGGER member_visibility AFTER UPDATE ON __data__."Organization" FOR EACH STATEMENT EXECUTE FUNCTION __auth__.visibility_changed();

CREATE FUNCTION __auth__.member_server_access(sid TEXT) RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,__data__,__auth__,pg_temp AS $$
 SELECT __auth__.active_actor() AND coalesce(current_setting('mua.auth_kind',true),'') IN ('session','launcher') AND EXISTS(
 SELECT 1 FROM "Server" s JOIN "Organization" o ON o.id=s."organizationId" WHERE s."serverId"=$1 AND o."archivedAt" IS NULL AND (
 EXISTS(SELECT 1 FROM "OrganizationMember" m WHERE m."organizationId"=s."organizationId" AND m."accountId"=__auth__.actor_id() AND m.status='ACTIVE') OR EXISTS(
 SELECT 1 FROM "OrganizationAccessGrant" g JOIN "OrganizationMember" m ON m."organizationId"=g."sourceOrganizationId" AND m."accountId"=g."accountId"
 JOIN "Organization" origin ON origin.id=m."organizationId" LEFT JOIN "ServerMemberVisibility" v ON v."serverId"=s."serverId"
 WHERE g."accountId"=__auth__.actor_id() AND g."targetOrganizationId"=s."organizationId" AND g."revokedAt" IS NULL AND m.status='ACTIVE' AND origin."archivedAt" IS NULL
 AND (s."serverId"=ANY(g."serverIds") OR g."autoIncludeNewServers" AND v."firstVisibleAt">g."approvedAt")))) $$;
CREATE FUNCTION __auth__.member_servers() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,__data__,__auth__,pg_temp AS $$ SELECT coalesce(jsonb_agg(item),'[]'::jsonb) FROM jsonb_array_elements(__auth__.distribution_servers()) item
 WHERE __auth__.member_server_access(item->>'serverId') $$;
CREATE FUNCTION __auth__.member_snapshot(sid TEXT,rid UUID DEFAULT NULL) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,__data__,__auth__,pg_temp AS $$ SELECT __auth__.distribution_snapshot($1,$2) WHERE __auth__.member_server_access($1) $$;
CREATE FUNCTION __auth__.member_organizations() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,__data__,__auth__,pg_temp AS $$ SELECT coalesce(jsonb_agg(jsonb_build_object('id',o.id,'displayName',o."displayName")),'[]'::jsonb)
 FROM "OrganizationMember" m JOIN "Organization" o ON o.id=m."organizationId" WHERE m."accountId"=__auth__.actor_id() AND m.status='ACTIVE' AND o."archivedAt" IS NULL AND __auth__.active_actor() $$;
CREATE FUNCTION __auth__.access_candidates(source_org UUID,target_org UUID DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,__data__,__auth__,pg_temp AS $$ BEGIN
 IF NOT __auth__.access_admin(source_org) THEN RAISE insufficient_privilege; END IF;
 IF target_org IS NULL THEN RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'displayName',"displayName")),'[]') FROM "Organization" WHERE id<>source_org AND "archivedAt" IS NULL); END IF;
 RETURN (SELECT coalesce(jsonb_agg(item),'[]') FROM jsonb_array_elements(__auth__.distribution_servers()) item WHERE item->'organization'->>'id'=target_org::text);
 END $$;
CREATE FUNCTION __auth__.access_state() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,__data__,__auth__,pg_temp AS $$ SELECT jsonb_build_object('requests',coalesce((SELECT jsonb_agg(row) FROM (
 SELECT r.*,s."displayName" AS "sourceName",t."displayName" AS "targetName",a."displayName" AS "memberName" FROM "OrganizationAccessRequest" r
 JOIN "Organization" s ON s.id=r."sourceOrganizationId" JOIN "Organization" t ON t.id=r."targetOrganizationId" JOIN "Account" a ON a.id=r."accountId"
 WHERE __auth__.access_admin(r."sourceOrganizationId") OR __auth__.access_admin(r."targetOrganizationId") ORDER BY r."createdAt" DESC LIMIT 200) row),'[]'::jsonb),
 'grants',coalesce((SELECT jsonb_agg(row) FROM (SELECT g.*,s."displayName" AS "sourceName",t."displayName" AS "targetName",a."displayName" AS "memberName" FROM "OrganizationAccessGrant" g
 JOIN "Organization" s ON s.id=g."sourceOrganizationId" JOIN "Organization" t ON t.id=g."targetOrganizationId" JOIN "Account" a ON a.id=g."accountId"
 WHERE __auth__.access_admin(g."sourceOrganizationId") OR __auth__.access_admin(g."targetOrganizationId") ORDER BY g."approvedAt" DESC LIMIT 200) row),'[]'::jsonb)) $$;
CREATE FUNCTION __auth__.union_login(subject_value TEXT,display_name TEXT,session_hash TEXT,expiry TIMESTAMPTZ) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,__data__,__auth__,pg_temp AS $$
 DECLARE site "UnionSkinSite"; identity_row "UnionIdentity"; aid UUID; BEGIN
 PERFORM pg_advisory_xact_lock(731402,1);
 IF subject_value !~ '^[A-Z]{1,6}:[0-9]{1,20}$' OR session_hash !~ '^[0-9a-f]{64}$' OR length(display_name) NOT BETWEEN 1 AND 100 OR expiry>now()+interval '12 hours' OR expiry<=now() THEN RAISE insufficient_privilege; END IF;
 SELECT * INTO site FROM "UnionSkinSite" WHERE code=split_part(subject_value,':',1) AND enabled;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM "Organization" WHERE id=site."organizationId" AND "archivedAt" IS NULL) THEN RAISE EXCEPTION 'UNION_SITE_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 SELECT * INTO identity_row FROM "UnionIdentity" WHERE subject=subject_value;
 IF FOUND THEN
 aid:=identity_row."accountId";
 IF identity_row."organizationId"<>site."organizationId" OR NOT EXISTS(SELECT 1 FROM "Account" a JOIN "OrganizationMember" m ON m."accountId"=a.id
 WHERE a.id=aid AND a.status='ACTIVE' AND m."organizationId"=site."organizationId" AND m.status='ACTIVE') THEN RAISE insufficient_privilege; END IF;
 ELSE
 aid:=gen_random_uuid();
 INSERT INTO "Account"(id,"displayName",status,"isSuperAdmin","updatedAt") VALUES(aid,display_name,'ACTIVE',false,now());
 INSERT INTO "UnionIdentity"(subject,"accountId","siteCode","organizationId") VALUES(subject_value,aid,site.code,site."organizationId");
 INSERT INTO "OrganizationMember"("organizationId","accountId",status,roles,"grantedById",source,"updatedAt") VALUES(site."organizationId",aid,'ACTIVE',ARRAY[]::__data__."Role"[],NULL,'UNION',now());
 END IF;
 INSERT INTO "Session"("tokenHash","accountId","expiresAt") VALUES(session_hash,aid,expiry);
 INSERT INTO "AuditEvent"(id,"actorId",action,"targetType","targetId","organizationId",details) VALUES(gen_random_uuid(),aid,'AUTH_UNION_LOGIN','Account',aid::text,site."organizationId",jsonb_build_object('siteCode',site.code,'mappingRevision',site.revision));
 RETURN aid; END $$;

CREATE FUNCTION __auth__.access_submit(source_org UUID,target_org UUID,beneficiary UUID,servers TEXT[],auto_new BOOLEAN,reason_value TEXT) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,__data__,__auth__,pg_temp AS $$ DECLARE request_id UUID:=gen_random_uuid(); available TEXT[]; BEGIN
 PERFORM pg_advisory_xact_lock(731402,1);
 IF source_org=target_org OR NOT __auth__.access_admin(source_org) OR length(trim(reason_value)) NOT BETWEEN 1 AND 1000 OR cardinality(servers) NOT BETWEEN 1 AND 1000 THEN RAISE insufficient_privilege; END IF;
 IF NOT EXISTS(SELECT 1 FROM "OrganizationMember" m JOIN "Account" a ON a.id=m."accountId" WHERE m."organizationId"=source_org AND m."accountId"=beneficiary AND m.status='ACTIVE' AND a.status='ACTIVE') THEN RAISE insufficient_privilege; END IF;
 SELECT array_agg(item->>'serverId') INTO available FROM jsonb_array_elements(__auth__.distribution_servers()) item WHERE item->'organization'->>'id'=target_org::text;
 IF available IS NULL OR NOT servers<@available THEN RAISE EXCEPTION 'Resources changed' USING ERRCODE='40001'; END IF;
 INSERT INTO "OrganizationAccessRequest"(id,"sourceOrganizationId","targetOrganizationId","accountId","createdById","serverIds","autoIncludeNewServers",reason)
 VALUES(request_id,source_org,target_org,beneficiary,__auth__.actor_id(),ARRAY(SELECT DISTINCT unnest(servers)),auto_new,reason_value);
 INSERT INTO "AuditEvent"(id,"actorId",action,"targetType","targetId","organizationId",details) VALUES(gen_random_uuid(),__auth__.actor_id(),'ACCESS_REQUEST','OrganizationAccessRequest',request_id::text,source_org,jsonb_build_object('targetOrganizationId',target_org,'accountId',beneficiary,'serverIds',servers,'autoIncludeNewServers',auto_new));
 RETURN request_id; END $$;
CREATE FUNCTION __auth__.access_decide(request_id UUID,expected_revision INTEGER,decision TEXT,note_value TEXT) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,__data__,__auth__,pg_temp AS $$ DECLARE r "OrganizationAccessRequest"; available TEXT[]; BEGIN
 PERFORM pg_advisory_xact_lock(731402,1);
 SELECT * INTO r FROM "OrganizationAccessRequest" WHERE id=request_id FOR UPDATE;
 IF NOT FOUND OR NOT (CASE WHEN decision='CANCELLED' THEN __auth__.access_admin(r."sourceOrganizationId") ELSE __auth__.access_admin(r."targetOrganizationId") END) THEN RAISE insufficient_privilege; END IF;
 IF r.status<>'PENDING' OR r.revision<>expected_revision THEN RAISE EXCEPTION 'Request changed' USING ERRCODE='40001'; END IF;
 IF decision NOT IN ('APPROVED','REJECTED','CANCELLED') OR length(note_value)>1000 THEN RAISE insufficient_privilege; END IF;
 IF decision='APPROVED' THEN
 IF NOT EXISTS(SELECT 1 FROM "OrganizationMember" m JOIN "Account" a ON a.id=m."accountId" JOIN "Organization" o ON o.id=m."organizationId"
 WHERE m."organizationId"=r."sourceOrganizationId" AND m."accountId"=r."accountId" AND m.status='ACTIVE' AND a.status='ACTIVE' AND o."archivedAt" IS NULL) THEN RAISE EXCEPTION 'Member changed' USING ERRCODE='40001'; END IF;
 SELECT array_agg(item->>'serverId') INTO available FROM jsonb_array_elements(__auth__.distribution_servers()) item WHERE item->'organization'->>'id'=r."targetOrganizationId"::text;
 IF available IS NULL OR NOT r."serverIds"<@available THEN RAISE EXCEPTION 'Resources changed' USING ERRCODE='40001'; END IF;
 PERFORM __auth__.sync_member_visibility();
 INSERT INTO "OrganizationAccessGrant"(id,"requestId","sourceOrganizationId","targetOrganizationId","accountId","serverIds","autoIncludeNewServers","approvedAt")
 VALUES(gen_random_uuid(),r.id,r."sourceOrganizationId",r."targetOrganizationId",r."accountId",r."serverIds",r."autoIncludeNewServers",clock_timestamp());
 END IF;
 UPDATE "OrganizationAccessRequest" SET status=decision,revision=revision+1,"reviewedById"=__auth__.actor_id(),"reviewedAt"=clock_timestamp(),note=note_value WHERE id=request_id;
 INSERT INTO "AuditEvent"(id,"actorId",action,"targetType","targetId","organizationId",details) VALUES(gen_random_uuid(),__auth__.actor_id(),'ACCESS_'||decision,'OrganizationAccessRequest',request_id::text,r."targetOrganizationId",jsonb_build_object('revision',expected_revision,'note',note_value));
 END $$;
CREATE FUNCTION __auth__.access_revoke(grant_id UUID,reason_value TEXT) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,__data__,__auth__,pg_temp AS $$ DECLARE g "OrganizationAccessGrant"; BEGIN
 PERFORM pg_advisory_xact_lock(731402,1); SELECT * INTO g FROM "OrganizationAccessGrant" WHERE id=grant_id FOR UPDATE;
 IF NOT FOUND OR NOT (__auth__.access_admin(g."sourceOrganizationId") OR __auth__.access_admin(g."targetOrganizationId")) OR length(trim(reason_value)) NOT BETWEEN 1 AND 1000 THEN RAISE insufficient_privilege; END IF;
 IF g."revokedAt" IS NOT NULL THEN RETURN; END IF;
 UPDATE "OrganizationAccessGrant" SET "revokedAt"=clock_timestamp(),"revokedById"=__auth__.actor_id(),"revokeReason"=reason_value WHERE id=grant_id;
 INSERT INTO "AuditEvent"(id,"actorId",action,"targetType","targetId","organizationId",details) VALUES(gen_random_uuid(),__auth__.actor_id(),'ACCESS_REVOKED','OrganizationAccessGrant',grant_id::text,g."targetOrganizationId",jsonb_build_object('reason',reason_value));
 END $$;

-- Upgrade-time conservative baseline: do not label existing historical releases as future additions.
INSERT INTO __data__."ServerMemberVisibility"("serverId","organizationId","firstVisibleAt") SELECT s."serverId",s."organizationId",now() FROM __data__."Server" s
 WHERE EXISTS(SELECT 1 FROM __data__."Client" c JOIN __data__."ClientRelease" r ON r."clientId"=c.id WHERE c."scopeServerId"=s."serverId") ON CONFLICT DO NOTHING;
$definitions$,'__data__',quote_ident(data_schema)),'__auth__',quote_ident(security_schema));

FOREACH t IN ARRAY ARRAY['UnionSkinSite','UnionIdentity','UnionOAuthAttempt','OrganizationAccessRequest','OrganizationAccessGrant','ServerMemberVisibility','LauncherLoginAttempt'] LOOP
 EXECUTE format('ALTER TABLE %I.%I OWNER TO mua_owner',data_schema,t);
 EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY',data_schema,t);
 EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY',data_schema,t);
 EXECUTE format('CREATE POLICY maintenance ON %I.%I TO mua_owner USING(true) WITH CHECK(true)',data_schema,t);
 EXECUTE format('CREATE POLICY lookup_read ON %I.%I FOR SELECT TO mua_lookup USING(true)',data_schema,t);
 EXECUTE format('GRANT SELECT ON %I.%I TO mua_lookup',data_schema,t);
END LOOP;
EXECUTE replace(replace($policies$
CREATE POLICY mapping_web ON __data__."UnionSkinSite" TO mua_web USING(__auth__.super_panel()) WITH CHECK(__auth__.super_panel());
GRANT SELECT,INSERT,UPDATE ON __data__."UnionSkinSite" TO mua_web;
CREATE POLICY identity_web ON __data__."UnionIdentity" FOR SELECT TO mua_web USING("accountId"=__auth__.actor_id() OR __auth__.super_panel());
GRANT SELECT ON __data__."UnionIdentity" TO mua_web;
CREATE POLICY oauth_auth ON __data__."UnionOAuthAttempt" TO mua_auth USING(true) WITH CHECK(true);
CREATE POLICY launcher_auth ON __data__."LauncherLoginAttempt" TO mua_auth USING(true) WITH CHECK(true);
GRANT SELECT,INSERT,UPDATE,DELETE ON __data__."UnionOAuthAttempt",__data__."LauncherLoginAttempt" TO mua_auth;
CREATE POLICY request_web ON __data__."OrganizationAccessRequest" FOR SELECT TO mua_web USING(__auth__.access_admin("sourceOrganizationId") OR __auth__.access_admin("targetOrganizationId"));
CREATE POLICY grant_web ON __data__."OrganizationAccessGrant" FOR SELECT TO mua_web USING(__auth__.access_admin("sourceOrganizationId") OR __auth__.access_admin("targetOrganizationId"));
GRANT SELECT ON __data__."OrganizationAccessRequest",__data__."OrganizationAccessGrant" TO mua_web;
$policies$,'__data__',quote_ident(data_schema)),'__auth__',quote_ident(security_schema));
-- All new security functions belong to the non-login owner; no implicit PUBLIC EXECUTE.
FOR t IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=security_schema AND p.proname IN
 ('access_state','can_manage','access_admin','sync_member_visibility','visibility_changed','member_server_access','member_servers','member_snapshot','member_organizations','access_candidates','union_login','access_submit','access_decide','access_revoke') LOOP
 EXECUTE 'ALTER FUNCTION '||t||' OWNER TO mua_owner'; EXECUTE 'REVOKE ALL ON FUNCTION '||t||' FROM PUBLIC';
END LOOP;
EXECUTE format('GRANT EXECUTE ON FUNCTION %I.access_state() TO mua_web',security_schema);
EXECUTE format('GRANT EXECUTE ON FUNCTION %I.can_manage(uuid) TO mua_lookup',security_schema);
EXECUTE format('GRANT EXECUTE ON FUNCTION %I.access_admin(uuid), %I.member_server_access(text), %I.member_servers(), %I.member_snapshot(text,uuid), %I.member_organizations(), %I.access_candidates(uuid,uuid), %I.access_submit(uuid,uuid,uuid,text[],boolean,text), %I.access_decide(uuid,integer,text,text), %I.access_revoke(uuid,text) TO mua_web',security_schema,security_schema,security_schema,security_schema,security_schema,security_schema,security_schema,security_schema,security_schema);
EXECUTE format('GRANT EXECUTE ON FUNCTION %I.union_login(text,text,text,timestamptz), %I.session_actor(text) TO mua_auth',security_schema,security_schema);
EXECUTE format('GRANT EXECUTE ON FUNCTION %I.sync_member_visibility() TO mua_worker',security_schema);
END $install$;
