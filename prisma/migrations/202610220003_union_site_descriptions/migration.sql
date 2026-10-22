DO $install$
DECLARE ds text:=current_schema(); az text:=CASE WHEN current_schema()='public' THEN 'authz' ELSE current_schema()||'_authz' END;
BEGIN
EXECUTE replace(replace($ddl$
ALTER TABLE __data__."Organization" ADD COLUMN "descriptionMode" TEXT NOT NULL DEFAULT 'AUTO' CHECK ("descriptionMode" IN ('AUTO','MANUAL'));
-- Existing prose and previously edited/cleared descriptions belong to their authors.
UPDATE __data__."Organization" o SET "descriptionMode"='MANUAL' WHERE description<>'' OR EXISTS (
 SELECT 1 FROM __data__."AuditEvent" e WHERE e.action='ORGANIZATION_EDIT' AND e."targetType"='Organization'
 AND e."targetId"=o.id::text AND e.details->'fields' ? 'description');

-- Invoker security deliberately retains the caller identity: automatic directory writes
-- run inside the existing mua_owner SECURITY DEFINER function; normal web edits do not.
CREATE FUNCTION __auth__.organization_description_mode() RETURNS trigger LANGUAGE plpgsql
 SET search_path=pg_catalog,__data__,__auth__,pg_temp AS $$ BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.description<>'' THEN NEW."descriptionMode":='MANUAL'; END IF;
 ELSIF current_user<>'mua_owner' THEN
  IF OLD."descriptionMode"='MANUAL' OR NEW.description IS DISTINCT FROM OLD.description THEN NEW."descriptionMode":='MANUAL';
  ELSE NEW."descriptionMode":=OLD."descriptionMode"; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER organization_description_mode BEFORE INSERT OR UPDATE OF description,"descriptionMode" ON __data__."Organization"
 FOR EACH ROW EXECUTE FUNCTION __auth__.organization_description_mode();

CREATE OR REPLACE FUNCTION __auth__.union_apply_sites(payload JSONB,lease UUID) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,__data__,__auth__,pg_temp AS $$
DECLARE item JSONB; site "UnionSkinSite"; oid UUID; matches INTEGER; created INTEGER:=0; synced INTEGER:=0; problems JSONB:='[]'; aliases TEXT[]; BEGIN
 PERFORM pg_advisory_xact_lock(731402,1);
 IF NOT EXISTS(SELECT 1 FROM "UnionSyncState" WHERE id='union' AND "leaseToken"=lease AND "leaseUntil">clock_timestamp()) THEN RAISE insufficient_privilege; END IF;
 IF jsonb_typeof(payload)<>'array' OR jsonb_array_length(payload)>1000 OR EXISTS(SELECT 1 FROM jsonb_array_elements(payload) p WHERE p->>'code' !~ '^[A-Z][A-Z0-9]{0,5}$' OR p->>'bsRoot' !~ '^https://[^/@]+(/.*)?$' OR p->>'code' IS NULL OR p->>'bsRoot' IS NULL) THEN RAISE insufficient_privilege; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(payload) p GROUP BY p->>'code' HAVING count(*)>1) THEN RAISE insufficient_privilege; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(payload) p
   WHERE p ? 'bsRootAliases' AND p->'bsRootAliases'<>'[]'::jsonb AND NOT
   (p->>'code'='YITUEM' AND p->>'bsRoot'='https://skin.yitmc.cn' AND p->'bsRootAliases'='["https://skin.uemcraft.cn"]'::jsonb)) THEN RAISE insufficient_privilege; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(payload) p WHERE p ? 'siteName' AND
   (jsonb_typeof(p->'siteName')<>'string' OR length(btrim(p->>'siteName')) NOT BETWEEN 1 AND 200 OR p->>'siteName' ~ '[[:cntrl:]]')) THEN RAISE insufficient_privilege; END IF;
 UPDATE "UnionSkinSite" SET "upstreamPresent"=false;
 FOR item IN SELECT * FROM jsonb_array_elements(payload) LOOP
  aliases:=ARRAY(SELECT jsonb_array_elements_text(coalesce(item->'bsRootAliases','[]'::jsonb)));
  SELECT * INTO site FROM "UnionSkinSite" WHERE code=item->>'code';
  IF FOUND THEN
   UPDATE "UnionSkinSite" SET "upstreamPresent"=true,"lastSeenAt"=clock_timestamp(),
    "avatarNextAt"=CASE WHEN ("bsRoot"<>item->>'bsRoot' OR "bsRootAliases"<>aliases) AND "managedBySync" THEN clock_timestamp() ELSE "avatarNextAt" END,
    revision=revision+CASE WHEN ("bsRoot"<>item->>'bsRoot' OR "bsRootAliases"<>aliases) AND "managedBySync" THEN 1 ELSE 0 END,
    "bsRoot"=CASE WHEN "managedBySync" THEN item->>'bsRoot' ELSE "bsRoot" END,
    "bsRootAliases"=CASE WHEN "managedBySync" THEN aliases ELSE "bsRootAliases" END,
    "updatedAt"=clock_timestamp() WHERE code=site.code;
   IF NOT site."managedBySync" AND (site."bsRoot"<>item->>'bsRoot' OR site."bsRootAliases"<>aliases) THEN problems:=problems||jsonb_build_array(jsonb_build_object('code',site.code,'issue','MAPPING_URL_MISMATCH')); END IF;
  ELSE
   SELECT count(*),min(id::text)::uuid INTO matches,oid FROM "Organization" WHERE "displayName"=item->>'code';
   IF matches>1 OR matches=1 AND EXISTS(SELECT 1 FROM "Organization" WHERE id=oid AND "archivedAt" IS NOT NULL) THEN
    problems:=problems||jsonb_build_array(jsonb_build_object('code',item->>'code','issue','ORGANIZATION_CONFLICT')); CONTINUE;
   END IF;
   IF matches=0 THEN
    oid:=gen_random_uuid(); INSERT INTO "Organization"(id,"displayName","updatedAt") VALUES(oid,item->>'code',clock_timestamp()); created:=created+1;
   END IF;
   INSERT INTO "UnionSkinSite"(code,"organizationId","bsRoot","bsRootAliases","managedBySync","upstreamPresent","lastSeenAt") VALUES(item->>'code',oid,item->>'bsRoot',aliases,true,true,clock_timestamp());
  END IF;
  synced:=synced+1;
 END LOOP;
 -- Choose a stable primary CODE per organization before testing fetch success. A failed
 -- primary never switches the description to a different CODE's name for one cycle.
 WITH primary_sites AS (
  SELECT DISTINCT ON (s."organizationId") s."organizationId",s."bsRoot",s."bsRootAliases",s.code
  FROM "UnionSkinSite" s WHERE s.enabled AND s."upstreamPresent" ORDER BY s."organizationId",s.code
 ), names AS (
  SELECT s."organizationId",btrim(p->>'siteName') AS value FROM primary_sites s
  JOIN jsonb_array_elements(payload) p ON s.code=p->>'code' AND s."bsRoot"=p->>'bsRoot'
   AND s."bsRootAliases"=ARRAY(SELECT jsonb_array_elements_text(coalesce(p->'bsRootAliases','[]'::jsonb)))
  WHERE p ? 'siteName'
 )
 UPDATE "Organization" o SET description=n.value,"updatedAt"=clock_timestamp() FROM names n
 WHERE o.id=n."organizationId" AND o."descriptionMode"='AUTO' AND o."archivedAt" IS NULL AND o.description IS DISTINCT FROM n.value;
 RETURN jsonb_build_object('created',created,'synced',synced,'issues',problems);
END $$;
$ddl$,'__data__',quote_ident(ds)),'__auth__',quote_ident(az));
EXECUTE format('ALTER FUNCTION %I.organization_description_mode() OWNER TO mua_owner',az);
EXECUTE format('REVOKE ALL ON FUNCTION %I.organization_description_mode() FROM PUBLIC',az);
-- CREATE OR REPLACE preserves the directory function owner and Worker-only grants.
END $install$;
