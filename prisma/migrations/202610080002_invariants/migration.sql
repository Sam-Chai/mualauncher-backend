-- Prisma cannot express these checks, expression indexes and triggers.
CREATE UNIQUE INDEX "Server_serverId_casefold_key" ON "Server" (lower("serverId"));
ALTER TABLE "Server" ADD CONSTRAINT "Server_id_format" CHECK ("serverId" ~ '^[A-Za-z]{3,5}$'),
  ADD CONSTRAINT "Server_color_format" CHECK ("themeColor" IS NULL OR "themeColor" ~ '^#[0-9A-Fa-f]{6}$');
ALTER TABLE "LocalCredential" ADD CONSTRAINT "Credential_username_format" CHECK ("username" ~ '^[a-z0-9_.-]{3,64}$');
ALTER TABLE "ServerGrant" ADD CONSTRAINT "ServerGrant_no_org_admin" CHECK (NOT ('ORG_ADMIN'::"Role" = ANY("roles")));
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_server_scope" CHECK ("serverId" IS NULL OR "organizationId" IS NOT NULL);
ALTER TABLE "ServerPublication" ADD CONSTRAINT "Publication_revision_positive" CHECK ("revision" >= 0);
ALTER TABLE "ClientDraft" ADD CONSTRAINT "Draft_revision_positive" CHECK ("contentRevision" > 0),
  ADD CONSTRAINT "Draft_digest_format" CHECK ("candidateManifestSha256" IS NULL OR "candidateManifestSha256" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "Draft_approval_revision" CHECK ("status" NOT IN ('APPROVED', 'RELEASED') OR
    ("reviewedById" IS NOT NULL AND "reviewedAt" IS NOT NULL AND "reviewedRevision" = "contentRevision" AND
     "candidateManifestSha256" IS NOT NULL AND "candidateManifestKey" IS NOT NULL));
ALTER TABLE "ClientRelease" ADD CONSTRAINT "Release_digest_format" CHECK ("manifestSha256" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "Release_signed_snapshot" CHECK (length("signature") > 0 AND length("signingKeyId") > 0 AND length("versionLabel") > 0);

CREATE FUNCTION mua_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Business records must be archived or disabled, not deleted'; END;
$$;
DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['Account', 'LocalCredential', 'Organization', 'OrganizationMember', 'Server', 'Client',
    'ServerGrant', 'ClientDraft', 'ClientRelease', 'ServerPublication', 'AuditEvent'] LOOP
    EXECUTE format('CREATE TRIGGER no_delete BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION mua_no_delete()', name);
  END LOOP;
END $$;

CREATE FUNCTION mua_audit_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Audit events are append-only'; END;
$$;
CREATE TRIGGER audit_append_only BEFORE UPDATE ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION mua_audit_append_only();

CREATE FUNCTION mua_release_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'archivedAt') IS DISTINCT FROM (to_jsonb(OLD) - 'archivedAt') THEN
    RAISE EXCEPTION 'Published release content is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER release_immutable BEFORE UPDATE ON "ClientRelease" FOR EACH ROW EXECUTE FUNCTION mua_release_immutable();

CREATE FUNCTION mua_scope_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."serverId" IS DISTINCT FROM OLD."serverId" OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId" THEN
    RAISE EXCEPTION 'Resource identifiers and ownership are immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER server_scope_immutable BEFORE UPDATE ON "Server" FOR EACH ROW EXECUTE FUNCTION mua_scope_immutable();
CREATE TRIGGER client_scope_immutable BEFORE UPDATE ON "Client" FOR EACH ROW EXECUTE FUNCTION mua_scope_immutable();

CREATE FUNCTION mua_draft_lock() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" = 'RELEASED' OR NEW."serverId" IS DISTINCT FROM OLD."serverId" THEN
    RAISE EXCEPTION 'Released drafts and draft ownership are immutable';
  END IF;
  IF OLD."status" IN ('SUBMITTED', 'APPROVED') AND
    (to_jsonb(NEW) - ARRAY['status','reviewedById','reviewedRevision','reviewedAt','reviewNote','updatedAt']) IS DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['status','reviewedById','reviewedRevision','reviewedAt','reviewNote','updatedAt']) THEN
    RAISE EXCEPTION 'Submitted draft content is locked; withdraw before editing';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER draft_lock BEFORE UPDATE ON "ClientDraft" FOR EACH ROW EXECUTE FUNCTION mua_draft_lock();

CREATE FUNCTION mua_release_approved() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE draft "ClientDraft";
BEGIN
  SELECT * INTO draft FROM "ClientDraft" WHERE "id" = NEW."sourceDraftId" FOR UPDATE;
  IF draft."status" <> 'APPROVED' OR draft."archivedAt" IS NOT NULL OR
    draft."reviewedRevision" IS DISTINCT FROM draft."contentRevision" OR
    draft."candidateManifestSha256" IS DISTINCT FROM NEW."manifestSha256" OR
    draft."candidateManifestKey" IS DISTINCT FROM NEW."manifestObjectKey" OR
    draft."reviewedById" IS DISTINCT FROM NEW."approvedById" OR
    draft."versionLabel" IS DISTINCT FROM NEW."versionLabel" OR draft."name" IS DISTINCT FROM NEW."name" OR
    draft."description" IS DISTINCT FROM NEW."description" OR draft."changelog" IS DISTINCT FROM NEW."changelog" THEN
    RAISE EXCEPTION 'Release must match its approved draft revision';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER release_approved BEFORE INSERT ON "ClientRelease" FOR EACH ROW EXECUTE FUNCTION mua_release_approved();

CREATE FUNCTION mua_publication_active() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."releaseId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "Server" s JOIN "Organization" o ON o."id" = s."organizationId"
    JOIN "Client" c ON c."serverId" = s."serverId"
    JOIN "ClientRelease" r ON r."serverId" = s."serverId" AND r."id" = NEW."releaseId"
    WHERE s."serverId" = NEW."serverId" AND s."archivedAt" IS NULL AND o."archivedAt" IS NULL
      AND c."archivedAt" IS NULL AND r."archivedAt" IS NULL
  ) THEN RAISE EXCEPTION 'Current release must belong to this server and all resources must be active'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER publication_active BEFORE INSERT OR UPDATE ON "ServerPublication" FOR EACH ROW EXECUTE FUNCTION mua_publication_active();

-- Deferred so server, dedicated client and empty publication can be created atomically.
CREATE FUNCTION mua_server_complete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Client" WHERE "serverId" = NEW."serverId") OR
    NOT EXISTS (SELECT 1 FROM "ServerPublication" WHERE "serverId" = NEW."serverId") THEN
    RAISE EXCEPTION 'Server requires exactly one dedicated client and publication';
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER server_complete AFTER INSERT ON "Server" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION mua_server_complete();
