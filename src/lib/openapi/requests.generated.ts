// Generated from actual service validators by npm run openapi:generate. Do not edit.

import { z } from "zod";

import { packageFormatVersionSchema } from "../client-contract";

import { diagnosticText } from "../diagnostics";

import { MAX_UPLOAD_SIZE_MB, UPLOAD_MB, maxUploadSizeMbSchema } from "../upload-size-policy";

import { enabledPackageFormatsSchema } from "../package-format-policy";

import { DEFAULT_ENVIRONMENT_DOWNLOAD_SETTINGS } from "../download-sources";

// src/lib/client-service.ts:uploadInput
export const CreateUpload = z.object({ clientId: z.string().uuid(), fileName: z.string().min(1).max(255).regex(/\.(zip|mrpack)$/i),
  size: z.number().int().positive().max(MAX_UPLOAD_SIZE_MB * UPLOAD_MB), baseReleaseId: z.string().uuid().nullable(), basePublicationRevision: z.number().int().nonnegative(),
  comparisonDraftId: z.string().uuid().nullable().optional(), packageFormatVersion: packageFormatVersionSchema }).strict();

// src/lib/client-service.ts:createClient
export const CreateClient = z.object({ organizationId: z.string().uuid(), name: z.string().trim().min(1).max(200),
    serverId: z.string().regex(/^[A-Za-z]{3,5}$/).nullable().optional(), publicationRevision: z.number().int().nonnegative().optional(),
    expectedClientId: z.string().uuid().nullable().optional(), replaceConfirmed: z.boolean().optional() }).strict();

// src/lib/client-service.ts:uploadPartUrl
export const UploadPart = z.object({ partNumber: z.number().int().min(1).max(320) }).strict();

// src/lib/client-service.ts:prepareCompletion
export const CompleteUpload = z.object({ parts: z.array(z.object({ partNumber: z.number().int().positive(), etag: z.string().min(1).max(200) }).strict()).min(1).max(320) }).strict();

// src/lib/client-service.ts:selectUploadInstance
export const SelectInstance = z.object({ instanceId: z.string().min(1).max(100) }).strict();

// src/lib/client-service.ts:reviewClient
export const ReviewDraft = z.object({ decision: z.enum(["approve", "reject"]), note: z.string().max(5000), contentRevision: z.number().int().positive(), packageRevision: z.number().int().positive() }).strict();

// src/lib/client-service.ts:publishClient
export const PublishDraft = z.object({ activate: z.boolean(),
    replacesDraftId: z.string().uuid().nullable().optional(), contentRevision: z.number().int().positive(), packageRevision: z.number().int().positive() }).strict();

// src/lib/client-service.ts:archiveClientDraft
export const ArchiveDraft = z.object({ contentRevision: z.number().int().positive(), packageRevision: z.number().int().positive() }).strict();

// src/lib/client-service.ts:activateClient
export const ActivateRelease = z.object({ publicationRevision: z.number().int().nonnegative() }).strict();

// src/lib/client-service.ts:bindClient
export const BindClient = z.object({ serverId: z.string().regex(/^[A-Za-z]{3,5}$/), publicationRevision: z.number().int().nonnegative(),
    expectedClientId: z.string().uuid().nullable(), replaceConfirmed: z.boolean() }).strict();

// src/lib/client-service.ts:unbindClient
export const UnbindClient = z.object({ serverId: z.string().nullable(), publicationRevision: z.number().int().nonnegative().nullable() }).strict();

// src/lib/api-auth.ts:createApiToken
export const CreateToken = z.object({ name: z.string().trim().min(1).max(100), serverIds: z.array(z.string().regex(/^[A-Za-z]{3,5}$/)).min(1).max(100),
    permissions: z.array(z.string()).min(1).max(20), expiresInDays: z.number().int().min(1).max(90) }).strict();

// src/lib/recycle-storage.ts:updateRecycleSettings
export const RecycleSettings = z.object({ recycleRetentionDays: z.number().int().min(1).max(365) }).strict();

// src/lib/upload-size-settings.ts:updateUploadSizeSettings
export const UploadSizeSettings = z.object({ maxUploadSizeMb: maxUploadSizeMbSchema }).strict();

// src/lib/package-format-settings.ts:updatePackageFormatSettings
export const PackageFormatSettings = z.object({ enabledPackageFormats: enabledPackageFormatsSchema }).strict();

// src/lib/download-settings.ts:host
export const host = z.string().trim().toLowerCase().max(253).regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/, diagnosticText("diagnostics.downloadSettings.enterACompleteDomainWithoutAProtocolPathOrWildcard"));

// src/lib/download-settings.ts:downloadSettingsSchema
export const DownloadSettings = z.object({ remoteSourceWhitelistEnabled: z.boolean(), remoteSourceHosts: z.array(host).max(100),
  downloadProxyEnabled: z.boolean(), downloadProxyUrl: z.string().trim().max(2000).refine(value => {
    if (!value) return true;
    try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash; }
    catch { return false; }
  }, diagnosticText("diagnostics.downloadSettings.theProxyMustBeHttpSHostPortWithoutCredentials")),
  minecraftDownloadSources: z.array(z.enum(["bmclapi", "ustc", "nju"])).max(3).refine(value => new Set(value).size === value.length, diagnosticText("diagnostics.downloadSettings.mirrorSourcesMustNotBeRepeated")).default([...DEFAULT_ENVIRONMENT_DOWNLOAD_SETTINGS.minecraftDownloadSources]),
  javaDownloadSources: z.array(z.enum(["tuna"])).max(1).default(["tuna"]),
  mirrorProxyEnabled: z.boolean().default(false), javaImageType: z.enum(["jre", "jdk"]).default("jre"),
  }).strict()
  .refine(value => !value.downloadProxyEnabled || !!value.downloadProxyUrl, diagnosticText("diagnostics.downloadSettings.enterAnAddressWhenEnablingTheProxy"));

