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
import english from "../locales/openapi-private-en.json";
import { recipeDistributionSchema } from "../recipe-distribution-contract";

type Operation = { method: "get" | "post" | "patch" | "put" | "delete"; path: string; id: string; tag: string;
  summary: string; description: string; response: z.ZodTypeAny; body?: z.ZodTypeAny; query?: z.AnyZodObject;
  status?: number; permissions?: string[]; superadmin?: boolean; deprecated?: boolean; auth?: "public" | "session" | "either"; multipart?: boolean };
const clientPath = "/api/v1/clients", adminPath = "/api/admin";
const ops: Operation[] = [];
const client = (method: Operation["method"], path: string, id: string, summary: string, response: z.ZodTypeAny, permissions: string[], description: string, body?: z.ZodTypeAny, query?: z.AnyZodObject, status = 200, tag = "Clients") =>
  ops.push({ method, path: clientPath + path, id, summary, response, permissions, description, body, query, status, tag, auth: "either" });
const admin = (method: Operation["method"], path: string, id: string, summary: string, response: z.ZodTypeAny, description: string, body?: z.ZodTypeAny, permissions: string[] = [], superadmin = false, status = 200, query?: z.AnyZodObject) =>
  ops.push({ method, path: adminPath + path, id, summary, response, description, body, permissions, superadmin, status, query, tag: "Administration", auth: "session" });

for (const [path, id, summary, permission] of [
  ["/uploads/{uploadId}/distribution-statistics", "getUploadDistribution", "查询 v2 上传分发统计", "DRAFT_READ"],
  ["/{clientId}/drafts/{draftId}/distribution-statistics", "getDraftDistribution", "查询 v2 草稿分发统计", "DRAFT_READ"],
  ["/{clientId}/releases/{releaseId}/distribution-statistics", "getReleaseDistribution", "查询 v2 发布分发统计", "RELEASE_READ"],
] as const) client("get", path, id, summary, recipeDistributionSchema, [permission], "只读，v1 返回 409，文件索引未准备完成返回 409。使用上传时固定的同客户端已发布 v2 基准，READY 后以实际产物基准为准；跨格式或无可用基准按完整包。changes 为新增、修改、移除、策略／optional、地址差异，移除不删除玩家文件。remoteDownloadBytes 按内容去重，地址变化不重复下载。假设基准完整、无额外缓存且全部 optional；knownNetworkBytes=所选 ZIP+远程内容，不包含环境与协议开销。未组包的 ZIP／网络量为 null，environmentBytes 始终 null、由 Launcher 解析；CAS 复用不等于玩家流量节省。读取历史不改写字节或签名。");

