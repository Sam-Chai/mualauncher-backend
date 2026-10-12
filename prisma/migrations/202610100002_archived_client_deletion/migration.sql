-- Archiving is the client's lifecycle state; published releases remain immutable history.
-- Only replace the identity guard. Do not rewrite releases, signatures or deleted clients.
CREATE OR REPLACE FUNCTION mua_client_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId" OR NEW."scopeServerId" IS DISTINCT FROM OLD."scopeServerId" THEN
    RAISE EXCEPTION 'Client identity and authorization origin are immutable';
  END IF;
  IF NEW."name" IS DISTINCT FROM OLD."name" OR NEW."nameKey" IS DISTINCT FROM OLD."nameKey" THEN
    IF OLD."deletedAt" IS NOT NULL OR OLD."archivedAt" IS NOT NULL OR OLD."currentReleaseId" IS NOT NULL OR OLD."revision" <> 0
      OR EXISTS (SELECT 1 FROM "ClientDraft" WHERE "clientId" = OLD."id")
      OR EXISTS (SELECT 1 FROM "ClientRelease" WHERE "clientId" = OLD."id")
      OR (SELECT count(*) FROM "ClientUpload" WHERE "clientId" = OLD."id" AND "status" IN ('UPLOADING','QUEUED','PROCESSING','READY','SUBMITTED')) <> 1
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
      OR EXISTS (SELECT 1 FROM "ClientUpload" WHERE "clientId" = OLD."id" AND "status" IN ('UPLOADING','QUEUED','PROCESSING'))
      OR EXISTS (SELECT 1 FROM "PackageBuild" b JOIN "ClientDraft" d ON d."id" = b."draftId" WHERE d."clientId" = OLD."id" AND b."status" = 'PROCESSING') THEN
      RAISE EXCEPTION 'Client deletion requires archived, unbound and inactive resources';
    END IF;
  END IF;
  RETURN NEW;
END $$;
