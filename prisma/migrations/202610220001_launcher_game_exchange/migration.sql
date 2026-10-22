DO $install$
DECLARE ds text:=current_schema(); az text:=CASE WHEN current_schema()='public' THEN 'authz' ELSE current_schema()||'_authz' END; t text; f text;
BEGIN
EXECUTE replace(replace($ddl$
CREATE TABLE __data__."LauncherAuthProvider" (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), "siteCode" VARCHAR(6) NOT NULL REFERENCES __data__."UnionSkinSite"(code),
 "displayName" TEXT NOT NULL, "bsRoot" TEXT NOT NULL, "authApiRoot" TEXT NOT NULL,
 adapter TEXT NOT NULL DEFAULT 'MUA_YGGC_ONLINE_V1' CHECK(adapter='MUA_YGGC_ONLINE_V1'), enabled BOOLEAN NOT NULL DEFAULT false,
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0), "siteRevision" INTEGER NOT NULL CHECK("siteRevision">0),
 "verificationNote" TEXT NOT NULL CHECK(length("verificationNote") BETWEEN 10 AND 1000),
 "verifiedById" UUID NOT NULL REFERENCES __data__."Account"(id), "verifiedAt" TIMESTAMPTZ NOT NULL DEFAULT now(), "updatedAt" TIMESTAMPTZ NOT NULL,
 UNIQUE("siteCode","bsRoot"), CHECK("authApiRoot"="bsRoot"||'/api/yggdrasil'),
 CHECK("bsRoot" ~ '^https://' AND "bsRoot" !~ '[[:space:]?#@]' AND right("bsRoot",1)<>'/')
);
CREATE TABLE __data__."LauncherGameLoginAttempt" (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), "providerId" UUID NOT NULL REFERENCES __data__."LauncherAuthProvider"(id),
 "providerRevision" INTEGER NOT NULL, "codeChallenge" CHAR(43) NOT NULL CHECK("codeChallenge" ~ '^[A-Za-z0-9_-]{43}$'),
 "nonceHash" CHAR(64) NOT NULL CHECK("nonceHash" ~ '^[a-f0-9]{64}$'), status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','VERIFYING','FAILED','CONSUMED')),
 "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(), "expiresAt" TIMESTAMPTZ NOT NULL, "consumedAt" TIMESTAMPTZ,
 CHECK("expiresAt">"createdAt" AND "expiresAt"<="createdAt"+interval '120 seconds')
);
CREATE INDEX ON __data__."LauncherGameLoginAttempt"("expiresAt");
ALTER TABLE __data__."Session" ADD COLUMN "authMethod" TEXT NOT NULL DEFAULT 'WEB',
 ADD COLUMN "providerId" UUID REFERENCES __data__."LauncherAuthProvider"(id), ADD COLUMN "providerRevision" INTEGER,
 ADD COLUMN "unionSubject" TEXT, ADD COLUMN "gameProfileId" CHAR(32), ADD COLUMN "gameProfileName" TEXT,
 ADD COLUMN "upstreamExpiresAt" TIMESTAMPTZ, ADD COLUMN "verifiedAt" TIMESTAMPTZ,
 ADD COLUMN "gameLoginAttemptId" UUID UNIQUE REFERENCES __data__."LauncherGameLoginAttempt"(id),
 ADD CONSTRAINT session_game_identity CHECK("authMethod" IN ('WEB','BROWSER_BRIDGE','YGGDRASIL') AND
 ("authMethod"<>'YGGDRASIL' OR (kind='LAUNCHER' AND "providerId" IS NOT NULL AND "providerRevision" IS NOT NULL
 AND "unionSubject" IS NOT NULL AND "gameProfileId" IS NOT NULL AND "gameProfileId" ~ '^[a-f0-9]{32}$' AND "gameProfileName" IS NOT NULL
 AND "upstreamExpiresAt" IS NOT NULL AND "verifiedAt" IS NOT NULL AND "gameLoginAttemptId" IS NOT NULL
 AND "expiresAt"<="upstreamExpiresAt"-interval '30 seconds' AND "expiresAt"<="verifiedAt"+interval '15 minutes')));

CREATE FUNCTION __auth__.launcher_provider_valid(pid UUID, rev INTEGER) RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,__data__,__auth__,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM "LauncherAuthProvider" p JOIN "UnionSkinSite" s ON s.code=p."siteCode"
 JOIN "Organization" o ON o.id=s."organizationId" WHERE p.id=pid AND p.revision=rev AND p.enabled AND s.enabled
 AND (NOT s."managedBySync" OR s."upstreamPresent") AND p."siteRevision"=s.revision AND o."archivedAt" IS NULL
 AND (p."bsRoot"=s."bsRoot" OR p."bsRoot"=ANY(s."bsRootAliases"))) $$;