client("get", "", "listClients", "获取可访问客户端和组包状态", z.array(s.client), ["DRAFT_READ OR RELEASE_READ"], "只返回当前 RBAC 可读客户端；删除记录隐藏。drafts、uploads 要求 DRAFT_READ，releases 要求 RELEASE_READ。组包状态在 drafts[].packageBuilds，发布历史在 releases[].packageBuilds，没有单独组包状态路由。lifecycleStatus 以 ARCHIVED 优先；uploads[].canEdit 表示所有者或超管。", undefined);
client("post", "", "createClient", "创建独立客户端", s.createdClient, ["DRAFT_CREATE", "DRAFT_SUBMIT"], "组织内名称按 NFKC、忽略大小写查重；同名返回 409，须使用更新。纯组织会话可创建未绑定客户端；Bearer Token 必须选择授权服务器。选择 serverId 另需 CLIENT_BIND；绑定替换需确认服务器 publicationRevision、expectedClientId 与 replaceConfirmed。客户端 ID 为 UUID。", r.CreateClient, undefined, 201);
client("get", "/{clientId}", "getClient", "查询客户端详情和真实任务进度", s.client, ["SERVER_READ", "DRAFT_READ OR RELEASE_READ"], "包含固定客户端修订 publicationRevision、当前发布、绑定修订 bindingRevision、草稿 contentRevision／packageRevision、上传和组包状态。权限可能使各历史数组为空；跨范围访问返回 404 或 403。");
client("post", "/uploads", "createClientUpload", "创建完整源包上传", s.upload, ["DRAFT_CREATE"], "上传完整 .zip／.mrpack，不上传差分 ZIP。固定客户端 baseReleaseId 与 basePublicationRevision；更新另需 DRAFT_EDIT。comparisonDraftId 仅比较／替代未发布草稿，另需 DRAFT_ARCHIVE。格式创建后锁定，省略为 1；关闭格式返回 409，超过实时上限返回 413，最多 20 个活动上传返回 429。每片 64 MiB、会话 24 小时；创建返回上传 ID 和 partSize。", r.CreateUpload, undefined, 201, "Uploads");
client("post", "/uploads/{uploadId}/parts", "signUploadPart", "签发单个分片 PUT 链接", z.object({ url: z.string().url(), expiresIn: z.literal(600) }).strict(), ["DRAFT_CREATE"], "要求 UPLOADING 且未过期、分片编号不超过总片数。直接 PUT 二进制到返回的 OSS URL，保存原始 ETag；这不是后台 multipart/form-data 上传。非末片为 partSize，末片可更小。浏览器依赖 OSS CORS 暴露 ETag。写上传操作只允许所有者或超管。", r.UploadPart, undefined, 200, "Uploads");
client("post", "/uploads/{uploadId}/complete", "completeClientUpload", "完成分片并排队导入", s.upload, ["DRAFT_CREATE"], "提交全部分片编号和原始 ETag，核对大小／分片后合并。合并在数据库写锁之外运行，随后再检查会话和范围；重复完成保留已有状态。返回 QUEUED 或已有任务状态，不表示导入／组包／发布完成。", r.CompleteUpload, undefined, 200, "Uploads");
client("get", "/uploads/{uploadId}", "getClientUpload", "查询导入状态和实例候选", s.upload, ["DRAFT_READ"], "轮询 status、processingPhase、detectedInfo、detectedMods、warnings 和 progress。SELECT_INSTANCE 时显示 candidates，不能默认选择第一个。Upload READY 仅表示导入完成，可提交审核；v2 的远程文件为 DECLARED，字节和运行环境由 Launcher 处理。statistics、recipeStatistics 与 comparisonStatistics 分别说明已发布玩家基准／配方／未发布草稿差异。", undefined, undefined, 200, "Uploads");
client("post", "/uploads/{uploadId}/select-instance", "selectClientInstance", "选择多实例源包中的目标实例", s.upload, ["DRAFT_CREATE"], "仅 QUEUED 且 processingPhase=SELECT_INSTANCE 可用；instanceId 必须来自 detectedInfo.candidates。选择后恢复 Worker，重新检查固定基准；不重新上传。", r.SelectInstance, undefined, 200, "Uploads");
client("post", "/uploads/{uploadId}/submit", "submitClientUpload", "提交已完成导入的版本供审核", z.object({ draftId: s.uuid }).strict(), ["DRAFT_SUBMIT"], "仅 READY 可首次提交；同资料重试返回原 draftId，变更资料返回 409。minecraftVersion／javaVersion 可省略并使用 Worker 识别值，缺失则 400；不接受 mods／modDetails，模组信息由 Worker 产生。已建立客户端名称不可变，首次无历史且唯一活动上传可确认识别名称。版本必须晚于已发布基准；自定义标签不按文件名推断。v1 platforms 缺省为五项；v2 不接受 platforms 参数。", clientSubmissionSchema, undefined, 200, "Uploads");
for (const [action, id, summary, description] of [
  ["retry", "retryClientUpload", "重试失败上传导入", "仅 FAILED 可重试，重置进度／错误／租约并进入 QUEUED，不重新上传源字节。"],
  ["cancel", "cancelClientUpload", "取消未提交的上传", "仅 UPLOADING、QUEUED、READY 或 FAILED 可取消；PROCESSING 和已提交不可取消。业务历史保留。"],
] as const) client("post", `/uploads/{uploadId}/${action}`, id, summary, s.upload, ["DRAFT_CREATE"], description, s.ignoredJson, undefined, 200, "Uploads");
client("get", "/{clientId}/drafts/{draftId}/manifest", "getDraftManifest", "读取草稿审核清单", publicManifestSchema, ["DRAFT_READ"], "核对候选清单摘要；v1 为旧客户端清单，v2 返回由草稿配方构造的目标清单。响应经过 JSON 序列化，不应把响应重编码字节当作已发布签名原文。", undefined, undefined, 200, "Drafts");
client("get", "/{clientId}/drafts/{draftId}/platform-manifest", "getDraftPlatformManifest", "读取准备好的平台或配方清单", z.union([muaPlatformManifestSchema, publicManifestSchema]), ["DRAFT_READ"], "v1 要求规范 platform；v2 使用 universal 任务，仅提供平台无关配方。清单未准备返回 404，损坏／与当前方案不符返回 422。", undefined, z.object({ platform: z.string().optional() }), 200, "Drafts");
client("post", "/{clientId}/drafts/{draftId}/review", "reviewClientDraft", "审核批准或驳回草稿", s.ok, ["DRAFT_REVIEW"], "要求 SUBMITTED，携带读取到的 contentRevision 和 packageRevision，均为必填。驳回 note 必须非空。固定已发布基准和候选清单再次核对；409 表示状态／修订／基准变化。审核批准后 Worker 签名组包，批准不等于产物 READY，也不等于发布。", r.ReviewDraft, undefined, 200, "Drafts");
client("post", "/{clientId}/drafts/{draftId}/platforms", "configureDraftPlatforms", "调整 v1 必需组包平台", s.ok, ["DRAFT_CREATE", "DRAFT_SUBMIT"], "仅 v1 的 SUBMITTED／APPROVED 草稿，更新另需 DRAFT_EDIT；v2 返回 409。变更会增加 packageRevision、清除审核并回到 SUBMITTED，需要重新审核。未变更返回 ok。", packageSelectionSchema, undefined, 200, "Drafts");
client("post", "/{clientId}/drafts/{draftId}/retry-packages", "retryDraftPackages", "重试失败的必需组包任务", s.ok, ["DRAFT_CREATE", "DRAFT_SUBMIT"], "仅未归档 SUBMITTED／APPROVED；更新另需 DRAFT_EDIT。重排失败必需任务；通过客户端详情轮询，所有必需任务 READY 才可发布。", s.ignoredJson, undefined, 200, "Drafts");
client("post", "/{clientId}/drafts/{draftId}/publish", "publishClientDraft", "发布已审核且组包完成的版本", s.published, ["RELEASE_PUBLISH"], "要求 APPROVED、审核对应当前 contentRevision／packageRevision，全部必需产物 READY 且校验成功。activate=true 另需 RELEASE_ACTIVATE。修改 replacesDraftId 另需 DRAFT_ARCHIVE，并必须提供当前两种草稿修订。仅发布成功归档显式替代链；发布内容不可修改。首次响应含 activated、archivedDraftIds；重复发布只返回 releaseId、versionLabel。", r.PublishDraft, undefined, 200, "Releases");
client("post", "/{clientId}/releases/{releaseId}/activate", "activateClientRelease", "启用或回退已有发布", s.ok, ["RELEASE_ACTIVATE"], "publicationRevision 是客户端修订，不是服务器绑定修订；必须来自最新客户端详情。只启用本客户端未归档发布，绑定待替换时另检查 CLIENT_BIND 和已确认服务器修订，冲突返回 409。", r.ActivateRelease, undefined, 200, "Releases");
client("post", "/{clientId}/drafts/{draftId}/archive", "archiveClientDraft", "撤回或归档未发布草稿", s.ok, ["DRAFT_ARCHIVE"], "携带两种草稿修订；已发布版本不可由此撤回。取消活动组包租约，保留 READY 产物与引用。重复归档返回 ok；此操作没有恢复参数。", r.ArchiveDraft, undefined, 200, "Drafts");
for (const kind of ["drafts", "releases"] as const) client("get", `/{clientId}/${kind}/{${kind === "drafts" ? "draftId" : "releaseId"}}/package`, kind === "drafts" ? "downloadDraftPackage" : "downloadReleasePackage", kind === "drafts" ? "下载草稿完整包" : "下载发布完整包", s.fullPackage, [kind === "drafts" ? "DRAFT_READ" : "RELEASE_READ"], "管理下载始终返回 full，链接 300 秒；不依赖公开服务器上架。v1 要求规范 platform；新 v2 忽略平台输入，但管理响应仍含 platform=universal。READY 前返回 409；OSS 大小／摘要不符返回 422。", undefined, z.object({ platform: z.string().optional() }), 200, kind === "drafts" ? "Drafts" : "Releases");
client("post", "/{clientId}/bind", "bindClient", "绑定同组织服务器", s.ok.extend({ pending: z.boolean() }), ["CLIENT_BIND"], "同时检查客户端、目标服务器和被替换客户端范围。publicationRevision 是服务器绑定修订，expectedClientId 必须匹配当前绑定；替换要求 replaceConfirmed。客户端最多绑定一个服务器。新客户端尚未发布且替换旧客户端时返回 pending=true，旧客户端继续可用；审核发布并启用后才执行已确认替换。", r.BindClient);
client("post", "/{clientId}/unbind", "unbindClient", "解绑或取消待绑定请求", s.ok, ["CLIENT_BIND"], "serverId／publicationRevision 必须等于当前绑定，未绑定时均为 null。归档客户端也允许解绑。保留当前发布、历史、存储与固定 scopeServerId，不自动恢复分发。", r.UnbindClient);
client("post", "/{clientId}/archive", "archiveClient", "归档或恢复客户端", s.ok, ["CLIENT_ARCHIVE"], "归档停止分发、清除实际和待绑定关系，不删除发布历史或移动 OSS；恢复不自动上架或绑定。ARCHIVED 优先于已发布状态。", s.archive);
client("post", "/{clientId}/delete", "deleteClient", "删除已归档且无绑定的客户端", s.ok, ["CLIENT_DELETE"], "必须已归档、无实际／待绑定、无 PROCESSING 上传／组包。已发布历史不阻止删除；保留不可恢复标记、签名历史和审计，隐藏记录并释放名称。未处理上传取消，文件由 Worker 按回收保留期处理，不立即删除共享 CAS。", s.ignoredJson);

