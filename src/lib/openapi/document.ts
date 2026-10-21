import { z } from "zod";
import { extendZodWithOpenApi, OpenAPIRegistry, OpenApiGeneratorV31 } from "@asteasolutions/zod-to-openapi";
import { PROJECT_NAME } from "../branding";
import { translator, type Locale } from "../i18n";
import { recipeManifestSchema } from "../muapack-v2-contract";
import { acceptedFormats, directorySchema, errorSchema, clientManifestSchema, packageQuery, packageResponseSchema, refreshQuery, serverParams } from "./schemas";

extendZodWithOpenApi(z);
export const OPENAPI_VERSION = "3.2.0";
export const PUBLIC_OPERATION_IDS = ["listServers", "getServerManifest", "getServerPackages", "refreshReleasePackages"] as const;

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
    description: t("后台使用 HttpOnly 会话 Cookie；写操作还要求同源 Origin。浏览器应通过登录流程建立会话，不手动填写 Cookie。") });
  registry.registerComponent("securitySchemes", "ApiToken", { type: "http", scheme: "bearer", bearerFormat: "mua_<64 lowercase hex characters>",
    description: t("客户端自动化接口使用 Bearer mua_…；不是 JWT。Token 受服务器范围、权限、有效期及账号当前 RBAC 限制，不能用于后台管理接口。") });
  const json = (schema: z.ZodTypeAny) => ({ "application/json": { schema } });
  const cacheHeaders = { "Cache-Control": { schema: { type: "string" as const, const: "private, no-store" } } };
  const errors = (codes: number[]) => Object.fromEntries(codes.map(code => [code, { description: t(({
    401: "请先登录", 400: "参数格式无效，或基准摘要缺少基准发布 ID。", 404: "资源未公开、已归档／删除／解绑，或所需文件／平台产物不可用。",
    409: "固定下载包摘要不匹配；必须重新建立下载任务，不能续传到其他字节。",
    415: "当前发布格式不在 acceptedFormatVersions 中；不会自动选择历史版本。",
    500: "服务或数据库暂时不可用。", 503: "已发布清单、基准或 OSS 产物不可读取，或身份／大小／摘要校验失败。",
  } as Record<number, string>)[code]), content: json(error), headers: cacheHeaders }]));

  registry.registerPath({ method: "get", path: "/api/v1/servers", operationId: "listServers", tags: ["Launcher"], security: memberSecurity,
    summary: t("获取账号可访问服务器目录"), description: t("只返回已上架、未归档且绑定有效发布的服务器，按 sortOrder、serverId 排序。展示区间采用开始包含、结束排除；到期只隐藏目录，不阻止仍在线资源的 Manifest、下载或刷新。时间为带时区的 ISO 8601 字符串。"),
    responses: { 200: { description: t("账号可访问服务器目录；没有可见服务器时 servers 为 []。"), content: json(directory), headers: cacheHeaders }, ...errors([401, 500]) } });
  registry.registerPath({ method: "get", path: "/api/v1/servers/{serverId}/manifest", operationId: "getServerManifest", tags: ["Launcher"], security: memberSecurity,
    summary: t("获取当前发布的原始清单"), description: t("返回已封存的原始 JSON 字节，保持签名对应的编码，不能重新序列化后验签。v1 返回 mua-client-manifest schemaVersion:2，不能将其摘要当作包内平台清单摘要；v2 返回 mua-recipe-manifest。必须从可信渠道取得公钥，响应中的 key ID 本身不建立信任。"),
    request: { params: serverParams, query: z.object({ acceptedFormatVersions: acceptedFormats }) },
    responses: { 200: { description: t("原始发布清单及 Ed25519 签名响应头。"), content: json(manifest), headers: { ...cacheHeaders,
      "X-MUA-Manifest-Sha256": { description: t("原始响应字节的 SHA-256。"), schema: { type: "string", pattern: "^[0-9a-f]{64}$" } },
      "X-MUA-Signing-Key": { schema: { type: "string", pattern: "^[0-9a-f]{24}$" } },
      "X-MUA-Signature": { description: t("发布清单签名；与包内 mua-pack.json 的独立签名不同。"), schema: { type: "string" } },
      "X-MUA-Signature-Algorithm": { schema: { type: "string", const: "Ed25519" } },
    } }, ...errors([400, 401, 404, 409, 415, 500, 503]) } });
  const platformDescription = t("v1 必须提供六项规范平台之一。v2 protocolRevision:2 不限制平台，各系统获取相同配方。平台规则不代表游戏启动兼容性已经验收。");
  const queryDescription = t("acceptedFormatVersions 必填，可传 1、2、1,2 或 2,1。baseReleaseId 必须对应上传时固定的已发布基准，建议同时提供 baseManifestSha256；不匹配时回退同目标 full。v1 基准摘要为包内平台清单摘要，v2 为原始配方清单摘要。损坏基准返回错误。");
  const downloadDescription = t("返回 JSON 下载描述，不直接返回 ZIP。full 永远指向同目标完整包。链接默认有效 300 秒；etag 是可能为 null 的对象存储原始值（含引号），不是 SHA-256。刷新使用相对 refreshUrl。OSS GET 支持单范围 Range／If-Match，浏览器仍受 OSS CORS 限制。下载后校验大小、SHA-256 和包内签名；签名参数由存储供应商决定，不要改变签名 URL，也不能把 GET URL 用作 HEAD。");
  for (const fixed of [false, true]) {
    registry.registerPath({ method: "get", path: fixed ? "/api/v1/servers/{serverId}/releases/{releaseId}/packages" : "/api/v1/servers/{serverId}/packages",
      operationId: fixed ? "refreshReleasePackages" : "getServerPackages", tags: ["Launcher"], security: memberSecurity,
      summary: t(fixed ? "刷新固定发布版本的下载链接" : "发现当前发布的完整包或更新包"),
      description: [platformDescription, queryDescription, downloadDescription, fixed ? t("releaseId 固定为当前在线绑定客户端的未归档发布，允许该客户端历史版本刷新，不重新选择最新版本。packageSha256 可选，但生成的 refreshUrl 始终携带；摘要不匹配返回 409。归档或解绑后新刷新被拒绝，已经签发的链接仍可能在剩余有效期内可用。") : ""].filter(Boolean).join("\n\n"),
      request: { params: fixed ? serverParams.extend({ releaseId: z.string().uuid() }) : serverParams, query: fixed ? refreshQuery : packageQuery },
      responses: { 200: { description: t("v1 或 v2 的 full／update 下载描述。"), content: json(packages), headers: cacheHeaders }, ...errors(fixed ? [400, 401, 404, 409, 415, 500, 503] : [400, 401, 404, 409, 415, 500, 503]) } });
  }
  return new OpenApiGeneratorV31(registry.definitions).generateDocument({ openapi: "3.1.0",
    info: { title: `${PROJECT_NAME} API`, version: OPENAPI_VERSION,
      description: t("公开规范描述 4 个 Launcher 读取接口；客户端自动化、后台及认证接口见受保护的完整规范。API 路由 v1、muapack formatVersion 与文档版本是不同概念。所有示例、代码生成和在线请求都应以此处声明的范围为准。") },
    servers: [{ url: "/", description: t("当前站点；本地、预览和生产使用各自的同源 API。") }],
    tags: [{ name: "Launcher", description: t("服务器发现、发布清单与下载链接。需要成员登录；逐请求检查所属组织、外部授权及分发条件。") }], security: memberSecurity,
  });
}
