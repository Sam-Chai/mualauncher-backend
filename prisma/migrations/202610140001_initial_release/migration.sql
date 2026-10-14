DO $install$
DECLARE data_schema text := current_schema(); security_schema text := CASE WHEN current_schema()='public' THEN 'authz' ELSE current_schema()||'_authz' END; statement text;
BEGIN
PERFORM set_config('check_function_bodies','off',true);
statement := $definitions$

ALTER SCHEMA __data__ OWNER TO mua_owner;

CREATE SCHEMA __auth__;

ALTER SCHEMA __auth__ OWNER TO mua_owner;
GRANT USAGE, CREATE ON SCHEMA __data__, __auth__ TO mua_lookup;

CREATE TYPE __data__."AccountStatus" AS ENUM (
    'ACTIVE',
    'DISABLED'
);

ALTER TYPE __data__."AccountStatus" OWNER TO mua_owner;

CREATE TYPE __data__."DraftStatus" AS ENUM (
    'DRAFT',
    'SUBMITTED',
    'APPROVED',
    'REJECTED',
    'RELEASED'
);

ALTER TYPE __data__."DraftStatus" OWNER TO mua_owner;

CREATE TYPE __data__."Role" AS ENUM (
    'ORG_ADMIN',
    'SERVER_ADMIN',
    'CLIENT_EDITOR',
    'SERVER_EDITOR',
    'REVIEWER',
    'PUBLISHER',
    'RELEASE_OPERATOR',
    'READ_ONLY'
);

ALTER TYPE __data__."Role" OWNER TO mua_owner;

CREATE TYPE __data__."UploadStatus" AS ENUM (
    'UPLOADING',
    'QUEUED',
    'PROCESSING',
    'READY',
    'FAILED',
    'CANCELLED',
    'SUBMITTED'
);

ALTER TYPE __data__."UploadStatus" OWNER TO mua_owner;

CREATE FUNCTION __data__.mua_audit_append_only() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', '__data__', '__auth__', 'pg_temp'
    AS $$
BEGIN RAISE EXCEPTION 'Audit events are append-only'; END;
$$;

ALTER FUNCTION __data__.mua_audit_append_only() OWNER TO mua_lookup;

CREATE FUNCTION __data__.mua_binding_consistent() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', '__data__', '__auth__', 'pg_temp'
    AS $$
DECLARE client_id TEXT;
BEGIN
  client_id := CASE WHEN TG_TABLE_NAME = 'Client' THEN to_jsonb(NEW)->>'id' ELSE to_jsonb(NEW)->>'clientId' END;
  IF EXISTS (SELECT 1 FROM "ServerPublication" p JOIN "Client" c ON c."id" = p."clientId"
    WHERE p."clientId" = client_id AND p."releaseId" IS DISTINCT FROM c."currentReleaseId") THEN
    RAISE EXCEPTION 'Bound server and client current release must change atomically';
  END IF;
  RETURN NEW;
END $$;

ALTER FUNCTION __data__.mua_binding_consistent() OWNER TO mua_lookup;

CREATE FUNCTION __data__.mua_build_format_gate() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', '__data__', '__auth__', 'pg_temp'
    AS $$
DECLARE d "ClientDraft";
BEGIN
 SELECT * INTO d FROM "ClientDraft" WHERE "id"=NEW."draftId";
 IF NOT FOUND OR (d."packageFormatVersion"=1 AND (NEW."platform"='universal' OR NEW."revision"<>1)) OR
  (d."packageFormatVersion"=2 AND (NEW."platform"<>'universal' OR (NEW."required" AND NEW."revision"<>d."packageRevision"))) THEN
  RAISE EXCEPTION 'Package build format, platform and revision must match the source draft'; END IF;
 RETURN NEW;
END $$;

ALTER FUNCTION __data__.mua_build_format_gate() OWNER TO mua_lookup;

CREATE FUNCTION __data__.mua_client_identity() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', '__data__', '__auth__', 'pg_temp'
    AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId" OR NEW."scopeServerId" IS DISTINCT FROM OLD."scopeServerId" THEN
    RAISE EXCEPTION 'Client identity and authorization origin are immutable';
  END IF;
  IF NEW."name" IS DISTINCT FROM OLD."name" OR NEW."nameKey" IS DISTINCT FROM OLD."nameKey" THEN
    IF OLD."deletedAt" IS NOT NULL OR OLD."archivedAt" IS NOT NULL OR OLD."currentReleaseId" IS NOT NULL OR OLD."revision" <> 0
      OR EXISTS (SELECT 1 FROM "ClientDraft" WHERE "clientId" = OLD."id")
      OR EXISTS (SELECT 1 FROM "ClientRelease" WHERE "clientId" = OLD."id")
      OR (SELECT count(*) FROM "ClientUpload" WHERE "clientId" = OLD."id" AND "status"::text IN ('UPLOADING','QUEUED','PROCESSING','READY','SUBMITTED')) <> 1
      OR NOT EXISTS (SELECT 1 FROM "ClientUpload" WHERE "clientId" = OLD."id" AND "status" = 'READY') THEN
      RAISE EXCEPTION 'Established client names are immutable';
    END IF;
  END IF;
  IF OLD."deletedAt" IS NOT NULL AND (to_jsonb(NEW) - ARRAY['storageIndexedAt','recycledAt','updatedAt']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['storageIndexedAt','recycledAt','updatedAt']) THEN
    RAISE EXCEPTION 'Deleted clients cannot be restored or edited';
  END IF;
  IF OLD."deletedAt" IS NULL AND NEW."deletedAt" IS NOT NULL THEN
    IF OLD."archivedAt" IS NULL OR NEW."archivedAt" IS NULL OR NEW."requestedServerId" IS NOT NULL
      OR EXISTS (SELECT 1 FROM "ServerPublication" WHERE "clientId" = OLD."id")
      OR EXISTS (SELECT 1 FROM "ClientUpload" WHERE "clientId" = OLD."id" AND "status"::text IN ('UPLOADING','QUEUED','PROCESSING'))
      OR EXISTS (SELECT 1 FROM "PackageBuild" b JOIN "ClientDraft" d ON d."id" = b."draftId" WHERE d."clientId" = OLD."id" AND b."status" = 'PROCESSING') THEN
      RAISE EXCEPTION 'Client deletion requires archived, unbound and inactive resources';
    END IF;
  END IF;
  RETURN NEW;
END $$;

ALTER FUNCTION __data__.mua_client_identity() OWNER TO mua_lookup;

CREATE FUNCTION __data__.mua_draft_format_gate() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', '__data__', '__auth__', 'pg_temp'
    AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW."packageFormatVersion" IS DISTINCT FROM OLD."packageFormatVersion" THEN RAISE EXCEPTION 'Draft format is immutable'; END IF;
 RETURN NEW;
END $$;

ALTER FUNCTION __data__.mua_draft_format_gate() OWNER TO mua_lookup;

CREATE FUNCTION __data__.mua_draft_lock() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', '__data__', '__auth__', 'pg_temp'
    AS $$
BEGIN
  IF OLD."status"='RELEASED' OR NEW."clientId" IS DISTINCT FROM OLD."clientId" OR NEW."versionSequence"<>OLD."versionSequence" THEN
    RAISE EXCEPTION 'Released drafts and client/sequence identity are immutable';
  END IF;
  IF OLD."status" IN ('SUBMITTED','APPROVED') AND
    (to_jsonb(NEW) - ARRAY['status','reviewedById','reviewedRevision','reviewedPackageRevision','reviewedAt','reviewNote','updatedAt','packageRevision','archivedAt','archiveReason','supersededByDraftId','replacesDraftId']) IS DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['status','reviewedById','reviewedRevision','reviewedPackageRevision','reviewedAt','reviewNote','updatedAt','packageRevision','archivedAt','archiveReason','supersededByDraftId','replacesDraftId']) THEN
    RAISE EXCEPTION 'Submitted draft content is locked';
  END IF;
  IF NEW."packageRevision" IS DISTINCT FROM OLD."packageRevision" AND
    (NEW."packageRevision"<>OLD."packageRevision"+1 OR NEW."status"<>'SUBMITTED' OR NEW."reviewedById" IS NOT NULL OR NEW."reviewedPackageRevision" IS NOT NULL OR NEW."reviewedRevision" IS NOT NULL) THEN
    RAISE EXCEPTION 'Platform changes require a new review';
  END IF;
  RETURN NEW;
END $$;

ALTER FUNCTION __data__.mua_draft_lock() OWNER TO mua_lookup;

CREATE FUNCTION __data__.mua_draft_replacement_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', '__data__', '__auth__', 'pg_temp'
    AS $$
BEGIN
  IF NEW."replacesDraftId" IS NOT NULL AND (TG_OP='INSERT' OR NEW."replacesDraftId" IS DISTINCT FROM OLD."replacesDraftId") AND NOT EXISTS (
    SELECT 1 FROM "ClientDraft" p WHERE p."id"=NEW."replacesDraftId" AND p."clientId"=NEW."clientId"
      AND p."versionSequence"<NEW."versionSequence" AND p."archivedAt" IS NULL AND p."status"<>'RELEASED'
      AND NOT EXISTS (SELECT 1 FROM "ClientRelease" r WHERE r."sourceDraftId"=p."id")) THEN
    RAISE EXCEPTION 'Replacement must reference an earlier unpublished draft of the same client';
  END IF;
  RETURN NEW;
END $$;

ALTER FUNCTION __data__.mua_draft_replacement_guard() OWNER TO mua_lookup;

CREATE FUNCTION __data__.mua_no_delete() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', '__data__', '__auth__', 'pg_temp'
    AS $$
BEGIN RAISE EXCEPTION 'Business records must be archived or disabled, not deleted'; END;
$$;

ALTER FUNCTION __data__.mua_no_delete() OWNER TO mua_lookup;

CREATE FUNCTION __data__.mua_not_deleted_client() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', '__data__', '__auth__', 'pg_temp'
    AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Client" WHERE "id" = NEW."clientId" AND "deletedAt" IS NOT NULL) THEN RAISE EXCEPTION 'Deleted clients cannot accept resources or bindings'; END IF;
  RETURN NEW;
END $$;

ALTER FUNCTION __data__.mua_not_deleted_client() OWNER TO mua_lookup;

CREATE FUNCTION __data__.mua_package_build_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', '__data__', '__auth__', 'pg_temp'
    AS $$
DECLARE d "ClientDraft";
BEGIN
  SELECT * INTO d FROM "ClientDraft" WHERE "id" = NEW."draftId" FOR UPDATE;
  IF EXISTS (SELECT 1 FROM "Client" WHERE "id" = d."clientId" AND "deletedAt" IS NOT NULL) THEN
    RAISE EXCEPTION 'Deleted clients cannot build packages';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW."draftId" <> OLD."draftId" OR NEW."platform" <> OLD."platform" OR NEW."id" <> OLD."id" OR NEW."revision" <> OLD."revision" THEN
      RAISE EXCEPTION 'Package build identity is immutable';
    END IF;
    IF d."status" = 'RELEASED' OR (OLD."status" = 'READY' AND
      (to_jsonb(NEW) - ARRAY['required','updatedAt']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['required','updatedAt'])) THEN
      RAISE EXCEPTION 'Completed packages are immutable';
    END IF;
    IF NEW."required" IS DISTINCT FROM OLD."required" AND d."status" <> 'SUBMITTED' THEN
      RAISE EXCEPTION 'Reviewed platform selection is locked';
    END IF;
  ELSIF d."status" <> 'SUBMITTED' THEN RAISE EXCEPTION 'Builds require a submitted draft';
  END IF;
  RETURN NEW;
END $$;

ALTER FUNCTION __data__.mua_package_build_guard() OWNER TO mua_lookup;

CREATE FUNCTION __data__.mua_package_delete_gate() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', '__data__', '__auth__', 'pg_temp'
    AS $$
BEGIN
  IF OLD."deletedAt" IS NULL AND NEW."deletedAt" IS NOT NULL AND EXISTS (
    SELECT 1 FROM "PackageBuild" b JOIN "ClientDraft" d ON d."id"=b."draftId" WHERE d."clientId"=OLD."id" AND b."status"='PROCESSING'
  ) THEN RAISE EXCEPTION 'Client has an active package build'; END IF;
  RETURN NEW;
END $$;

ALTER FUNCTION __data__.mua_package_delete_gate() OWNER TO mua_lookup;

CREATE FUNCTION __data__.mua_package_publish_gate() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', '__data__', '__auth__', 'pg_temp'
    AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "ClientUpload" WHERE "draftId" = NEW."sourceDraftId") AND
    (NEW."id" <> NEW."sourceDraftId" OR EXISTS (SELECT 1 FROM "ClientDraft" WHERE "id"=NEW."sourceDraftId" AND "reviewedPackageRevision" IS DISTINCT FROM "packageRevision") OR NOT EXISTS (
      SELECT 1 FROM "PackageBuild" WHERE "draftId" = NEW."sourceDraftId" AND "required") OR EXISTS (
      SELECT 1 FROM "PackageBuild" WHERE "draftId" = NEW."sourceDraftId" AND "required" AND
       ("status" <> 'READY' OR "artifacts" IS NULL OR "targetSha256" IS NULL))) THEN
    RAISE EXCEPTION 'All required muapack artifacts must be ready before publication';
  END IF;
  RETURN NEW;
END $$;

ALTER FUNCTION __data__.mua_package_publish_gate() OWNER TO mua_lookup;

CREATE FUNCTION __data__.mua_publication_active() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', '__data__', '__auth__', 'pg_temp'
    AS $$
BEGIN
  IF NEW."clientId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "Client" c JOIN "Server" s ON s."organizationId" = c."organizationId"
    JOIN "Organization" o ON o."id" = c."organizationId"
    WHERE c."id" = NEW."clientId" AND s."serverId" = NEW."serverId" AND c."archivedAt" IS NULL AND s."archivedAt" IS NULL AND o."archivedAt" IS NULL
  ) THEN RAISE EXCEPTION 'Binding requires an active client and server in the same organization'; END IF;
  IF NEW."releaseId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "Client" c JOIN "ClientRelease" r ON r."clientId" = c."id"
    WHERE c."id" = NEW."clientId" AND r."id" = NEW."releaseId" AND c."currentReleaseId" = r."id" AND r."archivedAt" IS NULL
  ) THEN RAISE EXCEPTION 'Server must use the bound client current release'; END IF;
  RETURN NEW;
END $$;

ALTER FUNCTION __data__.mua_publication_active() OWNER TO mua_lookup;

CREATE FUNCTION __data__.mua_release_approved() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', '__data__', '__auth__', 'pg_temp'
    AS $$
DECLARE d "ClientDraft";
BEGIN
 SELECT * INTO d FROM "ClientDraft" WHERE "id"=NEW."sourceDraftId" FOR UPDATE;
 IF d."status"<>'APPROVED' OR d."archivedAt" IS NOT NULL OR d."reviewedRevision" IS DISTINCT FROM d."contentRevision" OR
  d."reviewedById" IS DISTINCT FROM NEW."approvedById" OR d."versionLabel" IS DISTINCT FROM NEW."versionLabel" OR d."name" IS DISTINCT FROM NEW."name" OR
  d."summary" IS DISTINCT FROM NEW."summary" OR d."description" IS DISTINCT FROM NEW."description" OR d."changelog" IS DISTINCT FROM NEW."changelog" OR
  (EXISTS (SELECT 1 FROM "ClientUpload" WHERE "draftId"=d."id") AND d."candidateMetadata" IS DISTINCT FROM NEW."environmentSnapshot") THEN
  RAISE EXCEPTION 'Release must match its approved draft revision'; END IF;
 IF d."packageFormatVersion"=1 AND (d."candidateManifestSha256" IS DISTINCT FROM NEW."manifestSha256" OR d."candidateManifestKey" IS DISTINCT FROM NEW."manifestObjectKey") THEN
  RAISE EXCEPTION 'v1 release must match its candidate manifest'; END IF;
 IF d."packageFormatVersion"=2 AND (
  d."reviewedPackageRevision" IS DISTINCT FROM d."packageRevision" OR
  (SELECT count(*) FROM "PackageBuild" WHERE "draftId"=d."id" AND "required")<>1 OR NOT EXISTS (
   SELECT 1 FROM "PackageBuild" WHERE "draftId"=d."id" AND "required" AND "platform"='universal' AND "revision"=d."packageRevision" AND "status"='READY'
    AND "targetObjectKey"=NEW."manifestObjectKey" AND "targetSha256"=NEW."manifestSha256" AND "artifacts"->>'signingKeyId'=NEW."signingKeyId")) THEN
  RAISE EXCEPTION 'v2 publication requires the reviewed, signed current recipe artifact'; END IF;
 RETURN NEW;
