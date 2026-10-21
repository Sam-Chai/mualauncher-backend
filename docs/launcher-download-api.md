# Launcher 客户端下载与链接刷新

2026-10-21：四个服务器目录／Manifest／packages／固定版本刷新 GET 均要求有效成员 Cookie 或 `Authorization: Bearer mul_...`，匿名 401、无资源权限 404，不保留匿名兼容。管理自动化 mua_ Token 不用于成员分发；原生登录桥接见 [Union 成员访问](union-oauth-member-access.md)。每次读取实时授权，返回下载结果前再次校验绑定与权限；原格式、平台、基准、摘要、签名和五分钟 OSS 链接语义保留，展示时间仍只影响目录。本条优先于下文“公开下载”的匿名含义。

2026-10-14：存储支持 `.env` 选择 MinIO／AWS／通用 S3／阿里云 OSS／腾讯云 COS／华为云 OBS，见 [配置与验证](object-storage.md)。签名 URL 的参数由供应商决定，客户端按不透明 URL 使用；返回字段、发布签名、ETag／Range／If-Match 与刷新身份规则保持一致。

2026-10-14 首发基线：开发期旧入口、旧请求与历史协议分支已清理；当前规则、数据处理及验证见 [首发清理](first-release-cleanup.md)。本说明优先于下文历史实施记录。


2026-10-12：服务器目录新增 displayMode、displayStartsAt、displayEndsAt，并按永久／区间模式过滤展示。区间为开始包含、结束排除，只影响 GET /api/v1/servers；到期不修改 isListed，不阻止 manifest、packages 和固定版本刷新。管理入口及契约见 [服务器展示时间](server-display-schedule.md)。

更新：2026-10-12。v1／v2 使用同一发布系统和 S3 GetObject 预签名下载。公开下载检查在线绑定、上架和归档／删除状态，管理下载继续检查 RBAC。Launcher 安装、恢复事务和信任公钥部署仍需接入。

## 1. 发现当前发布

```http
GET /api/v1/servers/NPU/packages?platform=windows-amd64&acceptedFormatVersions=1,2
GET /api/v1/servers/NPU/packages?acceptedFormatVersions=2
```

v1 必须提供六平台协议中的规范 platform。v2 使用 protocolRevision:2，不限制平台，同一发布与同一基准使用相同配方字节，响应和 refreshUrl 不含 platform／supportedPlatforms。acceptedFormatVersions 必填，省略返回 400；不接受当前发布格式返回 415，不暗中选择其他发布。

新 v2 没有架构选择或发布平台名单；环境和原生库由 Launcher 按本机系统／架构解析，不保证任意平台实际可启动。历史受限 v2 声明保持原样。

更新请求附上 `baseReleaseId=<已安装 UUID>` 和建议的 `baseManifestSha256=<64 位小写 SHA-256>`。匹配上传时固定的已发布基准、格式及摘要才返回 update，否则返回同目标 full。平台门槛仅用于 v1 与历史 v2 目标；新修订可使用精确绑定的历史 v2 基准。v1 基准摘要为包内平台清单摘要，不是旧 /manifest 的摘要；v2 为原始 mua-recipe-manifest 摘要。

响应包含 `format`, `formatVersion`, `releaseId`, `version`, `packageType`, `baseReleaseId`, `baseManifestSha256`, `sha256`, `size`, `targetManifestSha256`, `signingKeyId`, `url`, `expiresIn:300`, `expiresAt`, `etag`, `refreshUrl`, `mods` 与 `full`。full 的基准字段为 null；full 自身含 sha256／size／etag／url／expiresIn／expiresAt／refreshUrl，始终指向同目标完整包。ETag 为 S3 原始值（含引号），不能代替 SHA-256。新 v2 另含 `minimumLauncherProtocol:2`, `protocolRevision:2`, `runtime`；仅 v1 含 platform。optional 标记保留。

## 2. 固定发布版本刷新

```http
GET /api/v1/servers/NPU/releases/<releaseId>/packages?platform=windows-amd64&acceptedFormatVersions=1&packageSha256=<原包 SHA-256>
GET /api/v1/servers/NPU/releases/<releaseId>/packages?acceptedFormatVersions=2&baseReleaseId=<基准 UUID>&baseManifestSha256=<基准摘要>&packageSha256=<原更新包 SHA-256>
```

Launcher 应保存并直接请求响应里的相对 `refreshUrl`，以后台 API origin 解析。刷新固定 `releaseId`、包摘要、v1 平台和更新基准，不重新选择服务器最新版本，也不重新组包。新版本上线后，同一个仍绑定的客户端的历史未归档发布仍可刷新；草稿、不属于当前绑定客户端的历史、归档／删除／解绑／下架资源返回 404。这里的 releaseId 是 MUA 不可变发布 ID，不是 S3 bucket 的 `versionId`。

