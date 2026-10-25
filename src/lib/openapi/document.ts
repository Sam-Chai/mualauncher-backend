import { z } from "zod";
import { extendZodWithOpenApi, OpenAPIRegistry, OpenApiGeneratorV31 } from "@asteasolutions/zod-to-openapi";
import { PROJECT_NAME } from "../branding";
import { translator, type Locale } from "../i18n";
import { recipeManifestSchema } from "../muapack-v2-contract";
import { acceptedFormats, directorySchema, errorSchema, clientManifestSchema, packageQuery, packageResponseSchema, refreshQuery, serverParams } from "./schemas";
import { unionOpenApi, PUBLIC_AUTH_OPERATION_IDS } from "./union-document";

extendZodWithOpenApi(z);
export const OPENAPI_VERSION = "5.2.0";
export const PUBLIC_OPERATION_IDS = ["listServers", "getServerManifest", "getServerPackages", "refreshReleasePackages", ...PUBLIC_AUTH_OPERATION_IDS] as const;

export function publicOpenApi(locale: Locale = "zh-CN") {
  const t = translator(locale), registry = new OpenAPIRegistry();
  const error = registry.register("Error", errorSchema);
  const directory = registry.register("ServerDirectory", directorySchema);
  const clientManifest = registry.register("ClientManifest", clientManifestSchema);
  const recipe = registry.register("RecipeManifest", recipeManifestSchema);
  const manifest = registry.register("PublicManifest", z.union([clientManifest, recipe]));
  const packages = registry.register("PackageDownload", packageResponseSchema);
  const memberSecurity: Record<string, string[]>[] = [{ SessionCookie: [] }, { LauncherToken: [] }];
  registry.registerComponent("securitySchemes", "LauncherToken", { type: "http", scheme: "bearer", bearerFormat: "mul_<64 lowercase hex characters>" });
  registry.registerComponent("securitySchemes", "SessionCookie", { type: "apiKey", in: "cookie", name: "mua_session",
    description: t("api.administrationUsesAnHttponlySessionCookieWritesAlsoRequire") });
  registry.registerComponent("securitySchemes", "ApiToken", { type: "http", scheme: "bearer", bearerFormat: "mua_<64 lowercase hex characters>",
    description: t("api.clientAutomationUsesBearerMuaTokensNotJwtsTokens") });
  const json = (schema: z.ZodTypeAny) => ({ "application/json": { schema } });
  const cacheHeaders = { "Cache-Control": { schema: { type: "string" as const, const: "private, no-store" } } };
  const errors = (codes: number[]) => Object.fromEntries(codes.map(code => [code, { description: t(({
    401: "api.signInFirst", 400: "api.invalidParameterFormatOrABaseManifestDigestWithout", 404: "api.theResourceIsNotPublicHasBeenArchivedDeleted",
    409: "api.theFixedPackageDigestNoLongerMatchesStartA",
    415: "api.theCurrentReleaseFormatIsNotAcceptedByAcceptedformatversions",
    500: "api.theServiceOrDatabaseIsTemporarilyUnavailable", 503: "api.thePublishedManifestBaseOrStorageArtifactIsUnreadable",
  } as Record<number, string>)[code]), content: json(error), headers: cacheHeaders }]));

  registry.registerPath({ method: "get", path: "/api/v1/servers", operationId: "listServers", tags: ["Launcher"], security: memberSecurity,
    summary: t("api.listServersAccessibleToTheSignedInAccount"), description: t("api.returnsListedUnarchivedServersWithAValidBoundRelease"),
    responses: { 200: { description: t("api.accountScopedServerDirectoryServersIsEmptyWhenNo"), content: json(directory), headers: cacheHeaders }, ...errors([401, 500]) } });
  registry.registerPath({ method: "get", path: "/api/v1/servers/{serverId}/manifest", operationId: "getServerManifest", tags: ["Launcher"], security: memberSecurity,
    summary: t("api.getTheOriginalCurrentReleaseManifest"), description: t("api.returnsSealedOriginalJsonBytesVerifyTheSignatureAgainst"),
    request: { params: serverParams, query: z.object({ acceptedFormatVersions: acceptedFormats }) },
    responses: { 200: { description: t("api.originalReleaseManifestWithEd25519SignatureHeaders"), content: json(manifest), headers: { ...cacheHeaders,
      "X-MUA-Manifest-Sha256": { description: t("api.sha256OfTheOriginalResponseBytes"), schema: { type: "string", pattern: "^[0-9a-f]{64}$" } },
      "X-MUA-Signing-Key": { schema: { type: "string", pattern: "^[0-9a-f]{24}$" } },
      "X-MUA-Signature": { description: t("api.releaseManifestSignatureDistinctFromTheIndependentSignatureOf"), schema: { type: "string" } },
      "X-MUA-Signature-Algorithm": { schema: { type: "string", const: "Ed25519" } },
    } }, ...errors([400, 401, 404, 409, 415, 500, 503]) } });
  const platformDescription = t("api.v1RequiresACanonicalPlatformV2Protocolrevision2Is");
  const queryDescription = t("api.acceptedformatversionsIsRequired1212Or2");
  const downloadDescription = t("api.returnsAJsonDownloadDescriptorNotZipBytesFull");
  for (const fixed of [false, true]) {
    registry.registerPath({ method: "get", path: fixed ? "/api/v1/servers/{serverId}/releases/{releaseId}/packages" : "/api/v1/servers/{serverId}/packages",
      operationId: fixed ? "refreshReleasePackages" : "getServerPackages", tags: ["Launcher"], security: memberSecurity,
      summary: t(fixed ? "api.refreshDownloadLinksForAFixedRelease" : "api.discoverAFullOrUpdatePackageForTheCurrent"),
      description: [platformDescription, queryDescription, downloadDescription, fixed ? t("api.releaseidIdentifiesAnUnarchivedReleaseOfTheCurrentlyOnline") : ""].filter(Boolean).join("\n\n"),
      request: { params: fixed ? serverParams.extend({ releaseId: z.string().uuid() }) : serverParams, query: fixed ? refreshQuery : packageQuery },
      responses: { 200: { description: t("api.fullOrUpdateDownloadDescriptorForV1OrV2"), content: json(packages), headers: cacheHeaders }, ...errors(fixed ? [400, 401, 404, 409, 415, 500, 503] : [400, 401, 404, 409, 415, 500, 503]) } });
  }
  const launcherAuth = unionOpenApi(locale, true);
  const document = new OpenApiGeneratorV31(registry.definitions).generateDocument({ openapi: "3.1.0",
    info: { title: `${PROJECT_NAME} API`, version: OPENAPI_VERSION,
      description: locale === "en-US" ? "Public Launcher authentication, member directory and four distribution reads. Administrative and automation operations remain private. API routes, package formats and documentation versions are independent." : "公开规范包含启动器认证、成员自查及四个分发读取操作；后台与自动化操作仍仅在受保护完整规范中。路由、包格式与文档版本相互独立。" },
    servers: [{ url: "/", description: t("api.currentSiteLocalPreviewAndProductionDeploymentsUseTheir") }],
    tags: [{ name: "Launcher", description: t("api.serverDiscoveryManifestsAndPackageLinksRequireMemberAuthentication") }], security: memberSecurity,
  });
  return { ...document, paths: { ...document.paths, ...launcherAuth.paths }, components: { ...document.components, schemas: { ...document.components?.schemas, ...launcherAuth.components?.schemas } } };
}