admin("get", "/state", "getAdminState", "读取后台范围和真实状态", s.state, "所有有效后台会话可读。组织、服务器和成员按实时 RBAC 过滤；账号、事件和完整窗口审计曲线仅超管可读，其他账号为空数组。普通账号从 enabledPackageFormats／maxUploadSizeMb 读取开放格式和上传上限。");
admin("get", "/pipeline", "getPipeline", "读取存储、Worker 和签名状态", s.infrastructure, "仅超管会话。返回真实 bucket 连通性、可为 null 的公钥身份、队列计数和最近 30 秒 Worker 心跳；不暴露私钥或 OSS 凭据。", undefined, [], true);
admin("get", "/organizations/{organizationId}/account-search", "searchOrganizationAccounts", "搜索可授权白名单账号", z.array(s.account), "ORG_MEMBERS_READ；q 去首尾空白后至少 3 字符，原值最多 64 字符。仅 ACTIVE 账号，忽略大小写搜索用户名／显示名称，按显示名称返回最多 10 项。", undefined, ["ORG_MEMBERS_READ"], false, 200, z.object({ q: z.string().min(3).max(64) }));
admin("get", "/tokens", "listApiTokens", "列出当前账号的 API Token 元数据", z.array(s.token), "仅列出本账号 Token，包括已撤销记录；不返回明文 Token。Token 不能认证本后台接口。");
admin("post", "/tokens", "createApiToken", "创建受范围限制的 API Token", s.createdToken, "只通过 Cookie 会话创建。serverIds 必须为调用者当前有权限的服务器，permissions 必须包含 SERVER_READ，禁止 ORG_* 和 SERVER_EDIT；有效期 1–90 天。明文只在创建响应出现一次。Token 实际权限与账号当前 RBAC 取交集，停用／撤权／撤销立即生效。", r.CreateToken, [], false, 201);
admin("post", "/tokens/{tokenId}/revoke", "revokeApiToken", "撤销本账号的 API Token", s.ok, "只能撤销本账号 Token；撤销记录保留，之后 Bearer 请求返回 401。", s.ignoredJson);
admin("post", "/organizations", "createOrganization", "创建组织", s.createdId, "仅超管；创建内部 UUID，别名、头像对象键和简介可随后编辑。", s.organizationCreate, [], true, 201);
admin("patch", "/organizations/{organizationId}", "updateOrganization", "编辑组织资料", s.ok, "要求组织范围 ORG_EDIT；只允许修改列出的资料，内部 ID 不变。", s.organizationUpdate, ["ORG_EDIT"]);
admin("post", "/servers", "createServer", "登记已有 MUA server ID", z.object({ serverId: s.serverId }).strict(), "仅超管且检查 ORG_EDIT。使用已有 3–5 位字母 ID，不另造 ID。登记时可选 displayMode=PERMANENT 或 RANGE，省略默认永久；区间须提供带时区的开始与结束时间且开始早于结束，永久模式时间须为空。箴言图片通过专用上传接口设置。", s.serverCreate, ["ORG_EDIT"], true, 201);
admin("patch", "/servers/{serverId}", "updateServer", "编辑服务器资料和展示配置", s.ok, "SERVER_EDIT 可修改范围内资料、themeColor、displayMode、displayStartsAt、displayEndsAt；sortOrder、isListed 仍仅超管。RANGE 要求有效起止时间且开始早于结束；PERMANENT 清空区间。时间字段为 UTC／带时区 ISO 8601，网页以北京时间编辑。箴言图片通过专用上传接口修改。", s.serverUpdate, ["SERVER_EDIT"]);
for (const [kind, param, id, summary] of [["organizations", "organizationId", "archiveOrganization", "归档或恢复组织"], ["servers", "serverId", "archiveServer", "归档或恢复服务器"]] as const)
  admin("post", `/${kind}/{${param}}/archive`, id, summary, s.ok, "归档保留历史并停止对应分发、清除绑定。恢复不自动上架或绑定。组织／服务器仅超管。", s.archive, [], true);
