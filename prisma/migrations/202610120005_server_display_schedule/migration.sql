-- Display windows affect discovery only; public_snapshot and signed releases are unchanged.
ALTER TABLE "Server"
 ADD COLUMN "displayMode" varchar(16) NOT NULL DEFAULT 'PERMANENT',
 ADD COLUMN "displayStartsAt" timestamptz(6),
 ADD COLUMN "displayEndsAt" timestamptz(6),
 ADD CONSTRAINT "Server_display_schedule" CHECK (
   ("displayMode"='PERMANENT' AND "displayStartsAt" IS NULL AND "displayEndsAt" IS NULL) OR
   ("displayMode"='RANGE' AND "displayStartsAt" IS NOT NULL AND "displayEndsAt" IS NOT NULL
    AND isfinite("displayStartsAt") AND isfinite("displayEndsAt") AND "displayStartsAt"<"displayEndsAt")
 );
DO $install$
DECLARE data_schema text := current_schema();
        security_schema text := CASE WHEN current_schema()='public' THEN 'authz' ELSE current_schema()||'_authz' END;
        statement text;
BEGIN
statement := $definitions$
CREATE OR REPLACE FUNCTION "__auth__".public_servers() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, "__data__", "__auth__", pg_temp AS $$
SELECT coalesce(jsonb_agg(jsonb_build_object('serverId',s."serverId",'displayName',s."displayName",'description',s.description,
 'displayMode',s."displayMode",'displayStartsAt',s."displayStartsAt",'displayEndsAt',s."displayEndsAt",
 'gameAddress',s."gameAddress",'themeColor',s."themeColor",'sortOrder',s."sortOrder",'organization',jsonb_build_object('id',o.id,'displayName',o."displayName"),
 'publicationRevision',b.revision,'currentRelease',jsonb_build_object('id',r.id,'clientId',r."clientId",'versionLabel',r."versionLabel",'name',r.name,
 'manifestSha256',r."manifestSha256",'packageFormatVersion',r."packageFormatVersion",'manifestUrl','/api/v1/servers/'||s."serverId"||'/manifest','packagesUrl','/api/v1/servers/'||s."serverId"||'/packages')) ORDER BY s."sortOrder",s."serverId"),'[]'::jsonb)
 FROM "__data__"."Server" s JOIN "__data__"."Organization" o ON o.id=s."organizationId"
 JOIN "__data__"."ServerPublication" b ON b."serverId"=s."serverId" JOIN "__data__"."Client" c ON c.id=b."clientId"
 JOIN "__data__"."ClientRelease" r ON r.id=b."releaseId"
 WHERE (s."displayMode"='PERMANENT' OR (s."displayStartsAt"<=CURRENT_TIMESTAMP AND s."displayEndsAt">CURRENT_TIMESTAMP)) AND s."isListed" AND s."archivedAt" IS NULL AND o."archivedAt" IS NULL AND c."archivedAt" IS NULL AND c."deletedAt" IS NULL AND r."archivedAt" IS NULL $$;

CREATE FUNCTION "__auth__".guard_server_display() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, "__data__", "__auth__", pg_temp AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
   IF (NEW."displayMode",NEW."displayStartsAt",NEW."displayEndsAt") IS NOT DISTINCT FROM
      (OLD."displayMode",OLD."displayStartsAt",OLD."displayEndsAt") THEN RETURN NEW; END IF;
 ELSE
   IF NEW."displayMode"='PERMANENT' AND NEW."displayStartsAt" IS NULL AND NEW."displayEndsAt" IS NULL THEN RETURN NEW; END IF;
 END IF;
 IF NOT ("__auth__".maintenance() OR "__auth__".super_panel()) THEN RAISE insufficient_privilege; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_server_display BEFORE INSERT OR UPDATE ON "__data__"."Server"
 FOR EACH ROW EXECUTE FUNCTION "__auth__".guard_server_display();
REVOKE ALL ON FUNCTION "__auth__".guard_server_display() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "__auth__".guard_server_display() TO mua_web,mua_owner;
$definitions$;
EXECUTE replace(replace(statement,'__data__',replace(data_schema,'"','""')),'__auth__',replace(security_schema,'"','""'));
END $install$;
