ALTER TABLE "PlatformSettings"
  ADD COLUMN "remoteSourceWhitelistEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "remoteSourceHosts" TEXT[] NOT NULL DEFAULT ARRAY['cdn.modrinth.com','github.com','raw.githubusercontent.com','release-assets.githubusercontent.com','objects.githubusercontent.com','gitlab.com','edge.forgecdn.net','mediafilez.forgecdn.net']::TEXT[],
  ADD COLUMN "downloadProxyEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "downloadProxyUrl" TEXT NOT NULL DEFAULT '';

ALTER TABLE "ClientUpload" DROP CONSTRAINT "upload_phase_valid";
ALTER TABLE "ClientUpload" ADD CONSTRAINT "upload_phase_valid"
  CHECK ("processingPhase" IS NULL OR "processingPhase" IN ('FETCHING','INSPECTING','SELECT_INSTANCE','DOWNLOADING','CAS'));

-- An imported pack may confirm the provisional name once, before its first draft.
-- Client IDs, organizations, scopes and all established version identities stay immutable.
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
    IF OLD."archivedAt" IS NULL OR NEW."archivedAt" IS NULL OR NEW."currentReleaseId" IS NOT NULL OR NEW."requestedServerId" IS NOT NULL
      OR EXISTS (SELECT 1 FROM "ServerPublication" WHERE "clientId" = OLD."id")
      OR EXISTS (SELECT 1 FROM "ClientRelease" WHERE "clientId" = OLD."id")
      OR EXISTS (SELECT 1 FROM "ClientUpload" WHERE "clientId" = OLD."id" AND "status" IN ('UPLOADING','QUEUED','PROCESSING'))
      OR EXISTS (SELECT 1 FROM "PackageBuild" b JOIN "ClientDraft" d ON d."id" = b."draftId" WHERE d."clientId" = OLD."id" AND b."status" = 'PROCESSING') THEN
      RAISE EXCEPTION 'Client deletion requires archived, unpublished, unbound and inactive resources';
    END IF;
  END IF;
  RETURN NEW;
END $$;
