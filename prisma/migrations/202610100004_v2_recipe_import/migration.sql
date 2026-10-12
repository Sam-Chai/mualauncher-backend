CREATE OR REPLACE FUNCTION mua_upload_lock() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['status','attempts','progress','leaseToken','leaseUntil','error','filesObjectKey','filesSha256','statistics','comparisonStatistics','detectedMods','warnings','draftId','sourceSha256','updatedAt','processingPhase','detectedInfo','selectedInstanceId']) IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status','attempts','progress','leaseToken','leaseUntil','error','filesObjectKey','filesSha256','statistics','comparisonStatistics','detectedMods','warnings','draftId','sourceSha256','updatedAt','processingPhase','detectedInfo','selectedInstanceId']) THEN
    RAISE EXCEPTION 'Upload ownership, format, source and baselines are immutable';
  END IF;
  -- Text comparisons also allow this migration to run in the same transaction as enum creation.
  IF NOT (
    (OLD."status"::text='UPLOADING' AND NEW."status"::text IN ('UPLOADING','WAITING_PROCESSOR','QUEUED','CANCELLED')) OR
    (OLD."status"::text='WAITING_PROCESSOR' AND NEW."status"::text IN ('WAITING_PROCESSOR','QUEUED','CANCELLED')) OR
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


-- v2 imports may be processed, but submission/build/publication remain gated until stage 4.
CREATE OR REPLACE FUNCTION mua_upload_format_gate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."packageFormatVersion"=1 AND NEW."status"::text='WAITING_PROCESSOR') OR
     (NEW."packageFormatVersion"=2 AND NEW."status"::text='SUBMITTED') THEN
    RAISE EXCEPTION 'v2 submission is not installed';
  END IF;
  IF NEW."packageFormatVersion"=2 AND NEW."status"::text='READY' AND
     (NEW."sourceSha256" IS NULL OR NEW."filesObjectKey" IS NULL OR NEW."filesSha256" IS NULL OR
      NEW."statistics"->>'localFiles' IS NULL OR NEW."statistics"->>'remoteFiles' IS NULL) THEN
    RAISE EXCEPTION 'v2 READY requires a sealed recipe import';
  END IF;
  RETURN NEW;
END $$;
-- Resume existing staged imports only for active owners and non-archived resources.
UPDATE "ClientUpload" u SET "status"='QUEUED', "updatedAt"=now()
FROM "Client" c, "Organization" o, "Account" a
WHERE u."packageFormatVersion"=2 AND u."status"::text='WAITING_PROCESSOR'
  AND c."id"=u."clientId" AND c."organizationId"=o."id" AND a."id"=u."createdById"
  AND c."archivedAt" IS NULL AND c."deletedAt" IS NULL AND o."archivedAt" IS NULL AND a."status"='ACTIVE';
