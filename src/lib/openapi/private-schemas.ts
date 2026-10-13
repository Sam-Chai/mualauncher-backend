import { z } from "zod";
import { AccountStatus, DraftStatus, Role, UploadStatus } from "../../generated/prisma/enums";
import { rolePermissions } from "../roles";
import { clientMetadataSchema } from "../client-contract";
import { packageArtifactsSchema } from "../package-contract";
import { mottoMetadataSchema } from "../server-motto-contract";
import { statistics } from "./schemas";

export const uuid = z.string().uuid();
export const serverId = z.string().regex(/^[A-Za-z]{3,5}$/);
export const clientId = z.union([uuid, serverId]);
export const date = z.string().datetime({ offset: true });
const nullableText = z.string().nullable(), nullableDate = date.nullable(), integer = z.number().int().nonnegative();
export const permission = z.enum([...new Set(Object.values(rolePermissions).flat())] as [string, ...string[]]);
export const role = z.nativeEnum(Role);
export const ok = z.object({ ok: z.literal(true) }).strict();
export const archive = z.object({ archived: z.boolean() }).strict();
export const createdId = z.object({ id: uuid }).strict();
export const ignoredJson = z.unknown(); // readJson accepts any JSON; these actions ignore the parsed body.
export const recipeStatistics = z.object({ localFiles: integer, remoteFiles: integer, optionalFiles: integer, localSize: integer,
  remoteDeclaredSize: integer, newLocalDataSize: integer, localCasReusePercent: z.number(), sourceSize: integer }).strict();
const importStatistics = z.union([statistics, recipeStatistics]).nullable();
const detectedRuntime = z.object({ instanceId: nullableText, minecraftVersion: nullableText, javaVersion: z.number().int().nullable(),
  javaComponent: nullableText, loader: nullableText, loaderVersion: nullableText, minecraftSource: nullableText, javaSource: nullableText,
  warnings: z.array(z.string()) }).strict();
export const inspection = detectedRuntime.extend({ schemaVersion: z.literal(1), requiresSelection: z.boolean(), candidates: z.array(detectedRuntime),
  pack: z.object({ format: z.literal("modrinth"), wrapper: z.union([z.literal("pcl"), z.null()]), name: z.string(), version: z.string(), summary: nullableText }).strict().optional(),
  importFiles: z.array(z.object({ path: z.string(), source: z.enum(["local", "remote"]), optional: z.boolean(), size: integer, downloads: z.array(z.string()),
    hashes: z.object({ sha1: z.string().optional(), sha512: z.string().optional(), sha256: z.string().optional() }).strict().optional(),
    status: z.enum(["PENDING", "DECLARED", "DOWNLOADING", "VERIFIED", "FAILED"]), downloadedBytes: integer, error: nullableText }).strict()).optional(),
}).strict();
export const upload = z.object({ id: uuid, clientId: z.string(), fileName: z.string(), size: integer, partSize: integer,
  packageFormatVersion: z.union([z.literal(1), z.literal(2)]), status: z.nativeEnum(UploadStatus), progress: integer,
  error: nullableText, draftId: uuid.nullable(), statistics: statistics.nullable(), recipeStatistics: recipeStatistics.nullable(),
  detectedMods: z.array(z.string()), warnings: z.array(z.string()), comparisonDraftId: uuid.nullable(), comparisonStatistics: statistics.nullable(),
  processingPhase: z.union([z.enum(["FETCHING", "INSPECTING", "SELECT_INSTANCE", "DOWNLOADING", "CAS"]), z.null()]), detectedInfo: inspection.nullable(),
  selectedInstanceId: nullableText, baseReleaseId: uuid.nullable(), basePublicationRevision: integer, createdAt: date }).strict();
export const buildProgress = z.object({ platform: z.string(), status: z.enum(["QUEUED", "PROCESSING", "PREPARED", "READY", "FAILED"]),
  phase: z.string(), progress: integer, error: nullableText, artifacts: packageArtifactsSchema.nullable() }).strict();
const sourceBuild = z.object({ draftId: uuid, platform: z.string(), revision: integer, status: z.string(), required: z.boolean(),
  artifacts: z.unknown() }).strict(); // Historical JSON is returned unchanged here.
export const releaseSource = z.object({ supportedPlatforms: z.array(z.string()), packageRevision: integer,
  upload: z.object({ statistics: importStatistics, comparisonStatistics: statistics.nullable() }).strict().nullable(),
  packageBuilds: z.array(sourceBuild) }).strict();
