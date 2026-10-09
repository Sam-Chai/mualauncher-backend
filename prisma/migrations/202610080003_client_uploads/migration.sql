-- CreateEnum
CREATE TYPE "UploadStatus" AS ENUM ('UPLOADING', 'QUEUED', 'PROCESSING', 'READY', 'FAILED', 'SUBMITTED', 'CANCELLED');

-- AlterTable
ALTER TABLE "ClientDraft" ADD COLUMN     "summary" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "ClientRelease" ADD COLUMN     "summary" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "ClientUpload" (
    "id" UUID NOT NULL,
    "serverId" VARCHAR(5) NOT NULL,
    "createdById" UUID NOT NULL,
    "fileName" TEXT NOT NULL,
    "size" BIGINT NOT NULL,
    "partSize" INTEGER NOT NULL,
    "multipartId" TEXT NOT NULL,
    "sourceObjectKey" TEXT NOT NULL,
    "sourceSha256" CHAR(64),
    "baseReleaseId" UUID,
    "basePublicationRevision" INTEGER NOT NULL,
    "status" "UploadStatus" NOT NULL DEFAULT 'UPLOADING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "leaseToken" UUID,
    "leaseUntil" TIMESTAMPTZ(6),
    "error" TEXT,
    "filesObjectKey" TEXT,
    "filesSha256" CHAR(64),
    "statistics" JSONB,
    "detectedMods" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "draftId" UUID,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ClientUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiToken" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "permissions" TEXT[],
    "serverIds" TEXT[],
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "revokedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerHeartbeat" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkerHeartbeat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClientUpload_sourceObjectKey_key" ON "ClientUpload"("sourceObjectKey");

-- CreateIndex
CREATE UNIQUE INDEX "ClientUpload_draftId_key" ON "ClientUpload"("draftId");

-- CreateIndex
CREATE INDEX "ClientUpload_status_leaseUntil_createdAt_idx" ON "ClientUpload"("status", "leaseUntil", "createdAt");

-- CreateIndex
CREATE INDEX "ClientUpload_serverId_createdAt_idx" ON "ClientUpload"("serverId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ClientUpload_serverId_draftId_key" ON "ClientUpload"("serverId", "draftId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiToken_tokenHash_key" ON "ApiToken"("tokenHash");

-- AddForeignKey
ALTER TABLE "ClientUpload" ADD CONSTRAINT "ClientUpload_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Client"("serverId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientUpload" ADD CONSTRAINT "ClientUpload_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientUpload" ADD CONSTRAINT "ClientUpload_serverId_draftId_fkey" FOREIGN KEY ("serverId", "draftId") REFERENCES "ClientDraft"("serverId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiToken" ADD CONSTRAINT "ApiToken_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ClientUpload" ADD CONSTRAINT "Upload_bounds" CHECK ("size" > 0 AND "size" <= 21474836480 AND "partSize" >= 5242880 AND "basePublicationRevision" >= 0 AND "progress" BETWEEN 0 AND 100),
  ADD CONSTRAINT "Upload_base_scope" FOREIGN KEY ("serverId", "baseReleaseId") REFERENCES "ClientRelease"("serverId", "id") ON DELETE RESTRICT,
  ADD CONSTRAINT "Upload_ready_inventory" CHECK ("status" NOT IN ('READY','SUBMITTED') OR ("filesObjectKey" IS NOT NULL AND "filesSha256" ~ '^[0-9a-f]{64}$' AND "sourceSha256" ~ '^[0-9a-f]{64}$' AND "statistics" IS NOT NULL)),
  ADD CONSTRAINT "Upload_submitted_draft" CHECK ("status" <> 'SUBMITTED' OR "draftId" IS NOT NULL);
CREATE TRIGGER no_delete BEFORE DELETE ON "ClientUpload" FOR EACH ROW EXECUTE FUNCTION mua_no_delete();
CREATE TRIGGER no_delete BEFORE DELETE ON "ApiToken" FOR EACH ROW EXECUTE FUNCTION mua_no_delete();

CREATE FUNCTION mua_upload_lock() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['status','attempts','progress','leaseToken','leaseUntil','error','filesObjectKey','filesSha256','statistics','detectedMods','warnings','draftId','sourceSha256','updatedAt']) IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status','attempts','progress','leaseToken','leaseUntil','error','filesObjectKey','filesSha256','statistics','detectedMods','warnings','draftId','sourceSha256','updatedAt']) THEN
    RAISE EXCEPTION 'Upload ownership, source and baseline are immutable';
  END IF;
  IF OLD."status" IN ('READY','SUBMITTED','CANCELLED') AND
     (to_jsonb(NEW) - ARRAY['status','draftId','updatedAt']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','draftId','updatedAt']) THEN
    RAISE EXCEPTION 'Prepared upload content is immutable';
  END IF;
  IF OLD."status" = 'SUBMITTED' AND NEW."status" <> 'SUBMITTED' THEN RAISE EXCEPTION 'Submitted upload is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER upload_lock BEFORE UPDATE ON "ClientUpload" FOR EACH ROW EXECUTE FUNCTION mua_upload_lock();

CREATE OR REPLACE FUNCTION mua_release_approved() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE draft "ClientDraft";
BEGIN
  SELECT * INTO draft FROM "ClientDraft" WHERE "id" = NEW."sourceDraftId" FOR UPDATE;
  IF draft."status" <> 'APPROVED' OR draft."archivedAt" IS NOT NULL OR
    draft."reviewedRevision" IS DISTINCT FROM draft."contentRevision" OR
    draft."candidateManifestSha256" IS DISTINCT FROM NEW."manifestSha256" OR
    draft."candidateManifestKey" IS DISTINCT FROM NEW."manifestObjectKey" OR
    draft."reviewedById" IS DISTINCT FROM NEW."approvedById" OR
    draft."versionLabel" IS DISTINCT FROM NEW."versionLabel" OR draft."name" IS DISTINCT FROM NEW."name" OR
    draft."summary" IS DISTINCT FROM NEW."summary" OR
    draft."description" IS DISTINCT FROM NEW."description" OR draft."changelog" IS DISTINCT FROM NEW."changelog" OR
    (EXISTS (SELECT 1 FROM "ClientUpload" WHERE "draftId" = draft."id") AND draft."candidateMetadata" IS DISTINCT FROM NEW."environmentSnapshot") THEN
    RAISE EXCEPTION 'Release must match its approved draft revision';
  END IF;
  RETURN NEW;
END $$;
