ALTER TABLE "ClientDraft" ADD COLUMN "packageRevision" INTEGER NOT NULL DEFAULT 1 CHECK ("packageRevision">0), ADD COLUMN "reviewedPackageRevision" INTEGER;
CREATE OR REPLACE FUNCTION mua_draft_lock() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" = 'RELEASED' OR NEW."clientId" IS DISTINCT FROM OLD."clientId" THEN RAISE EXCEPTION 'Released drafts and client ownership are immutable'; END IF;
  IF OLD."status" IN ('SUBMITTED','APPROVED') AND
    (to_jsonb(NEW) - ARRAY['status','reviewedById','reviewedRevision','reviewedPackageRevision','reviewedAt','reviewNote','updatedAt','packageRevision']) IS DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['status','reviewedById','reviewedRevision','reviewedPackageRevision','reviewedAt','reviewNote','updatedAt','packageRevision']) THEN
    RAISE EXCEPTION 'Submitted draft content is locked';
  END IF;
  IF NEW."packageRevision" IS DISTINCT FROM OLD."packageRevision" AND
    (NEW."packageRevision" <> OLD."packageRevision"+1 OR NEW."status"<>'SUBMITTED' OR NEW."reviewedById" IS NOT NULL OR NEW."reviewedPackageRevision" IS NOT NULL OR NEW."reviewedRevision" IS NOT NULL) THEN
    RAISE EXCEPTION 'Platform changes require a new review';
  END IF;
  RETURN NEW;
END $$;
UPDATE "ClientDraft" SET "reviewedPackageRevision"=1 WHERE "status"='APPROVED';
CREATE TABLE "PackageBuild" (
  "id" UUID PRIMARY KEY, "draftId" UUID NOT NULL REFERENCES "ClientDraft"("id") ON DELETE RESTRICT,
  "platform" TEXT NOT NULL CHECK ("platform" IN ('windows-amd64','windows-aarch64','linux-amd64','linux-aarch64','macos-amd64','macos-aarch64')),
  "required" BOOLEAN NOT NULL DEFAULT true,
  "status" TEXT NOT NULL DEFAULT 'QUEUED' CHECK ("status" IN ('QUEUED','PROCESSING','PREPARED','READY','FAILED')),
  "phase" TEXT NOT NULL DEFAULT '等待环境准备', "progress" INTEGER NOT NULL DEFAULT 0 CHECK ("progress" BETWEEN 0 AND 100),
  "attempts" INTEGER NOT NULL DEFAULT 0, "leaseToken" UUID, "leaseUntil" TIMESTAMP(3), "error" TEXT,
  "targetObjectKey" TEXT, "targetSha256" CHAR(64), "artifacts" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  UNIQUE("draftId","platform")
);
CREATE INDEX "PackageBuild_status_leaseUntil_createdAt_idx" ON "PackageBuild"("status","leaseUntil","createdAt");
INSERT INTO "PackageBuild" ("id","draftId","platform","updatedAt")
SELECT gen_random_uuid(), d."id", p, now() FROM "ClientDraft" d JOIN "ClientUpload" u ON u."draftId"=d."id"
JOIN "Client" c ON c."id"=d."clientId"
CROSS JOIN unnest(ARRAY['windows-amd64','windows-aarch64','linux-amd64','linux-aarch64','macos-amd64','macos-aarch64']) p
WHERE d."status" IN ('SUBMITTED','APPROVED') AND d."archivedAt" IS NULL AND c."deletedAt" IS NULL;
CREATE FUNCTION mua_package_build_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d "ClientDraft";
BEGIN
  SELECT * INTO d FROM "ClientDraft" WHERE "id" = NEW."draftId" FOR UPDATE;
  IF EXISTS (SELECT 1 FROM "Client" WHERE "id" = d."clientId" AND "deletedAt" IS NOT NULL) THEN
    RAISE EXCEPTION 'Deleted clients cannot build packages';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW."draftId" <> OLD."draftId" OR NEW."platform" <> OLD."platform" OR NEW."id" <> OLD."id" THEN
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
CREATE TRIGGER package_build_guard BEFORE INSERT OR UPDATE ON "PackageBuild" FOR EACH ROW EXECUTE FUNCTION mua_package_build_guard();
CREATE TRIGGER no_delete BEFORE DELETE ON "PackageBuild" FOR EACH ROW EXECUTE FUNCTION mua_no_delete();
CREATE FUNCTION mua_package_publish_gate() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE TRIGGER package_publish_gate BEFORE INSERT ON "ClientRelease" FOR EACH ROW EXECUTE FUNCTION mua_package_publish_gate();
CREATE FUNCTION mua_package_delete_gate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."deletedAt" IS NULL AND NEW."deletedAt" IS NOT NULL AND EXISTS (
    SELECT 1 FROM "PackageBuild" b JOIN "ClientDraft" d ON d."id"=b."draftId" WHERE d."clientId"=OLD."id" AND b."status"='PROCESSING'
  ) THEN RAISE EXCEPTION 'Client has an active package build'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER package_delete_gate BEFORE UPDATE ON "Client" FOR EACH ROW EXECUTE FUNCTION mua_package_delete_gate();
