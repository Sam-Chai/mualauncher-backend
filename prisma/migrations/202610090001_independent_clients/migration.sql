-- Separate immutable client identity from replaceable server binding. Preserve all rows and signed objects.
DROP TRIGGER client_scope_immutable ON "Client";
DROP TRIGGER publication_active ON "ServerPublication";
DROP TRIGGER server_complete ON "Server";
ALTER TABLE "ClientUpload" DROP CONSTRAINT "ClientUpload_serverId_fkey", DROP CONSTRAINT "ClientUpload_serverId_draftId_fkey", DROP CONSTRAINT "Upload_base_scope";
ALTER TABLE "ClientRelease" DROP CONSTRAINT "ClientRelease_serverId_fkey", DROP CONSTRAINT "ClientRelease_serverId_sourceDraftId_fkey";
ALTER TABLE "ClientDraft" DROP CONSTRAINT "ClientDraft_serverId_fkey";
ALTER TABLE "ServerPublication" DROP CONSTRAINT "ServerPublication_serverId_releaseId_fkey";
ALTER TABLE "Client" DROP CONSTRAINT "Client_organizationId_serverId_fkey";

ALTER TABLE "Client" RENAME COLUMN "serverId" TO "id";
ALTER TABLE "Client" ALTER COLUMN "id" TYPE TEXT;
ALTER TABLE "ClientDraft" RENAME COLUMN "serverId" TO "clientId";
ALTER TABLE "ClientDraft" ALTER COLUMN "clientId" TYPE TEXT;
ALTER TABLE "ClientRelease" RENAME COLUMN "serverId" TO "clientId";
ALTER TABLE "ClientRelease" ALTER COLUMN "clientId" TYPE TEXT;
ALTER TABLE "ClientUpload" RENAME COLUMN "serverId" TO "clientId";
ALTER TABLE "ClientUpload" ALTER COLUMN "clientId" TYPE TEXT;

ALTER TABLE "Client" ADD COLUMN "name" TEXT, ADD COLUMN "nameKey" TEXT,
  ADD COLUMN "scopeServerId" VARCHAR(5), ADD COLUMN "currentReleaseId" UUID,
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "requestedServerId" VARCHAR(5), ADD COLUMN "requestedRevision" INTEGER, ADD COLUMN "expectedClientId" TEXT;
UPDATE "Client" c SET "scopeServerId" = c."id",
  "currentReleaseId" = p."releaseId", "revision" = coalesce(p."revision", 0),
  "name" = coalesce((SELECT d."name" FROM "ClientDraft" d WHERE d."clientId" = c."id" AND nullif(btrim(d."name"), '') IS NOT NULL ORDER BY d."createdAt" DESC LIMIT 1), s."displayName", c."id")
  FROM "Server" s LEFT JOIN "ServerPublication" p ON p."serverId" = s."serverId" WHERE s."serverId" = c."id";
-- Resolve preexisting duplicate display labels without losing their versions.
DO $$ DECLARE c RECORD; candidate TEXT; k TEXT; suffix INTEGER; BEGIN
  FOR c IN SELECT * FROM "Client" ORDER BY "createdAt", "id" LOOP
    candidate := btrim(c."name"); k := lower(normalize(candidate, NFKC)); suffix := 0;
    WHILE EXISTS (SELECT 1 FROM "Client" WHERE "organizationId" = c."organizationId" AND "nameKey" = k AND "id" <> c."id") LOOP
      suffix := suffix + 1; candidate := btrim(c."name") || ' (' || c."id" || CASE WHEN suffix = 1 THEN '' ELSE '-' || suffix END || ')';
      k := lower(normalize(candidate, NFKC));
    END LOOP;
    UPDATE "Client" SET "name" = candidate, "nameKey" = k WHERE "id" = c."id";
  END LOOP;
END $$;
ALTER TABLE "Client" ALTER COLUMN "name" SET NOT NULL, ALTER COLUMN "nameKey" SET NOT NULL;
CREATE UNIQUE INDEX "Client_organizationId_nameKey_key" ON "Client" ("organizationId", "nameKey");
ALTER TABLE "Client" ADD CONSTRAINT "Client_revision_bounds" CHECK ("revision" >= 0),
  ADD CONSTRAINT "Client_name_bounds" CHECK (length(btrim("name")) BETWEEN 1 AND 200 AND "nameKey" = lower(normalize(btrim("name"), NFKC))),
  ADD CONSTRAINT "Client_scopeServer_fkey" FOREIGN KEY ("organizationId", "scopeServerId") REFERENCES "Server" ("organizationId", "serverId") ON DELETE RESTRICT,
  ADD CONSTRAINT "Client_currentRelease_fkey" FOREIGN KEY ("id", "currentReleaseId") REFERENCES "ClientRelease" ("clientId", "id") DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT "Client_requestedServer_fkey" FOREIGN KEY ("organizationId", "requestedServerId") REFERENCES "Server" ("organizationId", "serverId") ON DELETE RESTRICT,
  ADD CONSTRAINT "Client_requested_binding" CHECK (("requestedServerId" IS NULL AND "requestedRevision" IS NULL AND "expectedClientId" IS NULL) OR ("requestedServerId" IS NOT NULL AND "requestedRevision" >= 0));