CREATE FUNCTION __auth__.launcher_provider_list() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,__data__,__auth__,pg_temp AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'siteCode',p."siteCode",'displayName',p."displayName",'bsRoot',p."bsRoot",
 'authApiRoot',p."authApiRoot",'revision',p.revision,'directExchange',true,'browserLogin',true) ORDER BY p."siteCode",p."displayName"),'[]'::jsonb)
 FROM "LauncherAuthProvider" p WHERE __auth__.launcher_provider_valid(p.id,p.revision) $$;

-- Shared account resolution only: neither helper nor caller creates a temporary WEB session.
CREATE FUNCTION __auth__.union_resolve_identity(subject_value TEXT, display_name TEXT) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,__data__,__auth__,pg_temp AS $$
 DECLARE site "UnionSkinSite"; identity_row "UnionIdentity"; aid UUID;
 BEGIN
 PERFORM pg_advisory_xact_lock(731402,1);
 IF subject_value !~ '^[A-Z][A-Z0-9]{0,5}:[0-9]{1,20}$' OR length(display_name) NOT BETWEEN 1 AND 100 THEN RAISE insufficient_privilege; END IF;
 SELECT * INTO site FROM "UnionSkinSite" WHERE code=split_part(subject_value,':',1) AND enabled;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM "Organization" WHERE id=site."organizationId" AND "archivedAt" IS NULL) THEN RAISE insufficient_privilege; END IF;
 SELECT * INTO identity_row FROM "UnionIdentity" WHERE subject=subject_value;
 IF FOUND THEN
  aid:=identity_row."accountId";
  IF identity_row."organizationId"<>site."organizationId" OR NOT EXISTS(SELECT 1 FROM "Account" a JOIN "OrganizationMember" m ON m."accountId"=a.id
   WHERE a.id=aid AND a.status='ACTIVE' AND m."organizationId"=site."organizationId" AND m.status='ACTIVE') THEN RAISE insufficient_privilege; END IF;
 ELSE
  aid:=gen_random_uuid();
  INSERT INTO "Account"(id,"displayName",status,"isSuperAdmin","updatedAt") VALUES(aid,display_name,'ACTIVE',false,now());
  INSERT INTO "UnionIdentity"(subject,"accountId","siteCode","organizationId") VALUES(subject_value,aid,site.code,site."organizationId");
  INSERT INTO "OrganizationMember"("organizationId","accountId",status,roles,"grantedById",source,"updatedAt")
   VALUES(site."organizationId",aid,'ACTIVE',ARRAY['PLAYER']::__data__."Role"[],NULL,'UNION',now());
 END IF;
 RETURN aid;
 END $$;

CREATE OR REPLACE FUNCTION __auth__.union_login(subject_value TEXT,display_name TEXT,session_hash TEXT,expiry TIMESTAMPTZ) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,__data__,__auth__,pg_temp AS $$
 DECLARE aid UUID;
 BEGIN
 IF session_hash !~ '^[0-9a-f]{64}$' OR expiry>now()+interval '12 hours' OR expiry<=now() THEN RAISE insufficient_privilege; END IF;
 aid:=__auth__.union_resolve_identity(subject_value,display_name);
 INSERT INTO "Session"("tokenHash","accountId","expiresAt") VALUES(session_hash,aid,expiry);
 INSERT INTO "AuditEvent"(id,"actorId",action,"targetType","targetId",details)
 VALUES(gen_random_uuid(),aid,'AUTH_UNION_LOGIN','Account',aid::text,jsonb_build_object('siteCode',split_part(subject_value,':',1)));
 RETURN aid;
 END $$;

