import { unionOpenApi, unionOperations } from "./union-document";
import { z } from "zod";
import { OpenAPIRegistry, OpenApiGeneratorV31 } from "@asteasolutions/zod-to-openapi";
import { publicOpenApi, OPENAPI_VERSION } from "./document";
import { translator, type Locale } from "../i18n";
import { clientSubmissionSchema } from "../client-contract";
import { packageSelectionSchema } from "../package-contract";
import { muaPlatformManifestSchema } from "../muapack-contract";
import { publicManifestSchema, errorSchema } from "./schemas";
import * as s from "./private-schemas";
import * as r from "./requests.generated";
import { recipeDistributionSchema } from "../recipe-distribution-contract";
import { storageTelemetrySchema } from "../storage-telemetry-contract";
import { credentialRevocationSchema } from "../credential-revocation-contract";
import { executionSettingsSchema, executionSettingsInput, executionInstancesSchema } from "../execution-management-contract";

type Operation = { method: "get" | "post" | "patch" | "put" | "delete"; path: string; id: string; tag: string;
  response: z.ZodTypeAny; body?: z.ZodTypeAny; query?: z.ZodObject;
  status?: number; permissions?: string[]; superadmin?: boolean; deprecated?: boolean; auth?: "public" | "session" | "either"; multipart?: boolean };
const clientPath = "/api/v1/clients", adminPath = "/api/admin";
const ops: Operation[] = [];
const client = (method: Operation["method"], path: string, id: string, response: z.ZodTypeAny, permissions: string[], body?: z.ZodTypeAny, query?: z.ZodObject, status = 200, tag = "Clients") =>
  ops.push({ method, path: clientPath + path, id, response, permissions, body, query, status, tag, auth: "either" });
const admin = (method: Operation["method"], path: string, id: string, response: z.ZodTypeAny, body?: z.ZodTypeAny, permissions: string[] = [], superadmin = false, status = 200, query?: z.ZodObject) =>
  ops.push({ method, path: adminPath + path, id, response, body, permissions, superadmin, status, query, tag: "Administration", auth: "session" });

for (const [path, id, permission] of [
  ["/uploads/{uploadId}/distribution-statistics", "getUploadDistribution", "DRAFT_READ"],
  ["/{clientId}/drafts/{draftId}/distribution-statistics", "getDraftDistribution", "DRAFT_READ"],
  ["/{clientId}/releases/{releaseId}/distribution-statistics", "getReleaseDistribution", "RELEASE_READ"],
] as const) client("get", path, id, recipeDistributionSchema, [permission]);