`packageSha256` 在该路由可选，但生成的 refreshUrl 始终携带。摘要与当前可提供的包不符返回 409，不静默替换其他字节；例如更新基准已归档而只能提供 full，原更新下载刷新会失败，需 Launcher 明确重新选择完整包并建立新的下载任务。未提供包摘要时，可使用固定 releaseId 路由首次选择包，但不可依此保证续传文件身份。只需要完整包修复时，使用 `full.refreshUrl`；它不带更新基准。

成功响应 `Cache-Control:no-store`。它包含新预签名链接和从签名时间计算的 UTC `expiresAt`；同秒请求可能得到相同的有效 URL，刷新不要求随机生成 URL。无论服务器最新发布是什么，选定的 releaseId／SHA-256／大小不变才允许继续原下载。

## 3. 对象存储下载与续传

预签名链接由选定供应商的 SDK 签发，MinIO／AWS／通用 S3 使用 SigV4，三家云服务使用原生签名，默认有效 300 秒。GET 签名不绑定 `Range` 或 `If-Match`；Launcher 可以对同一对象请求单一范围，并携带后台返回的原始 ETag：

```http
GET <presigned-url>
Range: bytes=1048576-
If-Match: "<etag>"
```

续传只接受 `206 Partial Content`，检查 `Content-Range` 起点／终点／总大小以及 ETag 与当前任务一致后写入相应偏移。收到 200 不得直接追加到部分文件；412 表示 ETag 条件失败，416 表示请求范围不成立，应核对下载记录。一个 GET 只请求一个字节范围；并发分块须分别请求，不能发送多范围头。ETag 为不透明对象身份，multipart ETag 不是整个文件的 SHA-256，也不一定是 MD5。

链接过期后，续传的新 GET 会失败；先请求固定 refreshUrl，再以同一 SHA-256、size、ETag 及已有偏移续传。尚在进行中的传输不要求在 URL 到期时主动中断。只有确认是链接到期才刷新，不能把所有 403（权限、签名错误等）都当作到期无限重试。此 URL 签的是 GET，不能换 HEAD 方法；所需大小与 ETag 已在 JSON 响应中提供。不要改写签名 URL 的域名或查询参数。

完整下载完成后必须核对字节数与整个 ZIP 的 SHA-256，再用包外可信公钥验签、校验完整目标／基准、载荷摘要与安装路径。断点记录、原子安装、v2 环境解析和 optional 选择由 Launcher 实现。浏览器客户端还需要实际 OSS CORS 允许 Range／If-Match、暴露 ETag／Content-Range；原生 Launcher 不受浏览器 CORS 限制。

AWS 行为依据：[GetObject（Range、If-Match）](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html)、[预签名 URL 有效期](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html)。实际 IAM／临时凭证／bucket 策略可能使 URL 比标称时间更早失效。当前存储客户端使用配置的固定凭证；生产 IAM 与 CDN 策略需另行配置。

## 4. 后端校验与错误

v1 和 v2 在签发前均核对发布清单摘要及身份、READY／required 产物、完整包及所选更新包的 S3 HEAD `ContentLength` 与 `Metadata.sha256`；不会在每次请求时重新下载整个大 ZIP。完整字节／ZIP／签名在 Worker 生成时校验，下载端还必须对实际收到的字节重新校验，HEAD 元数据不替代密码学内容校验。

更新包核对上传时固定的 `baseReleaseId`、已发布基准所属客户端／组织／版本／平台及实际清单摘要。新 v1 更新产物记录 `baseManifestSha256`；所有更新产物必须保存并核对 baseManifestSha256。v2 必须有原本记录的基准摘要。存储／基准损坏不伪装成成功，也不偷偷选其他版本。

| HTTP | 含义 |
| --- | --- |
| 400 | 无效平台／UUID／能力列表／SHA-256，或基准摘要缺少基准 ID |
| 404 | 未公开、已归档／删除／解绑、跨客户端／组织目标，或未提供所需平台包 |
| 409 | 固定下载包摘要与可提供的包不符，必须重新建立下载任务 |
| 415 | Launcher 未声明接受目标 muapack 格式 |
| 503 | 已发布清单、产物、基准身份或 OSS 大小／摘要校验失败／不可读取 |

归档阻止新的发现、下载与刷新请求。已经发出的 S3 URL 仍有剩余有效期，归档本身不即时撤销它，也不保证清除客户端或 CDN 已缓存字节。
