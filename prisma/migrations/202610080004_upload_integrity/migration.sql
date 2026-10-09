CREATE OR REPLACE FUNCTION mua_upload_lock() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['status','attempts','progress','leaseToken','leaseUntil','error','filesObjectKey','filesSha256','statistics','detectedMods','warnings','draftId','sourceSha256','updatedAt']) IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status','attempts','progress','leaseToken','leaseUntil','error','filesObjectKey','filesSha256','statistics','detectedMods','warnings','draftId','sourceSha256','updatedAt']) THEN
    RAISE EXCEPTION 'Upload ownership, source and baseline are immutable';
  END IF;
  IF NOT (
    (OLD."status" = 'UPLOADING' AND NEW."status" IN ('UPLOADING','QUEUED','CANCELLED')) OR
    (OLD."status" = 'QUEUED' AND NEW."status" IN ('QUEUED','PROCESSING','CANCELLED')) OR
    (OLD."status" = 'PROCESSING' AND NEW."status" IN ('PROCESSING','READY','FAILED')) OR
    (OLD."status" = 'FAILED' AND NEW."status" IN ('FAILED','QUEUED','CANCELLED')) OR
    (OLD."status" = 'READY' AND NEW."status" IN ('READY','SUBMITTED','CANCELLED')) OR
    (OLD."status" = 'SUBMITTED' AND NEW."status" = 'SUBMITTED') OR
    (OLD."status" = 'CANCELLED' AND NEW."status" = 'CANCELLED')
  ) THEN RAISE EXCEPTION 'Invalid upload state transition'; END IF;
  IF OLD."status" IN ('READY','SUBMITTED','CANCELLED') AND
     (to_jsonb(NEW) - ARRAY['status','draftId','updatedAt']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','draftId','updatedAt']) THEN
    RAISE EXCEPTION 'Prepared upload content is immutable';
  END IF;
  IF OLD."status" IN ('SUBMITTED','CANCELLED') AND NEW."draftId" IS DISTINCT FROM OLD."draftId" THEN
    RAISE EXCEPTION 'Closed upload draft binding is immutable';
  END IF;
  IF NEW."draftId" IS DISTINCT FROM OLD."draftId" AND NOT (OLD."status" = 'READY' AND NEW."status" = 'SUBMITTED') THEN
    RAISE EXCEPTION 'Upload may bind a draft only once at submission';
  END IF;
  IF OLD."status" = 'READY' AND NEW."status" = 'SUBMITTED' AND NOT EXISTS (
    SELECT 1 FROM "ClientDraft" WHERE "id" = NEW."draftId" AND "serverId" = NEW."serverId"
      AND "sourceObjectKey" = NEW."sourceObjectKey" AND "status" = 'SUBMITTED'
  ) THEN RAISE EXCEPTION 'Submitted draft must match the sealed upload'; END IF;
  RETURN NEW;
END $$;