admin("put", "/organizations/{organizationId}/members/{accountId}", "setOrganizationMember", "设置成员状态和组织角色", s.ok, "ORG_MEMBERS_MANAGE；不能添加停用账号。普通管理员不能调整超管、保留角色及持有保留角色的成员资格；ORG_ADMIN／REVIEWER／PUBLISHER／RELEASE_OPERATOR 仅超管授予或撤销。停用保留记录。", s.member, ["ORG_MEMBERS_MANAGE"]);
admin("put", "/organizations/{organizationId}/members/{accountId}/servers/{serverId}", "setServerGrant", "设置组织成员的单服角色", s.ok, "ORG_MEMBERS_MANAGE 加 SERVER_READ；账号须已加入同组织，服务器也须属于此组织。单服 roles 不可含 ORG_ADMIN；空数组撤销授权并保留记录。保留角色仍仅超管可调整。", s.grant, ["ORG_MEMBERS_MANAGE", "SERVER_READ"]);
admin("post", "/accounts", "createAccount", "创建白名单账号", s.createdId, "仅超管。用户名去首尾空白并转小写，3–64 位字母数字或 _. -；初始密码 12–128 字符。不要将真实密码填入文档示例或持久化调试配置。", s.accountCreate, [], true, 201);
admin("patch", "/accounts/{accountId}", "updateAccount", "修改账号状态、平台角色或重置密码", s.ok, "仅超管；至少保留一个 ACTIVE 超管。停用、变更超管标记或重置密码会撤销该账号会话；用户名不在允许字段内。", s.accountUpdate, [], true);
for (const [kind, id, summary, schema, description] of [
  ["recycle-settings", "Recycle", "回收站保留期", r.RecycleSettings, "整数 1–365 天，默认 7 天；缩短后已到期文件会在下一次 Worker 清理永久移除，共享引用仍受保护。"],
  ["upload-size-settings", "UploadSize", "源包上传上限", r.UploadSizeSettings, "整数 1–20480 MB，默认 1024 MB；1 MB=1024² 字节。只限制新建源包上传，不取消已有任务，不限制产物。"],
  ["package-format-settings", "PackageFormat", "开放的 muapack 格式", r.PackageFormatSettings, "默认 [1,2]，至少保留一种、不能重复。关闭仅阻止新建上传，不取消已有任务或下架历史。"],
] as const) {
  admin("get", `/${kind}`, `get${id}Settings`, `读取${summary}`, schema, "独立 GET／PATCH 均仅超管会话；普通账号从 /api/admin/state 读取可公开给后台账号的上传选项。" + description, undefined, [], true);
  admin("patch", `/${kind}`, `set${id}Settings`, `修改${summary}`, schema, description + "修改写入审计。", schema, [], true);
}
const downloadObject = r.DownloadSettings.innerType();
const downloadOutput = z.object(Object.fromEntries(Object.entries(downloadObject.shape).map(([key, value]) => [key, value instanceof z.ZodDefault ? value.removeDefault() : value]))).strict();
const downloadInput = z.object(Object.fromEntries(Object.entries(downloadObject.shape).map(([key, value]) => [key, value instanceof z.ZodDefault ? value.removeDefault().optional() : value]))).strict();
admin("get", "/download-settings", "getDownloadSettings", "读取 Worker 下载与代理设置", downloadOutput, "仅超管会话；返回当前域名白名单、代理、镜像和 Java 镜像类型。", undefined, [], true);
admin("patch", "/download-settings", "setDownloadSettings", "修改 Worker 下载与代理设置", downloadOutput, "仅超管并审计。旧调用可省略镜像相关字段，保留当前值；启用总代理必须提供无凭据的 HTTP(S) 主机／端口 URL。关闭白名单仍保留 HTTPS、公网地址、DNS 固定、重定向及哈希保护。mirrorProxyEnabled 还要求总代理启用；MinIO 不经过代理。默认 JRE，只有超管可选择 JDK。", downloadInput, [], true);
admin("get", "/servers/{serverId}/probe", "probeServer", "读取真实 Minecraft 连接探测", s.probe, "SERVER_READ，在探测前及返回前再次检查范围。仅探测已保存地址，固定公网 DNS、SRV、超时、缓存和并发保护保留。ONLINE 为确认 MC 且低延迟，默认 ≥300ms 为 HIGH_LATENCY；无配置、归档或服务错误为 UNKNOWN。", undefined, ["SERVER_READ"]);
admin("get", "/servers/{serverId}/motto-image", "getServerMotto", "读取服务器箴言图片、原图或选区", s.motto, "SERVER_READ；variant=image／source 返回 image/webp 二进制，metadata 返回 JSON。version 可选，为当前图片对象目录中的 UUID，变化返回 409。原图已归一化为 WebP，可重裁剪。私有读取 Cache-Control: private, no-store。", undefined, ["SERVER_READ"], false, 200, z.object({ variant: z.enum(["image", "source", "metadata"]).default("image").optional(), version: s.uuid.optional() }));
admin("post", "/servers/{serverId}/motto-image", "uploadServerMotto", "上传或重新裁剪服务器箴言图片", s.mottoSaved, "SERVER_EDIT；multipart/form-data 字段 crop 和 expectedIconObjectKey 均为 JSON 编码文本（空对象键必须填 null 文本），不是嵌套表单对象。source 可省略以使用保留原图重裁剪；新 source 为静态 PNG／JPEG／WebP，最多 8 MiB／1600 万像素。固定 2.35:1，服务器复核选区和归属，存储完成后再次检查会话、范围和修订。", z.object({ source: z.string().optional(), crop: z.string(), expectedIconObjectKey: z.string() }).strict(), ["SERVER_EDIT"]);
ops[ops.length - 1].multipart = true;
admin("delete", "/servers/{serverId}/motto-image", "removeServerMotto", "移除当前服务器箴言图片", s.mottoSaved, "SERVER_EDIT；expectedIconObjectKey 必须匹配当前对象键，变化返回 409。移除绑定后旧 OSS 图片保留，本操作不改发布签名。", z.object({ expectedIconObjectKey: z.string().max(500).nullable() }).strict(), ["SERVER_EDIT"]);
for (const [action, id, summary, body, auth, description] of [
  ["login", "login", "使用白名单账号登录", s.login, "public", "同源 Origin 必需。返回 ok 并设置 HttpOnly、SameSite=Strict、Path=/ 的 mua_session；HTTPS 时 Secure，有效期 12 小时。密码错误／停用返回 401，节流返回 429；旧 Cookie 可选。"],
  ["logout", "logout", "退出当前会话", z.object({}).strict(), "public", "同源 Origin 必需，会话 Cookie 可选；删除当前会话并设置 Cookie Max-Age=0。请求为 {}。"],
  ["password", "changePassword", "修改当前账号密码", s.passwordChange, "session", "有效 Cookie 会话和同源 Origin 必需；校验当前密码，要求新密码 12–128 字符，修改后撤销该账号全部会话并清除 Cookie，须重新登录。不会修改 API Token 的明文或权限。"],
] as const) ops.push({ method: "post", path: `/api/auth/${action}`, id, summary, response: s.ok, body, auth, description, tag: "Authentication" });
export const privateOperations = ops;