ALTER TABLE "ClientDraft" ADD CONSTRAINT "ClientDraft_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT;
ALTER TABLE "ClientRelease" ADD CONSTRAINT "ClientRelease_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "ClientRelease_clientId_sourceDraftId_fkey" FOREIGN KEY ("clientId", "sourceDraftId") REFERENCES "ClientDraft" ("clientId", "id") ON DELETE RESTRICT;
ALTER TABLE "ClientUpload" ADD CONSTRAINT "ClientUpload_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "ClientUpload_clientId_draftId_fkey" FOREIGN KEY ("clientId", "draftId") REFERENCES "ClientDraft" ("clientId", "id") ON DELETE RESTRICT,
  ADD CONSTRAINT "Upload_base_scope" FOREIGN KEY ("clientId", "baseReleaseId") REFERENCES "ClientRelease" ("clientId", "id") ON DELETE RESTRICT;

ALTER TABLE "ServerPublication" ADD COLUMN "clientId" TEXT;
UPDATE "ServerPublication" SET "clientId" = "serverId";
UPDATE "ServerPublication" p SET "clientId" = NULL, "releaseId" = NULL WHERE EXISTS (
  SELECT 1 FROM "Client" c JOIN "Server" s ON s."serverId" = p."serverId" JOIN "Organization" o ON o."id" = c."organizationId"
  WHERE c."id" = p."clientId" AND (c."archivedAt" IS NOT NULL OR s."archivedAt" IS NOT NULL OR o."archivedAt" IS NOT NULL)
);
CREATE UNIQUE INDEX "ServerPublication_clientId_key" ON "ServerPublication" ("clientId");
CREATE UNIQUE INDEX "ServerPublication_clientId_releaseId_key" ON "ServerPublication" ("clientId", "releaseId");
ALTER TABLE "ServerPublication" ADD CONSTRAINT "ServerPublication_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "ServerPublication_clientId_releaseId_fkey" FOREIGN KEY ("clientId", "releaseId") REFERENCES "ClientRelease" ("clientId", "id") ON DELETE RESTRICT,
  ADD CONSTRAINT "Publication_release_has_client" CHECK ("releaseId" IS NULL OR "clientId" IS NOT NULL);

CREATE FUNCTION mua_client_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId" OR NEW."name" IS DISTINCT FROM OLD."name" OR NEW."nameKey" IS DISTINCT FROM OLD."nameKey" OR NEW."scopeServerId" IS DISTINCT FROM OLD."scopeServerId" THEN
    RAISE EXCEPTION 'Client identity and authorization origin are immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER client_scope_immutable BEFORE UPDATE ON "Client" FOR EACH ROW EXECUTE FUNCTION mua_client_identity();

CREATE OR REPLACE FUNCTION mua_draft_lock() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" = 'RELEASED' OR NEW."clientId" IS DISTINCT FROM OLD."clientId" THEN RAISE EXCEPTION 'Released drafts and client ownership are immutable'; END IF;
  IF OLD."status" IN ('SUBMITTED', 'APPROVED') AND
    (to_jsonb(NEW) - ARRAY['status','reviewedById','reviewedRevision','reviewedAt','reviewNote','updatedAt']) IS DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['status','reviewedById','reviewedRevision','reviewedAt','reviewNote','updatedAt']) THEN
    RAISE EXCEPTION 'Submitted draft content is locked';
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION mua_publication_active() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE TRIGGER publication_active BEFORE INSERT OR UPDATE ON "ServerPublication" FOR EACH ROW EXECUTE FUNCTION mua_publication_active();
CREATE OR REPLACE FUNCTION mua_server_complete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "ServerPublication" WHERE "serverId" = NEW."serverId") THEN RAISE EXCEPTION 'Server requires a publication container'; END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER server_complete AFTER INSERT ON "Server" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION mua_server_complete();

CREATE FUNCTION mua_binding_consistent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE client_id TEXT;
BEGIN
  client_id := CASE WHEN TG_TABLE_NAME = 'Client' THEN to_jsonb(NEW)->>'id' ELSE to_jsonb(NEW)->>'clientId' END;
  IF EXISTS (SELECT 1 FROM "ServerPublication" p JOIN "Client" c ON c."id" = p."clientId"
    WHERE p."clientId" = client_id AND p."releaseId" IS DISTINCT FROM c."currentReleaseId") THEN
    RAISE EXCEPTION 'Bound server and client current release must change atomically';
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER client_binding_consistent AFTER INSERT OR UPDATE ON "Client" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION mua_binding_consistent();
CREATE CONSTRAINT TRIGGER publication_binding_consistent AFTER INSERT OR UPDATE ON "ServerPublication" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION mua_binding_consistent();

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
    SELECT 1 FROM "ClientDraft" WHERE "id" = NEW."draftId" AND "clientId" = NEW."clientId"
      AND "sourceObjectKey" = NEW."sourceObjectKey" AND "status" = 'SUBMITTED'
  ) THEN RAISE EXCEPTION 'Submitted draft must match the sealed upload'; END IF;
  RETURN NEW;
END $$;