client("get", "", "listClients", z.array(s.client), ["DRAFT_READ OR RELEASE_READ"], undefined);
client("post", "", "createClient", s.createdClient, ["DRAFT_CREATE", "DRAFT_SUBMIT"], r.CreateClient, undefined, 201);
client("get", "/{clientId}", "getClient", s.client, ["SERVER_READ", "DRAFT_READ OR RELEASE_READ"]);
client("post", "/uploads", "createClientUpload", s.upload, ["DRAFT_CREATE"], r.CreateUpload, undefined, 201, "Uploads");
client("post", "/uploads/{uploadId}/parts", "signUploadPart", z.object({ url: z.string().url(), expiresIn: z.literal(600) }).strict(), ["DRAFT_CREATE"], r.UploadPart, undefined, 200, "Uploads");
client("post", "/uploads/{uploadId}/complete", "completeClientUpload", s.upload, ["DRAFT_CREATE"], r.CompleteUpload, undefined, 200, "Uploads");
client("get", "/uploads/{uploadId}", "getClientUpload", s.upload, ["DRAFT_READ"], undefined, undefined, 200, "Uploads");
client("post", "/uploads/{uploadId}/select-instance", "selectClientInstance", s.upload, ["DRAFT_CREATE"], r.SelectInstance, undefined, 200, "Uploads");
client("post", "/uploads/{uploadId}/submit", "submitClientUpload", z.object({ draftId: s.uuid }).strict(), ["DRAFT_SUBMIT"], clientSubmissionSchema, undefined, 200, "Uploads");
for (const [action, id] of [
  ["retry", "retryClientUpload"],
  ["cancel", "cancelClientUpload"],
] as const) client("post", `/uploads/{uploadId}/${action}`, id, s.upload, ["DRAFT_CREATE"], s.ignoredJson, undefined, 200, "Uploads");
client("get", "/{clientId}/drafts/{draftId}/manifest", "getDraftManifest", publicManifestSchema, ["DRAFT_READ"], undefined, undefined, 200, "Drafts");
client("get", "/{clientId}/drafts/{draftId}/platform-manifest", "getDraftPlatformManifest", z.union([muaPlatformManifestSchema, publicManifestSchema]), ["DRAFT_READ"], undefined, z.object({ platform: z.string().optional() }), 200, "Drafts");
client("post", "/{clientId}/drafts/{draftId}/review", "reviewClientDraft", s.ok, ["DRAFT_REVIEW"], r.ReviewDraft, undefined, 200, "Drafts");
client("post", "/{clientId}/drafts/{draftId}/platforms", "configureDraftPlatforms", s.ok, ["DRAFT_CREATE", "DRAFT_SUBMIT"], packageSelectionSchema, undefined, 200, "Drafts");
client("post", "/{clientId}/drafts/{draftId}/retry-packages", "retryDraftPackages", s.ok, ["DRAFT_CREATE", "DRAFT_SUBMIT"], s.ignoredJson, undefined, 200, "Drafts");
client("post", "/{clientId}/drafts/{draftId}/publish", "publishClientDraft", s.published, ["RELEASE_PUBLISH"], r.PublishDraft, undefined, 200, "Releases");
client("post", "/{clientId}/releases/{releaseId}/activate", "activateClientRelease", s.ok, ["RELEASE_ACTIVATE"], r.ActivateRelease, undefined, 200, "Releases");
client("post", "/{clientId}/drafts/{draftId}/archive", "archiveClientDraft", s.ok, ["DRAFT_ARCHIVE"], r.ArchiveDraft, undefined, 200, "Drafts");
for (const kind of ["drafts", "releases"] as const) client("get", `/{clientId}/${kind}/{${kind === "drafts" ? "draftId" : "releaseId"}}/package`, kind === "drafts" ? "downloadDraftPackage" : "downloadReleasePackage", s.fullPackage, [kind === "drafts" ? "DRAFT_READ" : "RELEASE_READ"], undefined, z.object({ platform: z.string().optional() }), 200, kind === "drafts" ? "Drafts" : "Releases");
client("post", "/{clientId}/bind", "bindClient", s.ok.extend({ pending: z.boolean() }), ["CLIENT_BIND"], r.BindClient);
client("post", "/{clientId}/unbind", "unbindClient", s.ok, ["CLIENT_BIND"], r.UnbindClient);
client("post", "/{clientId}/archive", "archiveClient", s.ok, ["CLIENT_ARCHIVE"], s.archive);
client("post", "/{clientId}/delete", "deleteClient", s.ok, ["CLIENT_DELETE"], s.ignoredJson);

admin("get", "/state", "getAdminState", s.state);
admin("get", "/pipeline", "getPipeline", s.infrastructure, undefined, [], true);
admin("get", "/execution-settings", "getExecutionSettings", executionSettingsSchema, undefined, [], true);
admin("patch", "/execution-settings", "setExecutionSettings", executionSettingsSchema, executionSettingsInput, [], true);
admin("get", "/execution-instances", "getExecutionInstances", executionInstancesSchema, undefined, [], true);
admin("get", "/storage-telemetry", "getStorageTelemetry", storageTelemetrySchema, undefined, [], true);
admin("get", "/organizations/{organizationId}/account-search", "searchOrganizationAccounts", z.array(s.account), undefined, ["ORG_MEMBERS_READ"], false, 200, z.object({ q: z.string().min(3).max(64) }));
admin("get", "/tokens", "listApiTokens", z.array(s.token));
admin("post", "/tokens", "createApiToken", s.createdToken, r.CreateToken, [], false, 201);
admin("post", "/tokens/{tokenId}/revoke", "revokeApiToken", s.ok, s.ignoredJson);
admin("post", "/organizations", "createOrganization", s.createdId, s.organizationCreate, [], true, 201);
admin("patch", "/organizations/{organizationId}", "updateOrganization", s.ok, s.organizationUpdate, ["ORG_EDIT"]);
admin("post", "/servers", "createServer", z.object({ serverId: s.serverId }).strict(), s.serverCreate, ["ORG_EDIT"], true, 201);
admin("patch", "/servers/{serverId}", "updateServer", s.ok, s.serverUpdate, ["SERVER_EDIT"]);
for (const [kind, param, id] of [["organizations", "organizationId", "archiveOrganization"], ["servers", "serverId", "archiveServer"]] as const)
  admin("post", `/${kind}/{${param}}/archive`, id, s.ok, s.archive, [], true);
