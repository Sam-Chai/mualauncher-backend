-- Existing signed v1 publications and artifacts remain unchanged.
ALTER TABLE "ClientDraft" ADD COLUMN "supportedPlatforms" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "PackageBuild" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision">0);
ALTER TABLE "PackageBuild" DROP CONSTRAINT "PackageBuild_platform_check", DROP CONSTRAINT "PackageBuild_draftId_platform_key";
ALTER TABLE "PackageBuild" ADD CONSTRAINT "PackageBuild_platform_check" CHECK ("platform" IN ('windows-amd64','windows-aarch64','linux-amd64','linux-aarch64','macos-amd64','macos-aarch64','universal'));
CREATE UNIQUE INDEX "PackageBuild_draftId_platform_revision_key" ON "PackageBuild"("draftId","platform","revision");
CREATE FUNCTION mua_v2_platforms_valid(selected TEXT[]) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT cardinality(selected)>0 AND cardinality(selected)<=6 AND selected=ARRAY(
  SELECT p FROM unnest(ARRAY['windows-amd64','windows-aarch64','linux-amd64','linux-aarch64','macos-amd64','macos-aarch64']) WITH ORDINALITY AS platforms(p,n)
  WHERE p=ANY(selected) ORDER BY n)
$$;
CREATE OR REPLACE FUNCTION mua_draft_lock() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status"='RELEASED' OR NEW."clientId" IS DISTINCT FROM OLD."clientId" OR NEW."versionSequence"<>OLD."versionSequence" THEN
    RAISE EXCEPTION 'Released drafts and client/sequence identity are immutable';
  END IF;
  IF OLD."status" IN ('SUBMITTED','APPROVED') AND
    (to_jsonb(NEW) - ARRAY['status','reviewedById','reviewedRevision','reviewedPackageRevision','reviewedAt','reviewNote','updatedAt','packageRevision','archivedAt','archiveReason','supersededByDraftId','replacesDraftId','supportedPlatforms']) IS DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['status','reviewedById','reviewedRevision','reviewedPackageRevision','reviewedAt','reviewNote','updatedAt','packageRevision','archivedAt','archiveReason','supersededByDraftId','replacesDraftId','supportedPlatforms']) THEN
    RAISE EXCEPTION 'Submitted draft content is locked';
  END IF;
  IF NEW."packageRevision" IS DISTINCT FROM OLD."packageRevision" AND
    (NEW."packageRevision"<>OLD."packageRevision"+1 OR NEW."status"<>'SUBMITTED' OR NEW."reviewedById" IS NOT NULL OR NEW."reviewedPackageRevision" IS NOT NULL OR NEW."reviewedRevision" IS NOT NULL) THEN
    RAISE EXCEPTION 'Platform changes require a new review';
  END IF;
  IF NEW."supportedPlatforms" IS DISTINCT FROM OLD."supportedPlatforms" AND
    (OLD."packageFormatVersion"<>2 OR NEW."packageRevision"<>OLD."packageRevision"+1) THEN
    RAISE EXCEPTION 'v2 platform changes require a new package revision';
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION mua_package_build_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d "ClientDraft";
BEGIN
  SELECT * INTO d FROM "ClientDraft" WHERE "id" = NEW."draftId" FOR UPDATE;
  IF EXISTS (SELECT 1 FROM "Client" WHERE "id" = d."clientId" AND "deletedAt" IS NOT NULL) THEN
    RAISE EXCEPTION 'Deleted clients cannot build packages';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW."draftId" <> OLD."draftId" OR NEW."platform" <> OLD."platform" OR NEW."id" <> OLD."id" OR NEW."revision" <> OLD."revision" THEN
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

