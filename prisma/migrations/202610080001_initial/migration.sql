-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ORG_ADMIN', 'SERVER_ADMIN', 'CLIENT_EDITOR', 'SERVER_EDITOR', 'REVIEWER', 'PUBLISHER', 'RELEASE_OPERATOR', 'READ_ONLY');

-- CreateEnum
CREATE TYPE "DraftStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'RELEASED');

-- CreateTable
CREATE TABLE "Account" (
    "id" UUID NOT NULL,
    "displayName" TEXT NOT NULL,
    "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocalCredential" (
    "accountId" UUID NOT NULL,
    "username" VARCHAR(64) NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "LocalCredential_pkey" PRIMARY KEY ("accountId")
);

-- CreateTable
CREATE TABLE "Session" (
    "tokenHash" CHAR(64) NOT NULL,
    "accountId" UUID NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("tokenHash")
);

-- CreateTable
CREATE TABLE "LoginThrottle" (
    "key" CHAR(64) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "resetAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "LoginThrottle_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" UUID NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "avatarObjectKey" TEXT,
    "archivedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationMember" (
    "organizationId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "roles" "Role"[] DEFAULT ARRAY[]::"Role"[],
    "grantedById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "OrganizationMember_pkey" PRIMARY KEY ("organizationId","accountId")
);

-- CreateTable
CREATE TABLE "Server" (
    "serverId" VARCHAR(5) NOT NULL,
    "organizationId" UUID NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "gameAddress" TEXT,
    "iconObjectKey" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "themeColor" VARCHAR(7),
    "isListed" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Server_pkey" PRIMARY KEY ("serverId")
);

-- CreateTable
CREATE TABLE "Client" (
    "serverId" VARCHAR(5) NOT NULL,
    "organizationId" UUID NOT NULL,
    "archivedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("serverId")
);

-- CreateTable
CREATE TABLE "ServerGrant" (
    "accountId" UUID NOT NULL,
    "serverId" VARCHAR(5) NOT NULL,
    "organizationId" UUID NOT NULL,
    "roles" "Role"[] DEFAULT ARRAY[]::"Role"[],
    "grantedById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ServerGrant_pkey" PRIMARY KEY ("accountId","serverId")
);

-- CreateTable
CREATE TABLE "ClientDraft" (
    "id" UUID NOT NULL,
    "serverId" VARCHAR(5) NOT NULL,
    "versionLabel" TEXT,
    "name" TEXT,
    "description" TEXT NOT NULL DEFAULT '',
    "changelog" TEXT NOT NULL DEFAULT '',
    "candidateMetadata" JSONB,
    "sourceObjectKey" TEXT,
    "candidateManifestKey" TEXT,
    "candidateManifestSha256" CHAR(64),
    "contentRevision" INTEGER NOT NULL DEFAULT 1,
    "status" "DraftStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" UUID NOT NULL,
    "reviewedById" UUID,
    "reviewedRevision" INTEGER,
    "reviewedAt" TIMESTAMPTZ(6),
    "reviewNote" TEXT,
    "archivedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ClientDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientRelease" (
    "id" UUID NOT NULL,
    "serverId" VARCHAR(5) NOT NULL,
    "sourceDraftId" UUID NOT NULL,
    "versionLabel" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "changelog" TEXT NOT NULL,
    "environmentSnapshot" JSONB NOT NULL,
    "manifestObjectKey" TEXT NOT NULL,
    "manifestSha256" CHAR(64) NOT NULL,
    "packObjectKey" TEXT,
    "signingKeyId" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "approvedById" UUID NOT NULL,
    "publishedById" UUID NOT NULL,
    "publishedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMPTZ(6),

    CONSTRAINT "ClientRelease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServerPublication" (
    "serverId" VARCHAR(5) NOT NULL,
    "releaseId" UUID,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "changedById" UUID NOT NULL,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ServerPublication_pkey" PRIMARY KEY ("serverId")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "organizationId" UUID,
    "serverId" VARCHAR(5),
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LocalCredential_username_key" ON "LocalCredential"("username");

-- CreateIndex
CREATE INDEX "Session_accountId_idx" ON "Session"("accountId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "OrganizationMember_accountId_idx" ON "OrganizationMember"("accountId");

-- CreateIndex
CREATE INDEX "Server_organizationId_idx" ON "Server"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Server_organizationId_serverId_key" ON "Server"("organizationId", "serverId");

-- CreateIndex
CREATE UNIQUE INDEX "Client_organizationId_serverId_key" ON "Client"("organizationId", "serverId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientDraft_serverId_id_key" ON "ClientDraft"("serverId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ClientRelease_sourceDraftId_key" ON "ClientRelease"("sourceDraftId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientRelease_serverId_versionLabel_key" ON "ClientRelease"("serverId", "versionLabel");

-- CreateIndex
CREATE UNIQUE INDEX "ClientRelease_serverId_sourceDraftId_key" ON "ClientRelease"("serverId", "sourceDraftId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientRelease_serverId_id_key" ON "ClientRelease"("serverId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ServerPublication_releaseId_key" ON "ServerPublication"("releaseId");

-- CreateIndex
CREATE UNIQUE INDEX "ServerPublication_serverId_releaseId_key" ON "ServerPublication"("serverId", "releaseId");

-- CreateIndex
CREATE INDEX "AuditEvent_organizationId_createdAt_idx" ON "AuditEvent"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_actorId_createdAt_idx" ON "AuditEvent"("actorId", "createdAt");

-- AddForeignKey
ALTER TABLE "LocalCredential" ADD CONSTRAINT "LocalCredential_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Server" ADD CONSTRAINT "Server_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_organizationId_serverId_fkey" FOREIGN KEY ("organizationId", "serverId") REFERENCES "Server"("organizationId", "serverId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServerGrant" ADD CONSTRAINT "ServerGrant_organizationId_accountId_fkey" FOREIGN KEY ("organizationId", "accountId") REFERENCES "OrganizationMember"("organizationId", "accountId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServerGrant" ADD CONSTRAINT "ServerGrant_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServerGrant" ADD CONSTRAINT "ServerGrant_organizationId_serverId_fkey" FOREIGN KEY ("organizationId", "serverId") REFERENCES "Server"("organizationId", "serverId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServerGrant" ADD CONSTRAINT "ServerGrant_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientDraft" ADD CONSTRAINT "ClientDraft_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Client"("serverId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientDraft" ADD CONSTRAINT "ClientDraft_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientDraft" ADD CONSTRAINT "ClientDraft_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientRelease" ADD CONSTRAINT "ClientRelease_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Client"("serverId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientRelease" ADD CONSTRAINT "ClientRelease_serverId_sourceDraftId_fkey" FOREIGN KEY ("serverId", "sourceDraftId") REFERENCES "ClientDraft"("serverId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientRelease" ADD CONSTRAINT "ClientRelease_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientRelease" ADD CONSTRAINT "ClientRelease_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServerPublication" ADD CONSTRAINT "ServerPublication_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("serverId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServerPublication" ADD CONSTRAINT "ServerPublication_serverId_releaseId_fkey" FOREIGN KEY ("serverId", "releaseId") REFERENCES "ClientRelease"("serverId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServerPublication" ADD CONSTRAINT "ServerPublication_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_organizationId_serverId_fkey" FOREIGN KEY ("organizationId", "serverId") REFERENCES "Server"("organizationId", "serverId") ON DELETE RESTRICT ON UPDATE CASCADE;
