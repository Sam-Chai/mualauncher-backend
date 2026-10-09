ALTER TABLE "Client" ADD COLUMN "deletedAt" TIMESTAMPTZ(6), ADD COLUMN "storageIndexedAt" TIMESTAMPTZ(6), ADD COLUMN "recycledAt" TIMESTAMPTZ(6);
DROP INDEX "Client_organizationId_nameKey_key";
CREATE UNIQUE INDEX "Client_active_name_key" ON "Client" ("organizationId", "nameKey") WHERE "deletedAt" IS NULL;
CREATE INDEX "Client_organizationId_nameKey_idx" ON "Client" ("organizationId", "nameKey");
CREATE TABLE "CasObject" ("sha256" CHAR(64) PRIMARY KEY, "size" BIGINT NOT NULL CHECK ("size" >= 0), "trashedAt" TIMESTAMPTZ(6), "purgedAt" TIMESTAMPTZ(6));
CREATE TABLE "CasReference" ("clientId" TEXT NOT NULL REFERENCES "Client"("id") ON DELETE RESTRICT, "sha256" CHAR(64) NOT NULL REFERENCES "CasObject"("sha256") ON DELETE RESTRICT, PRIMARY KEY ("clientId","sha256"));
CREATE INDEX "CasReference_sha256_idx" ON "CasReference"("sha256");
CREATE TABLE "RecycleObject" ("bucket" TEXT NOT NULL, "objectKey" TEXT NOT NULL, "trashKey" TEXT NOT NULL, "clientId" TEXT NOT NULL REFERENCES "Client"("id") ON DELETE RESTRICT, "trashedAt" TIMESTAMPTZ(6), "purgedAt" TIMESTAMPTZ(6), PRIMARY KEY ("bucket","objectKey"), UNIQUE ("bucket","trashKey"));
CREATE TABLE "PlatformSettings" ("id" TEXT PRIMARY KEY DEFAULT 'platform' CHECK ("id" = 'platform'), "recycleRetentionDays" INTEGER NOT NULL DEFAULT 7 CHECK ("recycleRetentionDays" BETWEEN 1 AND 365), "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now());

CREATE OR REPLACE FUNCTION mua_client_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId" OR NEW."name" IS DISTINCT FROM OLD."name" OR NEW."nameKey" IS DISTINCT FROM OLD."nameKey" OR NEW."scopeServerId" IS DISTINCT FROM OLD."scopeServerId" THEN
    RAISE EXCEPTION 'Client identity and authorization origin are immutable';
  END IF;
  IF OLD."deletedAt" IS NOT NULL AND (to_jsonb(NEW) - ARRAY['storageIndexedAt','recycledAt','updatedAt']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['storageIndexedAt','recycledAt','updatedAt']) THEN
    RAISE EXCEPTION 'Deleted clients cannot be restored or edited';
  END IF;
  IF OLD."deletedAt" IS NULL AND NEW."deletedAt" IS NOT NULL THEN
    IF OLD."archivedAt" IS NULL OR NEW."archivedAt" IS NULL OR NEW."currentReleaseId" IS NOT NULL OR NEW."requestedServerId" IS NOT NULL
      OR EXISTS (SELECT 1 FROM "ServerPublication" WHERE "clientId" = OLD."id")
      OR EXISTS (SELECT 1 FROM "ClientRelease" WHERE "clientId" = OLD."id")
      OR EXISTS (SELECT 1 FROM "ClientUpload" WHERE "clientId" = OLD."id" AND "status" IN ('UPLOADING','QUEUED','PROCESSING')) THEN
      RAISE EXCEPTION 'Client deletion requires archived, unpublished, unbound and inactive resources';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION mua_not_deleted_client() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Client" WHERE "id" = NEW."clientId" AND "deletedAt" IS NOT NULL) THEN RAISE EXCEPTION 'Deleted clients cannot accept resources or bindings'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER client_not_deleted BEFORE INSERT OR UPDATE ON "ServerPublication" FOR EACH ROW EXECUTE FUNCTION mua_not_deleted_client();
CREATE TRIGGER client_not_deleted BEFORE INSERT OR UPDATE ON "ClientUpload" FOR EACH ROW EXECUTE FUNCTION mua_not_deleted_client();
CREATE TRIGGER client_not_deleted BEFORE INSERT OR UPDATE ON "ClientDraft" FOR EACH ROW EXECUTE FUNCTION mua_not_deleted_client();
CREATE TRIGGER client_not_deleted BEFORE INSERT OR UPDATE ON "ClientRelease" FOR EACH ROW EXECUTE FUNCTION mua_not_deleted_client();
