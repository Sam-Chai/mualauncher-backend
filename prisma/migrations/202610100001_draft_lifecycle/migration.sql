-- Preserve historical manifests/signatures. New relationships are explicit only.
DROP TRIGGER draft_lock ON "ClientDraft";
-- Historical tombstones also receive ordering metadata. Temporarily remove only
-- this resource-write guard for backfill, then restore it before new operations.
DROP TRIGGER client_not_deleted ON "ClientDraft";
ALTER TABLE "ClientDraft" ADD COLUMN "versionSequence" SERIAL,
  ADD COLUMN "replacesDraftId" UUID, ADD COLUMN "archiveReason" TEXT,
  ADD COLUMN "supersededByDraftId" UUID;
WITH ordered AS (SELECT "id", row_number() OVER (ORDER BY "createdAt", "id") AS n FROM "ClientDraft")
UPDATE "ClientDraft" d SET "versionSequence"=o.n FROM ordered o WHERE d."id"=o."id";
SELECT setval(pg_get_serial_sequence('"ClientDraft"','versionSequence'), greatest(coalesce(max("versionSequence"),0),1), count(*)>0) FROM "ClientDraft";
CREATE TRIGGER client_not_deleted BEFORE INSERT OR UPDATE ON "ClientDraft" FOR EACH ROW EXECUTE FUNCTION mua_not_deleted_client();
CREATE UNIQUE INDEX "ClientDraft_versionSequence_key" ON "ClientDraft"("versionSequence");
ALTER TABLE "ClientDraft" ADD CONSTRAINT "ClientDraft_clientId_replacesDraftId_fkey"
  FOREIGN KEY ("clientId","replacesDraftId") REFERENCES "ClientDraft"("clientId","id") ON DELETE RESTRICT,
  ADD CONSTRAINT "ClientDraft_clientId_supersededByDraftId_fkey"
  FOREIGN KEY ("clientId","supersededByDraftId") REFERENCES "ClientDraft"("clientId","id") ON DELETE RESTRICT,
  ADD CONSTRAINT "Draft_archive_reason" CHECK (
    ("archiveReason" IS NULL AND "supersededByDraftId" IS NULL) OR
    ("archivedAt" IS NOT NULL AND coalesce("archiveReason",'')='MANUAL' AND "supersededByDraftId" IS NULL) OR
    ("archivedAt" IS NOT NULL AND coalesce("archiveReason",'')='SUPERSEDED' AND "supersededByDraftId" IS NOT NULL));
ALTER TABLE "ClientUpload" ADD COLUMN "comparisonDraftId" UUID, ADD COLUMN "comparisonStatistics" JSONB,
  ADD CONSTRAINT "ClientUpload_clientId_comparisonDraftId_fkey"
  FOREIGN KEY ("clientId","comparisonDraftId") REFERENCES "ClientDraft"("clientId","id") ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION mua_draft_lock() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE TRIGGER draft_lock BEFORE UPDATE ON "ClientDraft" FOR EACH ROW EXECUTE FUNCTION mua_draft_lock();
CREATE FUNCTION mua_draft_replacement_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."replacesDraftId" IS NOT NULL AND (TG_OP='INSERT' OR NEW."replacesDraftId" IS DISTINCT FROM OLD."replacesDraftId") AND NOT EXISTS (
    SELECT 1 FROM "ClientDraft" p WHERE p."id"=NEW."replacesDraftId" AND p."clientId"=NEW."clientId"
      AND p."versionSequence"<NEW."versionSequence" AND p."archivedAt" IS NULL AND p."status"<>'RELEASED'
      AND NOT EXISTS (SELECT 1 FROM "ClientRelease" r WHERE r."sourceDraftId"=p."id")) THEN
    RAISE EXCEPTION 'Replacement must reference an earlier unpublished draft of the same client';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER draft_replacement_guard BEFORE INSERT OR UPDATE ON "ClientDraft" FOR EACH ROW EXECUTE FUNCTION mua_draft_replacement_guard();

CREATE OR REPLACE FUNCTION mua_upload_lock() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['status','attempts','progress','leaseToken','leaseUntil','error','filesObjectKey','filesSha256','statistics','comparisonStatistics','detectedMods','warnings','draftId','sourceSha256','updatedAt','processingPhase','detectedInfo','selectedInstanceId']) IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status','attempts','progress','leaseToken','leaseUntil','error','filesObjectKey','filesSha256','statistics','comparisonStatistics','detectedMods','warnings','draftId','sourceSha256','updatedAt','processingPhase','detectedInfo','selectedInstanceId']) THEN
    RAISE EXCEPTION 'Upload ownership, source and baselines are immutable';
  END IF;
  IF NOT (
    (OLD."status"='UPLOADING' AND NEW."status" IN ('UPLOADING','QUEUED','CANCELLED')) OR
    (OLD."status"='QUEUED' AND NEW."status" IN ('QUEUED','PROCESSING','CANCELLED')) OR
    (OLD."status"='PROCESSING' AND (NEW."status" IN ('PROCESSING','READY','FAILED') OR (NEW."status"='QUEUED' AND NEW."processingPhase"='SELECT_INSTANCE'))) OR
    (OLD."status"='FAILED' AND NEW."status" IN ('FAILED','QUEUED','CANCELLED')) OR
    (OLD."status"='READY' AND NEW."status" IN ('READY','SUBMITTED','CANCELLED')) OR
    (OLD."status"='SUBMITTED' AND NEW."status"='SUBMITTED') OR
    (OLD."status"='CANCELLED' AND NEW."status"='CANCELLED')) THEN RAISE EXCEPTION 'Invalid upload state transition'; END IF;
  IF OLD."status" IN ('READY','SUBMITTED','CANCELLED') AND
     (to_jsonb(NEW) - ARRAY['status','draftId','updatedAt']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','draftId','updatedAt']) THEN
    RAISE EXCEPTION 'Prepared upload content is immutable';
  END IF;
  IF OLD."status" IN ('SUBMITTED','CANCELLED') AND NEW."draftId" IS DISTINCT FROM OLD."draftId" THEN RAISE EXCEPTION 'Closed upload draft binding is immutable'; END IF;
  IF NEW."draftId" IS DISTINCT FROM OLD."draftId" AND NOT (OLD."status"='READY' AND NEW."status"='SUBMITTED') THEN RAISE EXCEPTION 'Upload may bind a draft only once at submission'; END IF;
  IF OLD."status"='READY' AND NEW."status"='SUBMITTED' AND NOT EXISTS (
    SELECT 1 FROM "ClientDraft" WHERE "id"=NEW."draftId" AND "clientId"=NEW."clientId" AND "sourceObjectKey"=NEW."sourceObjectKey" AND "status"='SUBMITTED') THEN
    RAISE EXCEPTION 'Submitted draft must match the sealed upload';
  END IF;
  RETURN NEW;
END $$;
