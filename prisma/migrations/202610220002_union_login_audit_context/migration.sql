-- Preserve the previous OAuth audit context after extracting shared identity resolution.
DO $install$
DECLARE ds text:=current_schema(); az text:=CASE WHEN current_schema()='public' THEN 'authz' ELSE current_schema()||'_authz' END;
BEGIN
EXECUTE replace(replace($ddl$
CREATE OR REPLACE FUNCTION __auth__.union_login(subject_value TEXT,display_name TEXT,session_hash TEXT,expiry TIMESTAMPTZ) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,__data__,__auth__,pg_temp AS $$
 DECLARE aid UUID; site "UnionSkinSite";
 BEGIN
 IF session_hash !~ '^[0-9a-f]{64}$' OR expiry>now()+interval '12 hours' OR expiry<=now() THEN RAISE insufficient_privilege; END IF;
 aid:=__auth__.union_resolve_identity(subject_value,display_name);
 SELECT * INTO site FROM "UnionSkinSite" WHERE code=split_part(subject_value,':',1);
 INSERT INTO "Session"("tokenHash","accountId","expiresAt") VALUES(session_hash,aid,expiry);
 INSERT INTO "AuditEvent"(id,"actorId",action,"targetType","targetId","organizationId",details)
 VALUES(gen_random_uuid(),aid,'AUTH_UNION_LOGIN','Account',aid::text,site."organizationId",jsonb_build_object('siteCode',site.code,'mappingRevision',site.revision));
 RETURN aid;
 END $$;
$ddl$,'__data__',quote_ident(ds)),'__auth__',quote_ident(az));
END $install$;