const versionShape = { id: uuid, versionLabel: nullableText, name: nullableText, description: nullableText, changelog: z.string(), summary: nullableText, archivedAt: nullableDate };
export const draft = z.object({ ...versionShape, packageFormatVersion: z.number().int(), supportedPlatforms: z.array(z.string()), versionSequence: integer,
  replacesDraftId: uuid.nullable(), archiveReason: nullableText, supersededByDraftId: uuid.nullable(),
  candidateMetadata: z.unknown(), reviewNote: nullableText, status: z.nativeEnum(DraftStatus), contentRevision: integer, packageRevision: integer,
  createdAt: date, upload: z.object({ id: uuid, statistics: importStatistics, comparisonStatistics: statistics.nullable() }).strict().nullable(),
  packageBuilds: z.array(buildProgress) }).strict();
export const release = z.object({ ...versionShape, versionLabel: z.string(), name: z.string(), description: z.string(), summary: z.string(),
  packageFormatVersion: z.number().int(), environmentSnapshot: z.unknown(), publishedAt: date,
  sourceDraft: releaseSource.nullable(), packageBuilds: z.array(sourceBuild.extend({ artifacts: packageArtifactsSchema.nullable() })) }).strict();
export const displaySchedule = z.object({ displayMode: z.enum(["PERMANENT", "RANGE"]), displayStartsAt: nullableDate, displayEndsAt: nullableDate }).strict();
export const client = z.object({ clientId: z.string(), name: z.string(), organizationId: uuid, organizationName: z.string(),
  serverId: serverId.nullable(), serverName: z.string(), requestedServerId: serverId.nullable(), scopeServerId: serverId.nullable(),
  archived: z.boolean(), blocked: z.boolean(), displaySchedule: displaySchedule.nullable(), lifecycleStatus: z.enum(["ARCHIVED", "PUBLISHED", "UNPUBLISHED"]),
  permissions: z.array(permission), publicationRevision: integer, currentReleaseId: uuid.nullable(), initialPackageFormatVersion: z.number().int().nullable(),
  bindingRevision: integer.nullable(), drafts: z.array(draft), releases: z.array(release), canDelete: z.boolean(), uploads: z.array(upload.extend({ canEdit: z.boolean() })) }).strict();
export const createdClient = z.object({ clientId: z.string(), name: z.string(), currentReleaseId: z.null(), publicationRevision: z.literal(0) }).strict();
export const published = z.object({ releaseId: uuid, versionLabel: z.string(), activated: z.boolean().optional(), archivedDraftIds: z.array(uuid).optional() }).strict();
export const fullPackage = z.object({ packageType: z.literal("full"), packageFormatVersion: z.number().int(), platform: z.string(),
  versionLabel: z.string(), fileName: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/), size: integer, expiresIn: z.literal(300), url: z.string().url() }).strict();

export const account = z.object({ id: uuid, displayName: z.string(), status: z.nativeEnum(AccountStatus), isSuperAdmin: z.boolean(), username: z.string() }).strict();
export const server = z.object({ serverId, organizationId: uuid, displayName: z.string(), description: z.string(), gameAddress: nullableText,
  iconObjectKey: nullableText, sortOrder: z.number().int(), themeColor: nullableText, mottoImageUrl: nullableText,
  ...displaySchedule.shape, isListed: z.boolean(), archivedAt: nullableDate, clientArchivedAt: nullableDate,
  currentReleaseId: uuid.nullable(), currentReleaseActive: z.boolean(), publicationRevision: integer,
  boundClientId: nullableText, boundClientName: nullableText, permissions: z.array(permission) }).strict();
export const state = z.object({ actor: z.object({ id: uuid, displayName: z.string(), isSuperAdmin: z.boolean(), username: nullableText.optional() }).strict(),
  organizations: z.array(z.object({ id: uuid, displayName: z.string(), description: z.string(), clientCount: integer, avatarObjectKey: nullableText,
    archivedAt: nullableDate, permissions: z.array(permission), servers: z.array(server),
    members: z.array(z.object({ account, status: z.nativeEnum(AccountStatus), roles: z.array(role), grants: z.array(z.object({ serverId, roles: z.array(role) }).strict()), protected: z.boolean() }).strict()) }).strict()),
  accounts: z.array(account), events: z.array(z.object({ id: uuid, action: z.string(), targetType: z.string(), targetId: z.string(), organizationId: uuid.nullable(),
    serverId: serverId.nullable(), details: z.unknown(), createdAt: date, actor: z.object({ displayName: z.string() }).strict().nullable() }).strict()),
  auditActivity: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), count: integer }).strict()),
  enabledPackageFormats: z.array(z.union([z.literal(1), z.literal(2)])), maxUploadSizeMb: z.number().int().min(1).max(20480) }).strict();
