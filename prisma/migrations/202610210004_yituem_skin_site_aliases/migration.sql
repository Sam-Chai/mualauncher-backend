DO $install$
DECLARE ds text:=current_schema(); az text:=CASE WHEN current_schema()='public' THEN 'authz' ELSE current_schema()||'_authz' END;
BEGIN
EXECUTE replace(replace($ddl$
ALTER TABLE __data__."UnionSkinSite" ADD COLUMN "bsRootAliases" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
-- An explicit exception for the two retained domains of the merged YITUEM organization.
-- Do not permit arbitrary duplicate CODEs or turn aliases into separate identity sources.
ALTER TABLE __data__."UnionSkinSite" ADD CONSTRAINT "UnionSkinSite_aliases_check" CHECK (
 cardinality("bsRootAliases")=0 OR
 (code='YITUEM' AND "bsRoot"='https://skin.yitmc.cn' AND "bsRootAliases"=ARRAY['https://skin.uemcraft.cn']::TEXT[]));

CREATE OR REPLACE FUNCTION __auth__.union_apply_sites(payload JSONB,lease UUID) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,__data__,__auth__,pg_temp AS $$
DECLARE item JSONB; site "UnionSkinSite"; oid UUID; matches INTEGER; created INTEGER:=0; synced INTEGER:=0; problems JSONB:='[]'; aliases TEXT[]; BEGIN
 PERFORM pg_advisory_xact_lock(731402,1);
 IF NOT EXISTS(SELECT 1 FROM "UnionSyncState" WHERE id='union' AND "leaseToken"=lease AND "leaseUntil">clock_timestamp()) THEN RAISE insufficient_privilege; END IF;
 IF jsonb_typeof(payload)<>'array' OR jsonb_array_length(payload)>1000 OR EXISTS(SELECT 1 FROM jsonb_array_elements(payload) p WHERE p->>'code' !~ '^[A-Z][A-Z0-9]{0,5}$' OR p->>'bsRoot' !~ '^https://[^/@]+(/.*)?$' OR p->>'code' IS NULL OR p->>'bsRoot' IS NULL) THEN RAISE insufficient_privilege; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(payload) p GROUP BY p->>'code' HAVING count(*)>1) THEN RAISE insufficient_privilege; END IF;
 -- Validate aliases before applying any records; old Workers may omit the new field.
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(payload) p
   WHERE p ? 'bsRootAliases' AND p->'bsRootAliases'<>'[]'::jsonb AND NOT
   (p->>'code'='YITUEM' AND p->>'bsRoot'='https://skin.yitmc.cn' AND p->'bsRootAliases'='["https://skin.uemcraft.cn"]'::jsonb)) THEN RAISE insufficient_privilege; END IF;
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
 RETURN jsonb_build_object('created',created,'synced',synced,'issues',problems);
END $$;
$ddl$,'__data__',quote_ident(ds)),'__auth__',quote_ident(az));
-- CREATE OR REPLACE retains the existing owner and Worker-only execution grants.
END $install$;
