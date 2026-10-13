import { z } from "zod";
import { muaPlatformSchema, sha256Schema, muaPlatformManifestSchema } from "../muapack-contract";
import { recipeManifestSchema } from "../muapack-v2-contract";

// Wire DTOs only. No database, storage, credentials or server-only imports.
const id = z.string().uuid();
const clientId = z.string().min(1); // Retained legacy IDs and new UUIDs.
const integer = z.number().int().nonnegative();
const timestamp = z.string().datetime({ offset: true });
export const errorSchema = z.object({ error: z.string() }).strict();
export const serverParams = z.object({ serverId: z.string().regex(/^[A-Za-z]{3,5}$/) });
export const acceptedFormats = z.enum(["1", "2", "1,2", "2,1"]).default("1");

const serverShape = {
  serverId: serverParams.shape.serverId, displayName: z.string(), description: z.string(),
  gameAddress: z.string().nullable(), themeColor: z.string().nullable(), sortOrder: z.number().int(),
  organization: z.object({ id, displayName: z.string() }).strict(), publicationRevision: integer,
  currentRelease: z.object({ id, clientId, versionLabel: z.string(), name: z.string(), manifestSha256: sha256Schema,
    packageFormatVersion: z.union([z.literal(1), z.literal(2)]), manifestUrl: z.string(), packagesUrl: z.string() }).strict(),
};
export const directorySchema = z.object({ servers: z.array(z.union([
  z.object({ ...serverShape, displayMode: z.literal("PERMANENT"), displayStartsAt: z.null(), displayEndsAt: z.null() }).strict(),
  z.object({ ...serverShape, displayMode: z.literal("RANGE"), displayStartsAt: timestamp, displayEndsAt: timestamp }).strict(),
])) }).strict();

export const statistics = z.object({ previousVersion: z.string().nullable(), addedFiles: integer, modifiedFiles: integer, deletedFiles: integer,
  fullSize: integer, newDataSize: integer, estimatedDownloadSize: integer, casReusePercent: z.number(), fileCount: integer, sourceSize: integer }).strict();
const legacyShape = {
  format: z.literal("mua-client-manifest"), organizationId: id, version: z.string(), name: z.string(),
  runtime: z.object({ minecraft: z.string(), java: z.number().int() }).strict(), mods: z.array(z.string()),
  modDetails: z.array(z.object({ path: z.string(), optional: z.boolean() }).strict()).optional(),
  summary: z.string(), description: z.string(), sourceSha256: sha256Schema,
  files: z.array(z.object({ path: z.string(), sha256: sha256Schema, size: integer, policy: z.enum(["managed", "preserve"]), optional: z.boolean().optional() }).strict()),
  update: statistics,
};
export const legacyManifestSchema = z.union([
  z.object({ ...legacyShape, schemaVersion: z.literal(1), serverId: serverParams.shape.serverId, clientId: clientId.optional() }).strict(),
  z.object({ ...legacyShape, schemaVersion: z.literal(2), clientId, serverId: serverParams.shape.serverId.optional() }).strict(),
]);
export const publicManifestSchema = z.union([legacyManifestSchema, recipeManifestSchema]);
export const fileLinkSchema = z.object({ url: z.string().url(), expiresIn: z.literal(300) }).strict();

const linkShape = { url: z.string().url(), expiresIn: z.literal(300), expiresAt: timestamp, etag: z.string().nullable(),
  sha256: sha256Schema, size: integer, refreshUrl: z.string().startsWith("/api/v1/servers/") };
const packageShape = {
  ...linkShape, format: z.literal("muapack"), releaseId: id, version: z.string(), targetManifestSha256: sha256Schema,
  signingKeyId: z.string().regex(/^[0-9a-f]{24}$/), full: z.object(linkShape).strict(),
};
const selection = [
  z.object({ packageType: z.literal("full"), baseReleaseId: z.null(), baseManifestSha256: z.null() }),
  z.object({ packageType: z.literal("update"), baseReleaseId: id, baseManifestSha256: sha256Schema }),
] as const;
const v1Mod = muaPlatformManifestSchema.innerType().shape.mods.element.extend({ optional: z.boolean() });
const recipeShape = recipeManifestSchema.innerType().options[0].shape;
const v2Mods = z.array(z.union([
  z.object({ path: z.string(), name: z.null(), version: z.null(), optional: z.boolean(), source: z.literal("local"),
    hashes: z.object({ sha256: sha256Schema }).strict() }).strict(),
  z.object({ path: z.string(), name: z.null(), version: z.null(), optional: z.boolean(), source: z.literal("remote"),
    hashes: z.object({ sha1: z.string().regex(/^[0-9a-f]{40}$/), sha512: z.string().regex(/^[0-9a-f]{128}$/), sha256: sha256Schema.optional() }).strict() }).strict(),
]));
const packageVariants = selection.flatMap(selected => [
  z.object({ ...packageShape, ...selected.shape, formatVersion: z.literal(1), platform: muaPlatformSchema, mods: z.array(v1Mod) }).strict(),
  z.object({ ...packageShape, ...selected.shape, formatVersion: z.literal(2), minimumLauncherProtocol: z.literal(2),
    protocolRevision: z.literal(2), runtime: recipeShape.runtime, mods: v2Mods }).strict(),
  z.object({ ...packageShape, ...selected.shape, formatVersion: z.literal(2), minimumLauncherProtocol: z.literal(2),
    platform: z.union([muaPlatformSchema, z.literal("universal")]), supportedPlatforms: z.array(muaPlatformSchema).min(1).max(6),
    runtime: recipeShape.runtime, mods: v2Mods }).strict(),
]);
export const packageResponseSchema = z.union([packageVariants[0], packageVariants[1], ...packageVariants.slice(2)]);

// A string is intentional: protocolRevision:2 ignores even noncanonical platform values.
export const packageQuery = z.object({ platform: z.string().optional(), acceptedFormatVersions: acceptedFormats.optional(),
  baseReleaseId: id.optional(), baseManifestSha256: sha256Schema.optional() });
export const refreshQuery = packageQuery.extend({ packageSha256: sha256Schema.optional() });