admin("put", "/organizations/{organizationId}/members/{accountId}", "setOrganizationMember", s.ok, s.member, ["ORG_MEMBERS_MANAGE"]);
admin("put", "/organizations/{organizationId}/members/{accountId}/servers/{serverId}", "setServerGrant", s.ok, s.grant, ["ORG_MEMBERS_MANAGE", "SERVER_READ"]);
admin("post", "/accounts", "createAccount", s.createdId, s.accountCreate, [], true, 201);
admin("patch", "/accounts/{accountId}", "updateAccount", s.ok, s.accountUpdate, [], true);
admin("post", "/accounts/{accountId}/revoke-credentials", "revokeAccountCredentials", credentialRevocationSchema, z.object({}).strict(), [], true);
ops.push({ method: "post", path: "/api/auth/revoke-credentials", id: "revokeOwnCredentials", response: credentialRevocationSchema, body: z.object({}).strict(), auth: "session", tag: "Authentication" });
for (const [kind, id, schema] of [
  ["recycle-settings", "Recycle", r.RecycleSettings],
  ["upload-size-settings", "UploadSize", r.UploadSizeSettings],
  ["package-format-settings", "PackageFormat", r.PackageFormatSettings],
] as const) {
  admin("get", `/${kind}`, `get${id}Settings`, schema, undefined, [], true);
  admin("patch", `/${kind}`, `set${id}Settings`, schema, schema, [], true);
}
const downloadObject = r.DownloadSettings;
const downloadOutput = z.object(Object.fromEntries(Object.entries(downloadObject.shape).map(([key, value]) => [key, value instanceof z.ZodDefault ? value.removeDefault() : value]))).strict();
const downloadInput = z.object(Object.fromEntries(Object.entries(downloadObject.shape).map(([key, value]) => [key, value instanceof z.ZodDefault ? value.removeDefault().optional() : value]))).strict();
admin("get", "/download-settings", "getDownloadSettings", downloadOutput, undefined, [], true);
admin("patch", "/download-settings", "setDownloadSettings", downloadOutput, downloadInput, [], true);
admin("get", "/servers/{serverId}/probe", "probeServer", s.probe, undefined, ["SERVER_READ"]);
admin("get", "/servers/{serverId}/motto-image", "getServerMotto", s.motto, undefined, ["SERVER_READ"], false, 200, z.object({ variant: z.enum(["image", "source", "metadata"]).default("image").optional(), version: s.uuid.optional() }));
admin("post", "/servers/{serverId}/motto-image", "uploadServerMotto", s.mottoSaved, z.object({ source: z.string().optional(), crop: z.string(), expectedIconObjectKey: z.string() }).strict(), ["SERVER_EDIT"]);
ops[ops.length - 1].multipart = true;
admin("delete", "/servers/{serverId}/motto-image", "removeServerMotto", s.mottoSaved, z.object({ expectedIconObjectKey: z.string().max(500).nullable() }).strict(), ["SERVER_EDIT"]);
for (const [action, id, body, auth] of [
  ["login", "login", s.login, "public"],
  ["logout", "logout", z.object({}).strict(), "public"],
  ["password", "changePassword", s.passwordChange, "session"],
] as const) ops.push({ method: "post", path: `/api/auth/${action}`, id, response: s.ok, body, auth, tag: "Authentication" });
export const privateOperations = [...ops, ...unionOperations];