CREATE OR REPLACE FUNCTION mua_upload_format_gate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."packageFormatVersion"=1 AND NEW."status"::text='WAITING_PROCESSOR' THEN RAISE EXCEPTION 'v1 uploads cannot wait for a processor'; END IF;
 IF NEW."packageFormatVersion"=2 AND NEW."status"::text IN ('READY','SUBMITTED') AND
   (NEW."sourceSha256" IS NULL OR NEW."filesObjectKey" IS NULL OR NEW."filesSha256" IS NULL OR
    NEW."statistics"->>'localFiles' IS NULL OR NEW."statistics"->>'remoteFiles' IS NULL) THEN RAISE EXCEPTION 'v2 requires a sealed recipe import'; END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION mua_draft_format_gate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW."packageFormatVersion" IS DISTINCT FROM OLD."packageFormatVersion" THEN RAISE EXCEPTION 'Draft format is immutable'; END IF;
 IF NEW."packageFormatVersion"=1 AND cardinality(NEW."supportedPlatforms")<>0 THEN RAISE EXCEPTION 'v1 uses platform build selection'; END IF;
 IF NEW."packageFormatVersion"=2 AND NEW."status" IN ('SUBMITTED','APPROVED','RELEASED') AND NOT mua_v2_platforms_valid(NEW."supportedPlatforms") THEN RAISE EXCEPTION 'v2 requires a canonical supported platform set'; END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION mua_build_format_gate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d "ClientDraft";
BEGIN
 SELECT * INTO d FROM "ClientDraft" WHERE "id"=NEW."draftId";
 IF NOT FOUND OR (d."packageFormatVersion"=1 AND (NEW."platform"='universal' OR NEW."revision"<>1)) OR
  (d."packageFormatVersion"=2 AND (NEW."platform"<>'universal' OR (NEW."required" AND NEW."revision"<>d."packageRevision"))) THEN
  RAISE EXCEPTION 'Package build format, platform and revision must match the source draft'; END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION mua_release_format_gate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM "ClientDraft" WHERE "id"=NEW."sourceDraftId" AND "clientId"=NEW."clientId" AND "packageFormatVersion"=NEW."packageFormatVersion") THEN RAISE EXCEPTION 'Release format must match its draft'; END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION mua_release_approved() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d "ClientDraft";
BEGIN
 SELECT * INTO d FROM "ClientDraft" WHERE "id"=NEW."sourceDraftId" FOR UPDATE;
 IF d."status"<>'APPROVED' OR d."archivedAt" IS NOT NULL OR d."reviewedRevision" IS DISTINCT FROM d."contentRevision" OR
  d."reviewedById" IS DISTINCT FROM NEW."approvedById" OR d."versionLabel" IS DISTINCT FROM NEW."versionLabel" OR d."name" IS DISTINCT FROM NEW."name" OR
  d."summary" IS DISTINCT FROM NEW."summary" OR d."description" IS DISTINCT FROM NEW."description" OR d."changelog" IS DISTINCT FROM NEW."changelog" OR
  (EXISTS (SELECT 1 FROM "ClientUpload" WHERE "draftId"=d."id") AND d."candidateMetadata" IS DISTINCT FROM NEW."environmentSnapshot") THEN
  RAISE EXCEPTION 'Release must match its approved draft revision'; END IF;
 IF d."packageFormatVersion"=1 AND (d."candidateManifestSha256" IS DISTINCT FROM NEW."manifestSha256" OR d."candidateManifestKey" IS DISTINCT FROM NEW."manifestObjectKey") THEN
  RAISE EXCEPTION 'v1 release must match its candidate manifest'; END IF;
 IF d."packageFormatVersion"=2 AND (
  d."reviewedPackageRevision" IS DISTINCT FROM d."packageRevision" OR
  (SELECT count(*) FROM "PackageBuild" WHERE "draftId"=d."id" AND "required")<>1 OR NOT EXISTS (
   SELECT 1 FROM "PackageBuild" WHERE "draftId"=d."id" AND "required" AND "platform"='universal' AND "revision"=d."packageRevision" AND "status"='READY'
    AND "targetObjectKey"=NEW."manifestObjectKey" AND "targetSha256"=NEW."manifestSha256" AND "artifacts"->>'signingKeyId'=NEW."signingKeyId")) THEN
  RAISE EXCEPTION 'v2 publication requires the reviewed, signed current recipe artifact'; END IF;
 RETURN NEW;
END $$;