END $$;

ALTER FUNCTION __data__.mua_release_approved() OWNER TO mua_lookup;

CREATE FUNCTION __data__.mua_release_format_gate() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', '__data__', '__auth__', 'pg_temp'
    AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM "ClientDraft" WHERE "id"=NEW."sourceDraftId" AND "clientId"=NEW."clientId" AND "packageFormatVersion"=NEW."packageFormatVersion") THEN RAISE EXCEPTION 'Release format must match its draft'; END IF;
 RETURN NEW;
END $$;

ALTER FUNCTION __data__.mua_release_format_gate() OWNER TO mua_lookup;

CREATE FUNCTION __data__.mua_release_immutable() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', '__data__', '__auth__', 'pg_temp'
    AS $$
BEGIN
  IF (to_jsonb(NEW) - 'archivedAt') IS DISTINCT FROM (to_jsonb(OLD) - 'archivedAt') THEN
    RAISE EXCEPTION 'Published release content is immutable';
  END IF;
  RETURN NEW;
END $$;

ALTER FUNCTION __data__.mua_release_immutable() OWNER TO mua_lookup;

CREATE FUNCTION __data__.mua_scope_immutable() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', '__data__', '__auth__', 'pg_temp'
    AS $$
BEGIN
  IF NEW."serverId" IS DISTINCT FROM OLD."serverId" OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId" THEN
    RAISE EXCEPTION 'Resource identifiers and ownership are immutable';
  END IF;
  RETURN NEW;
END $$;

ALTER FUNCTION __data__.mua_scope_immutable() OWNER TO mua_lookup;

CREATE FUNCTION __data__.mua_server_complete() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', '__data__', '__auth__', 'pg_temp'
    AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "ServerPublication" WHERE "serverId" = NEW."serverId") THEN RAISE EXCEPTION 'Server requires a publication container'; END IF;
  RETURN NEW;
END $$;

ALTER FUNCTION __data__.mua_server_complete() OWNER TO mua_lookup;

CREATE FUNCTION __data__.mua_upload_format_gate() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', '__data__', '__auth__', 'pg_temp'
    AS $$
BEGIN
 IF NEW."packageFormatVersion"=2 AND NEW."status"::text IN ('READY','SUBMITTED') AND
   (NEW."sourceSha256" IS NULL OR NEW."filesObjectKey" IS NULL OR NEW."filesSha256" IS NULL OR
    NEW."statistics"->>'localFiles' IS NULL OR NEW."statistics"->>'remoteFiles' IS NULL) THEN RAISE EXCEPTION 'v2 requires a sealed recipe import'; END IF;
 RETURN NEW;
END $$;

ALTER FUNCTION __data__.mua_upload_format_gate() OWNER TO mua_lookup;