export const token = z.object({ id: uuid, name: z.string(), permissions: z.array(permission), serverIds: z.array(serverId),
  expiresAt: date, revokedAt: nullableDate, createdAt: date }).strict();
export const createdToken = token.extend({ token: z.string().regex(/^mua_[0-9a-f]{64}$/) }).strict();
export const infrastructure = z.object({ storageReady: z.boolean(), packagesBucket: z.string(), casBucket: z.string(), environmentsBucket: z.string(),
  signing: z.object({ keyId: z.string(), publicKey: z.string() }).strict().nullable(),
  queue: z.array(z.object({ status: z.nativeEnum(UploadStatus), count: integer }).strict()), packageQueue: z.array(z.object({ status: z.string(), count: integer }).strict()),
  workers: z.array(z.object({ id: z.string(), lastSeen: date }).strict()) }).strict();
export const probe = z.object({ serverId, state: z.enum(["ONLINE", "HIGH_LATENCY", "OFFLINE", "UNKNOWN"]), address: nullableText, checkedAt: nullableDate,
  latencyMs: z.number().nullable(), latencyKind: z.union([z.enum(["PONG", "STATUS"]), z.null()]), highLatencyMs: z.number(), message: z.string(), version: nullableText, playersOnline: z.number().int().nullable() }).strict();
export const motto = mottoMetadataSchema;
export const mottoSaved = ok.extend({ iconObjectKey: nullableText }).strict();
export const oldDraft = draft.pick({ id: true, versionLabel: true, name: true, description: true, changelog: true, summary: true, candidateMetadata: true,
  reviewNote: true, status: true, contentRevision: true, archivedAt: true, createdAt: true }).extend({ upload: z.object({ id: uuid, statistics: importStatistics }).strict().nullable() }).strict();
export const oldRelease = release.omit({ packageFormatVersion: true, packageBuilds: true }).strict();
export const serverClients = z.object({ drafts: z.array(oldDraft), releases: z.array(oldRelease) }).strict();

const text = (max = 200, minimum = 1) => z.string().trim().min(minimum).max(max);
const nullableInput = (max = 500) => z.union([text(max), z.literal(""), z.null()]);
export const organizationCreate = z.object({ displayName: text(), description: text(5000, 0).optional(), avatarObjectKey: nullableInput().optional() }).strict();
export const organizationUpdate = organizationCreate.partial();
export const serverCreate = z.object({ organizationId: uuid, serverId, displayName: text(), description: text(5000, 0).optional(), gameAddress: nullableInput(255).optional(), iconObjectKey: nullableInput().optional(),
  displayMode: z.enum(["PERMANENT", "RANGE"]).optional(), displayStartsAt: date.nullable().optional(), displayEndsAt: date.nullable().optional() }).strict();
export const serverUpdate = z.object({ displayName: text().optional(), description: text(5000, 0).optional(), gameAddress: nullableInput(255).optional(), iconObjectKey: nullableInput().optional(),
  sortOrder: z.number().int().min(-2147483647).max(2147483647).optional(), themeColor: z.union([z.string().regex(/^#[0-9a-f]{6}$/i), z.literal(""), z.null()]).optional(),
  isListed: z.boolean().optional(), displayMode: z.enum(["PERMANENT", "RANGE"]).optional(), displayStartsAt: nullableDate.optional(), displayEndsAt: nullableDate.optional() }).strict();
export const member = z.object({ roles: z.array(role), status: z.nativeEnum(AccountStatus) }).strict();
export const grant = z.object({ roles: z.array(role) }).strict();
export const accountCreate = z.object({ displayName: text(), username: text(64, 3).regex(/^[a-z0-9_.-]{3,64}$/i), password: z.string().min(12).max(128), isSuperAdmin: z.boolean().optional() }).strict();
export const accountUpdate = z.object({ displayName: text().optional(), status: z.nativeEnum(AccountStatus).optional(), isSuperAdmin: z.boolean().optional(), password: z.string().min(12).max(128).optional() }).strict();
export const login = z.object({ username: text(64, 3).regex(/^[a-z0-9_.-]{3,64}$/i), password: z.string().min(1).max(128) }).strict();
export const passwordChange = z.object({ currentPassword: z.string().max(128), newPassword: z.string().min(12).max(128) }).strict();
export const oldDraftCreate = z.object({ versionLabel: text(100), name: text(), description: text(10000, 0), changelog: text(10000, 0) }).strict();
export const oldDraftUpdate = oldDraftCreate.extend({ contentRevision: z.number().int() }).strict();
export const clientMetadata = clientMetadataSchema;