export function adminOpenApi(locale: Locale = "zh-CN") {
  const base = publicOpenApi(locale), t = translator(locale), registry = new OpenAPIRegistry();
  const error = registry.register("Error", errorSchema.clone());
  const cacheHeaders = { "Cache-Control": { schema: { type: "string" as const, example: "no-store" } } };
  const schemas = new Map<z.ZodTypeAny, z.ZodTypeAny>();
  for (const [name, schema] of Object.entries({ Client: s.client, Upload: s.upload, AdminState: s.state, ApiToken: s.token, CreatedApiToken: s.createdToken,
    Infrastructure: s.infrastructure, ServerProbe: s.probe, MottoMetadata: s.motto, ManagementFullPackage: s.fullPackage, PublishResult: s.published })) schemas.set(schema, registry.register(name, schema.clone()));
  for (const op of ops) {
    const isWrite = op.method !== "get", isClient = op.auth === "either";
    const params = Object.fromEntries([...op.path.matchAll(/\{([^}]+)\}/g)].map(([, name]) => [name, name === "serverId" ? s.serverId : name === "clientId" ? s.clientId : s.uuid]));
    let body = op.body;
    if (body instanceof z.ZodObject) body = body.extend(Object.fromEntries(Object.entries(body.shape).filter(([name]) => /^(password|currentPassword|newPassword)$/.test(name)).map(([name, value]) => [name, (value as z.ZodTypeAny).meta({ format: "password", writeOnly: true })])));
    if (op.multipart) body = z.object({ source: z.string().openapi({ format: "binary" }).optional(),
      crop: z.string().openapi({ description: t("api.jsonEncodedCropTextLeftTopWidthAndHeight"), example: '{"left":0,"top":0,"width":1,"height":0.648936170212766}' }),
      expectedIconObjectKey: z.string().openapi({ description: t("api.jsonEncodedCurrentObjectKeyForAFirstUpload"), example: "null" }) }).strict();
    const errors = Object.fromEntries([400, 401, 403, 404, 409, 413, 415, 422, 429, 500, 503].map(code => [code, { description: t("api.httpError", { "status": code }), content: { "application/json": { schema: error } }, headers: cacheHeaders }]));
    const jsonResponse = { "application/json": { schema: schemas.get(op.response) ?? op.response } };
    const content = op.id === "getServerMotto" ? { ...jsonResponse, "image/webp": { schema: { type: "string" as const, format: "binary" } } } : jsonResponse;
    const cookieHeader = op.tag === "Authentication" ? { "Set-Cookie": { description: t("api.setsOrClearsMuaSessionManagedByTheBrowser"), schema: { type: "string" as const } } } : {};
    registry.registerPath({ method: op.method, path: op.path, operationId: op.id, tags: [op.tag], summary: t(`api.operations.${op.id}.summary`),
      description: t(`api.operations.${op.id}.description`),
      security: op.auth === "public" ? [] : isClient ? [{ SessionCookie: [] }, { ApiToken: [] }] : [{ SessionCookie: [] }],
      "x-permissions": op.permissions ?? [], "x-superadmin-only": !!op.superadmin,
      "x-request-body-max-bytes": isWrite ? op.multipart ? 8 * 1024 ** 2 + 65536 : isClient && op.path !== clientPath ? 262144 : 32768 : undefined,
      request: { params: Object.keys(params).length ? z.object(params) : undefined, query: op.query,
        headers: isWrite ? z.object({ Origin: isClient ? z.string().optional().openapi({ description: t("api.requiredForCookieWritesOnlyBrowsersSendTheirActual") }) : z.string().openapi({ description: t("api.theCurrentSiteSCompleteOriginSentAutomaticallyBy") }) }) : undefined,
        body: body ? { required: true, content: { [op.multipart ? "multipart/form-data" : "application/json"]: { schema: body } } } : undefined },
      responses: { [op.status ?? 200]: { description: t("api.successFieldVisibilityRemainsSubjectToCurrentRbacAnd"), content, headers: { ...cacheHeaders, ...cookieHeader } }, ...errors },
    });
  }
  const internal = new OpenApiGeneratorV31(registry.definitions).generateDocument({ openapi: "3.1.0", info: { title: "Union Link API", version: OPENAPI_VERSION } });
  return { ...base, info: { ...base.info, description: t("api.theCompletePanelReferenceIncludesLauncherClientAutomationAdministration") },
    paths: { ...base.paths, ...internal.paths, ...unionOpenApi(locale).paths }, components: { ...base.components, schemas: { ...base.components?.schemas, ...internal.components?.schemas, ...unionOpenApi(locale).components?.schemas } },
    tags: [...base.tags ?? [], ...["Clients", "Uploads", "Drafts", "Releases", "Administration", "Authentication"].map(name => ({ name }))],
  };
}