CREATE FUNCTION __data__.mua_upload_lock() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', '__data__', '__auth__', 'pg_temp'
    AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['status','attempts','progress','leaseToken','leaseUntil','error','filesObjectKey','filesSha256','statistics','comparisonStatistics','detectedMods','warnings','draftId','sourceSha256','updatedAt','processingPhase','detectedInfo','selectedInstanceId']) IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status','attempts','progress','leaseToken','leaseUntil','error','filesObjectKey','filesSha256','statistics','comparisonStatistics','detectedMods','warnings','draftId','sourceSha256','updatedAt','processingPhase','detectedInfo','selectedInstanceId']) THEN
    RAISE EXCEPTION 'Upload ownership, format, source and baselines are immutable';
  END IF;
  -- Text comparisons also allow this migration to run in the same transaction as enum creation.
  IF NOT (
    (OLD."status"::text='UPLOADING' AND NEW."status"::text IN ('UPLOADING','QUEUED','CANCELLED')) OR
    (OLD."status"::text='QUEUED' AND NEW."status"::text IN ('QUEUED','PROCESSING','CANCELLED')) OR
    (OLD."status"::text='PROCESSING' AND (NEW."status"::text IN ('PROCESSING','READY','FAILED') OR (NEW."status"::text='QUEUED' AND NEW."processingPhase"='SELECT_INSTANCE'))) OR
    (OLD."status"::text='FAILED' AND NEW."status"::text IN ('FAILED','QUEUED','CANCELLED')) OR
    (OLD."status"::text='READY' AND NEW."status"::text IN ('READY','SUBMITTED','CANCELLED')) OR
    (OLD."status"::text='SUBMITTED' AND NEW."status"::text='SUBMITTED') OR
    (OLD."status"::text='CANCELLED' AND NEW."status"::text='CANCELLED')) THEN RAISE EXCEPTION 'Invalid upload state transition'; END IF;
  IF OLD."status"::text IN ('READY','SUBMITTED','CANCELLED') AND
     (to_jsonb(NEW) - ARRAY['status','draftId','updatedAt']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','draftId','updatedAt']) THEN
    RAISE EXCEPTION 'Prepared upload content is immutable';
  END IF;
  IF OLD."status"::text IN ('SUBMITTED','CANCELLED') AND NEW."draftId" IS DISTINCT FROM OLD."draftId" THEN RAISE EXCEPTION 'Closed upload draft binding is immutable'; END IF;
  IF NEW."draftId" IS DISTINCT FROM OLD."draftId" AND NOT (OLD."status"::text='READY' AND NEW."status"::text='SUBMITTED') THEN RAISE EXCEPTION 'Upload may bind a draft only once at submission'; END IF;
  IF OLD."status"::text='READY' AND NEW."status"::text='SUBMITTED' AND NOT EXISTS (
    SELECT 1 FROM "ClientDraft" WHERE "id"=NEW."draftId" AND "clientId"=NEW."clientId" AND "sourceObjectKey"=NEW."sourceObjectKey"
      AND "packageFormatVersion"=NEW."packageFormatVersion" AND "status"='SUBMITTED') THEN
    RAISE EXCEPTION 'Submitted draft must match the sealed upload and format';
  END IF;
  RETURN NEW;
END $$;

ALTER FUNCTION __data__.mua_upload_lock() OWNER TO mua_lookup;

CREATE FUNCTION __auth__.account_directory() RETURNS TABLE(id uuid, "displayName" text, status __data__."AccountStatus", "isSuperAdmin" boolean, username text, "createdAt" timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', '__data__', '__auth__', 'pg_temp'
    AS $$ SELECT a.id,a."displayName",a.status,a."isSuperAdmin",c.username::text,a."createdAt"
 FROM "__data__"."Account" a LEFT JOIN "__data__"."LocalCredential" c ON c."accountId"=a.id
 WHERE "__auth__".directory_reader() AND (a.status='ACTIVE' OR "__auth__".super_panel() OR "__auth__".maintenance()
 OR EXISTS(SELECT 1 FROM "__data__"."OrganizationMember" m WHERE m."accountId"=a.id AND "__auth__".org_permission(m."organizationId",'ORG_MEMBERS_READ'))) $$;

ALTER FUNCTION __auth__.account_directory() OWNER TO mua_lookup;

CREATE FUNCTION __auth__.active_actor() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', '__data__', '__auth__', 'pg_temp'
    AS $$ SELECT EXISTS(SELECT 1 FROM "__data__"."Account" WHERE id="__auth__".actor_id() AND status='ACTIVE') $$;

ALTER FUNCTION __auth__.active_actor() OWNER TO mua_lookup;

CREATE FUNCTION __auth__.actor_id() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$ SELECT nullif(current_setting('mua.account_id',true),'')::uuid $$;

ALTER FUNCTION __auth__.actor_id() OWNER TO mua_lookup;

CREATE FUNCTION __auth__.api_actor(hash text) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', '__data__', '__auth__', 'pg_temp'
    AS $_$ SELECT jsonb_build_object('id',a.id,'displayName',a."displayName",'isSuperAdmin',a."isSuperAdmin",
 'apiScope',jsonb_build_object('tokenId',t.id,'permissions',t.permissions,'serverIds',t."serverIds"))
 FROM "__data__"."ApiToken" t JOIN "__data__"."Account" a ON a.id=t."accountId"
 WHERE t."tokenHash"=$1 AND t."revokedAt" IS NULL AND t."expiresAt">now() AND a.status='ACTIVE' $_$;

ALTER FUNCTION __auth__.api_actor(hash text) OWNER TO mua_lookup;

CREATE FUNCTION __auth__.archive_binding(client_id text, server_id text, account_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', '__data__', '__auth__', 'pg_temp'
    AS $_$ BEGIN
 IF NOT ("__auth__".maintenance() OR $3="__auth__".actor_id()) OR NOT "__auth__".client_permission($1,'CLIENT_ARCHIVE') OR NOT EXISTS(SELECT 1 FROM "__data__"."Client" c
 JOIN "__data__"."ServerPublication" b ON b."clientId"=c.id WHERE c.id=$1 AND c."archivedAt" IS NOT NULL AND b."serverId"=$2) THEN RAISE insufficient_privilege; END IF;
 UPDATE "__data__"."ServerPublication" SET "clientId"=NULL,"releaseId"=NULL,revision=revision+1,"changedById"=$3,"updatedAt"=now() WHERE "serverId"=$2;
 UPDATE "__data__"."Server" SET "isListed"=false,"updatedAt"=now() WHERE "serverId"=$2;
END $_$;

ALTER FUNCTION __auth__.archive_binding(client_id text, server_id text, account_id uuid) OWNER TO mua_owner;

CREATE FUNCTION __auth__.client_permission(client_id text, permission text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', '__data__', '__auth__', 'pg_temp'
    AS $_$ SELECT "__auth__".maintenance() OR EXISTS(SELECT 1 FROM "__data__"."Client" c
 LEFT JOIN "__data__"."ServerPublication" b ON b."clientId"=c.id
 WHERE c.id=$1 AND c."deletedAt" IS NULL AND CASE WHEN coalesce(b."serverId",c."scopeServerId") IS NOT NULL
 THEN "__auth__".server_permission(coalesce(b."serverId",c."scopeServerId"),$2)
 ELSE "__auth__".org_permission(c."organizationId",$2) END) $_$;

ALTER FUNCTION __auth__.client_permission(client_id text, permission text) OWNER TO mua_lookup;

CREATE FUNCTION __auth__.client_row_permission(client_id text, org_id uuid, scope_id text, deleted_at timestamp with time zone, permission text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', '__data__', '__auth__', 'pg_temp'
    AS $_$ SELECT $4 IS NULL AND CASE WHEN coalesce((SELECT "serverId" FROM "__data__"."ServerPublication" WHERE "clientId"=$1),$3) IS NOT NULL
 THEN "__auth__".server_permission(coalesce((SELECT "serverId" FROM "__data__"."ServerPublication" WHERE "clientId"=$1),$3),$5)
 ELSE "__auth__".org_permission($2,$5) END $_$;

ALTER FUNCTION __auth__.client_row_permission(client_id text, org_id uuid, scope_id text, deleted_at timestamp with time zone, permission text) OWNER TO mua_lookup;

CREATE FUNCTION __auth__.client_summary(client_id text) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', '__data__', '__auth__', 'pg_temp'
    AS $_$ SELECT jsonb_build_object('initialPackageFormatVersion',(SELECT r."packageFormatVersion" FROM "__data__"."ClientRelease" r WHERE r."clientId"=$1 ORDER BY r."publishedAt",r.id LIMIT 1),
 'processingPackages',(SELECT count(*) FROM "__data__"."PackageBuild" b JOIN "__data__"."ClientDraft" d ON d.id=b."draftId" WHERE d."clientId"=$1 AND b.status='PROCESSING'))
 WHERE "__auth__".client_permission($1,'SERVER_READ') $_$;

ALTER FUNCTION __auth__.client_summary(client_id text) OWNER TO mua_lookup;

CREATE FUNCTION __auth__.client_write(client_id text, permissions text[]) RETURNS boolean
    LANGUAGE sql STABLE
    AS $_$ SELECT EXISTS(SELECT 1 FROM unnest($2) p WHERE "__auth__".client_permission($1,p)) $_$;

ALTER FUNCTION __auth__.client_write(client_id text, permissions text[]) OWNER TO mua_lookup;

CREATE FUNCTION __auth__.create_credential(account_id uuid, username text, password_hash text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', '__data__', '__auth__', 'pg_temp'
    AS $_$ BEGIN
 IF NOT ("__auth__".maintenance() OR "__auth__".super_panel()) THEN RAISE insufficient_privilege; END IF;
 INSERT INTO "__data__"."LocalCredential"("accountId",username,"passwordHash","updatedAt") VALUES($1,$2,$3,now());
END $_$;

ALTER FUNCTION __auth__.create_credential(account_id uuid, username text, password_hash text) OWNER TO mua_owner;

CREATE FUNCTION __auth__.delete_client(client_id text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', '__data__', '__auth__', 'pg_temp'
    AS $_$ BEGIN
 IF NOT "__auth__".client_permission($1,'CLIENT_DELETE') THEN RAISE insufficient_privilege; END IF;
 UPDATE "__data__"."Client" SET "deletedAt"=now(),"updatedAt"=now() WHERE id=$1;
END $_$;

ALTER FUNCTION __auth__.delete_client(client_id text) OWNER TO mua_owner;

CREATE FUNCTION __auth__.directory_reader() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', '__data__', '__auth__', 'pg_temp'
    AS $$ SELECT "__auth__".maintenance() OR "__auth__".super_panel() OR EXISTS(
 SELECT 1 FROM "__data__"."OrganizationMember" m WHERE m."accountId"="__auth__".actor_id()
 AND m.status='ACTIVE' AND "__auth__".org_permission(m."organizationId",'ORG_MEMBERS_READ')) $$;

ALTER FUNCTION __auth__.directory_reader() OWNER TO mua_lookup;

CREATE FUNCTION __auth__.draft_client(draft_id uuid) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', '__data__', '__auth__', 'pg_temp'
    AS $_$ SELECT "clientId" FROM "__data__"."ClientDraft" WHERE id=$1 $_$;

ALTER FUNCTION __auth__.draft_client(draft_id uuid) OWNER TO mua_lookup;

CREATE FUNCTION __auth__.guard_server_display() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', '__data__', '__auth__', 'pg_temp'
    AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
   IF (NEW."displayMode",NEW."displayStartsAt",NEW."displayEndsAt") IS NOT DISTINCT FROM
      (OLD."displayMode",OLD."displayStartsAt",OLD."displayEndsAt") THEN RETURN NEW; END IF;
   IF "__auth__".maintenance() OR "__auth__".super_panel() OR "__auth__".server_permission(OLD."serverId",'SERVER_EDIT') THEN
     RETURN NEW;
   END IF;
 ELSE
   IF NEW."displayMode"='PERMANENT' AND NEW."displayStartsAt" IS NULL AND NEW."displayEndsAt" IS NULL THEN RETURN NEW; END IF;
   IF "__auth__".maintenance() OR "__auth__".super_panel() THEN RETURN NEW; END IF;
 END IF;
 RAISE insufficient_privilege;
END $$;

ALTER FUNCTION __auth__.guard_server_display() OWNER TO mua_owner;

CREATE FUNCTION __auth__.maintenance() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', '__data__', '__auth__', 'pg_temp'
    AS $$ SELECT session_user='mua_migrator' OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname=session_user AND rolsuper) $$;

ALTER FUNCTION __auth__.maintenance() OWNER TO mua_lookup;

CREATE FUNCTION __auth__.org_permission(org_id uuid, permission text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', '__data__', '__auth__', 'pg_temp'
    AS $_$ SELECT "__auth__".token_allows($2) AND EXISTS(SELECT 1 FROM "__data__"."Account" a
 WHERE a.id="__auth__".actor_id() AND a.status='ACTIVE' AND (a."isSuperAdmin" OR EXISTS(
 SELECT 1 FROM "__data__"."OrganizationMember" m JOIN "__auth__".role_permission p ON p.role=ANY(m.roles::text[]) AND p.permission=$2
 WHERE m."organizationId"=$1 AND m."accountId"=a.id AND m.status='ACTIVE'))) $_$;

ALTER FUNCTION __auth__.org_permission(org_id uuid, permission text) OWNER TO mua_lookup;

CREATE FUNCTION __auth__.org_visible(org_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', '__data__', '__auth__', 'pg_temp'
    AS $_$ SELECT "__auth__".maintenance() OR "__auth__".active_actor() AND (
 "__auth__".super_actor() OR EXISTS(SELECT 1 FROM "__data__"."OrganizationMember"
 WHERE "organizationId"=$1 AND "accountId"="__auth__".actor_id() AND status='ACTIVE'))
 AND ("__auth__".panel() OR EXISTS(SELECT 1 FROM "__data__"."Server" s WHERE s."organizationId"=$1 AND "__auth__".token_allows('SERVER_READ',s."serverId"))) $_$;

ALTER FUNCTION __auth__.org_visible(org_id uuid) OWNER TO mua_lookup;

CREATE FUNCTION __auth__.panel() RETURNS boolean
    LANGUAGE sql STABLE
    AS $$ SELECT coalesce(current_setting('mua.auth_kind',true)='session',false) $$;

ALTER FUNCTION __auth__.panel() OWNER TO mua_lookup;

CREATE FUNCTION __auth__.public_servers() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', '__data__', '__auth__', 'pg_temp'
    AS $$
SELECT coalesce(jsonb_agg(jsonb_build_object('serverId',s."serverId",'displayName',s."displayName",'description',s.description,
 'displayMode',s."displayMode",'displayStartsAt',s."displayStartsAt",'displayEndsAt',s."displayEndsAt",
 'gameAddress',s."gameAddress",'themeColor',s."themeColor",'sortOrder',s."sortOrder",'organization',jsonb_build_object('id',o.id,'displayName',o."displayName"),
 'publicationRevision',b.revision,'currentRelease',jsonb_build_object('id',r.id,'clientId',r."clientId",'versionLabel',r."versionLabel",'name',r.name,
 'manifestSha256',r."manifestSha256",'packageFormatVersion',r."packageFormatVersion",'manifestUrl','/api/v1/servers/'||s."serverId"||'/manifest','packagesUrl','/api/v1/servers/'||s."serverId"||'/packages')) ORDER BY s."sortOrder",s."serverId"),'[]'::jsonb)
 FROM "__data__"."Server" s JOIN "__data__"."Organization" o ON o.id=s."organizationId"
 JOIN "__data__"."ServerPublication" b ON b."serverId"=s."serverId" JOIN "__data__"."Client" c ON c.id=b."clientId"
 JOIN "__data__"."ClientRelease" r ON r.id=b."releaseId"
 WHERE (s."displayMode"='PERMANENT' OR (s."displayStartsAt"<=CURRENT_TIMESTAMP AND s."displayEndsAt">CURRENT_TIMESTAMP)) AND s."isListed" AND s."archivedAt" IS NULL AND o."archivedAt" IS NULL AND c."archivedAt" IS NULL AND c."deletedAt" IS NULL AND r."archivedAt" IS NULL $$;

ALTER FUNCTION __auth__.public_servers() OWNER TO mua_lookup;

CREATE FUNCTION __auth__.public_snapshot(server_id text, release_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', '__data__', '__auth__', 'pg_temp'
    AS $_$
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
 'uploads',coalesce((SELECT jsonb_agg(jsonb_build_object('draftId',u."draftId",'baseReleaseId',u."baseReleaseId")) FROM "__data__"."ClientUpload" u JOIN target t ON t."sourceDraftId"=u."draftId"),'[]')) FROM binding b $_$;

ALTER FUNCTION __auth__.public_snapshot(server_id text, release_id uuid) OWNER TO mua_lookup;

CREATE FUNCTION __auth__.release_details(release_id uuid) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', '__data__', '__auth__', 'pg_temp'
    AS $_$ SELECT jsonb_build_object('packageRevision',d."packageRevision",
 'upload',(SELECT jsonb_build_object('statistics',u.statistics,'comparisonStatistics',u."comparisonStatistics") FROM "__data__"."ClientUpload" u WHERE u."draftId"=d.id),
 'packageBuilds',coalesce((SELECT jsonb_agg(jsonb_build_object('draftId',p."draftId",'platform',p.platform,'revision',p.revision,'status',p.status,'required',p.required,'artifacts',p.artifacts) ORDER BY p.platform)
 FROM "__data__"."PackageBuild" p WHERE p."draftId"=d.id AND p.required),'[]'::jsonb))
 FROM "__data__"."ClientRelease" r JOIN "__data__"."ClientDraft" d ON d.id=r."sourceDraftId"
 WHERE r.id=$1 AND "__auth__".client_permission(r."clientId",'RELEASE_READ') $_$;

ALTER FUNCTION __auth__.release_details(release_id uuid) OWNER TO mua_lookup;

CREATE FUNCTION __auth__.revoke_sessions(account_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', '__data__', '__auth__', 'pg_temp'
    AS $_$ BEGIN
 IF NOT ("__auth__".maintenance() OR "__auth__".super_panel() OR "__auth__".panel() AND $1="__auth__".actor_id()) THEN RAISE insufficient_privilege; END IF;
 DELETE FROM "__data__"."Session" WHERE "accountId"=$1;
END $_$;

ALTER FUNCTION __auth__.revoke_sessions(account_id uuid) OWNER TO mua_owner;

CREATE FUNCTION __auth__.server_permission(server_id text, permission text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', '__data__', '__auth__', 'pg_temp'
    AS $_$ SELECT "__auth__".maintenance() OR "__auth__".token_allows($2,$1) AND EXISTS(SELECT 1 FROM "__data__"."Account" a
 WHERE a.id="__auth__".actor_id() AND a.status='ACTIVE' AND (a."isSuperAdmin" OR EXISTS(
 SELECT 1 FROM "__data__"."Server" s JOIN "__data__"."OrganizationMember" m ON m."organizationId"=s."organizationId"
 LEFT JOIN "__data__"."ServerGrant" g ON g."serverId"=s."serverId" AND g."accountId"=m."accountId"
 JOIN "__auth__".role_permission p ON p.role=ANY(m.roles::text[]||coalesce(g.roles::text[],ARRAY[]::text[])) AND p.permission=$2
 WHERE s."serverId"=$1 AND m."accountId"=a.id AND m.status='ACTIVE'))) $_$;

ALTER FUNCTION __auth__.server_permission(server_id text, permission text) OWNER TO mua_lookup;

CREATE FUNCTION __auth__.server_summary(server_id text) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', '__data__', '__auth__', 'pg_temp'
    AS $_$ SELECT jsonb_build_object('currentReleaseActive',r.id IS NOT NULL AND r."archivedAt" IS NULL)
 FROM "__data__"."ServerPublication" b LEFT JOIN "__data__"."ClientRelease" r ON r.id=b."releaseId"
 WHERE b."serverId"=$1 AND "__auth__".server_permission($1,'SERVER_READ') $_$;

ALTER FUNCTION __auth__.server_summary(server_id text) OWNER TO mua_lookup;

CREATE FUNCTION __auth__.session_actor(hash text) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', '__data__', '__auth__', 'pg_temp'
    AS $_$ SELECT jsonb_build_object('id',a.id,'displayName',a."displayName",'isSuperAdmin',a."isSuperAdmin",'username',c.username)
 FROM "__data__"."Session" s JOIN "__data__"."Account" a ON a.id=s."accountId"
 LEFT JOIN "__data__"."LocalCredential" c ON c."accountId"=a.id
 WHERE s."tokenHash"=$1 AND s."expiresAt">now() AND a.status='ACTIVE' $_$;

ALTER FUNCTION __auth__.session_actor(hash text) OWNER TO mua_lookup;

CREATE FUNCTION __auth__.set_password(account_id uuid, password_hash text, expected_hash text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', '__data__', '__auth__', 'pg_temp'
    AS $_$ BEGIN
 IF NOT ("__auth__".maintenance() OR "__auth__".super_panel() OR "__auth__".panel() AND $1="__auth__".actor_id() AND $3 IS NOT NULL) THEN RAISE insufficient_privilege; END IF;
 UPDATE "__data__"."LocalCredential" SET "passwordHash"=$2,"updatedAt"=now() WHERE "accountId"=$1 AND ($3 IS NULL OR "passwordHash"=$3);
 IF NOT FOUND THEN RAISE EXCEPTION 'Password changed concurrently' USING ERRCODE='40001'; END IF;
END $_$;

ALTER FUNCTION __auth__.set_password(account_id uuid, password_hash text, expected_hash text) OWNER TO mua_owner;

CREATE FUNCTION __auth__.super_actor() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', '__data__', '__auth__', 'pg_temp'
    AS $$ SELECT EXISTS(SELECT 1 FROM "__data__"."Account" WHERE id="__auth__".actor_id() AND status='ACTIVE' AND "isSuperAdmin") $$;

ALTER FUNCTION __auth__.super_actor() OWNER TO mua_lookup;

CREATE FUNCTION __auth__.super_panel() RETURNS boolean
    LANGUAGE sql STABLE
    AS $$ SELECT "__auth__".super_actor() AND "__auth__".panel() $$;

ALTER FUNCTION __auth__.super_panel() OWNER TO mua_lookup;

CREATE FUNCTION __auth__.token_allows(permission text, server_id text DEFAULT NULL::text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', '__data__', '__auth__', 'pg_temp'
    AS $$ SELECT CASE WHEN "__auth__".panel() THEN true ELSE EXISTS (
 SELECT 1 FROM "__data__"."ApiToken" t WHERE t.id=nullif(current_setting('mua.api_token_id',true),'')::uuid
 AND t."accountId"="__auth__".actor_id() AND t."revokedAt" IS NULL AND t."expiresAt">now()
 AND permission=ANY(t.permissions) AND (cardinality(t."serverIds")=0 OR server_id=ANY(t."serverIds"))
) END $$;

ALTER FUNCTION __auth__.token_allows(permission text, server_id text) OWNER TO mua_lookup;

CREATE FUNCTION __auth__.upload_options() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', '__data__', '__auth__', 'pg_temp'
    AS $$ SELECT jsonb_build_object('enabledPackageFormats',coalesce((SELECT "enabledPackageFormats" FROM "__data__"."PlatformSettings" WHERE id='platform'),ARRAY[1,2]),
 'maxUploadSizeMb',coalesce((SELECT "maxUploadSizeMb" FROM "__data__"."PlatformSettings" WHERE id='platform'),1024),
 'javaImageType',coalesce((SELECT "javaImageType" FROM "__data__"."PlatformSettings" WHERE id='platform'),'jre'))
 WHERE "__auth__".active_actor() OR "__auth__".maintenance() OR session_user='mua_worker' $$;

ALTER FUNCTION __auth__.upload_options() OWNER TO mua_lookup;

CREATE TABLE __data__."Account" (
    id uuid NOT NULL,
    "displayName" text NOT NULL,
    status __data__."AccountStatus" DEFAULT 'ACTIVE'::__data__."AccountStatus" NOT NULL,
    "isSuperAdmin" boolean DEFAULT false NOT NULL,
    "createdAt" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(6) with time zone NOT NULL
);

ALTER TABLE ONLY __data__."Account" FORCE ROW LEVEL SECURITY;

ALTER TABLE __data__."Account" OWNER TO mua_owner;

CREATE TABLE __data__."ApiToken" (
    id uuid NOT NULL,
    "accountId" uuid NOT NULL,
    name text NOT NULL,
    "tokenHash" character(64) NOT NULL,
    permissions text[],
    "serverIds" text[],
    "expiresAt" timestamp(6) with time zone NOT NULL,
    "revokedAt" timestamp(6) with time zone,
    "createdAt" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE ONLY __data__."ApiToken" FORCE ROW LEVEL SECURITY;

ALTER TABLE __data__."ApiToken" OWNER TO mua_owner;

CREATE TABLE __data__."AuditEvent" (
    id uuid NOT NULL,
    "actorId" uuid NOT NULL,
    "organizationId" uuid,
    "serverId" character varying(5),
    action text NOT NULL,
    "targetType" text NOT NULL,
    "targetId" text NOT NULL,
    details jsonb NOT NULL,
    "createdAt" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "AuditEvent_server_scope" CHECK ((("serverId" IS NULL) OR ("organizationId" IS NOT NULL)))
);

ALTER TABLE ONLY __data__."AuditEvent" FORCE ROW LEVEL SECURITY;

ALTER TABLE __data__."AuditEvent" OWNER TO mua_owner;

CREATE TABLE __data__."CasObject" (
    sha256 character(64) NOT NULL,
    size bigint NOT NULL,
    "trashedAt" timestamp(6) with time zone,
    "purgedAt" timestamp(6) with time zone,
    CONSTRAINT "CasObject_size_check" CHECK ((size >= 0))
);

ALTER TABLE ONLY __data__."CasObject" FORCE ROW LEVEL SECURITY;

ALTER TABLE __data__."CasObject" OWNER TO mua_owner;

CREATE TABLE __data__."CasReference" (
    "clientId" text NOT NULL,
    sha256 character(64) NOT NULL
);

ALTER TABLE ONLY __data__."CasReference" FORCE ROW LEVEL SECURITY;

ALTER TABLE __data__."CasReference" OWNER TO mua_owner;

CREATE TABLE __data__."Client" (
    id text CONSTRAINT "Client_serverId_not_null" NOT NULL,
    "organizationId" uuid NOT NULL,
    "archivedAt" timestamp(6) with time zone,
    "createdAt" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(6) with time zone NOT NULL,
    name text NOT NULL,
    "nameKey" text NOT NULL,
    "scopeServerId" character varying(5),
    "currentReleaseId" uuid,
    revision integer DEFAULT 0 NOT NULL,
    "requestedServerId" character varying(5),
    "requestedRevision" integer,
    "expectedClientId" text,
    "deletedAt" timestamp(6) with time zone,
    "storageIndexedAt" timestamp(6) with time zone,
    "recycledAt" timestamp(6) with time zone,
    CONSTRAINT "Client_name_bounds" CHECK ((((length(btrim(name)) >= 1) AND (length(btrim(name)) <= 200)) AND ("nameKey" = lower(NORMALIZE(btrim(name), NFKC))))),
    CONSTRAINT "Client_requested_binding" CHECK (((("requestedServerId" IS NULL) AND ("requestedRevision" IS NULL) AND ("expectedClientId" IS NULL)) OR (("requestedServerId" IS NOT NULL) AND ("requestedRevision" >= 0)))),
    CONSTRAINT "Client_revision_bounds" CHECK ((revision >= 0))
);

ALTER TABLE ONLY __data__."Client" FORCE ROW LEVEL SECURITY;

ALTER TABLE __data__."Client" OWNER TO mua_owner;

CREATE TABLE __data__."ClientDraft" (
    id uuid NOT NULL,
    "clientId" text CONSTRAINT "ClientDraft_serverId_not_null" NOT NULL,
    "versionLabel" text,
    name text,
    description text DEFAULT ''::text NOT NULL,
    changelog text DEFAULT ''::text NOT NULL,
    "candidateMetadata" jsonb,
    "sourceObjectKey" text,
    "candidateManifestKey" text,
    "candidateManifestSha256" character(64),
    "contentRevision" integer DEFAULT 1 NOT NULL,
    status __data__."DraftStatus" DEFAULT 'DRAFT'::__data__."DraftStatus" NOT NULL,
    "createdById" uuid NOT NULL,
    "reviewedById" uuid,
    "reviewedRevision" integer,
    "reviewedAt" timestamp(6) with time zone,
    "reviewNote" text,
    "archivedAt" timestamp(6) with time zone,
    "createdAt" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(6) with time zone NOT NULL,
    summary text DEFAULT ''::text NOT NULL,
    "packageRevision" integer DEFAULT 1 NOT NULL,
    "reviewedPackageRevision" integer,
    "versionSequence" integer NOT NULL,
    "replacesDraftId" uuid,
    "archiveReason" text,
    "supersededByDraftId" uuid,
    "packageFormatVersion" integer DEFAULT 1 NOT NULL,
    CONSTRAINT "ClientDraft_packageFormatVersion_check" CHECK (("packageFormatVersion" = ANY (ARRAY[1, 2]))),
    CONSTRAINT "ClientDraft_packageRevision_check" CHECK (("packageRevision" > 0)),
    CONSTRAINT "Draft_approval_revision" CHECK (((status <> ALL (ARRAY['APPROVED'::__data__."DraftStatus", 'RELEASED'::__data__."DraftStatus"])) OR (("reviewedById" IS NOT NULL) AND ("reviewedAt" IS NOT NULL) AND ("reviewedRevision" = "contentRevision") AND ("candidateManifestSha256" IS NOT NULL) AND ("candidateManifestKey" IS NOT NULL)))),
    CONSTRAINT "Draft_archive_reason" CHECK (((("archiveReason" IS NULL) AND ("supersededByDraftId" IS NULL)) OR (("archivedAt" IS NOT NULL) AND (COALESCE("archiveReason", ''::text) = 'MANUAL'::text) AND ("supersededByDraftId" IS NULL)) OR (("archivedAt" IS NOT NULL) AND (COALESCE("archiveReason", ''::text) = 'SUPERSEDED'::text) AND ("supersededByDraftId" IS NOT NULL)))),
    CONSTRAINT "Draft_digest_format" CHECK ((("candidateManifestSha256" IS NULL) OR ("candidateManifestSha256" ~ '^[0-9a-f]{64}$'::text))),
    CONSTRAINT "Draft_revision_positive" CHECK (("contentRevision" > 0))
);

ALTER TABLE ONLY __data__."ClientDraft" FORCE ROW LEVEL SECURITY;

ALTER TABLE __data__."ClientDraft" OWNER TO mua_owner;

CREATE SEQUENCE __data__."ClientDraft_versionSequence_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE __data__."ClientDraft_versionSequence_seq" OWNER TO mua_owner;

ALTER SEQUENCE __data__."ClientDraft_versionSequence_seq" OWNED BY __data__."ClientDraft"."versionSequence";

CREATE TABLE __data__."ClientRelease" (
    id uuid NOT NULL,
    "clientId" text CONSTRAINT "ClientRelease_serverId_not_null" NOT NULL,
    "sourceDraftId" uuid NOT NULL,
    "versionLabel" text NOT NULL,
    name text NOT NULL,
    description text NOT NULL,
    changelog text NOT NULL,
    "environmentSnapshot" jsonb NOT NULL,
    "manifestObjectKey" text NOT NULL,
    "manifestSha256" character(64) NOT NULL,
    "packObjectKey" text,
    "signingKeyId" text NOT NULL,
    signature text NOT NULL,
    "approvedById" uuid NOT NULL,
    "publishedById" uuid NOT NULL,
    "publishedAt" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "archivedAt" timestamp(6) with time zone,
    summary text DEFAULT ''::text NOT NULL,
    "packageFormatVersion" integer DEFAULT 1 NOT NULL,
    CONSTRAINT "ClientRelease_packageFormatVersion_check" CHECK (("packageFormatVersion" = ANY (ARRAY[1, 2]))),
    CONSTRAINT "Release_digest_format" CHECK (("manifestSha256" ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT "Release_signed_snapshot" CHECK (((length(signature) > 0) AND (length("signingKeyId") > 0) AND (length("versionLabel") > 0)))
);

ALTER TABLE ONLY __data__."ClientRelease" FORCE ROW LEVEL SECURITY;

ALTER TABLE __data__."ClientRelease" OWNER TO mua_owner;

CREATE TABLE __data__."ClientUpload" (
    id uuid NOT NULL,
    "clientId" text CONSTRAINT "ClientUpload_serverId_not_null" NOT NULL,
    "createdById" uuid NOT NULL,
    "fileName" text NOT NULL,
    size bigint NOT NULL,
    "partSize" integer NOT NULL,
    "multipartId" text NOT NULL,
    "sourceObjectKey" text NOT NULL,
    "sourceSha256" character(64),
    "baseReleaseId" uuid,
    "basePublicationRevision" integer NOT NULL,
    status __data__."UploadStatus" DEFAULT 'UPLOADING'::__data__."UploadStatus" NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    progress integer DEFAULT 0 NOT NULL,
    "leaseToken" uuid,
    "leaseUntil" timestamp(6) with time zone,
    error text,
    "filesObjectKey" text,
    "filesSha256" character(64),
    statistics jsonb,
    "detectedMods" text[] DEFAULT ARRAY[]::text[],
    warnings text[] DEFAULT ARRAY[]::text[],
    "draftId" uuid,
    "expiresAt" timestamp(6) with time zone NOT NULL,
    "createdAt" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(6) with time zone NOT NULL,
    "processingPhase" text,
    "detectedInfo" jsonb,
    "selectedInstanceId" text,
    "comparisonDraftId" uuid,
    "comparisonStatistics" jsonb,
    "packageFormatVersion" integer DEFAULT 1 NOT NULL,
    CONSTRAINT "ClientUpload_packageFormatVersion_check" CHECK (("packageFormatVersion" = ANY (ARRAY[1, 2]))),
    CONSTRAINT "Upload_bounds" CHECK (((size > 0) AND (size <= '21474836480'::bigint) AND ("partSize" >= 5242880) AND ("basePublicationRevision" >= 0) AND ((progress >= 0) AND (progress <= 100)))),
    CONSTRAINT "Upload_ready_inventory" CHECK (((status <> ALL (ARRAY['READY'::__data__."UploadStatus", 'SUBMITTED'::__data__."UploadStatus"])) OR (("filesObjectKey" IS NOT NULL) AND ("filesSha256" ~ '^[0-9a-f]{64}$'::text) AND ("sourceSha256" ~ '^[0-9a-f]{64}$'::text) AND (statistics IS NOT NULL)))),
    CONSTRAINT "Upload_submitted_draft" CHECK (((status <> 'SUBMITTED'::__data__."UploadStatus") OR ("draftId" IS NOT NULL))),
    CONSTRAINT upload_phase_valid CHECK ((("processingPhase" IS NULL) OR ("processingPhase" = ANY (ARRAY['FETCHING'::text, 'INSPECTING'::text, 'SELECT_INSTANCE'::text, 'DOWNLOADING'::text, 'CAS'::text]))))
);

ALTER TABLE ONLY __data__."ClientUpload" FORCE ROW LEVEL SECURITY;

ALTER TABLE __data__."ClientUpload" OWNER TO mua_owner;

CREATE TABLE __data__."LocalCredential" (
    "accountId" uuid NOT NULL,
    username character varying(64) NOT NULL,
    "passwordHash" text NOT NULL,
    "createdAt" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(6) with time zone NOT NULL,
    CONSTRAINT "Credential_username_format" CHECK (((username)::text ~ '^[a-z0-9_.-]{3,64}$'::text))
);

ALTER TABLE ONLY __data__."LocalCredential" FORCE ROW LEVEL SECURITY;

ALTER TABLE __data__."LocalCredential" OWNER TO mua_owner;

CREATE TABLE __data__."LoginThrottle" (
    key character(64) NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    "resetAt" timestamp(6) with time zone NOT NULL
);

ALTER TABLE ONLY __data__."LoginThrottle" FORCE ROW LEVEL SECURITY;

ALTER TABLE __data__."LoginThrottle" OWNER TO mua_owner;

CREATE TABLE __data__."Organization" (
    id uuid NOT NULL,
    "displayName" text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    "avatarObjectKey" text,
    "archivedAt" timestamp(6) with time zone,
    "createdAt" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(6) with time zone NOT NULL
);

ALTER TABLE ONLY __data__."Organization" FORCE ROW LEVEL SECURITY;

ALTER TABLE __data__."Organization" OWNER TO mua_owner;

CREATE TABLE __data__."OrganizationMember" (
    "organizationId" uuid NOT NULL,
    "accountId" uuid NOT NULL,
    status __data__."AccountStatus" DEFAULT 'ACTIVE'::__data__."AccountStatus" NOT NULL,
    roles __data__."Role"[] DEFAULT ARRAY[]::__data__."Role"[],
    "grantedById" uuid NOT NULL,
    "createdAt" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(6) with time zone NOT NULL
);

ALTER TABLE ONLY __data__."OrganizationMember" FORCE ROW LEVEL SECURITY;

ALTER TABLE __data__."OrganizationMember" OWNER TO mua_owner;

CREATE TABLE __data__."PackageBuild" (
    id uuid NOT NULL,
    "draftId" uuid NOT NULL,
    platform text NOT NULL,
    required boolean DEFAULT true NOT NULL,
    status text DEFAULT 'QUEUED'::text NOT NULL,
    phase text DEFAULT '等待环境准备'::text NOT NULL,
    progress integer DEFAULT 0 NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    "leaseToken" uuid,
    "leaseUntil" timestamp(3) without time zone,
    error text,
    "targetObjectKey" text,
    "targetSha256" character(64),
    artifacts jsonb,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    CONSTRAINT "PackageBuild_platform_check" CHECK ((platform = ANY (ARRAY['windows-amd64'::text, 'windows-aarch64'::text, 'linux-amd64'::text, 'linux-aarch64'::text, 'macos-amd64'::text, 'macos-aarch64'::text, 'universal'::text]))),
    CONSTRAINT "PackageBuild_progress_check" CHECK (((progress >= 0) AND (progress <= 100))),
    CONSTRAINT "PackageBuild_revision_check" CHECK ((revision > 0)),
    CONSTRAINT "PackageBuild_status_check" CHECK ((status = ANY (ARRAY['QUEUED'::text, 'PROCESSING'::text, 'PREPARED'::text, 'READY'::text, 'FAILED'::text])))
);

ALTER TABLE ONLY __data__."PackageBuild" FORCE ROW LEVEL SECURITY;

ALTER TABLE __data__."PackageBuild" OWNER TO mua_owner;

CREATE TABLE __data__."PlatformSettings" (
    id text DEFAULT 'platform'::text NOT NULL,
    "recycleRetentionDays" integer DEFAULT 7 NOT NULL,
    "updatedAt" timestamp(6) with time zone DEFAULT now() NOT NULL,
    "remoteSourceWhitelistEnabled" boolean DEFAULT false NOT NULL,
    "remoteSourceHosts" text[] DEFAULT ARRAY['cdn.modrinth.com'::text, 'github.com'::text, 'raw.githubusercontent.com'::text, 'release-assets.githubusercontent.com'::text, 'objects.githubusercontent.com'::text, 'gitlab.com'::text, 'edge.forgecdn.net'::text, 'mediafilez.forgecdn.net'::text] NOT NULL,
    "downloadProxyEnabled" boolean DEFAULT false NOT NULL,
    "downloadProxyUrl" text DEFAULT ''::text NOT NULL,
    "minecraftDownloadSources" text[] DEFAULT ARRAY['bmclapi'::text, 'ustc'::text, 'nju'::text] NOT NULL,
    "javaDownloadSources" text[] DEFAULT ARRAY['tuna'::text] NOT NULL,
    "mirrorProxyEnabled" boolean DEFAULT false NOT NULL,
    "javaImageType" text DEFAULT 'jre'::text NOT NULL,
    "enabledPackageFormats" integer[] DEFAULT ARRAY[1, 2] NOT NULL,
    "maxUploadSizeMb" integer DEFAULT 1024 NOT NULL,
    CONSTRAINT "PlatformSettings_enabledPackageFormats_check" CHECK ((((("enabledPackageFormats" = ARRAY[1]) OR ("enabledPackageFormats" = ARRAY[2])) OR ("enabledPackageFormats" = ARRAY[1, 2])) OR ("enabledPackageFormats" = ARRAY[2, 1]))),
    CONSTRAINT "PlatformSettings_id_check" CHECK ((id = 'platform'::text)),
    CONSTRAINT "PlatformSettings_recycleRetentionDays_check" CHECK ((("recycleRetentionDays" >= 1) AND ("recycleRetentionDays" <= 365))),
    CONSTRAINT "PlatformSettings_upload_size_bounds" CHECK ((("maxUploadSizeMb" >= 1) AND ("maxUploadSizeMb" <= 20480))),
    CONSTRAINT java_download_sources_valid CHECK ((("javaDownloadSources" = ARRAY[]::text[]) OR ("javaDownloadSources" = ARRAY['tuna'::text]))),
    CONSTRAINT java_image_type_valid CHECK (("javaImageType" = ANY (ARRAY['jre'::text, 'jdk'::text]))),
    CONSTRAINT minecraft_download_sources_valid CHECK ((("minecraftDownloadSources" <@ ARRAY['bmclapi'::text, 'ustc'::text, 'nju'::text]) AND (array_position("minecraftDownloadSources", NULL::text) IS NULL) AND (cardinality("minecraftDownloadSources") <= 3) AND (cardinality("minecraftDownloadSources") = (((('bmclapi'::text = ANY ("minecraftDownloadSources")))::integer + (('ustc'::text = ANY ("minecraftDownloadSources")))::integer) + (('nju'::text = ANY ("minecraftDownloadSources")))::integer))))
);

ALTER TABLE ONLY __data__."PlatformSettings" FORCE ROW LEVEL SECURITY;

ALTER TABLE __data__."PlatformSettings" OWNER TO mua_owner;

CREATE TABLE __data__."RecycleObject" (
    bucket text NOT NULL,
    "objectKey" text NOT NULL,
    "trashKey" text NOT NULL,
    "clientId" text NOT NULL,
    "trashedAt" timestamp(6) with time zone,
    "purgedAt" timestamp(6) with time zone
);

ALTER TABLE ONLY __data__."RecycleObject" FORCE ROW LEVEL SECURITY;

ALTER TABLE __data__."RecycleObject" OWNER TO mua_owner;

CREATE TABLE __data__."Server" (
    "serverId" character varying(5) NOT NULL,
    "organizationId" uuid NOT NULL,
    "displayName" text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    "gameAddress" text,
    "iconObjectKey" text,
    "sortOrder" integer DEFAULT 0 NOT NULL,
    "themeColor" character varying(7),
    "isListed" boolean DEFAULT false NOT NULL,
    "archivedAt" timestamp(6) with time zone,
    "createdAt" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(6) with time zone NOT NULL,
    "displayMode" character varying(16) DEFAULT 'PERMANENT'::character varying NOT NULL,
    "displayStartsAt" timestamp(6) with time zone,
    "displayEndsAt" timestamp(6) with time zone,
    CONSTRAINT "Server_color_format" CHECK ((("themeColor" IS NULL) OR (("themeColor")::text ~ '^#[0-9A-Fa-f]{6}$'::text))),
    CONSTRAINT "Server_display_schedule" CHECK ((((("displayMode")::text = 'PERMANENT'::text) AND ("displayStartsAt" IS NULL) AND ("displayEndsAt" IS NULL)) OR ((("displayMode")::text = 'RANGE'::text) AND ("displayStartsAt" IS NOT NULL) AND ("displayEndsAt" IS NOT NULL) AND isfinite("displayStartsAt") AND isfinite("displayEndsAt") AND ("displayStartsAt" < "displayEndsAt")))),
    CONSTRAINT "Server_id_format" CHECK ((("serverId")::text ~ '^[A-Za-z]{3,5}$'::text))
);

ALTER TABLE ONLY __data__."Server" FORCE ROW LEVEL SECURITY;

ALTER TABLE __data__."Server" OWNER TO mua_owner;

CREATE TABLE __data__."ServerGrant" (
    "accountId" uuid NOT NULL,
    "serverId" character varying(5) NOT NULL,
    "organizationId" uuid NOT NULL,
    roles __data__."Role"[] DEFAULT ARRAY[]::__data__."Role"[],
    "grantedById" uuid NOT NULL,
    "createdAt" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(6) with time zone NOT NULL,
    CONSTRAINT "ServerGrant_no_org_admin" CHECK ((NOT ('ORG_ADMIN'::__data__."Role" = ANY (roles))))
);

ALTER TABLE ONLY __data__."ServerGrant" FORCE ROW LEVEL SECURITY;

ALTER TABLE __data__."ServerGrant" OWNER TO mua_owner;

CREATE TABLE __data__."ServerPublication" (
    "serverId" character varying(5) NOT NULL,
    "releaseId" uuid,
    revision integer DEFAULT 0 NOT NULL,
    "changedById" uuid NOT NULL,
    "updatedAt" timestamp(6) with time zone NOT NULL,
    "clientId" text,
    CONSTRAINT "Publication_release_has_client" CHECK ((("releaseId" IS NULL) OR ("clientId" IS NOT NULL))),
    CONSTRAINT "Publication_revision_positive" CHECK ((revision >= 0))
);

ALTER TABLE ONLY __data__."ServerPublication" FORCE ROW LEVEL SECURITY;

ALTER TABLE __data__."ServerPublication" OWNER TO mua_owner;

CREATE TABLE __data__."Session" (
    "tokenHash" character(64) NOT NULL,
    "accountId" uuid NOT NULL,
    "expiresAt" timestamp(6) with time zone NOT NULL,
    "createdAt" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE ONLY __data__."Session" FORCE ROW LEVEL SECURITY;

ALTER TABLE __data__."Session" OWNER TO mua_owner;

CREATE TABLE __data__."WorkerHeartbeat" (
    id text NOT NULL,
    "startedAt" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "lastSeen" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE ONLY __data__."WorkerHeartbeat" FORCE ROW LEVEL SECURITY;

ALTER TABLE __data__."WorkerHeartbeat" OWNER TO mua_owner;

CREATE TABLE __auth__.role_permission (
    role text NOT NULL,
    permission text NOT NULL
);

ALTER TABLE __auth__.role_permission OWNER TO mua_owner;

ALTER TABLE ONLY __data__."ClientDraft" ALTER COLUMN "versionSequence" SET DEFAULT nextval('__data__."ClientDraft_versionSequence_seq"'::regclass);

ALTER TABLE ONLY __data__."Account"
    ADD CONSTRAINT "Account_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY __data__."ApiToken"
    ADD CONSTRAINT "ApiToken_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY __data__."AuditEvent"
    ADD CONSTRAINT "AuditEvent_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY __data__."CasObject"
    ADD CONSTRAINT "CasObject_pkey" PRIMARY KEY (sha256);

ALTER TABLE ONLY __data__."CasReference"
    ADD CONSTRAINT "CasReference_pkey" PRIMARY KEY ("clientId", sha256);

ALTER TABLE ONLY __data__."ClientDraft"
    ADD CONSTRAINT "ClientDraft_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY __data__."ClientRelease"
    ADD CONSTRAINT "ClientRelease_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY __data__."ClientUpload"
    ADD CONSTRAINT "ClientUpload_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY __data__."Client"
    ADD CONSTRAINT "Client_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY __data__."LocalCredential"
    ADD CONSTRAINT "LocalCredential_pkey" PRIMARY KEY ("accountId");

ALTER TABLE ONLY __data__."LoginThrottle"
    ADD CONSTRAINT "LoginThrottle_pkey" PRIMARY KEY (key);

ALTER TABLE ONLY __data__."OrganizationMember"
    ADD CONSTRAINT "OrganizationMember_pkey" PRIMARY KEY ("organizationId", "accountId");

ALTER TABLE ONLY __data__."Organization"
    ADD CONSTRAINT "Organization_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY __data__."PackageBuild"
    ADD CONSTRAINT "PackageBuild_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY __data__."PlatformSettings"
    ADD CONSTRAINT "PlatformSettings_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY __data__."RecycleObject"
    ADD CONSTRAINT "RecycleObject_bucket_trashKey_key" UNIQUE (bucket, "trashKey");

ALTER TABLE ONLY __data__."RecycleObject"
    ADD CONSTRAINT "RecycleObject_pkey" PRIMARY KEY (bucket, "objectKey");

ALTER TABLE ONLY __data__."ServerGrant"
    ADD CONSTRAINT "ServerGrant_pkey" PRIMARY KEY ("accountId", "serverId");

ALTER TABLE ONLY __data__."ServerPublication"
    ADD CONSTRAINT "ServerPublication_pkey" PRIMARY KEY ("serverId");

ALTER TABLE ONLY __data__."Server"
    ADD CONSTRAINT "Server_pkey" PRIMARY KEY ("serverId");

ALTER TABLE ONLY __data__."Session"
    ADD CONSTRAINT "Session_pkey" PRIMARY KEY ("tokenHash");

ALTER TABLE ONLY __data__."WorkerHeartbeat"
    ADD CONSTRAINT "WorkerHeartbeat_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY __auth__.role_permission
    ADD CONSTRAINT role_permission_pkey PRIMARY KEY (role, permission);

CREATE UNIQUE INDEX "ApiToken_tokenHash_key" ON __data__."ApiToken" USING btree ("tokenHash");

CREATE INDEX "AuditEvent_actorId_createdAt_idx" ON __data__."AuditEvent" USING btree ("actorId", "createdAt");

CREATE INDEX "AuditEvent_organizationId_createdAt_idx" ON __data__."AuditEvent" USING btree ("organizationId", "createdAt");

CREATE INDEX "CasReference_sha256_idx" ON __data__."CasReference" USING btree (sha256);

CREATE UNIQUE INDEX "ClientDraft_serverId_id_key" ON __data__."ClientDraft" USING btree ("clientId", id);

CREATE UNIQUE INDEX "ClientDraft_versionSequence_key" ON __data__."ClientDraft" USING btree ("versionSequence");

CREATE UNIQUE INDEX "ClientRelease_serverId_id_key" ON __data__."ClientRelease" USING btree ("clientId", id);

CREATE UNIQUE INDEX "ClientRelease_serverId_sourceDraftId_key" ON __data__."ClientRelease" USING btree ("clientId", "sourceDraftId");

CREATE UNIQUE INDEX "ClientRelease_serverId_versionLabel_key" ON __data__."ClientRelease" USING btree ("clientId", "versionLabel");

CREATE UNIQUE INDEX "ClientRelease_sourceDraftId_key" ON __data__."ClientRelease" USING btree ("sourceDraftId");

CREATE UNIQUE INDEX "ClientUpload_draftId_key" ON __data__."ClientUpload" USING btree ("draftId");

CREATE INDEX "ClientUpload_serverId_createdAt_idx" ON __data__."ClientUpload" USING btree ("clientId", "createdAt");

CREATE UNIQUE INDEX "ClientUpload_serverId_draftId_key" ON __data__."ClientUpload" USING btree ("clientId", "draftId");

CREATE UNIQUE INDEX "ClientUpload_sourceObjectKey_key" ON __data__."ClientUpload" USING btree ("sourceObjectKey");

CREATE INDEX "ClientUpload_status_leaseUntil_createdAt_idx" ON __data__."ClientUpload" USING btree (status, "leaseUntil", "createdAt");

CREATE UNIQUE INDEX "Client_active_name_key" ON __data__."Client" USING btree ("organizationId", "nameKey") WHERE ("deletedAt" IS NULL);

CREATE INDEX "Client_organizationId_nameKey_idx" ON __data__."Client" USING btree ("organizationId", "nameKey");

CREATE UNIQUE INDEX "Client_organizationId_serverId_key" ON __data__."Client" USING btree ("organizationId", id);

CREATE UNIQUE INDEX "LocalCredential_username_key" ON __data__."LocalCredential" USING btree (username);

CREATE INDEX "OrganizationMember_accountId_idx" ON __data__."OrganizationMember" USING btree ("accountId");

CREATE UNIQUE INDEX "PackageBuild_draftId_platform_revision_key" ON __data__."PackageBuild" USING btree ("draftId", platform, revision);

CREATE INDEX "PackageBuild_status_leaseUntil_createdAt_idx" ON __data__."PackageBuild" USING btree (status, "leaseUntil", "createdAt");

CREATE UNIQUE INDEX "ServerPublication_clientId_key" ON __data__."ServerPublication" USING btree ("clientId");

CREATE UNIQUE INDEX "ServerPublication_clientId_releaseId_key" ON __data__."ServerPublication" USING btree ("clientId", "releaseId");

CREATE UNIQUE INDEX "ServerPublication_releaseId_key" ON __data__."ServerPublication" USING btree ("releaseId");

CREATE UNIQUE INDEX "ServerPublication_serverId_releaseId_key" ON __data__."ServerPublication" USING btree ("serverId", "releaseId");

CREATE INDEX "Server_organizationId_idx" ON __data__."Server" USING btree ("organizationId");

CREATE UNIQUE INDEX "Server_organizationId_serverId_key" ON __data__."Server" USING btree ("organizationId", "serverId");

CREATE UNIQUE INDEX "Server_serverId_casefold_key" ON __data__."Server" USING btree (lower(("serverId")::text));

CREATE INDEX "Session_accountId_idx" ON __data__."Session" USING btree ("accountId");

CREATE INDEX "Session_expiresAt_idx" ON __data__."Session" USING btree ("expiresAt");

CREATE TRIGGER audit_append_only BEFORE UPDATE ON __data__."AuditEvent" FOR EACH ROW EXECUTE FUNCTION __data__.mua_audit_append_only();

CREATE TRIGGER build_format_gate BEFORE INSERT OR UPDATE ON __data__."PackageBuild" FOR EACH ROW EXECUTE FUNCTION __data__.mua_build_format_gate();

CREATE CONSTRAINT TRIGGER client_binding_consistent AFTER INSERT OR UPDATE ON __data__."Client" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION __data__.mua_binding_consistent();

CREATE TRIGGER client_not_deleted BEFORE INSERT OR UPDATE ON __data__."ClientDraft" FOR EACH ROW EXECUTE FUNCTION __data__.mua_not_deleted_client();

CREATE TRIGGER client_not_deleted BEFORE INSERT OR UPDATE ON __data__."ClientRelease" FOR EACH ROW EXECUTE FUNCTION __data__.mua_not_deleted_client();

CREATE TRIGGER client_not_deleted BEFORE INSERT OR UPDATE ON __data__."ClientUpload" FOR EACH ROW EXECUTE FUNCTION __data__.mua_not_deleted_client();

CREATE TRIGGER client_not_deleted BEFORE INSERT OR UPDATE ON __data__."ServerPublication" FOR EACH ROW EXECUTE FUNCTION __data__.mua_not_deleted_client();

CREATE TRIGGER client_scope_immutable BEFORE UPDATE ON __data__."Client" FOR EACH ROW EXECUTE FUNCTION __data__.mua_client_identity();

CREATE TRIGGER draft_format_gate BEFORE INSERT OR UPDATE ON __data__."ClientDraft" FOR EACH ROW EXECUTE FUNCTION __data__.mua_draft_format_gate();

CREATE TRIGGER draft_lock BEFORE UPDATE ON __data__."ClientDraft" FOR EACH ROW EXECUTE FUNCTION __data__.mua_draft_lock();

CREATE TRIGGER draft_replacement_guard BEFORE INSERT OR UPDATE ON __data__."ClientDraft" FOR EACH ROW EXECUTE FUNCTION __data__.mua_draft_replacement_guard();

CREATE TRIGGER guard_server_display BEFORE INSERT OR UPDATE ON __data__."Server" FOR EACH ROW EXECUTE FUNCTION __auth__.guard_server_display();

CREATE TRIGGER no_delete BEFORE DELETE ON __data__."Account" FOR EACH ROW EXECUTE FUNCTION __data__.mua_no_delete();

CREATE TRIGGER no_delete BEFORE DELETE ON __data__."ApiToken" FOR EACH ROW EXECUTE FUNCTION __data__.mua_no_delete();

CREATE TRIGGER no_delete BEFORE DELETE ON __data__."AuditEvent" FOR EACH ROW EXECUTE FUNCTION __data__.mua_no_delete();

CREATE TRIGGER no_delete BEFORE DELETE ON __data__."Client" FOR EACH ROW EXECUTE FUNCTION __data__.mua_no_delete();

CREATE TRIGGER no_delete BEFORE DELETE ON __data__."ClientDraft" FOR EACH ROW EXECUTE FUNCTION __data__.mua_no_delete();

CREATE TRIGGER no_delete BEFORE DELETE ON __data__."ClientRelease" FOR EACH ROW EXECUTE FUNCTION __data__.mua_no_delete();

CREATE TRIGGER no_delete BEFORE DELETE ON __data__."ClientUpload" FOR EACH ROW EXECUTE FUNCTION __data__.mua_no_delete();

CREATE TRIGGER no_delete BEFORE DELETE ON __data__."LocalCredential" FOR EACH ROW EXECUTE FUNCTION __data__.mua_no_delete();

CREATE TRIGGER no_delete BEFORE DELETE ON __data__."Organization" FOR EACH ROW EXECUTE FUNCTION __data__.mua_no_delete();

CREATE TRIGGER no_delete BEFORE DELETE ON __data__."OrganizationMember" FOR EACH ROW EXECUTE FUNCTION __data__.mua_no_delete();

CREATE TRIGGER no_delete BEFORE DELETE ON __data__."PackageBuild" FOR EACH ROW EXECUTE FUNCTION __data__.mua_no_delete();

CREATE TRIGGER no_delete BEFORE DELETE ON __data__."Server" FOR EACH ROW EXECUTE FUNCTION __data__.mua_no_delete();

CREATE TRIGGER no_delete BEFORE DELETE ON __data__."ServerGrant" FOR EACH ROW EXECUTE FUNCTION __data__.mua_no_delete();

CREATE TRIGGER no_delete BEFORE DELETE ON __data__."ServerPublication" FOR EACH ROW EXECUTE FUNCTION __data__.mua_no_delete();

CREATE TRIGGER package_build_guard BEFORE INSERT OR UPDATE ON __data__."PackageBuild" FOR EACH ROW EXECUTE FUNCTION __data__.mua_package_build_guard();

CREATE TRIGGER package_delete_gate BEFORE UPDATE ON __data__."Client" FOR EACH ROW EXECUTE FUNCTION __data__.mua_package_delete_gate();

CREATE TRIGGER package_publish_gate BEFORE INSERT ON __data__."ClientRelease" FOR EACH ROW EXECUTE FUNCTION __data__.mua_package_publish_gate();

CREATE TRIGGER publication_active BEFORE INSERT OR UPDATE ON __data__."ServerPublication" FOR EACH ROW EXECUTE FUNCTION __data__.mua_publication_active();

CREATE CONSTRAINT TRIGGER publication_binding_consistent AFTER INSERT OR UPDATE ON __data__."ServerPublication" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION __data__.mua_binding_consistent();

CREATE TRIGGER release_approved BEFORE INSERT ON __data__."ClientRelease" FOR EACH ROW EXECUTE FUNCTION __data__.mua_release_approved();

CREATE TRIGGER release_format_gate BEFORE INSERT ON __data__."ClientRelease" FOR EACH ROW EXECUTE FUNCTION __data__.mua_release_format_gate();

CREATE TRIGGER release_immutable BEFORE UPDATE ON __data__."ClientRelease" FOR EACH ROW EXECUTE FUNCTION __data__.mua_release_immutable();

CREATE CONSTRAINT TRIGGER server_complete AFTER INSERT ON __data__."Server" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION __data__.mua_server_complete();

CREATE TRIGGER server_scope_immutable BEFORE UPDATE ON __data__."Server" FOR EACH ROW EXECUTE FUNCTION __data__.mua_scope_immutable();

CREATE TRIGGER upload_format_gate BEFORE INSERT OR UPDATE ON __data__."ClientUpload" FOR EACH ROW EXECUTE FUNCTION __data__.mua_upload_format_gate();

CREATE TRIGGER upload_lock BEFORE UPDATE ON __data__."ClientUpload" FOR EACH ROW EXECUTE FUNCTION __data__.mua_upload_lock();

ALTER TABLE ONLY __data__."ApiToken"
    ADD CONSTRAINT "ApiToken_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES __data__."Account"(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY __data__."AuditEvent"
    ADD CONSTRAINT "AuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES __data__."Account"(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY __data__."AuditEvent"
    ADD CONSTRAINT "AuditEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES __data__."Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY __data__."AuditEvent"
    ADD CONSTRAINT "AuditEvent_organizationId_serverId_fkey" FOREIGN KEY ("organizationId", "serverId") REFERENCES __data__."Server"("organizationId", "serverId") ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY __data__."CasReference"
    ADD CONSTRAINT "CasReference_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES __data__."Client"(id) ON DELETE RESTRICT;

ALTER TABLE ONLY __data__."CasReference"
    ADD CONSTRAINT "CasReference_sha256_fkey" FOREIGN KEY (sha256) REFERENCES __data__."CasObject"(sha256) ON DELETE RESTRICT;

ALTER TABLE ONLY __data__."ClientDraft"
    ADD CONSTRAINT "ClientDraft_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES __data__."Client"(id) ON DELETE RESTRICT;

ALTER TABLE ONLY __data__."ClientDraft"
    ADD CONSTRAINT "ClientDraft_clientId_replacesDraftId_fkey" FOREIGN KEY ("clientId", "replacesDraftId") REFERENCES __data__."ClientDraft"("clientId", id) ON DELETE RESTRICT;

ALTER TABLE ONLY __data__."ClientDraft"
    ADD CONSTRAINT "ClientDraft_clientId_supersededByDraftId_fkey" FOREIGN KEY ("clientId", "supersededByDraftId") REFERENCES __data__."ClientDraft"("clientId", id) ON DELETE RESTRICT;

ALTER TABLE ONLY __data__."ClientDraft"
    ADD CONSTRAINT "ClientDraft_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES __data__."Account"(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY __data__."ClientDraft"
    ADD CONSTRAINT "ClientDraft_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES __data__."Account"(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY __data__."ClientRelease"
    ADD CONSTRAINT "ClientRelease_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES __data__."Account"(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY __data__."ClientRelease"
    ADD CONSTRAINT "ClientRelease_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES __data__."Client"(id) ON DELETE RESTRICT;

ALTER TABLE ONLY __data__."ClientRelease"
    ADD CONSTRAINT "ClientRelease_clientId_sourceDraftId_fkey" FOREIGN KEY ("clientId", "sourceDraftId") REFERENCES __data__."ClientDraft"("clientId", id) ON DELETE RESTRICT;

ALTER TABLE ONLY __data__."ClientRelease"
    ADD CONSTRAINT "ClientRelease_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES __data__."Account"(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY __data__."ClientUpload"
    ADD CONSTRAINT "ClientUpload_clientId_comparisonDraftId_fkey" FOREIGN KEY ("clientId", "comparisonDraftId") REFERENCES __data__."ClientDraft"("clientId", id) ON DELETE RESTRICT;

ALTER TABLE ONLY __data__."ClientUpload"
    ADD CONSTRAINT "ClientUpload_clientId_draftId_fkey" FOREIGN KEY ("clientId", "draftId") REFERENCES __data__."ClientDraft"("clientId", id) ON DELETE RESTRICT;

ALTER TABLE ONLY __data__."ClientUpload"
    ADD CONSTRAINT "ClientUpload_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES __data__."Client"(id) ON DELETE RESTRICT;

ALTER TABLE ONLY __data__."ClientUpload"
    ADD CONSTRAINT "ClientUpload_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES __data__."Account"(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY __data__."Client"
    ADD CONSTRAINT "Client_currentRelease_fkey" FOREIGN KEY (id, "currentReleaseId") REFERENCES __data__."ClientRelease"("clientId", id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY __data__."Client"
    ADD CONSTRAINT "Client_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES __data__."Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY __data__."Client"
    ADD CONSTRAINT "Client_requestedServer_fkey" FOREIGN KEY ("organizationId", "requestedServerId") REFERENCES __data__."Server"("organizationId", "serverId") ON DELETE RESTRICT;

ALTER TABLE ONLY __data__."Client"
    ADD CONSTRAINT "Client_scopeServer_fkey" FOREIGN KEY ("organizationId", "scopeServerId") REFERENCES __data__."Server"("organizationId", "serverId") ON DELETE RESTRICT;

ALTER TABLE ONLY __data__."LocalCredential"
    ADD CONSTRAINT "LocalCredential_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES __data__."Account"(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY __data__."OrganizationMember"
    ADD CONSTRAINT "OrganizationMember_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES __data__."Account"(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY __data__."OrganizationMember"
    ADD CONSTRAINT "OrganizationMember_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES __data__."Account"(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY __data__."OrganizationMember"
    ADD CONSTRAINT "OrganizationMember_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES __data__."Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY __data__."PackageBuild"
    ADD CONSTRAINT "PackageBuild_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES __data__."ClientDraft"(id) ON DELETE RESTRICT;

ALTER TABLE ONLY __data__."RecycleObject"
    ADD CONSTRAINT "RecycleObject_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES __data__."Client"(id) ON DELETE RESTRICT;

ALTER TABLE ONLY __data__."ServerGrant"
    ADD CONSTRAINT "ServerGrant_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES __data__."Account"(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY __data__."ServerGrant"
    ADD CONSTRAINT "ServerGrant_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES __data__."Account"(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY __data__."ServerGrant"
    ADD CONSTRAINT "ServerGrant_organizationId_accountId_fkey" FOREIGN KEY ("organizationId", "accountId") REFERENCES __data__."OrganizationMember"("organizationId", "accountId") ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY __data__."ServerGrant"
    ADD CONSTRAINT "ServerGrant_organizationId_serverId_fkey" FOREIGN KEY ("organizationId", "serverId") REFERENCES __data__."Server"("organizationId", "serverId") ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY __data__."ServerPublication"
    ADD CONSTRAINT "ServerPublication_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES __data__."Account"(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY __data__."ServerPublication"
    ADD CONSTRAINT "ServerPublication_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES __data__."Client"(id) ON DELETE RESTRICT;

ALTER TABLE ONLY __data__."ServerPublication"
    ADD CONSTRAINT "ServerPublication_clientId_releaseId_fkey" FOREIGN KEY ("clientId", "releaseId") REFERENCES __data__."ClientRelease"("clientId", id) ON DELETE RESTRICT;

ALTER TABLE ONLY __data__."ServerPublication"
    ADD CONSTRAINT "ServerPublication_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES __data__."Server"("serverId") ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY __data__."Server"
    ADD CONSTRAINT "Server_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES __data__."Organization"(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY __data__."Session"
    ADD CONSTRAINT "Session_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES __data__."Account"(id) ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ONLY __data__."ClientUpload"
    ADD CONSTRAINT "Upload_base_scope" FOREIGN KEY ("clientId", "baseReleaseId") REFERENCES __data__."ClientRelease"("clientId", id) ON DELETE RESTRICT;

ALTER TABLE __data__."Account" ENABLE ROW LEVEL SECURITY;

ALTER TABLE __data__."ApiToken" ENABLE ROW LEVEL SECURITY;

ALTER TABLE __data__."AuditEvent" ENABLE ROW LEVEL SECURITY;

ALTER TABLE __data__."CasObject" ENABLE ROW LEVEL SECURITY;

ALTER TABLE __data__."CasReference" ENABLE ROW LEVEL SECURITY;

ALTER TABLE __data__."Client" ENABLE ROW LEVEL SECURITY;

ALTER TABLE __data__."ClientDraft" ENABLE ROW LEVEL SECURITY;

ALTER TABLE __data__."ClientRelease" ENABLE ROW LEVEL SECURITY;

ALTER TABLE __data__."ClientUpload" ENABLE ROW LEVEL SECURITY;

ALTER TABLE __data__."LocalCredential" ENABLE ROW LEVEL SECURITY;

ALTER TABLE __data__."LoginThrottle" ENABLE ROW LEVEL SECURITY;

ALTER TABLE __data__."Organization" ENABLE ROW LEVEL SECURITY;

ALTER TABLE __data__."OrganizationMember" ENABLE ROW LEVEL SECURITY;

ALTER TABLE __data__."PackageBuild" ENABLE ROW LEVEL SECURITY;

ALTER TABLE __data__."PlatformSettings" ENABLE ROW LEVEL SECURITY;

ALTER TABLE __data__."RecycleObject" ENABLE ROW LEVEL SECURITY;

ALTER TABLE __data__."Server" ENABLE ROW LEVEL SECURITY;

ALTER TABLE __data__."ServerGrant" ENABLE ROW LEVEL SECURITY;

ALTER TABLE __data__."ServerPublication" ENABLE ROW LEVEL SECURITY;

ALTER TABLE __data__."Session" ENABLE ROW LEVEL SECURITY;

ALTER TABLE __data__."WorkerHeartbeat" ENABLE ROW LEVEL SECURITY;

CREATE POLICY authentication ON __data__."Account" TO mua_auth USING (true) WITH CHECK (true);

CREATE POLICY authentication ON __data__."LocalCredential" TO mua_auth USING (true) WITH CHECK (true);

CREATE POLICY authentication ON __data__."LoginThrottle" TO mua_auth USING (true) WITH CHECK (true);

CREATE POLICY authentication ON __data__."Session" TO mua_auth USING (true) WITH CHECK (true);

CREATE POLICY authentication_audit ON __data__."AuditEvent" FOR INSERT TO mua_auth WITH CHECK ((action = 'AUTH_LOGIN'::text));

CREATE POLICY lookup_lock ON __data__."Client" FOR UPDATE TO mua_lookup USING (true) WITH CHECK (false);

CREATE POLICY lookup_lock ON __data__."ClientDraft" FOR UPDATE TO mua_lookup USING (true) WITH CHECK (false);

CREATE POLICY lookup_lock ON __data__."ClientUpload" FOR UPDATE TO mua_lookup USING (true) WITH CHECK (false);

CREATE POLICY lookup_lock ON __data__."PackageBuild" FOR UPDATE TO mua_lookup USING (true) WITH CHECK (false);

CREATE POLICY lookup_read ON __data__."Account" FOR SELECT TO mua_lookup USING (true);

CREATE POLICY lookup_read ON __data__."ApiToken" FOR SELECT TO mua_lookup USING (true);

CREATE POLICY lookup_read ON __data__."AuditEvent" FOR SELECT TO mua_lookup USING (true);

CREATE POLICY lookup_read ON __data__."CasObject" FOR SELECT TO mua_lookup USING (true);

CREATE POLICY lookup_read ON __data__."CasReference" FOR SELECT TO mua_lookup USING (true);

CREATE POLICY lookup_read ON __data__."Client" FOR SELECT TO mua_lookup USING (true);

CREATE POLICY lookup_read ON __data__."ClientDraft" FOR SELECT TO mua_lookup USING (true);

CREATE POLICY lookup_read ON __data__."ClientRelease" FOR SELECT TO mua_lookup USING (true);

CREATE POLICY lookup_read ON __data__."ClientUpload" FOR SELECT TO mua_lookup USING (true);

CREATE POLICY lookup_read ON __data__."LocalCredential" FOR SELECT TO mua_lookup USING (true);

CREATE POLICY lookup_read ON __data__."LoginThrottle" FOR SELECT TO mua_lookup USING (true);

CREATE POLICY lookup_read ON __data__."Organization" FOR SELECT TO mua_lookup USING (true);

CREATE POLICY lookup_read ON __data__."OrganizationMember" FOR SELECT TO mua_lookup USING (true);

CREATE POLICY lookup_read ON __data__."PackageBuild" FOR SELECT TO mua_lookup USING (true);

CREATE POLICY lookup_read ON __data__."PlatformSettings" FOR SELECT TO mua_lookup USING (true);

CREATE POLICY lookup_read ON __data__."RecycleObject" FOR SELECT TO mua_lookup USING (true);

CREATE POLICY lookup_read ON __data__."Server" FOR SELECT TO mua_lookup USING (true);

CREATE POLICY lookup_read ON __data__."ServerGrant" FOR SELECT TO mua_lookup USING (true);

CREATE POLICY lookup_read ON __data__."ServerPublication" FOR SELECT TO mua_lookup USING (true);

CREATE POLICY lookup_read ON __data__."Session" FOR SELECT TO mua_lookup USING (true);

CREATE POLICY lookup_read ON __data__."WorkerHeartbeat" FOR SELECT TO mua_lookup USING (true);

CREATE POLICY maintenance ON __data__."Account" TO mua_owner USING (true) WITH CHECK (true);

CREATE POLICY maintenance ON __data__."ApiToken" TO mua_owner USING (true) WITH CHECK (true);

CREATE POLICY maintenance ON __data__."AuditEvent" TO mua_owner USING (true) WITH CHECK (true);

CREATE POLICY maintenance ON __data__."CasObject" TO mua_owner USING (true) WITH CHECK (true);

CREATE POLICY maintenance ON __data__."CasReference" TO mua_owner USING (true) WITH CHECK (true);

CREATE POLICY maintenance ON __data__."Client" TO mua_owner USING (true) WITH CHECK (true);

CREATE POLICY maintenance ON __data__."ClientDraft" TO mua_owner USING (true) WITH CHECK (true);

CREATE POLICY maintenance ON __data__."ClientRelease" TO mua_owner USING (true) WITH CHECK (true);

CREATE POLICY maintenance ON __data__."ClientUpload" TO mua_owner USING (true) WITH CHECK (true);

CREATE POLICY maintenance ON __data__."LocalCredential" TO mua_owner USING (true) WITH CHECK (true);

CREATE POLICY maintenance ON __data__."LoginThrottle" TO mua_owner USING (true) WITH CHECK (true);

CREATE POLICY maintenance ON __data__."Organization" TO mua_owner USING (true) WITH CHECK (true);

CREATE POLICY maintenance ON __data__."OrganizationMember" TO mua_owner USING (true) WITH CHECK (true);

CREATE POLICY maintenance ON __data__."PackageBuild" TO mua_owner USING (true) WITH CHECK (true);

CREATE POLICY maintenance ON __data__."PlatformSettings" TO mua_owner USING (true) WITH CHECK (true);

CREATE POLICY maintenance ON __data__."RecycleObject" TO mua_owner USING (true) WITH CHECK (true);

CREATE POLICY maintenance ON __data__."Server" TO mua_owner USING (true) WITH CHECK (true);

CREATE POLICY maintenance ON __data__."ServerGrant" TO mua_owner USING (true) WITH CHECK (true);

CREATE POLICY maintenance ON __data__."ServerPublication" TO mua_owner USING (true) WITH CHECK (true);

CREATE POLICY maintenance ON __data__."Session" TO mua_owner USING (true) WITH CHECK (true);

CREATE POLICY maintenance ON __data__."WorkerHeartbeat" TO mua_owner USING (true) WITH CHECK (true);

CREATE POLICY web_account_read ON __data__."Account" FOR SELECT TO mua_web USING (((id = __auth__.actor_id()) OR __auth__.directory_reader()));

CREATE POLICY web_account_write ON __data__."Account" TO mua_web USING (__auth__.super_panel()) WITH CHECK (__auth__.super_panel());

CREATE POLICY web_audit_insert ON __data__."AuditEvent" FOR INSERT TO mua_web WITH CHECK (("actorId" = __auth__.actor_id()));

CREATE POLICY web_audit_read ON __data__."AuditEvent" FOR SELECT TO mua_web USING (__auth__.super_panel());

CREATE POLICY web_build_read ON __data__."PackageBuild" FOR SELECT TO mua_web USING (__auth__.client_permission(__auth__.draft_client("draftId"), 'DRAFT_READ'::text));

CREATE POLICY web_build_write ON __data__."PackageBuild" TO mua_web USING (__auth__.client_write(__auth__.draft_client("draftId"), ARRAY['DRAFT_EDIT'::text, 'DRAFT_REVIEW'::text, 'DRAFT_ARCHIVE'::text, 'RELEASE_PUBLISH'::text])) WITH CHECK (__auth__.client_write(__auth__.draft_client("draftId"), ARRAY['DRAFT_CREATE'::text, 'DRAFT_EDIT'::text, 'DRAFT_REVIEW'::text, 'DRAFT_ARCHIVE'::text, 'RELEASE_PUBLISH'::text]));

CREATE POLICY web_client_insert ON __data__."Client" FOR INSERT TO mua_web WITH CHECK ((__auth__.super_panel() OR
CASE
    WHEN ("scopeServerId" IS NULL) THEN __auth__.org_permission("organizationId", 'DRAFT_CREATE'::text)
    ELSE __auth__.server_permission(("scopeServerId")::text, 'DRAFT_CREATE'::text)
END));

CREATE POLICY web_client_read ON __data__."Client" FOR SELECT TO mua_web USING (__auth__.client_row_permission(id, "organizationId", ("scopeServerId")::text, "deletedAt", 'SERVER_READ'::text));

CREATE POLICY web_client_update ON __data__."Client" FOR UPDATE TO mua_web USING (__auth__.client_write(id, ARRAY['DRAFT_CREATE'::text, 'DRAFT_EDIT'::text, 'CLIENT_ARCHIVE'::text, 'CLIENT_BIND'::text, 'RELEASE_ACTIVATE'::text])) WITH CHECK (__auth__.client_write(id, ARRAY['DRAFT_CREATE'::text, 'DRAFT_EDIT'::text, 'CLIENT_ARCHIVE'::text, 'CLIENT_BIND'::text, 'RELEASE_ACTIVATE'::text]));

CREATE POLICY web_draft_insert ON __data__."ClientDraft" FOR INSERT TO mua_web WITH CHECK (__auth__.client_permission("clientId", 'DRAFT_CREATE'::text));

CREATE POLICY web_draft_read ON __data__."ClientDraft" FOR SELECT TO mua_web USING (__auth__.client_permission("clientId", 'DRAFT_READ'::text));

CREATE POLICY web_draft_update ON __data__."ClientDraft" FOR UPDATE TO mua_web USING (__auth__.client_write("clientId", ARRAY['DRAFT_EDIT'::text, 'DRAFT_SUBMIT'::text, 'DRAFT_REVIEW'::text, 'DRAFT_ARCHIVE'::text, 'RELEASE_PUBLISH'::text])) WITH CHECK (__auth__.client_write("clientId", ARRAY['DRAFT_EDIT'::text, 'DRAFT_SUBMIT'::text, 'DRAFT_REVIEW'::text, 'DRAFT_ARCHIVE'::text, 'RELEASE_PUBLISH'::text]));

CREATE POLICY web_grant_read ON __data__."ServerGrant" FOR SELECT TO mua_web USING ((("accountId" = __auth__.actor_id()) OR __auth__.org_permission("organizationId", 'ORG_MEMBERS_READ'::text)));

CREATE POLICY web_grant_write ON __data__."ServerGrant" TO mua_web USING (__auth__.org_permission("organizationId", 'ORG_MEMBERS_MANAGE'::text)) WITH CHECK (__auth__.org_permission("organizationId", 'ORG_MEMBERS_MANAGE'::text));

CREATE POLICY web_heartbeat_read ON __data__."WorkerHeartbeat" FOR SELECT TO mua_web USING (__auth__.super_panel());

CREATE POLICY web_member_read ON __data__."OrganizationMember" FOR SELECT TO mua_web USING ((("accountId" = __auth__.actor_id()) OR __auth__.org_permission("organizationId", 'ORG_MEMBERS_READ'::text)));

CREATE POLICY web_member_write ON __data__."OrganizationMember" TO mua_web USING (__auth__.org_permission("organizationId", 'ORG_MEMBERS_MANAGE'::text)) WITH CHECK (__auth__.org_permission("organizationId", 'ORG_MEMBERS_MANAGE'::text));

CREATE POLICY web_org_read ON __data__."Organization" FOR SELECT TO mua_web USING (__auth__.org_visible(id));

CREATE POLICY web_org_write ON __data__."Organization" TO mua_web USING (__auth__.org_permission(id, 'ORG_EDIT'::text)) WITH CHECK ((__auth__.super_panel() OR __auth__.org_permission(id, 'ORG_EDIT'::text)));

CREATE POLICY web_publication_read ON __data__."ServerPublication" FOR SELECT TO mua_web USING (__auth__.server_permission(("serverId")::text, 'SERVER_READ'::text));

CREATE POLICY web_publication_write ON __data__."ServerPublication" TO mua_web USING ((__auth__.server_permission(("serverId")::text, 'CLIENT_BIND'::text) OR __auth__.server_permission(("serverId")::text, 'RELEASE_ACTIVATE'::text))) WITH CHECK ((__auth__.super_panel() OR __auth__.server_permission(("serverId")::text, 'CLIENT_BIND'::text) OR __auth__.server_permission(("serverId")::text, 'RELEASE_ACTIVATE'::text)));

CREATE POLICY web_release_insert ON __data__."ClientRelease" FOR INSERT TO mua_web WITH CHECK (__auth__.client_permission("clientId", 'RELEASE_PUBLISH'::text));

CREATE POLICY web_release_read ON __data__."ClientRelease" FOR SELECT TO mua_web USING (__auth__.client_permission("clientId", 'RELEASE_READ'::text));

CREATE POLICY web_release_update ON __data__."ClientRelease" FOR UPDATE TO mua_web USING (__auth__.super_panel()) WITH CHECK (__auth__.super_panel());

CREATE POLICY web_server_read ON __data__."Server" FOR SELECT TO mua_web USING (__auth__.server_permission(("serverId")::text, 'SERVER_READ'::text));

CREATE POLICY web_server_write ON __data__."Server" TO mua_web USING (__auth__.server_permission(("serverId")::text, 'SERVER_EDIT'::text)) WITH CHECK ((__auth__.super_panel() OR __auth__.server_permission(("serverId")::text, 'SERVER_EDIT'::text)));

CREATE POLICY web_settings_read ON __data__."PlatformSettings" FOR SELECT TO mua_web USING (__auth__.super_panel());

CREATE POLICY web_settings_write ON __data__."PlatformSettings" TO mua_web USING (__auth__.super_panel()) WITH CHECK (__auth__.super_panel());

CREATE POLICY web_token ON __data__."ApiToken" TO mua_web USING ((__auth__.panel() AND ("accountId" = __auth__.actor_id()) AND __auth__.active_actor())) WITH CHECK ((__auth__.panel() AND ("accountId" = __auth__.actor_id()) AND __auth__.active_actor()));

CREATE POLICY web_upload_read ON __data__."ClientUpload" FOR SELECT TO mua_web USING (__auth__.client_permission("clientId", 'DRAFT_READ'::text));

CREATE POLICY web_upload_write ON __data__."ClientUpload" TO mua_web USING ((__auth__.client_write("clientId", ARRAY['DRAFT_CREATE'::text, 'DRAFT_EDIT'::text, 'DRAFT_ARCHIVE'::text, 'CLIENT_DELETE'::text]) AND (("createdById" = __auth__.actor_id()) OR __auth__.super_actor() OR __auth__.client_permission("clientId", 'CLIENT_DELETE'::text)))) WITH CHECK ((__auth__.client_write("clientId", ARRAY['DRAFT_CREATE'::text, 'DRAFT_EDIT'::text, 'DRAFT_ARCHIVE'::text, 'CLIENT_DELETE'::text]) AND (("createdById" = __auth__.actor_id()) OR __auth__.super_actor() OR __auth__.client_permission("clientId", 'CLIENT_DELETE'::text))));

CREATE POLICY worker_audit ON __data__."AuditEvent" FOR INSERT TO mua_worker WITH CHECK (true);

CREATE POLICY worker_index ON __data__."Client" FOR UPDATE TO mua_worker USING (true) WITH CHECK (true);

CREATE POLICY worker_manifest ON __data__."ClientDraft" FOR UPDATE TO mua_worker USING (true) WITH CHECK (true);

CREATE POLICY worker_read ON __data__."Account" FOR SELECT TO mua_worker USING (true);

CREATE POLICY worker_read ON __data__."AuditEvent" FOR SELECT TO mua_worker USING (true);

CREATE POLICY worker_read ON __data__."CasObject" FOR SELECT TO mua_worker USING (true);

CREATE POLICY worker_read ON __data__."CasReference" FOR SELECT TO mua_worker USING (true);

CREATE POLICY worker_read ON __data__."Client" FOR SELECT TO mua_worker USING (true);

CREATE POLICY worker_read ON __data__."ClientDraft" FOR SELECT TO mua_worker USING (true);

CREATE POLICY worker_read ON __data__."ClientRelease" FOR SELECT TO mua_worker USING (true);

CREATE POLICY worker_read ON __data__."ClientUpload" FOR SELECT TO mua_worker USING (true);

CREATE POLICY worker_read ON __data__."Organization" FOR SELECT TO mua_worker USING (true);

CREATE POLICY worker_read ON __data__."OrganizationMember" FOR SELECT TO mua_worker USING (true);

CREATE POLICY worker_read ON __data__."PackageBuild" FOR SELECT TO mua_worker USING (true);

CREATE POLICY worker_read ON __data__."PlatformSettings" FOR SELECT TO mua_worker USING (true);

CREATE POLICY worker_read ON __data__."RecycleObject" FOR SELECT TO mua_worker USING (true);

CREATE POLICY worker_read ON __data__."Server" FOR SELECT TO mua_worker USING (true);

CREATE POLICY worker_read ON __data__."ServerGrant" FOR SELECT TO mua_worker USING (true);

CREATE POLICY worker_read ON __data__."ServerPublication" FOR SELECT TO mua_worker USING (true);

CREATE POLICY worker_read ON __data__."WorkerHeartbeat" FOR SELECT TO mua_worker USING (true);

CREATE POLICY worker_work ON __data__."CasObject" TO mua_worker USING (true) WITH CHECK (true);

CREATE POLICY worker_work ON __data__."CasReference" TO mua_worker USING (true) WITH CHECK (true);

CREATE POLICY worker_work ON __data__."ClientUpload" TO mua_worker USING (true) WITH CHECK (true);

CREATE POLICY worker_work ON __data__."PackageBuild" TO mua_worker USING (true) WITH CHECK (true);

CREATE POLICY worker_work ON __data__."RecycleObject" TO mua_worker USING (true) WITH CHECK (true);

CREATE POLICY worker_work ON __data__."WorkerHeartbeat" TO mua_worker USING (true) WITH CHECK (true);

GRANT USAGE ON SCHEMA __data__ TO mua_web;
GRANT USAGE ON SCHEMA __data__ TO mua_auth;
GRANT USAGE ON SCHEMA __data__ TO mua_worker;
GRANT ALL ON SCHEMA __data__ TO mua_lookup;
GRANT USAGE ON SCHEMA __data__ TO mua_public;

GRANT USAGE ON SCHEMA __auth__ TO mua_web;
GRANT USAGE ON SCHEMA __auth__ TO mua_auth;
GRANT USAGE ON SCHEMA __auth__ TO mua_worker;
GRANT ALL ON SCHEMA __auth__ TO mua_lookup;
GRANT USAGE ON SCHEMA __auth__ TO mua_public;

REVOKE ALL ON FUNCTION __data__.mua_audit_append_only() FROM PUBLIC;

REVOKE ALL ON FUNCTION __data__.mua_binding_consistent() FROM PUBLIC;

REVOKE ALL ON FUNCTION __data__.mua_build_format_gate() FROM PUBLIC;

REVOKE ALL ON FUNCTION __data__.mua_client_identity() FROM PUBLIC;

REVOKE ALL ON FUNCTION __data__.mua_draft_format_gate() FROM PUBLIC;

REVOKE ALL ON FUNCTION __data__.mua_draft_lock() FROM PUBLIC;

REVOKE ALL ON FUNCTION __data__.mua_draft_replacement_guard() FROM PUBLIC;

REVOKE ALL ON FUNCTION __data__.mua_no_delete() FROM PUBLIC;

REVOKE ALL ON FUNCTION __data__.mua_not_deleted_client() FROM PUBLIC;

REVOKE ALL ON FUNCTION __data__.mua_package_build_guard() FROM PUBLIC;

REVOKE ALL ON FUNCTION __data__.mua_package_delete_gate() FROM PUBLIC;

REVOKE ALL ON FUNCTION __data__.mua_package_publish_gate() FROM PUBLIC;

REVOKE ALL ON FUNCTION __data__.mua_publication_active() FROM PUBLIC;

REVOKE ALL ON FUNCTION __data__.mua_release_approved() FROM PUBLIC;

REVOKE ALL ON FUNCTION __data__.mua_release_format_gate() FROM PUBLIC;

REVOKE ALL ON FUNCTION __data__.mua_release_immutable() FROM PUBLIC;

REVOKE ALL ON FUNCTION __data__.mua_scope_immutable() FROM PUBLIC;

REVOKE ALL ON FUNCTION __data__.mua_server_complete() FROM PUBLIC;

REVOKE ALL ON FUNCTION __data__.mua_upload_format_gate() FROM PUBLIC;

REVOKE ALL ON FUNCTION __data__.mua_upload_lock() FROM PUBLIC;

REVOKE ALL ON FUNCTION __auth__.account_directory() FROM PUBLIC;
GRANT ALL ON FUNCTION __auth__.account_directory() TO mua_web;
GRANT ALL ON FUNCTION __auth__.account_directory() TO mua_worker;
GRANT ALL ON FUNCTION __auth__.account_directory() TO mua_owner;

REVOKE ALL ON FUNCTION __auth__.active_actor() FROM PUBLIC;
GRANT ALL ON FUNCTION __auth__.active_actor() TO mua_web;
GRANT ALL ON FUNCTION __auth__.active_actor() TO mua_worker;
GRANT ALL ON FUNCTION __auth__.active_actor() TO mua_owner;

REVOKE ALL ON FUNCTION __auth__.actor_id() FROM PUBLIC;
GRANT ALL ON FUNCTION __auth__.actor_id() TO mua_web;
GRANT ALL ON FUNCTION __auth__.actor_id() TO mua_worker;
GRANT ALL ON FUNCTION __auth__.actor_id() TO mua_owner;

REVOKE ALL ON FUNCTION __auth__.api_actor(hash text) FROM PUBLIC;
GRANT ALL ON FUNCTION __auth__.api_actor(hash text) TO mua_web;
GRANT ALL ON FUNCTION __auth__.api_actor(hash text) TO mua_worker;
GRANT ALL ON FUNCTION __auth__.api_actor(hash text) TO mua_owner;

REVOKE ALL ON FUNCTION __auth__.archive_binding(client_id text, server_id text, account_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION __auth__.archive_binding(client_id text, server_id text, account_id uuid) TO mua_web;

REVOKE ALL ON FUNCTION __auth__.client_permission(client_id text, permission text) FROM PUBLIC;
GRANT ALL ON FUNCTION __auth__.client_permission(client_id text, permission text) TO mua_web;
GRANT ALL ON FUNCTION __auth__.client_permission(client_id text, permission text) TO mua_worker;
GRANT ALL ON FUNCTION __auth__.client_permission(client_id text, permission text) TO mua_owner;

REVOKE ALL ON FUNCTION __auth__.client_row_permission(client_id text, org_id uuid, scope_id text, deleted_at timestamp with time zone, permission text) FROM PUBLIC;
GRANT ALL ON FUNCTION __auth__.client_row_permission(client_id text, org_id uuid, scope_id text, deleted_at timestamp with time zone, permission text) TO mua_web;
GRANT ALL ON FUNCTION __auth__.client_row_permission(client_id text, org_id uuid, scope_id text, deleted_at timestamp with time zone, permission text) TO mua_worker;
GRANT ALL ON FUNCTION __auth__.client_row_permission(client_id text, org_id uuid, scope_id text, deleted_at timestamp with time zone, permission text) TO mua_owner;

REVOKE ALL ON FUNCTION __auth__.client_summary(client_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION __auth__.client_summary(client_id text) TO mua_web;
GRANT ALL ON FUNCTION __auth__.client_summary(client_id text) TO mua_worker;
GRANT ALL ON FUNCTION __auth__.client_summary(client_id text) TO mua_owner;

REVOKE ALL ON FUNCTION __auth__.client_write(client_id text, permissions text[]) FROM PUBLIC;
GRANT ALL ON FUNCTION __auth__.client_write(client_id text, permissions text[]) TO mua_web;
GRANT ALL ON FUNCTION __auth__.client_write(client_id text, permissions text[]) TO mua_worker;
GRANT ALL ON FUNCTION __auth__.client_write(client_id text, permissions text[]) TO mua_owner;

REVOKE ALL ON FUNCTION __auth__.create_credential(account_id uuid, username text, password_hash text) FROM PUBLIC;
GRANT ALL ON FUNCTION __auth__.create_credential(account_id uuid, username text, password_hash text) TO mua_web;

REVOKE ALL ON FUNCTION __auth__.delete_client(client_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION __auth__.delete_client(client_id text) TO mua_web;

REVOKE ALL ON FUNCTION __auth__.directory_reader() FROM PUBLIC;
GRANT ALL ON FUNCTION __auth__.directory_reader() TO mua_web;
GRANT ALL ON FUNCTION __auth__.directory_reader() TO mua_worker;
GRANT ALL ON FUNCTION __auth__.directory_reader() TO mua_owner;

REVOKE ALL ON FUNCTION __auth__.draft_client(draft_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION __auth__.draft_client(draft_id uuid) TO mua_web;
GRANT ALL ON FUNCTION __auth__.draft_client(draft_id uuid) TO mua_worker;
GRANT ALL ON FUNCTION __auth__.draft_client(draft_id uuid) TO mua_owner;

REVOKE ALL ON FUNCTION __auth__.guard_server_display() FROM PUBLIC;
GRANT ALL ON FUNCTION __auth__.guard_server_display() TO mua_web;

REVOKE ALL ON FUNCTION __auth__.maintenance() FROM PUBLIC;
GRANT ALL ON FUNCTION __auth__.maintenance() TO mua_web;
GRANT ALL ON FUNCTION __auth__.maintenance() TO mua_worker;
GRANT ALL ON FUNCTION __auth__.maintenance() TO mua_owner;

REVOKE ALL ON FUNCTION __auth__.org_permission(org_id uuid, permission text) FROM PUBLIC;
GRANT ALL ON FUNCTION __auth__.org_permission(org_id uuid, permission text) TO mua_web;
GRANT ALL ON FUNCTION __auth__.org_permission(org_id uuid, permission text) TO mua_worker;
GRANT ALL ON FUNCTION __auth__.org_permission(org_id uuid, permission text) TO mua_owner;

REVOKE ALL ON FUNCTION __auth__.org_visible(org_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION __auth__.org_visible(org_id uuid) TO mua_web;
GRANT ALL ON FUNCTION __auth__.org_visible(org_id uuid) TO mua_worker;
GRANT ALL ON FUNCTION __auth__.org_visible(org_id uuid) TO mua_owner;

REVOKE ALL ON FUNCTION __auth__.panel() FROM PUBLIC;
GRANT ALL ON FUNCTION __auth__.panel() TO mua_web;
GRANT ALL ON FUNCTION __auth__.panel() TO mua_worker;
GRANT ALL ON FUNCTION __auth__.panel() TO mua_owner;

REVOKE ALL ON FUNCTION __auth__.public_servers() FROM PUBLIC;
GRANT ALL ON FUNCTION __auth__.public_servers() TO mua_web;
GRANT ALL ON FUNCTION __auth__.public_servers() TO mua_worker;
GRANT ALL ON FUNCTION __auth__.public_servers() TO mua_owner;
GRANT ALL ON FUNCTION __auth__.public_servers() TO mua_public;

REVOKE ALL ON FUNCTION __auth__.public_snapshot(server_id text, release_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION __auth__.public_snapshot(server_id text, release_id uuid) TO mua_web;
GRANT ALL ON FUNCTION __auth__.public_snapshot(server_id text, release_id uuid) TO mua_worker;
GRANT ALL ON FUNCTION __auth__.public_snapshot(server_id text, release_id uuid) TO mua_owner;
GRANT ALL ON FUNCTION __auth__.public_snapshot(server_id text, release_id uuid) TO mua_public;

REVOKE ALL ON FUNCTION __auth__.release_details(release_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION __auth__.release_details(release_id uuid) TO mua_web;
GRANT ALL ON FUNCTION __auth__.release_details(release_id uuid) TO mua_worker;
GRANT ALL ON FUNCTION __auth__.release_details(release_id uuid) TO mua_owner;

REVOKE ALL ON FUNCTION __auth__.revoke_sessions(account_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION __auth__.revoke_sessions(account_id uuid) TO mua_web;

REVOKE ALL ON FUNCTION __auth__.server_permission(server_id text, permission text) FROM PUBLIC;
GRANT ALL ON FUNCTION __auth__.server_permission(server_id text, permission text) TO mua_web;
GRANT ALL ON FUNCTION __auth__.server_permission(server_id text, permission text) TO mua_worker;
GRANT ALL ON FUNCTION __auth__.server_permission(server_id text, permission text) TO mua_owner;

REVOKE ALL ON FUNCTION __auth__.server_summary(server_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION __auth__.server_summary(server_id text) TO mua_web;
GRANT ALL ON FUNCTION __auth__.server_summary(server_id text) TO mua_worker;
GRANT ALL ON FUNCTION __auth__.server_summary(server_id text) TO mua_owner;

REVOKE ALL ON FUNCTION __auth__.session_actor(hash text) FROM PUBLIC;
GRANT ALL ON FUNCTION __auth__.session_actor(hash text) TO mua_web;
GRANT ALL ON FUNCTION __auth__.session_actor(hash text) TO mua_worker;
GRANT ALL ON FUNCTION __auth__.session_actor(hash text) TO mua_owner;

REVOKE ALL ON FUNCTION __auth__.set_password(account_id uuid, password_hash text, expected_hash text) FROM PUBLIC;
GRANT ALL ON FUNCTION __auth__.set_password(account_id uuid, password_hash text, expected_hash text) TO mua_web;

REVOKE ALL ON FUNCTION __auth__.super_actor() FROM PUBLIC;
GRANT ALL ON FUNCTION __auth__.super_actor() TO mua_web;
GRANT ALL ON FUNCTION __auth__.super_actor() TO mua_worker;
GRANT ALL ON FUNCTION __auth__.super_actor() TO mua_owner;

REVOKE ALL ON FUNCTION __auth__.super_panel() FROM PUBLIC;
GRANT ALL ON FUNCTION __auth__.super_panel() TO mua_web;
GRANT ALL ON FUNCTION __auth__.super_panel() TO mua_worker;
GRANT ALL ON FUNCTION __auth__.super_panel() TO mua_owner;

REVOKE ALL ON FUNCTION __auth__.token_allows(permission text, server_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION __auth__.token_allows(permission text, server_id text) TO mua_web;
GRANT ALL ON FUNCTION __auth__.token_allows(permission text, server_id text) TO mua_worker;
GRANT ALL ON FUNCTION __auth__.token_allows(permission text, server_id text) TO mua_owner;

REVOKE ALL ON FUNCTION __auth__.upload_options() FROM PUBLIC;
GRANT ALL ON FUNCTION __auth__.upload_options() TO mua_web;
GRANT ALL ON FUNCTION __auth__.upload_options() TO mua_worker;
GRANT ALL ON FUNCTION __auth__.upload_options() TO mua_owner;

GRANT SELECT ON TABLE __data__."Account" TO mua_lookup;
GRANT SELECT ON TABLE __data__."Account" TO mua_auth;
GRANT SELECT ON TABLE __data__."Account" TO mua_worker;
GRANT SELECT,INSERT,UPDATE ON TABLE __data__."Account" TO mua_web;

GRANT SELECT ON TABLE __data__."ApiToken" TO mua_lookup;
GRANT SELECT,INSERT,UPDATE ON TABLE __data__."ApiToken" TO mua_web;

GRANT SELECT ON TABLE __data__."AuditEvent" TO mua_lookup;
GRANT INSERT ON TABLE __data__."AuditEvent" TO mua_auth;
GRANT SELECT,INSERT ON TABLE __data__."AuditEvent" TO mua_worker;
GRANT SELECT,INSERT ON TABLE __data__."AuditEvent" TO mua_web;

GRANT SELECT ON TABLE __data__."CasObject" TO mua_lookup;
GRANT SELECT,INSERT,UPDATE ON TABLE __data__."CasObject" TO mua_worker;

GRANT SELECT ON TABLE __data__."CasReference" TO mua_lookup;
GRANT SELECT,INSERT,UPDATE ON TABLE __data__."CasReference" TO mua_worker;

GRANT SELECT ON TABLE __data__."Client" TO mua_lookup;
GRANT SELECT ON TABLE __data__."Client" TO mua_worker;
GRANT SELECT,INSERT,UPDATE ON TABLE __data__."Client" TO mua_web;

GRANT UPDATE(id) ON TABLE __data__."Client" TO mua_lookup;

GRANT UPDATE("updatedAt") ON TABLE __data__."Client" TO mua_worker;

GRANT UPDATE("storageIndexedAt") ON TABLE __data__."Client" TO mua_worker;

GRANT UPDATE("recycledAt") ON TABLE __data__."Client" TO mua_worker;

GRANT SELECT ON TABLE __data__."ClientDraft" TO mua_lookup;
GRANT SELECT ON TABLE __data__."ClientDraft" TO mua_worker;
GRANT SELECT,INSERT,UPDATE ON TABLE __data__."ClientDraft" TO mua_web;

GRANT UPDATE(id) ON TABLE __data__."ClientDraft" TO mua_lookup;

GRANT UPDATE("candidateManifestKey") ON TABLE __data__."ClientDraft" TO mua_worker;

GRANT UPDATE("candidateManifestSha256") ON TABLE __data__."ClientDraft" TO mua_worker;

GRANT UPDATE("updatedAt") ON TABLE __data__."ClientDraft" TO mua_worker;

GRANT USAGE ON SEQUENCE __data__."ClientDraft_versionSequence_seq" TO mua_web;
GRANT USAGE ON SEQUENCE __data__."ClientDraft_versionSequence_seq" TO mua_worker;

GRANT SELECT ON TABLE __data__."ClientRelease" TO mua_lookup;
GRANT SELECT ON TABLE __data__."ClientRelease" TO mua_worker;
GRANT SELECT,INSERT,UPDATE ON TABLE __data__."ClientRelease" TO mua_web;

GRANT SELECT ON TABLE __data__."ClientUpload" TO mua_lookup;
GRANT SELECT,INSERT,UPDATE ON TABLE __data__."ClientUpload" TO mua_worker;
GRANT SELECT,INSERT,UPDATE ON TABLE __data__."ClientUpload" TO mua_web;

GRANT UPDATE(id) ON TABLE __data__."ClientUpload" TO mua_lookup;

GRANT SELECT ON TABLE __data__."LocalCredential" TO mua_lookup;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE __data__."LocalCredential" TO mua_auth;

GRANT SELECT ON TABLE __data__."LoginThrottle" TO mua_lookup;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE __data__."LoginThrottle" TO mua_auth;

GRANT SELECT ON TABLE __data__."Organization" TO mua_lookup;
GRANT SELECT ON TABLE __data__."Organization" TO mua_worker;
GRANT SELECT,INSERT,UPDATE ON TABLE __data__."Organization" TO mua_web;

GRANT SELECT ON TABLE __data__."OrganizationMember" TO mua_lookup;
GRANT SELECT ON TABLE __data__."OrganizationMember" TO mua_worker;
GRANT SELECT,INSERT,UPDATE ON TABLE __data__."OrganizationMember" TO mua_web;

GRANT SELECT ON TABLE __data__."PackageBuild" TO mua_lookup;
GRANT SELECT,INSERT,UPDATE ON TABLE __data__."PackageBuild" TO mua_worker;
GRANT SELECT,INSERT,UPDATE ON TABLE __data__."PackageBuild" TO mua_web;

GRANT UPDATE(id) ON TABLE __data__."PackageBuild" TO mua_lookup;

GRANT SELECT ON TABLE __data__."PlatformSettings" TO mua_lookup;
GRANT SELECT ON TABLE __data__."PlatformSettings" TO mua_worker;
GRANT SELECT,INSERT,UPDATE ON TABLE __data__."PlatformSettings" TO mua_web;

GRANT SELECT ON TABLE __data__."RecycleObject" TO mua_lookup;
GRANT SELECT,INSERT,UPDATE ON TABLE __data__."RecycleObject" TO mua_worker;

GRANT SELECT ON TABLE __data__."Server" TO mua_lookup;
GRANT SELECT ON TABLE __data__."Server" TO mua_worker;
GRANT SELECT,INSERT,UPDATE ON TABLE __data__."Server" TO mua_web;

GRANT SELECT ON TABLE __data__."ServerGrant" TO mua_lookup;
GRANT SELECT ON TABLE __data__."ServerGrant" TO mua_worker;
GRANT SELECT,INSERT,UPDATE ON TABLE __data__."ServerGrant" TO mua_web;

GRANT SELECT ON TABLE __data__."ServerPublication" TO mua_lookup;
GRANT SELECT ON TABLE __data__."ServerPublication" TO mua_worker;
GRANT SELECT,INSERT,UPDATE ON TABLE __data__."ServerPublication" TO mua_web;

GRANT SELECT ON TABLE __data__."Session" TO mua_lookup;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE __data__."Session" TO mua_auth;

GRANT SELECT ON TABLE __data__."WorkerHeartbeat" TO mua_lookup;
GRANT SELECT,INSERT,UPDATE ON TABLE __data__."WorkerHeartbeat" TO mua_worker;
GRANT SELECT ON TABLE __data__."WorkerHeartbeat" TO mua_web;

GRANT SELECT ON TABLE __auth__.role_permission TO mua_lookup;
GRANT SELECT ON TABLE __auth__.role_permission TO mua_web;
GRANT SELECT ON TABLE __auth__.role_permission TO mua_auth;
GRANT SELECT ON TABLE __auth__.role_permission TO mua_public;
GRANT SELECT ON TABLE __auth__.role_permission TO mua_worker;

INSERT INTO __auth__.role_permission(role,permission) VALUES
('CLIENT_EDITOR','DRAFT_ARCHIVE'),
('CLIENT_EDITOR','DRAFT_CREATE'),
('CLIENT_EDITOR','DRAFT_EDIT'),
('CLIENT_EDITOR','DRAFT_READ'),
('CLIENT_EDITOR','DRAFT_SUBMIT'),
('CLIENT_EDITOR','RELEASE_READ'),
('CLIENT_EDITOR','SERVER_READ'),
('ORG_ADMIN','CLIENT_ARCHIVE'),
('ORG_ADMIN','CLIENT_BIND'),
('ORG_ADMIN','CLIENT_DELETE'),
('ORG_ADMIN','DRAFT_ARCHIVE'),
('ORG_ADMIN','DRAFT_CREATE'),
('ORG_ADMIN','DRAFT_EDIT'),
('ORG_ADMIN','DRAFT_READ'),
('ORG_ADMIN','DRAFT_SUBMIT'),
('ORG_ADMIN','ORG_EDIT'),
('ORG_ADMIN','ORG_MEMBERS_MANAGE'),
('ORG_ADMIN','ORG_MEMBERS_READ'),
('ORG_ADMIN','RELEASE_READ'),
('ORG_ADMIN','SERVER_EDIT'),
('ORG_ADMIN','SERVER_READ'),
('PUBLISHER','DRAFT_READ'),
('PUBLISHER','RELEASE_PUBLISH'),
('PUBLISHER','RELEASE_READ'),
('PUBLISHER','SERVER_READ'),
('READ_ONLY','DRAFT_READ'),
('READ_ONLY','RELEASE_READ'),
('READ_ONLY','SERVER_READ'),
('RELEASE_OPERATOR','RELEASE_ACTIVATE'),
('RELEASE_OPERATOR','RELEASE_READ'),
('RELEASE_OPERATOR','SERVER_READ'),
('REVIEWER','DRAFT_READ'),
('REVIEWER','DRAFT_REVIEW'),
('REVIEWER','RELEASE_READ'),
('REVIEWER','SERVER_READ'),
('SERVER_ADMIN','CLIENT_ARCHIVE'),
('SERVER_ADMIN','CLIENT_BIND'),
('SERVER_ADMIN','CLIENT_DELETE'),
('SERVER_ADMIN','DRAFT_ARCHIVE'),
('SERVER_ADMIN','DRAFT_CREATE'),
('SERVER_ADMIN','DRAFT_EDIT'),
('SERVER_ADMIN','DRAFT_READ'),
('SERVER_ADMIN','DRAFT_SUBMIT'),
('SERVER_ADMIN','RELEASE_READ'),
('SERVER_ADMIN','SERVER_EDIT'),
('SERVER_ADMIN','SERVER_READ'),
('SERVER_EDITOR','SERVER_EDIT'),
('SERVER_EDITOR','SERVER_READ');

ALTER TABLE __data__."Client" ADD CONSTRAINT "Client_id_uuid" CHECK (id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
REVOKE CREATE ON SCHEMA __data__, __auth__ FROM mua_lookup;
$definitions$;
EXECUTE replace(replace(statement,'__auth__',quote_ident(security_schema)),'__data__',quote_ident(data_schema));
PERFORM set_config('check_function_bodies','on',true);
END $install$;
