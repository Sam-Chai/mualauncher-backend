DO $install$
DECLARE ds text:=current_schema(); az text:=CASE WHEN current_schema()='public' THEN 'authz' ELSE current_schema()||'_authz' END;
BEGIN
EXECUTE replace(replace($ddl$
ALTER TABLE __data__."Organization" ADD COLUMN "launcherLoginOverrides" JSONB NOT NULL DEFAULT '{}'::jsonb
 CHECK (jsonb_typeof("launcherLoginOverrides")='object');
CREATE FUNCTION __auth__.launcher_root_allowed(default_enabled BOOLEAN,overrides JSONB,code TEXT,root TEXT) RETURNS BOOLEAN
 LANGUAGE sql IMMUTABLE AS $$ SELECT coalesce((overrides->(code||':'||root))::boolean,default_enabled) $$;

CREATE OR REPLACE FUNCTION __auth__.organization_launcher_guard() RETURNS trigger LANGUAGE plpgsql
 SET search_path=pg_catalog,__data__,__auth__,pg_temp AS $$ BEGIN
 IF jsonb_typeof(NEW."launcherLoginOverrides") IS DISTINCT FROM 'object' THEN RAISE check_violation; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_each(NEW."launcherLoginOverrides") p WHERE jsonb_typeof(p.value)<>'boolean') THEN RAISE check_violation; END IF;
 IF TG_OP='INSERT' THEN
  IF current_user='mua_owner' THEN
   NEW."launcherLoginEnabled":=coalesce((SELECT "autoAuthorizeNewOrganizations" FROM "PlatformSettings" WHERE id='platform'),false);
  END IF;
  NEW."launcherLoginRevision":=0;
 ELSE
  IF (NEW."launcherLoginEnabled" IS DISTINCT FROM OLD."launcherLoginEnabled" OR NEW."launcherLoginOverrides" IS DISTINCT FROM OLD."launcherLoginOverrides" OR NEW."launcherLoginRevision"<>OLD."launcherLoginRevision")
   AND current_user<>'mua_owner' AND NOT __auth__.org_permission(OLD.id,'ORG_EDIT') THEN RAISE insufficient_privilege; END IF;
  NEW."launcherLoginRevision":=OLD."launcherLoginRevision"+CASE WHEN NEW."launcherLoginEnabled" IS DISTINCT FROM OLD."launcherLoginEnabled" OR NEW."launcherLoginOverrides" IS DISTINCT FROM OLD."launcherLoginOverrides" THEN 1 ELSE 0 END;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER organization_launcher_guard ON __data__."Organization";
CREATE TRIGGER organization_launcher_guard BEFORE INSERT OR UPDATE OF "launcherLoginEnabled","launcherLoginOverrides","launcherLoginRevision" ON __data__."Organization"
 FOR EACH ROW EXECUTE FUNCTION __auth__.organization_launcher_guard();

CREATE OR REPLACE FUNCTION __auth__.organization_launcher_changed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,__data__,__auth__,pg_temp AS $$ BEGIN
 IF NEW."launcherLoginEnabled" IS DISTINCT FROM OLD."launcherLoginEnabled" OR NEW."launcherLoginOverrides" IS DISTINCT FROM OLD."launcherLoginOverrides" THEN
  UPDATE "LauncherAuthProvider" p SET revision=p.revision+1,"updatedAt"=clock_timestamp() FROM "UnionSkinSite" s
   WHERE s.code=p."siteCode" AND s."organizationId"=NEW.id
   AND __auth__.launcher_root_allowed(OLD."launcherLoginEnabled",OLD."launcherLoginOverrides",s.code,p."bsRoot")
    IS DISTINCT FROM __auth__.launcher_root_allowed(NEW."launcherLoginEnabled",NEW."launcherLoginOverrides",s.code,p."bsRoot");
  UPDATE "UnionSyncState" SET "nextSyncAt"=least("nextSyncAt",clock_timestamp()) WHERE id='union';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER organization_launcher_changed ON __data__."Organization";
CREATE TRIGGER organization_launcher_changed AFTER UPDATE OF "launcherLoginEnabled","launcherLoginOverrides" ON __data__."Organization"
 FOR EACH ROW EXECUTE FUNCTION __auth__.organization_launcher_changed();

CREATE OR REPLACE FUNCTION __auth__.launcher_provider_valid(pid UUID,rev INTEGER) RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,__data__,__auth__,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM "LauncherAuthProvider" p JOIN "UnionSkinSite" s ON s.code=p."siteCode"
 JOIN "Organization" o ON o.id=s."organizationId" WHERE p.id=pid AND p.revision=rev AND p.enabled AND s.enabled
 AND __auth__.launcher_root_allowed(o."launcherLoginEnabled",o."launcherLoginOverrides",s.code,p."bsRoot")
 AND (NOT s."managedBySync" OR s."upstreamPresent") AND p."siteRevision"=s.revision AND o."archivedAt" IS NULL
 AND (p."bsRoot"=s."bsRoot" OR p."bsRoot"=ANY(s."bsRootAliases"))) $$;