export function adminOpenApi(locale: Locale = "zh-CN") {
  const base = publicOpenApi(locale), t = translator(locale), registry = new OpenAPIRegistry();
  const error = registry.register("Error", errorSchema);
  const cacheHeaders = { "Cache-Control": { schema: { type: "string" as const, example: "no-store" } } };
  const schemas = new Map<z.ZodTypeAny, z.ZodTypeAny>();
  for (const [name, schema] of Object.entries({ Client: s.client, Upload: s.upload, AdminState: s.state, ApiToken: s.token, CreatedApiToken: s.createdToken,
    Infrastructure: s.infrastructure, ServerProbe: s.probe, MottoMetadata: s.motto, ManagementFullPackage: s.fullPackage, PublishResult: s.published })) schemas.set(schema, registry.register(name, schema));
  for (const op of ops) {
    const translated = (english as Record<string, string[]>)[op.id];
    if (!translated || translated.length !== 2) throw new Error(`Missing English operation text: ${op.id}`);
    const isWrite = op.method !== "get", isClient = op.auth === "either";
    const params = Object.fromEntries([...op.path.matchAll(/\{([^}]+)\}/g)].map(([, name]) => [name, name === "serverId" ? s.serverId : name === "clientId" ? s.clientId : s.uuid]));
    let body = op.body;
    if (body instanceof z.ZodObject) body = body.extend(Object.fromEntries(Object.entries(body.shape).filter(([name]) => /^(password|currentPassword|newPassword)$/.test(name)).map(([name, value]) => [name, (value as z.ZodTypeAny).openapi({ format: "password", writeOnly: true })])));
    if (op.multipart) body = z.object({ source: z.string().openapi({ format: "binary" }).optional(),
      crop: z.string().openapi({ description: t("JSON 编码选区文本：left、top、width、height 为 0–1 的比例，宽高必须大于 0。"), example: '{"left":0,"top":0,"width":1,"height":0.648936170212766}' }),
      expectedIconObjectKey: z.string().openapi({ description: t("JSON 编码的当前对象键，首次上传填写文本 null。"), example: "null" }) }).strict();
    const errors = Object.fromEntries([400, 401, 403, 404, 409, 413, 415, 422, 429, 500, 503].map(code => [code, { description: t("HTTP {0}：参数、会话、权限、资源状态或基础设施错误。", { "0": code }), content: { "application/json": { schema: error } }, headers: cacheHeaders }]));
    const jsonResponse = { "application/json": { schema: schemas.get(op.response) ?? op.response } };
    const content = op.id === "getServerMotto" ? { ...jsonResponse, "image/webp": { schema: { type: "string" as const, format: "binary" } } } : jsonResponse;
    const cookieHeader = op.tag === "Authentication" ? { "Set-Cookie": { description: t("mua_session 会话设置或清除，由浏览器管理。"), schema: { type: "string" as const } } } : {};
    registry.registerPath({ method: op.method, path: op.path, operationId: op.id, tags: [op.tag], summary: locale === "en-US" ? translated[0] : op.summary,
      description: (locale === "en-US" ? translated[1] : op.description) + (isWrite ? "\n\n" + t(isClient ? "Cookie 写请求要求同源 Origin；Bearer 写请求不要求 Origin。Authorization 存在时只采用 Bearer，错误 Token 不回退 Cookie。请求必须包含 JSON，忽略正文的操作推荐 {}。" : "写请求要求同源 Origin，Bearer 不能替代 Cookie。除图片上传外使用 application/json，必须包含正文。") : ""),
      security: op.auth === "public" ? [] : isClient ? [{ SessionCookie: [] }, { ApiToken: [] }] : [{ SessionCookie: [] }],
      "x-permissions": op.permissions ?? [], "x-superadmin-only": !!op.superadmin,
      "x-request-body-max-bytes": isWrite ? op.multipart ? 8 * 1024 ** 2 + 65536 : isClient && op.path !== clientPath ? 262144 : 32768 : undefined,
      request: { params: Object.keys(params).length ? z.object(params) : undefined, query: op.query,
        headers: isWrite ? z.object({ Origin: isClient ? z.string().optional().openapi({ description: t("仅 Cookie 写请求必需；浏览器自动发送真实 Origin。") }) : z.string().openapi({ description: t("当前网站的完整 origin；浏览器自动发送。") }) }) : undefined,
        body: body ? { required: true, content: { [op.multipart ? "multipart/form-data" : "application/json"]: { schema: body } } } : undefined },
      responses: { [op.status ?? 200]: { description: t("成功；字段可见性仍受当前 RBAC 和资源状态约束。"), content, headers: { ...cacheHeaders, ...cookieHeader } }, ...errors },
    });
  }
  const internal = new OpenApiGeneratorV31(registry.definitions).generateDocument({ openapi: "3.1.0", info: { title: "Union Link API", version: OPENAPI_VERSION } });
  return { ...base, info: { ...base.info, description: t("后台完整规范包含 Launcher、客户端自动化、后台和认证接口。文档可见性不授予业务权限；每次业务请求仍检查范围、RBAC、修订和生命周期。按上传、审核、组包、发布顺序执行，读取真实进度后再推进。") },
    paths: { ...base.paths, ...internal.paths }, components: { ...base.components, schemas: { ...base.components?.schemas, ...internal.components?.schemas } },
    tags: [...base.tags ?? [], ...["Clients", "Uploads", "Drafts", "Releases", "Administration", "Authentication"].map(name => ({ name }))],
  };
}