CREATE FUNCTION __auth__.launcher_game_issue(attempt_id UUID, expected_revision INTEGER, subject_value TEXT, profile_id TEXT,
 profile_name TEXT, upstream_expiry TIMESTAMPTZ, expiry TIMESTAMPTZ, session_hash TEXT) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,__data__,__auth__,pg_temp AS $$
 DECLARE attempt "LauncherGameLoginAttempt"; provider "LauncherAuthProvider"; aid UUID;
 BEGIN
 PERFORM pg_advisory_xact_lock(731402,1);
 SELECT * INTO attempt FROM "LauncherGameLoginAttempt" WHERE id=attempt_id FOR UPDATE;
 IF NOT FOUND OR attempt.status<>'VERIFYING' OR attempt."expiresAt"<=clock_timestamp() OR attempt."providerRevision"<>expected_revision THEN RAISE insufficient_privilege; END IF;
 SELECT * INTO provider FROM "LauncherAuthProvider" WHERE id=attempt."providerId";
 IF NOT __auth__.launcher_provider_valid(provider.id,expected_revision) OR split_part(subject_value,':',1)<>provider."siteCode"
 OR profile_id !~ '^[a-f0-9]{32}$' OR length(profile_name) NOT BETWEEN 1 AND 64 OR session_hash !~ '^[a-f0-9]{64}$'
 OR expiry<=clock_timestamp()+interval '59 seconds' OR expiry>clock_timestamp()+interval '15 minutes'
 OR expiry>upstream_expiry-interval '30 seconds' THEN RAISE insufficient_privilege; END IF;
 aid:=__auth__.union_resolve_identity(subject_value,'Union · '||subject_value);
 INSERT INTO "Session"("tokenHash","accountId",kind,"authMethod","expiresAt","providerId","providerRevision","unionSubject",
 "gameProfileId","gameProfileName","upstreamExpiresAt","verifiedAt","gameLoginAttemptId")
 VALUES(session_hash,aid,'LAUNCHER','YGGDRASIL',expiry,provider.id,provider.revision,subject_value,profile_id,profile_name,upstream_expiry,clock_timestamp(),attempt.id);
 UPDATE "LauncherGameLoginAttempt" SET status='CONSUMED',"consumedAt"=clock_timestamp() WHERE id=attempt.id;
 INSERT INTO "AuditEvent"(id,"actorId",action,"targetType","targetId",details)
 VALUES(gen_random_uuid(),aid,'AUTH_LAUNCHER_GAME_LOGIN','Account',aid::text,jsonb_build_object('providerId',provider.id,'providerRevision',provider.revision));
 RETURN aid;
 END $$;

CREATE OR REPLACE FUNCTION __auth__.session_actor(hash text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,__data__,__auth__,pg_temp AS $$
 SELECT jsonb_build_object('id',a.id,'displayName',a."displayName",'isSuperAdmin',a."isSuperAdmin",'username',c.username,'unionSubject',i.subject,'sessionKind',s.kind,'canManage',__auth__.can_manage(a.id))
 FROM "Session" s JOIN "Account" a ON a.id=s."accountId" LEFT JOIN "LocalCredential" c ON c."accountId"=a.id LEFT JOIN "UnionIdentity" i ON i."accountId"=a.id
 WHERE s."tokenHash"=$1 AND s."expiresAt">now() AND a.status='ACTIVE'
 AND (s."authMethod"<>'YGGDRASIL' OR (__auth__.launcher_provider_valid(s."providerId",s."providerRevision") AND i.subject=s."unionSubject"
 AND EXISTS(SELECT 1 FROM "OrganizationMember" m JOIN "Organization" o ON o.id=m."organizationId"
 WHERE m."accountId"=a.id AND m."organizationId"=i."organizationId" AND m.status='ACTIVE' AND o."archivedAt" IS NULL))) $$;
$ddl$,'__data__',quote_ident(ds)),'__auth__',quote_ident(az));

FOREACH t IN ARRAY ARRAY['LauncherAuthProvider','LauncherGameLoginAttempt'] LOOP
 EXECUTE format('ALTER TABLE %I.%I OWNER TO mua_owner',ds,t);
 EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY',ds,t);
 EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY',ds,t);
 EXECUTE format('CREATE POLICY maintenance ON %I.%I TO mua_owner USING(true) WITH CHECK(true)',ds,t);
END LOOP;
EXECUTE replace(replace($policies$
CREATE POLICY provider_web ON __data__."LauncherAuthProvider" TO mua_web USING(__auth__.super_panel()) WITH CHECK(__auth__.super_panel());
GRANT SELECT,INSERT,UPDATE ON __data__."LauncherAuthProvider" TO mua_web;
CREATE POLICY provider_auth ON __data__."LauncherAuthProvider" FOR SELECT TO mua_auth USING(true);
GRANT SELECT ON __data__."LauncherAuthProvider" TO mua_auth;
CREATE POLICY game_attempt_auth ON __data__."LauncherGameLoginAttempt" TO mua_auth USING(true) WITH CHECK(true);
GRANT SELECT,INSERT,UPDATE,DELETE ON __data__."LauncherGameLoginAttempt" TO mua_auth;
$policies$,'__data__',quote_ident(ds)),'__auth__',quote_ident(az));
FOR f IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=az AND p.proname IN
 ('launcher_provider_valid','launcher_provider_list','union_resolve_identity','launcher_game_issue') LOOP
 EXECUTE 'ALTER FUNCTION '||f||' OWNER TO mua_owner'; EXECUTE 'REVOKE ALL ON FUNCTION '||f||' FROM PUBLIC';
END LOOP;
EXECUTE format('GRANT EXECUTE ON FUNCTION %I.launcher_provider_valid(uuid,integer), %I.launcher_provider_list(), %I.launcher_game_issue(uuid,integer,text,text,text,timestamptz,timestamptz,text) TO mua_auth',az,az,az);
EXECUTE format('GRANT EXECUTE ON FUNCTION %I.launcher_provider_valid(uuid,integer) TO mua_lookup',az);
END $install$;