CREATE OR REPLACE FUNCTION __auth__.union_apply_launcher_providers(payload JSONB,lease UUID) RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,__data__,__auth__,pg_temp AS $$
DECLARE item JSONB; s "UnionSkinSite"; o "Organization"; state "UnionSyncState"; root TEXT; n INTEGER:=0; BEGIN
 PERFORM pg_advisory_xact_lock(731402,1);
 SELECT * INTO state FROM "UnionSyncState" WHERE id='union' AND "leaseToken"=lease AND "leaseUntil">clock_timestamp();
 IF NOT FOUND THEN RAISE insufficient_privilege; END IF;
 IF jsonb_typeof(payload)<>'array' OR jsonb_array_length(payload)>1000 THEN RAISE insufficient_privilege; END IF;
 FOR item IN SELECT * FROM jsonb_array_elements(payload) LOOP
  SELECT * INTO s FROM "UnionSkinSite" WHERE code=item->>'code';
  IF NOT FOUND OR NOT s.enabled OR (s."managedBySync" AND NOT s."upstreamPresent") THEN CONTINUE; END IF;
  SELECT * INTO o FROM "Organization" WHERE id=s."organizationId";
  IF NOT __auth__.launcher_root_allowed(o."launcherLoginEnabled",o."launcherLoginOverrides",s.code,item->>'bsRoot') OR o."archivedAt" IS NOT NULL THEN CONTINUE; END IF;
  IF item->>'organizationId' IS NOT NULL THEN
   IF o.id::text<>item->>'organizationId' OR o."launcherLoginRevision"<>(item->>'organizationRevision')::integer
    OR s.revision<>(item->>'siteRevision')::integer THEN CONTINUE; END IF;
  ELSE
   IF o."createdAt"<state."attemptedAt" OR o."launcherLoginRevision"<>0
    OR NOT coalesce((SELECT "autoAuthorizeNewOrganizations" AND "unionAuthorizationRevision"=(item->>'settingsRevision')::integer FROM "PlatformSettings" WHERE id='platform'),false) THEN CONTINUE; END IF;
  END IF;
  IF NOT (item->>'bsRoot'=s."bsRoot" OR item->>'bsRoot'=ANY(s."bsRootAliases")) THEN CONTINUE; END IF;
  root:=item->>'authApiRoot';
  IF root IS NULL OR length(root)>2048 OR root !~ '^https://' OR root ~ '[[:space:]?#@]' THEN RAISE insufficient_privilege; END IF;
  INSERT INTO "LauncherAuthProvider"(id,"siteCode","displayName","bsRoot","authApiRoot",adapter,enabled,revision,"siteRevision","verificationNote","verifiedById","managedByOrganization","updatedAt")
   VALUES(gen_random_uuid(),s.code,o."displayName",item->>'bsRoot',root,'MUA_YGGC_ONLINE_V1',true,1,s.revision,
    'Organization authorized launcher access; ALI metadata discovered. Game-token identity verification is still required; no end-to-end acceptance is asserted.',NULL,true,clock_timestamp())
   ON CONFLICT ("siteCode","bsRoot") DO UPDATE SET "displayName"=excluded."displayName","authApiRoot"=excluded."authApiRoot",enabled=true,
    "siteRevision"=excluded."siteRevision","verifiedAt"=clock_timestamp(),"updatedAt"=clock_timestamp(),
    revision="LauncherAuthProvider".revision+CASE WHEN "LauncherAuthProvider"."authApiRoot"<>excluded."authApiRoot"
      OR "LauncherAuthProvider"."siteRevision"<>excluded."siteRevision" OR NOT "LauncherAuthProvider".enabled THEN 1 ELSE 0 END
   WHERE "LauncherAuthProvider"."managedByOrganization";
  n:=n+1;
 END LOOP;
 RETURN n;
END $$;

$ddl$,'__data__',quote_ident(ds)),'__auth__',quote_ident(az));
EXECUTE format('ALTER FUNCTION %I.launcher_root_allowed(boolean,jsonb,text,text) OWNER TO mua_owner',az);
EXECUTE format('REVOKE ALL ON FUNCTION %I.launcher_root_allowed(boolean,jsonb,text,text) FROM PUBLIC',az);
END $install$;
