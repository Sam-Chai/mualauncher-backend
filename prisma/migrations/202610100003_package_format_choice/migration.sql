-- Existing rows gain only a v1 discriminator. Signed documents and objects are untouched.
ALTER TYPE "UploadStatus" ADD VALUE IF NOT EXISTS 'WAITING_PROCESSOR';
ALTER TABLE "ClientUpload" ADD COLUMN "packageFormatVersion" INTEGER NOT NULL DEFAULT 1
  CHECK ("packageFormatVersion" IN (1,2));
ALTER TABLE "ClientDraft" ADD COLUMN "packageFormatVersion" INTEGER NOT NULL DEFAULT 1
  CHECK ("packageFormatVersion" IN (1,2));
ALTER TABLE "ClientRelease" ADD COLUMN "packageFormatVersion" INTEGER NOT NULL DEFAULT 1
  CHECK ("packageFormatVersion" IN (1,2));

CREATE OR REPLACE FUNCTION mua_upload_lock() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['status','attempts','progress','leaseToken','leaseUntil','error','filesObjectKey','filesSha256','statistics','comparisonStatistics','detectedMods','warnings','draftId','sourceSha256','updatedAt','processingPhase','detectedInfo','selectedInstanceId']) IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status','attempts','progress','leaseToken','leaseUntil','error','filesObjectKey','filesSha256','statistics','comparisonStatistics','detectedMods','warnings','draftId','sourceSha256','updatedAt','processingPhase','detectedInfo','selectedInstanceId']) THEN
    RAISE EXCEPTION 'Upload ownership, format, source and baselines are immutable';
  END IF;
  -- Text comparisons also allow this migration to run in the same transaction as enum creation.
  IF NOT (
    (OLD."status"::text='UPLOADING' AND NEW."status"::text IN ('UPLOADING','WAITING_PROCESSOR','QUEUED','CANCELLED')) OR
    (OLD."status"::text='WAITING_PROCESSOR' AND NEW."status"::text IN ('WAITING_PROCESSOR','CANCELLED')) OR
    (OLD."status"::text='QUEUED' AND NEW."status"::text IN ('QUEUED','PROCESSING','CANCELLED')) OR
    (OLD."status"::text='PROCESSING' AND (NEW."status"::text IN ('PROCESSING','READY','FAILED') OR (NEW."status"::text='QUEUED' AND NEW."processingPhase"='SELECT_INSTANCE'))) OR
    (OLD."status"::text='FAILED' AND NEW."status"::text IN ('FAILED','WAITING_PROCESSOR','QUEUED','CANCELLED')) OR
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

-- Stage 2 saves v2 uploads without ever handing them to the v1 processor.
-- Stage 3 will explicitly replace this gate when its processor is installed.
CREATE FUNCTION mua_upload_format_gate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."packageFormatVersion"=1 AND NEW."status"::text='WAITING_PROCESSOR') OR
     (NEW."packageFormatVersion"=2 AND NEW."status"::text NOT IN ('UPLOADING','WAITING_PROCESSOR','FAILED','CANCELLED')) THEN
    RAISE EXCEPTION 'v2 uploads must wait for the v2 processor';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER upload_format_gate BEFORE INSERT OR UPDATE ON "ClientUpload" FOR EACH ROW EXECUTE FUNCTION mua_upload_format_gate();

CREATE FUNCTION mua_draft_format_gate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND NEW."packageFormatVersion" IS DISTINCT FROM OLD."packageFormatVersion" THEN
    RAISE EXCEPTION 'Draft package format is immutable';
  END IF;
  IF NEW."packageFormatVersion"=2 AND NEW."status" NOT IN ('DRAFT','REJECTED') THEN
    RAISE EXCEPTION 'v2 submission and publication are not installed';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER draft_format_gate BEFORE INSERT OR UPDATE ON "ClientDraft" FOR EACH ROW EXECUTE FUNCTION mua_draft_format_gate();

CREATE FUNCTION mua_release_format_gate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."packageFormatVersion"<>1 OR NOT EXISTS (
    SELECT 1 FROM "ClientDraft" WHERE "id"=NEW."sourceDraftId" AND "clientId"=NEW."clientId" AND "packageFormatVersion"=NEW."packageFormatVersion") THEN
    RAISE EXCEPTION 'Release format must match its draft and an installed publisher';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER release_format_gate BEFORE INSERT ON "ClientRelease" FOR EACH ROW EXECUTE FUNCTION mua_release_format_gate();

CREATE FUNCTION mua_build_format_gate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "ClientDraft" WHERE "id"=NEW."draftId" AND "packageFormatVersion"=1) THEN
    RAISE EXCEPTION 'v1 builds cannot process v2 drafts';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER build_format_gate BEFORE INSERT OR UPDATE ON "PackageBuild" FOR EACH ROW EXECUTE FUNCTION mua_build_format_gate();

-- Preserve deletion/identity guards and include the new waiting state in active uploads.
CREATE OR REPLACE FUNCTION mua_client_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId" OR NEW."scopeServerId" IS DISTINCT FROM OLD."scopeServerId" THEN
    RAISE EXCEPTION 'Client identity and authorization origin are immutable';
  END IF;
  IF NEW."name" IS DISTINCT FROM OLD."name" OR NEW."nameKey" IS DISTINCT FROM OLD."nameKey" THEN
    IF OLD."deletedAt" IS NOT NULL OR OLD."archivedAt" IS NOT NULL OR OLD."currentReleaseId" IS NOT NULL OR OLD."revision" <> 0
      OR EXISTS (SELECT 1 FROM "ClientDraft" WHERE "clientId" = OLD."id")
      OR EXISTS (SELECT 1 FROM "ClientRelease" WHERE "clientId" = OLD."id")
      OR (SELECT count(*) FROM "ClientUpload" WHERE "clientId" = OLD."id" AND "status"::text IN ('UPLOADING','WAITING_PROCESSOR','QUEUED','PROCESSING','READY','SUBMITTED')) <> 1
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
      OR EXISTS (SELECT 1 FROM "ClientUpload" WHERE "clientId" = OLD."id" AND "status"::text IN ('UPLOADING','WAITING_PROCESSOR','QUEUED','PROCESSING'))
      OR EXISTS (SELECT 1 FROM "PackageBuild" b JOIN "ClientDraft" d ON d."id" = b."draftId" WHERE d."clientId" = OLD."id" AND b."status" = 'PROCESSING') THEN
      RAISE EXCEPTION 'Client deletion requires archived, unbound and inactive resources';
    END IF;
  END IF;
  RETURN NEW;
END $$;
