DO $install$
DECLARE ds text:=current_schema(); az text:=CASE WHEN current_schema()='public' THEN 'authz' ELSE current_schema()||'_authz' END; f text;
BEGIN
EXECUTE replace(replace($ddl$
ALTER TABLE __data__."Organization" ADD COLUMN "avatarMode" TEXT NOT NULL DEFAULT 'AUTO' CHECK ("avatarMode" IN ('AUTO','MANUAL'));
ALTER TABLE __data__."Organization" ADD COLUMN "avatarRevision" INTEGER NOT NULL DEFAULT 0 CHECK ("avatarRevision">=0);
UPDATE __data__."Organization" SET "avatarMode"='MANUAL' WHERE "avatarObjectKey" IS NOT NULL;
ALTER TABLE __data__."UnionSkinSite" ADD COLUMN "managedBySync" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE __data__."UnionSkinSite" ADD COLUMN "upstreamPresent" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE __data__."UnionSkinSite" ADD COLUMN "lastSeenAt" TIMESTAMPTZ(6);
ALTER TABLE __data__."UnionSkinSite" ADD COLUMN "avatarNextAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now();
ALTER TABLE __data__."UnionSkinSite" ADD COLUMN "avatarCheckedAt" TIMESTAMPTZ(6);
ALTER TABLE __data__."UnionSkinSite" ADD COLUMN "avatarError" TEXT;
-- The live directory includes alphanumeric codes such as TEST2.
ALTER TABLE __data__."UnionSkinSite" DROP CONSTRAINT "UnionSkinSite_code_check";
ALTER TABLE __data__."UnionSkinSite" ADD CONSTRAINT "UnionSkinSite_code_check" CHECK (code ~ '^[A-Z][A-Z0-9]{0,5}$');
CREATE TABLE __data__."UnionSyncState" (
 id TEXT PRIMARY KEY CHECK(id='union'), "attemptedAt" TIMESTAMPTZ(6), "syncedAt" TIMESTAMPTZ(6), "nextSyncAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
 "leaseToken" UUID,"leaseUntil" TIMESTAMPTZ(6),"avatarLeaseToken" UUID,"avatarLeaseUntil" TIMESTAMPTZ(6),"upstreamVersion" TEXT,
 "receivedCount" INTEGER NOT NULL DEFAULT 0,"syncedCount" INTEGER NOT NULL DEFAULT 0,"createdCount" INTEGER NOT NULL DEFAULT 0,error TEXT,issues JSONB NOT NULL DEFAULT '[]');
ALTER TABLE __data__."UnionSyncState" OWNER TO mua_owner;
ALTER TABLE __data__."UnionSyncState" ENABLE ROW LEVEL SECURITY;
ALTER TABLE __data__."UnionSyncState" FORCE ROW LEVEL SECURITY;
CREATE POLICY maintenance ON __data__."UnionSyncState" TO mua_owner USING(true) WITH CHECK(true);
CREATE POLICY lookup_read ON __data__."UnionSyncState" FOR SELECT TO mua_lookup USING(true);
CREATE POLICY sync_worker ON __data__."UnionSyncState" TO mua_worker USING(true) WITH CHECK(true);
CREATE POLICY sync_panel ON __data__."UnionSyncState" FOR SELECT TO mua_web USING(__auth__.super_panel());
GRANT SELECT ON __data__."UnionSyncState" TO mua_lookup,mua_web;
GRANT SELECT,INSERT,UPDATE ON __data__."UnionSyncState" TO mua_worker;
CREATE POLICY site_worker_read ON __data__."UnionSkinSite" FOR SELECT TO mua_worker USING(true);
GRANT SELECT ON __data__."UnionSkinSite" TO mua_worker;

CREATE FUNCTION __auth__.union_apply_sites(payload JSONB,lease UUID) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,__data__,__auth__,pg_temp AS $$
DECLARE item JSONB; site "UnionSkinSite"; oid UUID; matches INTEGER; created INTEGER:=0; synced INTEGER:=0; problems JSONB:='[]'; BEGIN
 PERFORM pg_advisory_xact_lock(731402,1);
 IF NOT EXISTS(SELECT 1 FROM "UnionSyncState" WHERE id='union' AND "leaseToken"=lease AND "leaseUntil">clock_timestamp()) THEN RAISE insufficient_privilege; END IF;
 IF jsonb_typeof(payload)<>'array' OR jsonb_array_length(payload)>1000 OR EXISTS(SELECT 1 FROM jsonb_array_elements(payload) p WHERE p->>'code' !~ '^[A-Z][A-Z0-9]{0,5}$' OR p->>'bsRoot' !~ '^https://[^/@]+(/.*)?$' OR p->>'code' IS NULL OR p->>'bsRoot' IS NULL) THEN RAISE insufficient_privilege; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(payload) p GROUP BY p->>'code' HAVING count(*)>1) THEN RAISE insufficient_privilege; END IF;
 UPDATE "UnionSkinSite" SET "upstreamPresent"=false;
 FOR item IN SELECT * FROM jsonb_array_elements(payload) LOOP
  SELECT * INTO site FROM "UnionSkinSite" WHERE code=item->>'code';
  IF FOUND THEN
   UPDATE "UnionSkinSite" SET "upstreamPresent"=true,"lastSeenAt"=clock_timestamp(),
    "avatarNextAt"=CASE WHEN "bsRoot"<>item->>'bsRoot' AND "managedBySync" THEN clock_timestamp() ELSE "avatarNextAt" END,
    revision=revision+CASE WHEN "bsRoot"<>item->>'bsRoot' AND "managedBySync" THEN 1 ELSE 0 END,
    "bsRoot"=CASE WHEN "managedBySync" THEN item->>'bsRoot' ELSE "bsRoot" END,"updatedAt"=clock_timestamp() WHERE code=site.code;
   IF NOT site."managedBySync" AND site."bsRoot"<>item->>'bsRoot' THEN problems:=problems||jsonb_build_array(jsonb_build_object('code',site.code,'issue','MAPPING_URL_MISMATCH')); END IF;
  ELSE
   SELECT count(*),min(id::text)::uuid INTO matches,oid FROM "Organization" WHERE "displayName"=item->>'code';
   IF matches>1 OR matches=1 AND EXISTS(SELECT 1 FROM "Organization" WHERE id=oid AND "archivedAt" IS NOT NULL) THEN
    problems:=problems||jsonb_build_array(jsonb_build_object('code',item->>'code','issue','ORGANIZATION_CONFLICT')); CONTINUE;
   END IF;
   IF matches=0 THEN
    oid:=gen_random_uuid(); INSERT INTO "Organization"(id,"displayName","updatedAt") VALUES(oid,item->>'code',clock_timestamp()); created:=created+1;
   END IF;
   INSERT INTO "UnionSkinSite"(code,"organizationId","bsRoot","managedBySync","upstreamPresent","lastSeenAt") VALUES(item->>'code',oid,item->>'bsRoot',true,true,clock_timestamp());
  END IF;
  synced:=synced+1;
 END LOOP;
 RETURN jsonb_build_object('created',created,'synced',synced,'issues',problems);
END $$;

CREATE FUNCTION __auth__.union_avatar_result(site_code TEXT,root TEXT,expected_revision INTEGER,object_key TEXT,problem TEXT,lease UUID) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,__data__,__auth__,pg_temp AS $$ DECLARE s "UnionSkinSite"; o "Organization"; BEGIN
 PERFORM pg_advisory_xact_lock(731402,1);
 IF NOT EXISTS(SELECT 1 FROM "UnionSyncState" WHERE id='union' AND "avatarLeaseToken"=lease AND "avatarLeaseUntil">clock_timestamp()) THEN RAISE insufficient_privilege; END IF;
 SELECT * INTO s FROM "UnionSkinSite" WHERE code=site_code AND "bsRoot"=root AND enabled AND "upstreamPresent";
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT * INTO o FROM "Organization" WHERE id=s."organizationId";
 IF object_key IS NOT NULL AND (object_key !~ ('^organization-avatars/'||o.id::text||'/[a-f0-9-]{36}/image[.]webp$') OR problem IS NOT NULL) THEN RAISE insufficient_privilege; END IF;
 IF o."avatarMode"='AUTO' AND o."archivedAt" IS NULL AND o."avatarRevision"=expected_revision AND object_key IS NOT NULL THEN
  UPDATE "Organization" SET "avatarObjectKey"=object_key,"avatarRevision"="avatarRevision"+1,"updatedAt"=clock_timestamp() WHERE id=o.id;
 END IF;
 UPDATE "UnionSkinSite" SET "avatarCheckedAt"=clock_timestamp(),"avatarError"=CASE WHEN o."avatarMode"='MANUAL' THEN NULL ELSE left(problem,100) END,
 "avatarNextAt"=clock_timestamp()+CASE WHEN problem IS NULL OR o."avatarMode"='MANUAL' THEN interval '24 hours' ELSE interval '1 hour' END WHERE code=s.code;
 RETURN true;
END $$;
CREATE FUNCTION __auth__.union_request_sync() RETURNS void LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,__data__,__auth__,pg_temp AS $$ BEGIN
 IF NOT __auth__.super_panel() THEN RAISE insufficient_privilege; END IF;
 INSERT INTO "UnionSyncState"(id,"nextSyncAt") VALUES('union',clock_timestamp()) ON CONFLICT(id) DO UPDATE SET "nextSyncAt"=clock_timestamp();
 INSERT INTO "AuditEvent"(id,"actorId",action,"targetType","targetId",details) VALUES(gen_random_uuid(),__auth__.actor_id(),'UNION_SYNC_REQUEST','UnionSyncState','union','{}');
END $$;
$ddl$,'__data__',quote_ident(ds)),'__auth__',quote_ident(az));
-- Retain the existing login function with only the provider's actual CODE grammar widened.
SELECT pg_get_functiondef(p.oid) INTO f FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=az AND p.proname='union_login';
EXECUTE replace(f,'^[A-Z]{1,6}:[0-9]{1,20}$','^[A-Z][A-Z0-9]{0,5}:[0-9]{1,20}$');
FOREACH f IN ARRAY ARRAY['union_apply_sites(jsonb,uuid)','union_avatar_result(text,text,integer,text,text,uuid)'] LOOP
 EXECUTE format('ALTER FUNCTION %I.%s OWNER TO mua_owner',az,f);
 EXECUTE format('REVOKE ALL ON FUNCTION %I.%s FROM PUBLIC',az,f);
 EXECUTE format('GRANT EXECUTE ON FUNCTION %I.%s TO mua_worker',az,f);
END LOOP;
EXECUTE format('ALTER FUNCTION %I.union_request_sync() OWNER TO mua_owner',az);
EXECUTE format('REVOKE ALL ON FUNCTION %I.union_request_sync() FROM PUBLIC',az);
EXECUTE format('GRANT EXECUTE ON FUNCTION %I.union_request_sync() TO mua_web',az);
END $install$;
