# Union Link API 文档

后台完整规范包含 Launcher、客户端自动化、后台和认证接口。文档可见性不授予业务权限；每次业务请求仍检查范围、RBAC、修订和生命周期。按上传、审核、组包、发布顺序执行，读取真实进度后再推进。

| 项目 | 值 |
| --- | --- |
| OpenAPI 标准版本 | `3.1.0` |
| API 文档版本 | `5.2.0` |
| 应用版本 | `0.1.0` |
| 完整操作数 | 93 |
| 公开规范收录操作数 | 11 |
| 生成日期 | 2026-10-26 |
| 完整规范来源 | [docs/openapi/union-link.admin.zh-CN.json](docs/openapi/union-link.admin.zh-CN.json) |
| 公开规范来源 | [docs/openapi/union-link.zh-CN.json](docs/openapi/union-link.zh-CN.json) |
| 完整规范 SHA-256 | `f7a9ed73af60f4c812e7c15dcc1ba7f4eb63f99418da874d6425594c12c216ff` |

本文件按本地已校验的 OpenAPI JSON 生成，包含后台完整接口。规范中的参数、约束、响应码及权限标识原样保留；未提供的业务示例不作推测。接口说明及运行时校验仍决定跨字段、RBAC、修订和生命周期规则。

“公开规范”表示该接口收录在无需登录即可读取的 OpenAPI JSON 中，并不表示该接口允许匿名请求。各接口的认证要求以其“认证”栏为准。

## 目录

- [地址与调用约定](#conventions)
- [认证方式](#authentication)
- [接口索引](#operations)
- [接口详情](#details)
- [数据模型与字段约束](#schemas)

<a id="conventions"></a>

## 地址与调用约定

| 规范服务器地址 | 说明 |
| --- | --- |
| `/` | 当前站点；本地、预览和生产使用各自的同源 API。 |

路径均为相对站点根目录的路径。当前部署地址为 `https://link.mualliance.cn`；本地或其他部署应替换为对应站点地址。

- `application/json` 请求使用 JSON 请求体；`multipart/form-data` 接口按各自的文件字段提交。
- Cookie 写请求使用同源 `Origin`。浏览器会自动携带真实 Origin；自动化调用须遵循接口注明的认证要求。
- `mua_` 自动化 Token 与 `mul_` 启动器 Token 用途不同，均不是 JWT。
- 请求体大小限制、仅超管操作和权限要求分别取自 `x-request-body-max-bytes`、`x-superadmin-only` 和 `x-permissions`。没有声明的限制不在本文补造。
- 参数的“必填”与字段的“允许 null”分别表达：字段存在但值为 null，并不等于可以省略该字段。
- 成功响应只表示对应步骤完成；异步导入、组包与发布的边界以接口说明及状态字段为准。

<a id="authentication"></a>

## 认证方式

| 方案 | 位置 / 类型 | 格式 | 说明 |
| --- | --- | --- | --- |
| `LauncherToken` | HTTP / http | `mul_<64 lowercase hex characters>` |  |
| `SessionCookie` | cookie / apiKey | `mua_session` | 后台使用 HttpOnly 会话 Cookie；写操作还要求同源 Origin。浏览器应通过登录流程建立会话，不手动填写 Cookie。 |
| `ApiToken` | HTTP / http | `mua_<64 lowercase hex characters>` | 客户端自动化接口使用 Bearer mua_…；不是 JWT。Token 受服务器范围、权限、有效期及账号当前 RBAC 限制，不能用于后台管理接口。 |

认证规则中的“或”表示任选一套认证，“且”表示同一套要求须同时满足。Cookie 会话经网站登录建立；不要将真实账号、会话 Cookie、Token 或第三方密钥写入本文。

`ApiToken` 通过 `Authorization: Bearer mua_<TOKEN>` 发送，`LauncherToken` 通过 `Authorization: Bearer mul_<TOKEN>` 发送。请将占位符替换为实际签发的 Token，保持前缀和完整值。

<a id="operations"></a>

## 接口索引

### 启动器与玩家分发（4）

| 方法 | 路径 | 说明 | 认证 | 公开规范 |
| --- | --- | --- | --- | --- |
| `GET` | [`/api/v1/servers`](#operation-listServers) | 获取账号可访问服务器目录 | `SessionCookie` 或 `LauncherToken` | 是 |
| `GET` | [`/api/v1/servers/{serverId}/manifest`](#operation-getServerManifest) | 获取当前发布的原始清单 | `SessionCookie` 或 `LauncherToken` | 是 |
| `GET` | [`/api/v1/servers/{serverId}/packages`](#operation-getServerPackages) | 发现当前发布的完整包或更新包 | `SessionCookie` 或 `LauncherToken` | 是 |
| `GET` | [`/api/v1/servers/{serverId}/releases/{releaseId}/packages`](#operation-refreshReleasePackages) | 刷新固定发布版本的下载链接 | `SessionCookie` 或 `LauncherToken` | 是 |

### 客户端管理（10）

| 方法 | 路径 | 说明 | 认证 | 公开规范 |
| --- | --- | --- | --- | --- |
| `GET` | [`/api/v1/clients/uploads/{uploadId}/distribution-statistics`](#operation-getUploadDistribution) | 查询 v2 上传分发统计 | `SessionCookie` 或 `ApiToken` | 否 |
| `GET` | [`/api/v1/clients/{clientId}/drafts/{draftId}/distribution-statistics`](#operation-getDraftDistribution) | 查询 v2 草稿分发统计 | `SessionCookie` 或 `ApiToken` | 否 |
| `GET` | [`/api/v1/clients/{clientId}/releases/{releaseId}/distribution-statistics`](#operation-getReleaseDistribution) | 查询 v2 发布分发统计 | `SessionCookie` 或 `ApiToken` | 否 |
| `GET` | [`/api/v1/clients`](#operation-listClients) | 获取可访问客户端和组包状态 | `SessionCookie` 或 `ApiToken` | 否 |
| `POST` | [`/api/v1/clients`](#operation-createClient) | 创建独立客户端 | `SessionCookie` 或 `ApiToken` | 否 |
| `GET` | [`/api/v1/clients/{clientId}`](#operation-getClient) | 查询客户端详情和真实任务进度 | `SessionCookie` 或 `ApiToken` | 否 |
| `POST` | [`/api/v1/clients/{clientId}/bind`](#operation-bindClient) | 绑定同组织服务器 | `SessionCookie` 或 `ApiToken` | 否 |
| `POST` | [`/api/v1/clients/{clientId}/unbind`](#operation-unbindClient) | 解绑或取消待绑定请求 | `SessionCookie` 或 `ApiToken` | 否 |
| `POST` | [`/api/v1/clients/{clientId}/archive`](#operation-archiveClient) | 归档或恢复客户端 | `SessionCookie` 或 `ApiToken` | 否 |
| `POST` | [`/api/v1/clients/{clientId}/delete`](#operation-deleteClient) | 删除已归档且无绑定的客户端 | `SessionCookie` 或 `ApiToken` | 否 |

### 源包上传（8）

| 方法 | 路径 | 说明 | 认证 | 公开规范 |
| --- | --- | --- | --- | --- |
| `POST` | [`/api/v1/clients/uploads`](#operation-createClientUpload) | 创建完整源包上传 | `SessionCookie` 或 `ApiToken` | 否 |
| `POST` | [`/api/v1/clients/uploads/{uploadId}/parts`](#operation-signUploadPart) | 签发单个分片 PUT 链接 | `SessionCookie` 或 `ApiToken` | 否 |
| `POST` | [`/api/v1/clients/uploads/{uploadId}/complete`](#operation-completeClientUpload) | 完成分片并排队导入 | `SessionCookie` 或 `ApiToken` | 否 |
| `GET` | [`/api/v1/clients/uploads/{uploadId}`](#operation-getClientUpload) | 查询导入状态和实例候选 | `SessionCookie` 或 `ApiToken` | 否 |
| `POST` | [`/api/v1/clients/uploads/{uploadId}/select-instance`](#operation-selectClientInstance) | 选择多实例源包中的目标实例 | `SessionCookie` 或 `ApiToken` | 否 |
| `POST` | [`/api/v1/clients/uploads/{uploadId}/submit`](#operation-submitClientUpload) | 提交已完成导入的版本供审核 | `SessionCookie` 或 `ApiToken` | 否 |
| `POST` | [`/api/v1/clients/uploads/{uploadId}/retry`](#operation-retryClientUpload) | 重试失败上传导入 | `SessionCookie` 或 `ApiToken` | 否 |
| `POST` | [`/api/v1/clients/uploads/{uploadId}/cancel`](#operation-cancelClientUpload) | 取消未提交的上传 | `SessionCookie` 或 `ApiToken` | 否 |

### 草稿与审核（7）

| 方法 | 路径 | 说明 | 认证 | 公开规范 |
| --- | --- | --- | --- | --- |
| `GET` | [`/api/v1/clients/{clientId}/drafts/{draftId}/manifest`](#operation-getDraftManifest) | 读取草稿审核清单 | `SessionCookie` 或 `ApiToken` | 否 |
| `GET` | [`/api/v1/clients/{clientId}/drafts/{draftId}/platform-manifest`](#operation-getDraftPlatformManifest) | 读取准备好的平台或配方清单 | `SessionCookie` 或 `ApiToken` | 否 |
| `POST` | [`/api/v1/clients/{clientId}/drafts/{draftId}/review`](#operation-reviewClientDraft) | 审核批准或驳回草稿 | `SessionCookie` 或 `ApiToken` | 否 |
| `POST` | [`/api/v1/clients/{clientId}/drafts/{draftId}/platforms`](#operation-configureDraftPlatforms) | 调整 v1 必需组包平台 | `SessionCookie` 或 `ApiToken` | 否 |
| `POST` | [`/api/v1/clients/{clientId}/drafts/{draftId}/retry-packages`](#operation-retryDraftPackages) | 重试失败的必需组包任务 | `SessionCookie` 或 `ApiToken` | 否 |
| `POST` | [`/api/v1/clients/{clientId}/drafts/{draftId}/archive`](#operation-archiveClientDraft) | 撤回或归档未发布草稿 | `SessionCookie` 或 `ApiToken` | 否 |
| `GET` | [`/api/v1/clients/{clientId}/drafts/{draftId}/package`](#operation-downloadDraftPackage) | 下载草稿完整包 | `SessionCookie` 或 `ApiToken` | 否 |

### 发布与切换（3）

| 方法 | 路径 | 说明 | 认证 | 公开规范 |
| --- | --- | --- | --- | --- |
| `POST` | [`/api/v1/clients/{clientId}/drafts/{draftId}/publish`](#operation-publishClientDraft) | 发布已审核且组包完成的版本 | `SessionCookie` 或 `ApiToken` | 否 |
| `POST` | [`/api/v1/clients/{clientId}/releases/{releaseId}/activate`](#operation-activateClientRelease) | 启用或回退已有发布 | `SessionCookie` 或 `ApiToken` | 否 |
| `GET` | [`/api/v1/clients/{clientId}/releases/{releaseId}/package`](#operation-downloadReleasePackage) | 下载发布完整包 | `SessionCookie` 或 `ApiToken` | 否 |

### 后台管理（47）

| 方法 | 路径 | 说明 | 认证 | 公开规范 |
| --- | --- | --- | --- | --- |
| `GET` | [`/api/admin/state`](#operation-getAdminState) | 读取后台范围和真实状态 | `SessionCookie` | 否 |
| `GET` | [`/api/admin/pipeline`](#operation-getPipeline) | 读取存储、Worker 和签名状态 | `SessionCookie` | 否 |
| `GET` | [`/api/admin/execution-settings`](#operation-getExecutionSettings) | api.operations.getExecutionSettings.summary | `SessionCookie` | 否 |
| `PATCH` | [`/api/admin/execution-settings`](#operation-setExecutionSettings) | api.operations.setExecutionSettings.summary | `SessionCookie` | 否 |
| `GET` | [`/api/admin/execution-instances`](#operation-getExecutionInstances) | api.operations.getExecutionInstances.summary | `SessionCookie` | 否 |
| `GET` | [`/api/admin/storage-telemetry`](#operation-getStorageTelemetry) | 读取存储遥测 | `SessionCookie` | 否 |
| `GET` | [`/api/admin/organizations/{organizationId}/account-search`](#operation-searchOrganizationAccounts) | 搜索可授权白名单账号 | `SessionCookie` | 否 |
| `GET` | [`/api/admin/tokens`](#operation-listApiTokens) | 列出当前账号的 API Token 元数据 | `SessionCookie` | 否 |
| `POST` | [`/api/admin/tokens`](#operation-createApiToken) | 创建受范围限制的 API Token | `SessionCookie` | 否 |
| `POST` | [`/api/admin/tokens/{tokenId}/revoke`](#operation-revokeApiToken) | 撤销本账号的 API Token | `SessionCookie` | 否 |
| `POST` | [`/api/admin/organizations`](#operation-createOrganization) | 创建组织 | `SessionCookie` | 否 |
| `PATCH` | [`/api/admin/organizations/{organizationId}`](#operation-updateOrganization) | 编辑组织资料 | `SessionCookie` | 否 |
| `POST` | [`/api/admin/servers`](#operation-createServer) | 登记已有 MUA server ID | `SessionCookie` | 否 |
| `PATCH` | [`/api/admin/servers/{serverId}`](#operation-updateServer) | 编辑服务器资料和展示配置 | `SessionCookie` | 否 |
| `POST` | [`/api/admin/organizations/{organizationId}/archive`](#operation-archiveOrganization) | 归档或恢复组织 | `SessionCookie` | 否 |
| `POST` | [`/api/admin/servers/{serverId}/archive`](#operation-archiveServer) | 归档或恢复服务器 | `SessionCookie` | 否 |
| `PUT` | [`/api/admin/organizations/{organizationId}/members/{accountId}`](#operation-setOrganizationMember) | 设置成员状态和组织角色 | `SessionCookie` | 否 |
| `PUT` | [`/api/admin/organizations/{organizationId}/members/{accountId}/servers/{serverId}`](#operation-setServerGrant) | 设置组织成员的单服角色 | `SessionCookie` | 否 |
| `POST` | [`/api/admin/accounts`](#operation-createAccount) | 创建白名单账号 | `SessionCookie` | 否 |
| `PATCH` | [`/api/admin/accounts/{accountId}`](#operation-updateAccount) | 修改账号状态、平台角色或重置密码 | `SessionCookie` | 否 |
| `POST` | [`/api/admin/accounts/{accountId}/revoke-credentials`](#operation-revokeAccountCredentials) | 撤销账号凭据 | `SessionCookie` | 否 |
| `GET` | [`/api/admin/recycle-settings`](#operation-getRecycleSettings) | 读取回收站保留期 | `SessionCookie` | 否 |
| `PATCH` | [`/api/admin/recycle-settings`](#operation-setRecycleSettings) | 修改回收站保留期 | `SessionCookie` | 否 |
| `GET` | [`/api/admin/upload-size-settings`](#operation-getUploadSizeSettings) | 读取源包上传上限 | `SessionCookie` | 否 |
| `PATCH` | [`/api/admin/upload-size-settings`](#operation-setUploadSizeSettings) | 修改源包上传上限 | `SessionCookie` | 否 |
| `GET` | [`/api/admin/package-format-settings`](#operation-getPackageFormatSettings) | 读取开放的 muapack 格式 | `SessionCookie` | 否 |
| `PATCH` | [`/api/admin/package-format-settings`](#operation-setPackageFormatSettings) | 修改开放的 muapack 格式 | `SessionCookie` | 否 |
| `GET` | [`/api/admin/download-settings`](#operation-getDownloadSettings) | 读取 Worker 下载与代理设置 | `SessionCookie` | 否 |
| `PATCH` | [`/api/admin/download-settings`](#operation-setDownloadSettings) | 修改 Worker 下载与代理设置 | `SessionCookie` | 否 |
| `GET` | [`/api/admin/servers/{serverId}/probe`](#operation-probeServer) | 读取真实 Minecraft 连接探测 | `SessionCookie` | 否 |
| `GET` | [`/api/admin/servers/{serverId}/motto-image`](#operation-getServerMotto) | 读取服务器箴言图片、原图或选区 | `SessionCookie` | 否 |
| `POST` | [`/api/admin/servers/{serverId}/motto-image`](#operation-uploadServerMotto) | 上传或重新裁剪服务器箴言图片 | `SessionCookie` | 否 |
| `DELETE` | [`/api/admin/servers/{serverId}/motto-image`](#operation-removeServerMotto) | 移除当前服务器箴言图片 | `SessionCookie` | 否 |
| `GET` | [`/api/admin/launcher-providers`](#operation-listLauncherProvidersAdmin) | 超管读取启动器认证来源配置 | `SessionCookie` | 否 |
| `PUT` | [`/api/admin/launcher-providers`](#operation-saveLauncherProvider) | 超管核准或停用启动器认证来源 | `SessionCookie` | 否 |
| `GET` | [`/api/admin/union-sync`](#operation-getUnionSync) | 读取联盟目录同步状态 | `SessionCookie` | 否 |
| `POST` | [`/api/admin/union-sync`](#operation-requestUnionSync) | 安排立即同步联盟目录 | `SessionCookie` | 否 |
| `GET` | [`/api/admin/organizations/{organizationId}/avatar-image`](#operation-getOrganizationAvatar) | 读取组织头像、原图或裁剪资料 | `SessionCookie` | 否 |
| `POST` | [`/api/admin/organizations/{organizationId}/avatar-image`](#operation-uploadOrganizationAvatar) | 上传或重新裁剪组织头像 | `SessionCookie` | 否 |
| `DELETE` | [`/api/admin/organizations/{organizationId}/avatar-image`](#operation-removeOrganizationAvatar) | 移除组织头像并保留人工选择 | `SessionCookie` | 否 |
| `GET` | [`/api/admin/union-sites`](#operation-listUnionSites) | 列出皮肤站组织映射 | `SessionCookie` | 否 |
| `PUT` | [`/api/admin/union-sites`](#operation-saveUnionSite) | 保存皮肤站组织映射 | `SessionCookie` | 否 |
| `GET` | [`/api/admin/access/candidates`](#operation-getAccessCandidates) | 列出跨组织访问候选资源 | `SessionCookie` | 否 |
| `GET` | [`/api/admin/access/requests`](#operation-listAccessRequests) | 列出访问申请与授权 | `SessionCookie` | 否 |
| `POST` | [`/api/admin/access/requests`](#operation-submitAccessRequest) | 为本组织成员申请访问 | `SessionCookie` | 否 |
| `POST` | [`/api/admin/access/requests/{id}`](#operation-decideAccessRequest) | 审批或取消访问申请 | `SessionCookie` | 否 |
| `POST` | [`/api/admin/access/grants/{id}/revoke`](#operation-revokeAccessGrant) | 撤销跨组织访问授权 | `SessionCookie` | 否 |

### 认证与会话（14）

| 方法 | 路径 | 说明 | 认证 | 公开规范 |
| --- | --- | --- | --- | --- |
| `GET` | [`/api/auth/launcher/providers`](#operation-listLauncherProviders) | 列出已核准的启动器认证来源 | 无需认证 | 是 |
| `POST` | [`/api/auth/launcher/yggdrasil/start`](#operation-startLauncherGameLogin) | 创建游戏令牌换票请求 | 无需认证 | 是 |
| `POST` | [`/api/auth/launcher/yggdrasil/exchange`](#operation-exchangeLauncherGameLogin) | 验证游戏身份并签发 Launcher Token | 无需认证 | 是 |
| `POST` | [`/api/auth/launcher/start`](#operation-startLauncherLogin) | 创建 Launcher 登录请求 | 无需认证 | 是 |
| `POST` | [`/api/auth/launcher/claim`](#operation-claimLauncherLogin) | 领取 Launcher 只读会话 | 无需认证 | 是 |
| `POST` | [`/api/auth/launcher/logout`](#operation-logoutLauncher) | 撤销当前 Launcher 会话 | `LauncherToken` | 是 |
| `GET` | [`/api/member`](#operation-getMemberDirectory) | 读取成员身份与资源目录 | `SessionCookie` 或 `LauncherToken` | 是 |
| `POST` | [`/api/auth/revoke-credentials`](#operation-revokeOwnCredentials) | 撤销本人凭据 | `SessionCookie` | 否 |
| `POST` | [`/api/auth/login`](#operation-login) | 使用白名单账号登录 | 无需认证 | 否 |
| `POST` | [`/api/auth/logout`](#operation-logout) | 退出当前会话 | 无需认证 | 否 |
| `POST` | [`/api/auth/password`](#operation-changePassword) | 修改当前账号密码 | `SessionCookie` | 否 |
| `GET` | [`/api/auth/union/start`](#operation-startUnionLogin) | 开始 Union OAuth 登录 | 无需认证 | 否 |
| `GET` | [`/api/auth/union/callback`](#operation-completeUnionLogin) | 处理 Union OAuth 回调 | 无需认证 | 否 |
| `POST` | [`/api/auth/launcher/approve`](#operation-approveLauncherLogin) | 浏览器确认 Launcher 登录 | `SessionCookie` | 否 |

<a id="details"></a>

## 接口详情

### 启动器与玩家分发

<a id="operation-listServers"></a>

#### GET `/api/v1/servers` — 获取账号可访问服务器目录

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `listServers` |
| 认证 | `SessionCookie` 或 `LauncherToken` |
| 规范范围 | 完整规范及公开规范 |

只返回已上架、未归档且绑定有效发布的服务器，按 sortOrder、serverId 排序。展示区间采用开始包含、结束排除；到期只隐藏目录，不阻止仍在线资源的 Manifest、下载或刷新。时间为带时区的 ISO 8601 字符串。

##### 参数

规范未声明路径、查询、Header 或 Cookie 参数；认证要求见上表。

##### 请求体

规范未声明请求体。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 账号可访问服务器目录；没有可见服务器时 servers 为 []。 | `application/json` → [ServerDirectory](#schema-serverdirectory) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `401` | 请先登录 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `500` | 服务或数据库暂时不可用。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |

<a id="operation-getServerManifest"></a>

#### GET `/api/v1/servers/{serverId}/manifest` — 获取当前发布的原始清单

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `getServerManifest` |
| 认证 | `SessionCookie` 或 `LauncherToken` |
| 规范范围 | 完整规范及公开规范 |

返回已封存的原始 JSON 字节，保持签名对应的编码，不能重新序列化后验签。v1 返回 mua-client-manifest schemaVersion:2，不能将其摘要当作包内平台清单摘要；v2 返回 mua-recipe-manifest。必须从可信渠道取得公钥，响应中的 key ID 本身不建立信任。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `serverId` | `path` | 是 | string | 正则：`"^[A-Za-z]{3,5}$"` |  |
| `acceptedFormatVersions` | `query` | 是 | string | 可选值：`["1","2","1,2","2,1"]` |  |

##### 请求体

规范未声明请求体。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 原始发布清单及 Ed25519 签名响应头。 | `application/json` → [PublicManifest](#schema-publicmanifest) | `Cache-Control`：string；固定值：`"private, no-store"`<br>`X-MUA-Manifest-Sha256`：string；正则：`"^[0-9a-f]{64}$"`；原始响应字节的 SHA-256。<br>`X-MUA-Signing-Key`：string；正则：`"^[0-9a-f]{24}$"`<br>`X-MUA-Signature`：string；发布清单签名；与包内 mua-pack.json 的独立签名不同。<br>`X-MUA-Signature-Algorithm`：string；固定值：`"Ed25519"` |
| `400` | 参数格式无效，或基准摘要缺少基准发布 ID。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `401` | 请先登录 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `404` | 资源未公开、已归档／删除／解绑，或所需文件／平台产物不可用。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `409` | 固定下载包摘要不匹配；必须重新建立下载任务，不能续传到其他字节。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `415` | 当前发布格式不在 acceptedFormatVersions 中；不会自动选择历史版本。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `500` | 服务或数据库暂时不可用。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `503` | 已发布清单、基准或 OSS 产物不可读取，或身份／大小／摘要校验失败。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |

<a id="operation-getServerPackages"></a>

#### GET `/api/v1/servers/{serverId}/packages` — 发现当前发布的完整包或更新包

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `getServerPackages` |
| 认证 | `SessionCookie` 或 `LauncherToken` |
| 规范范围 | 完整规范及公开规范 |

v1 必须提供六项规范平台之一。v2 protocolRevision:2 不限制平台，各系统获取相同配方。平台规则不代表游戏启动兼容性已经验收。

acceptedFormatVersions 必填，可传 1、2、1,2 或 2,1。baseReleaseId 必须对应上传时固定的已发布基准，建议同时提供 baseManifestSha256；不匹配时回退同目标 full。v1 基准摘要为包内平台清单摘要，v2 为原始配方清单摘要。损坏基准返回错误。

返回 JSON 下载描述，不直接返回 ZIP。full 永远指向同目标完整包。链接默认有效 300 秒；etag 是可能为 null 的对象存储原始值（含引号），不是 SHA-256。刷新使用相对 refreshUrl。OSS GET 支持单范围 Range／If-Match，浏览器仍受 OSS CORS 限制。下载后校验大小、SHA-256 和包内签名；签名参数由存储供应商决定，不要改变签名 URL，也不能把 GET URL 用作 HEAD。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `serverId` | `path` | 是 | string | 正则：`"^[A-Za-z]{3,5}$"` |  |
| `platform` | `query` | 否 | string |  |  |
| `acceptedFormatVersions` | `query` | 是 | string | 可选值：`["1","2","1,2","2,1"]` |  |
| `baseReleaseId` | `query` | 否 | string (uuid) |  |  |
| `baseManifestSha256` | `query` | 否 | string | 正则：`"^[0-9a-f]{64}$"` |  |

##### 请求体

规范未声明请求体。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | v1 或 v2 的 full／update 下载描述。 | `application/json` → [PackageDownload](#schema-packagedownload) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `400` | 参数格式无效，或基准摘要缺少基准发布 ID。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `401` | 请先登录 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `404` | 资源未公开、已归档／删除／解绑，或所需文件／平台产物不可用。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `409` | 固定下载包摘要不匹配；必须重新建立下载任务，不能续传到其他字节。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `415` | 当前发布格式不在 acceptedFormatVersions 中；不会自动选择历史版本。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `500` | 服务或数据库暂时不可用。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `503` | 已发布清单、基准或 OSS 产物不可读取，或身份／大小／摘要校验失败。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |

<a id="operation-refreshReleasePackages"></a>

#### GET `/api/v1/servers/{serverId}/releases/{releaseId}/packages` — 刷新固定发布版本的下载链接

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `refreshReleasePackages` |
| 认证 | `SessionCookie` 或 `LauncherToken` |
| 规范范围 | 完整规范及公开规范 |

v1 必须提供六项规范平台之一。v2 protocolRevision:2 不限制平台，各系统获取相同配方。平台规则不代表游戏启动兼容性已经验收。

acceptedFormatVersions 必填，可传 1、2、1,2 或 2,1。baseReleaseId 必须对应上传时固定的已发布基准，建议同时提供 baseManifestSha256；不匹配时回退同目标 full。v1 基准摘要为包内平台清单摘要，v2 为原始配方清单摘要。损坏基准返回错误。

返回 JSON 下载描述，不直接返回 ZIP。full 永远指向同目标完整包。链接默认有效 300 秒；etag 是可能为 null 的对象存储原始值（含引号），不是 SHA-256。刷新使用相对 refreshUrl。OSS GET 支持单范围 Range／If-Match，浏览器仍受 OSS CORS 限制。下载后校验大小、SHA-256 和包内签名；签名参数由存储供应商决定，不要改变签名 URL，也不能把 GET URL 用作 HEAD。

releaseId 固定为当前在线绑定客户端的未归档发布，允许该客户端历史版本刷新，不重新选择最新版本。packageSha256 可选，但生成的 refreshUrl 始终携带；摘要不匹配返回 409。归档或解绑后新刷新被拒绝，已经签发的链接仍可能在剩余有效期内可用。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `serverId` | `path` | 是 | string | 正则：`"^[A-Za-z]{3,5}$"` |  |
| `releaseId` | `path` | 是 | string (uuid) |  |  |
| `platform` | `query` | 否 | string |  |  |
| `acceptedFormatVersions` | `query` | 是 | string | 可选值：`["1","2","1,2","2,1"]` |  |
| `baseReleaseId` | `query` | 否 | string (uuid) |  |  |
| `baseManifestSha256` | `query` | 否 | string | 正则：`"^[0-9a-f]{64}$"` |  |
| `packageSha256` | `query` | 否 | string | 正则：`"^[0-9a-f]{64}$"` |  |

##### 请求体

规范未声明请求体。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | v1 或 v2 的 full／update 下载描述。 | `application/json` → [PackageDownload](#schema-packagedownload) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `400` | 参数格式无效，或基准摘要缺少基准发布 ID。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `401` | 请先登录 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `404` | 资源未公开、已归档／删除／解绑，或所需文件／平台产物不可用。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `409` | 固定下载包摘要不匹配；必须重新建立下载任务，不能续传到其他字节。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `415` | 当前发布格式不在 acceptedFormatVersions 中；不会自动选择历史版本。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `500` | 服务或数据库暂时不可用。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `503` | 已发布清单、基准或 OSS 产物不可读取，或身份／大小／摘要校验失败。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |

### 客户端管理

<a id="operation-getUploadDistribution"></a>

#### GET `/api/v1/clients/uploads/{uploadId}/distribution-statistics` — 查询 v2 上传分发统计

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `getUploadDistribution` |
| 认证 | `SessionCookie` 或 `ApiToken` |
| 规范范围 | 完整规范 |
| 权限 | `DRAFT_READ` |
| 仅超管 | 否 |

只读，v1 返回 409，文件索引未准备完成返回 409。使用上传时固定的同客户端已发布 v2 基准，READY 后以实际产物基准为准；跨格式或无可用基准按完整包。changes 为新增、修改、移除、策略／optional、地址差异，移除不删除玩家文件。remoteDownloadBytes 按内容去重，地址变化不重复下载。假设基准完整、无额外缓存且全部 optional；knownNetworkBytes=所选 ZIP+远程内容，不包含环境与协议开销。未组包的 ZIP／网络量为 null，environmentBytes 始终 null、由 Launcher 解析；CAS 复用不等于玩家流量节省。读取历史不改写字节或签名。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `uploadId` | `path` | 是 | string (uuid) |  |  |

##### 请求体

规范未声明请求体。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功；字段可见性仍受当前 RBAC 和资源状态约束。 | `application/json` → [getUploadDistribution 200 响应](#schema-inline-17) | `Cache-Control`：string；规范示例：`"no-store"` |
| `400` | HTTP 400：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `401` | HTTP 401：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `403` | HTTP 403：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `404` | HTTP 404：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `409` | HTTP 409：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `413` | HTTP 413：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `415` | HTTP 415：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `422` | HTTP 422：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `429` | HTTP 429：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `500` | HTTP 500：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `503` | HTTP 503：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |

<a id="operation-getDraftDistribution"></a>

#### GET `/api/v1/clients/{clientId}/drafts/{draftId}/distribution-statistics` — 查询 v2 草稿分发统计

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `getDraftDistribution` |
| 认证 | `SessionCookie` 或 `ApiToken` |
| 规范范围 | 完整规范 |
| 权限 | `DRAFT_READ` |
| 仅超管 | 否 |

只读，v1 返回 409，文件索引未准备完成返回 409。使用上传时固定的同客户端已发布 v2 基准，READY 后以实际产物基准为准；跨格式或无可用基准按完整包。changes 为新增、修改、移除、策略／optional、地址差异，移除不删除玩家文件。remoteDownloadBytes 按内容去重，地址变化不重复下载。假设基准完整、无额外缓存且全部 optional；knownNetworkBytes=所选 ZIP+远程内容，不包含环境与协议开销。未组包的 ZIP／网络量为 null，environmentBytes 始终 null、由 Launcher 解析；CAS 复用不等于玩家流量节省。读取历史不改写字节或签名。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `clientId` | `path` | 是 | string (uuid) |  |  |
| `draftId` | `path` | 是 | string (uuid) |  |  |

##### 请求体

规范未声明请求体。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功；字段可见性仍受当前 RBAC 和资源状态约束。 | `application/json` → [getUploadDistribution 200 响应](#schema-inline-17) | `Cache-Control`：string；规范示例：`"no-store"` |
| `400` | HTTP 400：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `401` | HTTP 401：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `403` | HTTP 403：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `404` | HTTP 404：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `409` | HTTP 409：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `413` | HTTP 413：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `415` | HTTP 415：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `422` | HTTP 422：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `429` | HTTP 429：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `500` | HTTP 500：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `503` | HTTP 503：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |

<a id="operation-getReleaseDistribution"></a>

#### GET `/api/v1/clients/{clientId}/releases/{releaseId}/distribution-statistics` — 查询 v2 发布分发统计

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `getReleaseDistribution` |
| 认证 | `SessionCookie` 或 `ApiToken` |
| 规范范围 | 完整规范 |
| 权限 | `RELEASE_READ` |
| 仅超管 | 否 |

只读，v1 返回 409，文件索引未准备完成返回 409。使用上传时固定的同客户端已发布 v2 基准，READY 后以实际产物基准为准；跨格式或无可用基准按完整包。changes 为新增、修改、移除、策略／optional、地址差异，移除不删除玩家文件。remoteDownloadBytes 按内容去重，地址变化不重复下载。假设基准完整、无额外缓存且全部 optional；knownNetworkBytes=所选 ZIP+远程内容，不包含环境与协议开销。未组包的 ZIP／网络量为 null，environmentBytes 始终 null、由 Launcher 解析；CAS 复用不等于玩家流量节省。读取历史不改写字节或签名。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `clientId` | `path` | 是 | string (uuid) |  |  |
| `releaseId` | `path` | 是 | string (uuid) |  |  |

##### 请求体

规范未声明请求体。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功；字段可见性仍受当前 RBAC 和资源状态约束。 | `application/json` → [getUploadDistribution 200 响应](#schema-inline-17) | `Cache-Control`：string；规范示例：`"no-store"` |
| `400` | HTTP 400：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `401` | HTTP 401：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `403` | HTTP 403：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `404` | HTTP 404：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `409` | HTTP 409：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `413` | HTTP 413：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `415` | HTTP 415：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `422` | HTTP 422：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `429` | HTTP 429：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `500` | HTTP 500：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `503` | HTTP 503：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |

<a id="operation-listClients"></a>

#### GET `/api/v1/clients` — 获取可访问客户端和组包状态

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `listClients` |
| 认证 | `SessionCookie` 或 `ApiToken` |
| 规范范围 | 完整规范 |
| 权限 | `DRAFT_READ OR RELEASE_READ` |
| 仅超管 | 否 |

只返回当前 RBAC 可读客户端；删除记录隐藏。drafts、uploads 要求 DRAFT_READ，releases 要求 RELEASE_READ。组包状态在 drafts[].packageBuilds，发布历史在 releases[].packageBuilds，没有单独组包状态路由。lifecycleStatus 以 ARCHIVED 优先；uploads[].canEdit 表示所有者或超管。

##### 参数

规范未声明路径、查询、Header 或 Cookie 参数；认证要求见上表。

##### 请求体

规范未声明请求体。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功；字段可见性仍受当前 RBAC 和资源状态约束。 | `application/json` → [listClients 200 响应](#schema-inline-18) | `Cache-Control`：string；规范示例：`"no-store"` |
| `400` | HTTP 400：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `401` | HTTP 401：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `403` | HTTP 403：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `404` | HTTP 404：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `409` | HTTP 409：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `413` | HTTP 413：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `415` | HTTP 415：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `422` | HTTP 422：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `429` | HTTP 429：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `500` | HTTP 500：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `503` | HTTP 503：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |

<a id="operation-createClient"></a>

#### POST `/api/v1/clients` — 创建独立客户端

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `createClient` |
| 认证 | `SessionCookie` 或 `ApiToken` |
| 规范范围 | 完整规范 |
| 权限 | `DRAFT_CREATE`, `DRAFT_SUBMIT` |
| 仅超管 | 否 |
| 请求体上限 | 32768 字节 |

组织内名称按 NFKC、忽略大小写查重；同名返回 409，须使用更新。纯组织会话可创建未绑定客户端；Bearer Token 必须选择授权服务器。选择 serverId 另需 CLIENT_BIND；绑定替换需确认服务器 publicationRevision、expectedClientId 与 replaceConfirmed。客户端 ID 为 UUID。

Cookie 写请求要求同源 Origin；Bearer 写请求不要求 Origin。Authorization 存在时只采用 Bearer，错误 Token 不回退 Cookie。请求必须包含 JSON，忽略正文的操作推荐 {}。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `Origin` | `header` | 否 | string |  | 仅 Cookie 写请求必需；浏览器自动发送真实 Origin。 |

##### 请求体

必填：是。

- Content-Type：`application/json`；结构：[createClient 请求体](#schema-inline-19)。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `201` | 成功；字段可见性仍受当前 RBAC 和资源状态约束。 | `application/json` → [createClient 201 响应](#schema-inline-20) | `Cache-Control`：string；规范示例：`"no-store"` |
| `400` | HTTP 400：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `401` | HTTP 401：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `403` | HTTP 403：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `404` | HTTP 404：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `409` | HTTP 409：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `413` | HTTP 413：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `415` | HTTP 415：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `422` | HTTP 422：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `429` | HTTP 429：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `500` | HTTP 500：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `503` | HTTP 503：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |

<a id="operation-getClient"></a>

#### GET `/api/v1/clients/{clientId}` — 查询客户端详情和真实任务进度

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `getClient` |
| 认证 | `SessionCookie` 或 `ApiToken` |
| 规范范围 | 完整规范 |
| 权限 | `SERVER_READ`, `DRAFT_READ OR RELEASE_READ` |
| 仅超管 | 否 |

包含固定客户端修订 publicationRevision、当前发布、绑定修订 bindingRevision、草稿 contentRevision／packageRevision、上传和组包状态。权限可能使各历史数组为空；跨范围访问返回 404 或 403。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `clientId` | `path` | 是 | string (uuid) |  |  |

##### 请求体

规范未声明请求体。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功；字段可见性仍受当前 RBAC 和资源状态约束。 | `application/json` → [Client](#schema-client) | `Cache-Control`：string；规范示例：`"no-store"` |
| `400` | HTTP 400：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `401` | HTTP 401：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `403` | HTTP 403：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `404` | HTTP 404：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `409` | HTTP 409：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `413` | HTTP 413：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `415` | HTTP 415：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `422` | HTTP 422：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `429` | HTTP 429：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `500` | HTTP 500：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `503` | HTTP 503：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |

<a id="operation-bindClient"></a>

#### POST `/api/v1/clients/{clientId}/bind` — 绑定同组织服务器

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `bindClient` |
| 认证 | `SessionCookie` 或 `ApiToken` |
| 规范范围 | 完整规范 |
| 权限 | `CLIENT_BIND` |
| 仅超管 | 否 |
| 请求体上限 | 262144 字节 |

同时检查客户端、目标服务器和被替换客户端范围。publicationRevision 是服务器绑定修订，expectedClientId 必须匹配当前绑定；替换要求 replaceConfirmed。客户端最多绑定一个服务器。新客户端尚未发布且替换旧客户端时返回 pending=true，旧客户端继续可用；审核发布并启用后才执行已确认替换。

Cookie 写请求要求同源 Origin；Bearer 写请求不要求 Origin。Authorization 存在时只采用 Bearer，错误 Token 不回退 Cookie。请求必须包含 JSON，忽略正文的操作推荐 {}。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `clientId` | `path` | 是 | string (uuid) |  |  |
| `Origin` | `header` | 否 | string |  | 仅 Cookie 写请求必需；浏览器自动发送真实 Origin。 |

##### 请求体

必填：是。

- Content-Type：`application/json`；结构：[bindClient 请求体](#schema-inline-21)。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功；字段可见性仍受当前 RBAC 和资源状态约束。 | `application/json` → [bindClient 200 响应](#schema-inline-22) | `Cache-Control`：string；规范示例：`"no-store"` |
| `400` | HTTP 400：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `401` | HTTP 401：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `403` | HTTP 403：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `404` | HTTP 404：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `409` | HTTP 409：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `413` | HTTP 413：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `415` | HTTP 415：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `422` | HTTP 422：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `429` | HTTP 429：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `500` | HTTP 500：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `503` | HTTP 503：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |

<a id="operation-unbindClient"></a>

#### POST `/api/v1/clients/{clientId}/unbind` — 解绑或取消待绑定请求

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `unbindClient` |
| 认证 | `SessionCookie` 或 `ApiToken` |
| 规范范围 | 完整规范 |
| 权限 | `CLIENT_BIND` |
| 仅超管 | 否 |
| 请求体上限 | 262144 字节 |

serverId／publicationRevision 必须等于当前绑定，未绑定时均为 null。归档客户端也允许解绑。保留当前发布、历史、存储与固定 scopeServerId，不自动恢复分发。

Cookie 写请求要求同源 Origin；Bearer 写请求不要求 Origin。Authorization 存在时只采用 Bearer，错误 Token 不回退 Cookie。请求必须包含 JSON，忽略正文的操作推荐 {}。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `clientId` | `path` | 是 | string (uuid) |  |  |
| `Origin` | `header` | 否 | string |  | 仅 Cookie 写请求必需；浏览器自动发送真实 Origin。 |

##### 请求体

必填：是。

- Content-Type：`application/json`；结构：[unbindClient 请求体](#schema-inline-23)。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功；字段可见性仍受当前 RBAC 和资源状态约束。 | `application/json` → [unbindClient 200 响应](#schema-inline-24) | `Cache-Control`：string；规范示例：`"no-store"` |
| `400` | HTTP 400：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `401` | HTTP 401：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `403` | HTTP 403：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `404` | HTTP 404：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `409` | HTTP 409：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `413` | HTTP 413：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `415` | HTTP 415：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `422` | HTTP 422：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `429` | HTTP 429：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `500` | HTTP 500：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `503` | HTTP 503：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |

<a id="operation-archiveClient"></a>

#### POST `/api/v1/clients/{clientId}/archive` — 归档或恢复客户端

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `archiveClient` |
| 认证 | `SessionCookie` 或 `ApiToken` |
| 规范范围 | 完整规范 |
| 权限 | `CLIENT_ARCHIVE` |
| 仅超管 | 否 |
| 请求体上限 | 262144 字节 |

归档停止分发、清除实际和待绑定关系，不删除发布历史或移动 OSS；恢复不自动上架或绑定。ARCHIVED 优先于已发布状态。

Cookie 写请求要求同源 Origin；Bearer 写请求不要求 Origin。Authorization 存在时只采用 Bearer，错误 Token 不回退 Cookie。请求必须包含 JSON，忽略正文的操作推荐 {}。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `clientId` | `path` | 是 | string (uuid) |  |  |
| `Origin` | `header` | 否 | string |  | 仅 Cookie 写请求必需；浏览器自动发送真实 Origin。 |

##### 请求体

必填：是。

- Content-Type：`application/json`；结构：[archiveClient 请求体](#schema-inline-25)。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功；字段可见性仍受当前 RBAC 和资源状态约束。 | `application/json` → [unbindClient 200 响应](#schema-inline-24) | `Cache-Control`：string；规范示例：`"no-store"` |
| `400` | HTTP 400：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `401` | HTTP 401：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `403` | HTTP 403：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `404` | HTTP 404：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `409` | HTTP 409：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `413` | HTTP 413：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `415` | HTTP 415：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `422` | HTTP 422：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `429` | HTTP 429：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `500` | HTTP 500：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `503` | HTTP 503：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |

<a id="operation-deleteClient"></a>

#### POST `/api/v1/clients/{clientId}/delete` — 删除已归档且无绑定的客户端

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `deleteClient` |
| 认证 | `SessionCookie` 或 `ApiToken` |
| 规范范围 | 完整规范 |
| 权限 | `CLIENT_DELETE` |
| 仅超管 | 否 |
| 请求体上限 | 262144 字节 |

必须已归档、无实际／待绑定、无 PROCESSING 上传／组包。已发布历史不阻止删除；保留不可恢复标记、签名历史和审计，隐藏记录并释放名称。未处理上传取消，文件由 Worker 按回收保留期处理，不立即删除共享 CAS。

Cookie 写请求要求同源 Origin；Bearer 写请求不要求 Origin。Authorization 存在时只采用 Bearer，错误 Token 不回退 Cookie。请求必须包含 JSON，忽略正文的操作推荐 {}。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `clientId` | `path` | 是 | string (uuid) |  |  |
| `Origin` | `header` | 否 | string |  | 仅 Cookie 写请求必需；浏览器自动发送真实 Origin。 |

##### 请求体

必填：是。

- Content-Type：`application/json`；结构：[deleteClient 请求体](#schema-inline-26)。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功；字段可见性仍受当前 RBAC 和资源状态约束。 | `application/json` → [unbindClient 200 响应](#schema-inline-24) | `Cache-Control`：string；规范示例：`"no-store"` |
| `400` | HTTP 400：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `401` | HTTP 401：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `403` | HTTP 403：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `404` | HTTP 404：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `409` | HTTP 409：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `413` | HTTP 413：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `415` | HTTP 415：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `422` | HTTP 422：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `429` | HTTP 429：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `500` | HTTP 500：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `503` | HTTP 503：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |

### 源包上传

<a id="operation-createClientUpload"></a>

#### POST `/api/v1/clients/uploads` — 创建完整源包上传

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `createClientUpload` |
| 认证 | `SessionCookie` 或 `ApiToken` |
| 规范范围 | 完整规范 |
| 权限 | `DRAFT_CREATE` |
| 仅超管 | 否 |
| 请求体上限 | 262144 字节 |

上传完整 .zip／.mrpack，不上传差分 ZIP。固定客户端 baseReleaseId 与 basePublicationRevision；更新另需 DRAFT_EDIT。comparisonDraftId 仅比较／替代未发布草稿，另需 DRAFT_ARCHIVE。格式创建后锁定，省略为 1；关闭格式返回 409，超过实时上限返回 413，最多 20 个活动上传返回 429。每片 64 MiB、会话 24 小时；创建返回上传 ID 和 partSize。

> 规范差异提示：上段保留了 JSON 中“省略为 1”的原始描述，但该请求的 JSON Schema 和当前服务校验均要求必填 `packageFormatVersion`，且没有默认值。调用时应显式传入 `1` 或 `2`。

Cookie 写请求要求同源 Origin；Bearer 写请求不要求 Origin。Authorization 存在时只采用 Bearer，错误 Token 不回退 Cookie。请求必须包含 JSON，忽略正文的操作推荐 {}。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `Origin` | `header` | 否 | string |  | 仅 Cookie 写请求必需；浏览器自动发送真实 Origin。 |

##### 请求体

必填：是。

- Content-Type：`application/json`；结构：[createClientUpload 请求体](#schema-inline-27)。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `201` | 成功；字段可见性仍受当前 RBAC 和资源状态约束。 | `application/json` → [Upload](#schema-upload) | `Cache-Control`：string；规范示例：`"no-store"` |
| `400` | HTTP 400：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `401` | HTTP 401：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `403` | HTTP 403：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `404` | HTTP 404：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `409` | HTTP 409：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `413` | HTTP 413：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `415` | HTTP 415：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `422` | HTTP 422：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `429` | HTTP 429：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `500` | HTTP 500：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `503` | HTTP 503：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |

<a id="operation-signUploadPart"></a>

#### POST `/api/v1/clients/uploads/{uploadId}/parts` — 签发单个分片 PUT 链接

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `signUploadPart` |
| 认证 | `SessionCookie` 或 `ApiToken` |
| 规范范围 | 完整规范 |
| 权限 | `DRAFT_CREATE` |
| 仅超管 | 否 |
| 请求体上限 | 262144 字节 |

要求 UPLOADING 且未过期、分片编号不超过总片数。直接 PUT 二进制到返回的 OSS URL，保存原始 ETag；这不是后台 multipart/form-data 上传。非末片为 partSize，末片可更小。浏览器依赖 OSS CORS 暴露 ETag。写上传操作只允许所有者或超管。

Cookie 写请求要求同源 Origin；Bearer 写请求不要求 Origin。Authorization 存在时只采用 Bearer，错误 Token 不回退 Cookie。请求必须包含 JSON，忽略正文的操作推荐 {}。

链接签入由已保存上传大小和分片编号计算的精确 Content-Length，末片也必须匹配。使用 Blob 或已知长度的 Buffer 发送精确字节；浏览器自动设置 Content-Length。缺少或改动长度将在存储认证阶段被拒绝，无须等到合并。华为上传链接使用 V4 签名。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `uploadId` | `path` | 是 | string (uuid) |  |  |
| `Origin` | `header` | 否 | string |  | 仅 Cookie 写请求必需；浏览器自动发送真实 Origin。 |

##### 请求体

必填：是。

- Content-Type：`application/json`；结构：[signUploadPart 请求体](#schema-inline-28)。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功；字段可见性仍受当前 RBAC 和资源状态约束。 | `application/json` → [signUploadPart 200 响应](#schema-inline-29) | `Cache-Control`：string；规范示例：`"no-store"` |
| `400` | HTTP 400：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `401` | HTTP 401：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `403` | HTTP 403：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `404` | HTTP 404：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `409` | HTTP 409：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `413` | HTTP 413：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `415` | HTTP 415：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `422` | HTTP 422：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `429` | HTTP 429：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `500` | HTTP 500：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `503` | HTTP 503：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |

<a id="operation-completeClientUpload"></a>

#### POST `/api/v1/clients/uploads/{uploadId}/complete` — 完成分片并排队导入

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `completeClientUpload` |
| 认证 | `SessionCookie` 或 `ApiToken` |
| 规范范围 | 完整规范 |
| 权限 | `DRAFT_CREATE` |
| 仅超管 | 否 |
| 请求体上限 | 262144 字节 |

提交全部分片编号和原始 ETag，核对大小／分片后合并。合并在数据库写锁之外运行，随后再检查会话和范围；重复完成保留已有状态。返回 QUEUED 或已有任务状态，不表示导入／组包／发布完成。

Cookie 写请求要求同源 Origin；Bearer 写请求不要求 Origin。Authorization 存在时只采用 Bearer，错误 Token 不回退 Cookie。请求必须包含 JSON，忽略正文的操作推荐 {}。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `uploadId` | `path` | 是 | string (uuid) |  |  |
| `Origin` | `header` | 否 | string |  | 仅 Cookie 写请求必需；浏览器自动发送真实 Origin。 |

##### 请求体

必填：是。

- Content-Type：`application/json`；结构：[completeClientUpload 请求体](#schema-inline-30)。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功；字段可见性仍受当前 RBAC 和资源状态约束。 | `application/json` → [Upload](#schema-upload) | `Cache-Control`：string；规范示例：`"no-store"` |
| `400` | HTTP 400：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `401` | HTTP 401：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `403` | HTTP 403：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `404` | HTTP 404：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `409` | HTTP 409：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `413` | HTTP 413：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `415` | HTTP 415：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `422` | HTTP 422：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `429` | HTTP 429：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `500` | HTTP 500：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `503` | HTTP 503：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |

<a id="operation-getClientUpload"></a>

#### GET `/api/v1/clients/uploads/{uploadId}` — 查询导入状态和实例候选

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `getClientUpload` |
| 认证 | `SessionCookie` 或 `ApiToken` |
| 规范范围 | 完整规范 |
| 权限 | `DRAFT_READ` |
| 仅超管 | 否 |

轮询 status、processingPhase、detectedInfo、detectedMods、warnings 和 progress。SELECT_INSTANCE 时显示 candidates，不能默认选择第一个。Upload READY 仅表示导入完成，可提交审核；v2 的远程文件为 DECLARED，字节和运行环境由 Launcher 处理。statistics、recipeStatistics 与 comparisonStatistics 分别说明已发布玩家基准／配方／未发布草稿差异。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `uploadId` | `path` | 是 | string (uuid) |  |  |

##### 请求体

规范未声明请求体。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功；字段可见性仍受当前 RBAC 和资源状态约束。 | `application/json` → [Upload](#schema-upload) | `Cache-Control`：string；规范示例：`"no-store"` |
| `400` | HTTP 400：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `401` | HTTP 401：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `403` | HTTP 403：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `404` | HTTP 404：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `409` | HTTP 409：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `413` | HTTP 413：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `415` | HTTP 415：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `422` | HTTP 422：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `429` | HTTP 429：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `500` | HTTP 500：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `503` | HTTP 503：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |

<a id="operation-selectClientInstance"></a>

#### POST `/api/v1/clients/uploads/{uploadId}/select-instance` — 选择多实例源包中的目标实例

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `selectClientInstance` |
| 认证 | `SessionCookie` 或 `ApiToken` |
| 规范范围 | 完整规范 |
| 权限 | `DRAFT_CREATE` |
| 仅超管 | 否 |
| 请求体上限 | 262144 字节 |

仅 QUEUED 且 processingPhase=SELECT_INSTANCE 可用；instanceId 必须来自 detectedInfo.candidates。选择后恢复 Worker，重新检查固定基准；不重新上传。

Cookie 写请求要求同源 Origin；Bearer 写请求不要求 Origin。Authorization 存在时只采用 Bearer，错误 Token 不回退 Cookie。请求必须包含 JSON，忽略正文的操作推荐 {}。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `uploadId` | `path` | 是 | string (uuid) |  |  |
| `Origin` | `header` | 否 | string |  | 仅 Cookie 写请求必需；浏览器自动发送真实 Origin。 |

##### 请求体

必填：是。

- Content-Type：`application/json`；结构：[selectClientInstance 请求体](#schema-inline-31)。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功；字段可见性仍受当前 RBAC 和资源状态约束。 | `application/json` → [Upload](#schema-upload) | `Cache-Control`：string；规范示例：`"no-store"` |
| `400` | HTTP 400：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `401` | HTTP 401：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `403` | HTTP 403：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `404` | HTTP 404：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `409` | HTTP 409：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `413` | HTTP 413：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `415` | HTTP 415：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `422` | HTTP 422：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `429` | HTTP 429：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `500` | HTTP 500：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `503` | HTTP 503：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |

<a id="operation-submitClientUpload"></a>

#### POST `/api/v1/clients/uploads/{uploadId}/submit` — 提交已完成导入的版本供审核

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `submitClientUpload` |
| 认证 | `SessionCookie` 或 `ApiToken` |
| 规范范围 | 完整规范 |
| 权限 | `DRAFT_SUBMIT` |
| 仅超管 | 否 |
| 请求体上限 | 262144 字节 |

仅 READY 可首次提交；同资料重试返回原 draftId，变更资料返回 409。minecraftVersion／javaVersion 可省略并使用 Worker 识别值，缺失则 400；不接受 mods／modDetails，模组信息由 Worker 产生。已建立客户端名称不可变，首次无历史且唯一活动上传可确认识别名称。版本必须晚于已发布基准；自定义标签不按文件名推断。v1 platforms 缺省为五项；v2 不接受 platforms 参数。

Cookie 写请求要求同源 Origin；Bearer 写请求不要求 Origin。Authorization 存在时只采用 Bearer，错误 Token 不回退 Cookie。请求必须包含 JSON，忽略正文的操作推荐 {}。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `uploadId` | `path` | 是 | string (uuid) |  |  |
| `Origin` | `header` | 否 | string |  | 仅 Cookie 写请求必需；浏览器自动发送真实 Origin。 |

##### 请求体

必填：是。

- Content-Type：`application/json`；结构：[submitClientUpload 请求体](#schema-inline-32)。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功；字段可见性仍受当前 RBAC 和资源状态约束。 | `application/json` → [submitClientUpload 200 响应](#schema-inline-33) | `Cache-Control`：string；规范示例：`"no-store"` |
| `400` | HTTP 400：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `401` | HTTP 401：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `403` | HTTP 403：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `404` | HTTP 404：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `409` | HTTP 409：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `413` | HTTP 413：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `415` | HTTP 415：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `422` | HTTP 422：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `429` | HTTP 429：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `500` | HTTP 500：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `503` | HTTP 503：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |

<a id="operation-retryClientUpload"></a>

#### POST `/api/v1/clients/uploads/{uploadId}/retry` — 重试失败上传导入

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `retryClientUpload` |
| 认证 | `SessionCookie` 或 `ApiToken` |
| 规范范围 | 完整规范 |
| 权限 | `DRAFT_CREATE` |
| 仅超管 | 否 |
| 请求体上限 | 262144 字节 |

仅 FAILED 可重试，重置进度／错误／租约并进入 QUEUED，不重新上传源字节。

Cookie 写请求要求同源 Origin；Bearer 写请求不要求 Origin。Authorization 存在时只采用 Bearer，错误 Token 不回退 Cookie。请求必须包含 JSON，忽略正文的操作推荐 {}。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `uploadId` | `path` | 是 | string (uuid) |  |  |
| `Origin` | `header` | 否 | string |  | 仅 Cookie 写请求必需；浏览器自动发送真实 Origin。 |

##### 请求体

必填：是。

- Content-Type：`application/json`；结构：[deleteClient 请求体](#schema-inline-26)。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功；字段可见性仍受当前 RBAC 和资源状态约束。 | `application/json` → [Upload](#schema-upload) | `Cache-Control`：string；规范示例：`"no-store"` |
| `400` | HTTP 400：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `401` | HTTP 401：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `403` | HTTP 403：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `404` | HTTP 404：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `409` | HTTP 409：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `413` | HTTP 413：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `415` | HTTP 415：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `422` | HTTP 422：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `429` | HTTP 429：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `500` | HTTP 500：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `503` | HTTP 503：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |

<a id="operation-cancelClientUpload"></a>

#### POST `/api/v1/clients/uploads/{uploadId}/cancel` — 取消未提交的上传

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `cancelClientUpload` |
| 认证 | `SessionCookie` 或 `ApiToken` |
| 规范范围 | 完整规范 |
| 权限 | `DRAFT_CREATE` |
| 仅超管 | 否 |
| 请求体上限 | 262144 字节 |

仅 UPLOADING、QUEUED、READY 或 FAILED 可取消；PROCESSING 和已提交不可取消。业务历史保留。

Cookie 写请求要求同源 Origin；Bearer 写请求不要求 Origin。Authorization 存在时只采用 Bearer，错误 Token 不回退 Cookie。请求必须包含 JSON，忽略正文的操作推荐 {}。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `uploadId` | `path` | 是 | string (uuid) |  |  |
| `Origin` | `header` | 否 | string |  | 仅 Cookie 写请求必需；浏览器自动发送真实 Origin。 |

##### 请求体

必填：是。

- Content-Type：`application/json`；结构：[deleteClient 请求体](#schema-inline-26)。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功；字段可见性仍受当前 RBAC 和资源状态约束。 | `application/json` → [Upload](#schema-upload) | `Cache-Control`：string；规范示例：`"no-store"` |
| `400` | HTTP 400：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `401` | HTTP 401：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `403` | HTTP 403：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `404` | HTTP 404：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `409` | HTTP 409：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `413` | HTTP 413：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `415` | HTTP 415：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `422` | HTTP 422：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `429` | HTTP 429：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `500` | HTTP 500：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `503` | HTTP 503：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |

### 草稿与审核

<a id="operation-getDraftManifest"></a>

#### GET `/api/v1/clients/{clientId}/drafts/{draftId}/manifest` — 读取草稿审核清单

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `getDraftManifest` |
| 认证 | `SessionCookie` 或 `ApiToken` |
| 规范范围 | 完整规范 |
| 权限 | `DRAFT_READ` |
| 仅超管 | 否 |

核对候选清单摘要；v1 为旧客户端清单，v2 返回由草稿配方构造的目标清单。响应经过 JSON 序列化，不应把响应重编码字节当作已发布签名原文。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `clientId` | `path` | 是 | string (uuid) |  |  |
| `draftId` | `path` | 是 | string (uuid) |  |  |

##### 请求体

规范未声明请求体。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功；字段可见性仍受当前 RBAC 和资源状态约束。 | `application/json` → [getDraftManifest 200 响应](#schema-inline-34) | `Cache-Control`：string；规范示例：`"no-store"` |
| `400` | HTTP 400：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `401` | HTTP 401：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `403` | HTTP 403：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `404` | HTTP 404：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `409` | HTTP 409：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `413` | HTTP 413：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `415` | HTTP 415：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `422` | HTTP 422：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `429` | HTTP 429：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `500` | HTTP 500：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `503` | HTTP 503：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |

<a id="operation-getDraftPlatformManifest"></a>

#### GET `/api/v1/clients/{clientId}/drafts/{draftId}/platform-manifest` — 读取准备好的平台或配方清单

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `getDraftPlatformManifest` |
| 认证 | `SessionCookie` 或 `ApiToken` |
| 规范范围 | 完整规范 |
| 权限 | `DRAFT_READ` |
| 仅超管 | 否 |

v1 要求规范 platform；v2 使用 universal 任务，仅提供平台无关配方。清单未准备返回 404，损坏／与当前方案不符返回 422。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `clientId` | `path` | 是 | string (uuid) |  |  |
| `draftId` | `path` | 是 | string (uuid) |  |  |
| `platform` | `query` | 否 | string |  |  |

##### 请求体

规范未声明请求体。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功；字段可见性仍受当前 RBAC 和资源状态约束。 | `application/json` → [getDraftPlatformManifest 200 响应](#schema-inline-35) | `Cache-Control`：string；规范示例：`"no-store"` |
| `400` | HTTP 400：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `401` | HTTP 401：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `403` | HTTP 403：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `404` | HTTP 404：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `409` | HTTP 409：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `413` | HTTP 413：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `415` | HTTP 415：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `422` | HTTP 422：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `429` | HTTP 429：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `500` | HTTP 500：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `503` | HTTP 503：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |

<a id="operation-reviewClientDraft"></a>

#### POST `/api/v1/clients/{clientId}/drafts/{draftId}/review` — 审核批准或驳回草稿

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `reviewClientDraft` |
| 认证 | `SessionCookie` 或 `ApiToken` |
| 规范范围 | 完整规范 |
| 权限 | `DRAFT_REVIEW` |
| 仅超管 | 否 |
| 请求体上限 | 262144 字节 |

要求 SUBMITTED，携带读取到的 contentRevision 和 packageRevision，均为必填。驳回 note 必须非空。固定已发布基准和候选清单再次核对；409 表示状态／修订／基准变化。审核批准后 Worker 签名组包，批准不等于产物 READY，也不等于发布。

Cookie 写请求要求同源 Origin；Bearer 写请求不要求 Origin。Authorization 存在时只采用 Bearer，错误 Token 不回退 Cookie。请求必须包含 JSON，忽略正文的操作推荐 {}。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `clientId` | `path` | 是 | string (uuid) |  |  |
| `draftId` | `path` | 是 | string (uuid) |  |  |
| `Origin` | `header` | 否 | string |  | 仅 Cookie 写请求必需；浏览器自动发送真实 Origin。 |

##### 请求体

必填：是。

- Content-Type：`application/json`；结构：[reviewClientDraft 请求体](#schema-inline-36)。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功；字段可见性仍受当前 RBAC 和资源状态约束。 | `application/json` → [unbindClient 200 响应](#schema-inline-24) | `Cache-Control`：string；规范示例：`"no-store"` |
| `400` | HTTP 400：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `401` | HTTP 401：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `403` | HTTP 403：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `404` | HTTP 404：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `409` | HTTP 409：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `413` | HTTP 413：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `415` | HTTP 415：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `422` | HTTP 422：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `429` | HTTP 429：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `500` | HTTP 500：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `503` | HTTP 503：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |

<a id="operation-configureDraftPlatforms"></a>

#### POST `/api/v1/clients/{clientId}/drafts/{draftId}/platforms` — 调整 v1 必需组包平台

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `configureDraftPlatforms` |
| 认证 | `SessionCookie` 或 `ApiToken` |
| 规范范围 | 完整规范 |
| 权限 | `DRAFT_CREATE`, `DRAFT_SUBMIT` |
| 仅超管 | 否 |
| 请求体上限 | 262144 字节 |

仅 v1 的 SUBMITTED／APPROVED 草稿，更新另需 DRAFT_EDIT；v2 返回 409。变更会增加 packageRevision、清除审核并回到 SUBMITTED，需要重新审核。未变更返回 ok。

Cookie 写请求要求同源 Origin；Bearer 写请求不要求 Origin。Authorization 存在时只采用 Bearer，错误 Token 不回退 Cookie。请求必须包含 JSON，忽略正文的操作推荐 {}。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `clientId` | `path` | 是 | string (uuid) |  |  |
| `draftId` | `path` | 是 | string (uuid) |  |  |
| `Origin` | `header` | 否 | string |  | 仅 Cookie 写请求必需；浏览器自动发送真实 Origin。 |

##### 请求体

必填：是。

- Content-Type：`application/json`；结构：[configureDraftPlatforms 请求体](#schema-inline-37)。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功；字段可见性仍受当前 RBAC 和资源状态约束。 | `application/json` → [unbindClient 200 响应](#schema-inline-24) | `Cache-Control`：string；规范示例：`"no-store"` |
| `400` | HTTP 400：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `401` | HTTP 401：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `403` | HTTP 403：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `404` | HTTP 404：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `409` | HTTP 409：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `413` | HTTP 413：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `415` | HTTP 415：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `422` | HTTP 422：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `429` | HTTP 429：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `500` | HTTP 500：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `503` | HTTP 503：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |

<a id="operation-retryDraftPackages"></a>

#### POST `/api/v1/clients/{clientId}/drafts/{draftId}/retry-packages` — 重试失败的必需组包任务

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `retryDraftPackages` |
| 认证 | `SessionCookie` 或 `ApiToken` |
| 规范范围 | 完整规范 |
| 权限 | `DRAFT_CREATE`, `DRAFT_SUBMIT` |
| 仅超管 | 否 |
| 请求体上限 | 262144 字节 |

仅未归档 SUBMITTED／APPROVED；更新另需 DRAFT_EDIT。重排失败必需任务；通过客户端详情轮询，所有必需任务 READY 才可发布。

Cookie 写请求要求同源 Origin；Bearer 写请求不要求 Origin。Authorization 存在时只采用 Bearer，错误 Token 不回退 Cookie。请求必须包含 JSON，忽略正文的操作推荐 {}。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `clientId` | `path` | 是 | string (uuid) |  |  |
| `draftId` | `path` | 是 | string (uuid) |  |  |
| `Origin` | `header` | 否 | string |  | 仅 Cookie 写请求必需；浏览器自动发送真实 Origin。 |

##### 请求体

必填：是。

- Content-Type：`application/json`；结构：[deleteClient 请求体](#schema-inline-26)。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功；字段可见性仍受当前 RBAC 和资源状态约束。 | `application/json` → [unbindClient 200 响应](#schema-inline-24) | `Cache-Control`：string；规范示例：`"no-store"` |
| `400` | HTTP 400：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `401` | HTTP 401：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `403` | HTTP 403：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `404` | HTTP 404：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `409` | HTTP 409：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `413` | HTTP 413：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `415` | HTTP 415：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `422` | HTTP 422：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `429` | HTTP 429：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `500` | HTTP 500：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `503` | HTTP 503：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |

<a id="operation-archiveClientDraft"></a>

#### POST `/api/v1/clients/{clientId}/drafts/{draftId}/archive` — 撤回或归档未发布草稿

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `archiveClientDraft` |
| 认证 | `SessionCookie` 或 `ApiToken` |
| 规范范围 | 完整规范 |
| 权限 | `DRAFT_ARCHIVE` |
| 仅超管 | 否 |
| 请求体上限 | 262144 字节 |

携带两种草稿修订；已发布版本不可由此撤回。取消活动组包租约，保留 READY 产物与引用。重复归档返回 ok；此操作没有恢复参数。

Cookie 写请求要求同源 Origin；Bearer 写请求不要求 Origin。Authorization 存在时只采用 Bearer，错误 Token 不回退 Cookie。请求必须包含 JSON，忽略正文的操作推荐 {}。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `clientId` | `path` | 是 | string (uuid) |  |  |
| `draftId` | `path` | 是 | string (uuid) |  |  |
| `Origin` | `header` | 否 | string |  | 仅 Cookie 写请求必需；浏览器自动发送真实 Origin。 |

##### 请求体

必填：是。

- Content-Type：`application/json`；结构：[archiveClientDraft 请求体](#schema-inline-38)。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功；字段可见性仍受当前 RBAC 和资源状态约束。 | `application/json` → [unbindClient 200 响应](#schema-inline-24) | `Cache-Control`：string；规范示例：`"no-store"` |
| `400` | HTTP 400：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `401` | HTTP 401：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `403` | HTTP 403：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `404` | HTTP 404：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `409` | HTTP 409：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `413` | HTTP 413：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `415` | HTTP 415：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `422` | HTTP 422：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `429` | HTTP 429：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `500` | HTTP 500：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `503` | HTTP 503：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |

<a id="operation-downloadDraftPackage"></a>

#### GET `/api/v1/clients/{clientId}/drafts/{draftId}/package` — 下载草稿完整包

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `downloadDraftPackage` |
| 认证 | `SessionCookie` 或 `ApiToken` |
| 规范范围 | 完整规范 |
| 权限 | `DRAFT_READ` |
| 仅超管 | 否 |

管理下载始终返回 full，链接 300 秒；不依赖公开服务器上架。v1 要求规范 platform；新 v2 忽略平台输入，但管理响应仍含 platform=universal。READY 前返回 409；OSS 大小／摘要不符返回 422。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `clientId` | `path` | 是 | string (uuid) |  |  |
| `draftId` | `path` | 是 | string (uuid) |  |  |
| `platform` | `query` | 否 | string |  |  |

##### 请求体

规范未声明请求体。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功；字段可见性仍受当前 RBAC 和资源状态约束。 | `application/json` → [ManagementFullPackage](#schema-managementfullpackage) | `Cache-Control`：string；规范示例：`"no-store"` |
| `400` | HTTP 400：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `401` | HTTP 401：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `403` | HTTP 403：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `404` | HTTP 404：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `409` | HTTP 409：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `413` | HTTP 413：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `415` | HTTP 415：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `422` | HTTP 422：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `429` | HTTP 429：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `500` | HTTP 500：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `503` | HTTP 503：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |

### 发布与切换

<a id="operation-publishClientDraft"></a>

#### POST `/api/v1/clients/{clientId}/drafts/{draftId}/publish` — 发布已审核且组包完成的版本

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `publishClientDraft` |
| 认证 | `SessionCookie` 或 `ApiToken` |
| 规范范围 | 完整规范 |
| 权限 | `RELEASE_PUBLISH` |
| 仅超管 | 否 |
| 请求体上限 | 262144 字节 |

要求 APPROVED、审核对应当前 contentRevision／packageRevision，全部必需产物 READY 且校验成功。activate=true 另需 RELEASE_ACTIVATE。修改 replacesDraftId 另需 DRAFT_ARCHIVE，并必须提供当前两种草稿修订。仅发布成功归档显式替代链；发布内容不可修改。首次响应含 activated、archivedDraftIds；重复发布只返回 releaseId、versionLabel。

Cookie 写请求要求同源 Origin；Bearer 写请求不要求 Origin。Authorization 存在时只采用 Bearer，错误 Token 不回退 Cookie。请求必须包含 JSON，忽略正文的操作推荐 {}。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `clientId` | `path` | 是 | string (uuid) |  |  |
| `draftId` | `path` | 是 | string (uuid) |  |  |
| `Origin` | `header` | 否 | string |  | 仅 Cookie 写请求必需；浏览器自动发送真实 Origin。 |

##### 请求体

必填：是。

- Content-Type：`application/json`；结构：[publishClientDraft 请求体](#schema-inline-39)。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功；字段可见性仍受当前 RBAC 和资源状态约束。 | `application/json` → [PublishResult](#schema-publishresult) | `Cache-Control`：string；规范示例：`"no-store"` |
| `400` | HTTP 400：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `401` | HTTP 401：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `403` | HTTP 403：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `404` | HTTP 404：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `409` | HTTP 409：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `413` | HTTP 413：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `415` | HTTP 415：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `422` | HTTP 422：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `429` | HTTP 429：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `500` | HTTP 500：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `503` | HTTP 503：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |

<a id="operation-activateClientRelease"></a>

#### POST `/api/v1/clients/{clientId}/releases/{releaseId}/activate` — 启用或回退已有发布

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `activateClientRelease` |
| 认证 | `SessionCookie` 或 `ApiToken` |
| 规范范围 | 完整规范 |
| 权限 | `RELEASE_ACTIVATE` |
| 仅超管 | 否 |
| 请求体上限 | 262144 字节 |

publicationRevision 是客户端修订，不是服务器绑定修订；必须来自最新客户端详情。只启用本客户端未归档发布，绑定待替换时另检查 CLIENT_BIND 和已确认服务器修订，冲突返回 409。

Cookie 写请求要求同源 Origin；Bearer 写请求不要求 Origin。Authorization 存在时只采用 Bearer，错误 Token 不回退 Cookie。请求必须包含 JSON，忽略正文的操作推荐 {}。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `clientId` | `path` | 是 | string (uuid) |  |  |
| `releaseId` | `path` | 是 | string (uuid) |  |  |
| `Origin` | `header` | 否 | string |  | 仅 Cookie 写请求必需；浏览器自动发送真实 Origin。 |

##### 请求体

必填：是。

- Content-Type：`application/json`；结构：[activateClientRelease 请求体](#schema-inline-40)。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功；字段可见性仍受当前 RBAC 和资源状态约束。 | `application/json` → [unbindClient 200 响应](#schema-inline-24) | `Cache-Control`：string；规范示例：`"no-store"` |
| `400` | HTTP 400：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `401` | HTTP 401：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `403` | HTTP 403：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `404` | HTTP 404：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `409` | HTTP 409：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `413` | HTTP 413：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `415` | HTTP 415：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `422` | HTTP 422：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `429` | HTTP 429：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `500` | HTTP 500：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `503` | HTTP 503：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |

<a id="operation-downloadReleasePackage"></a>

#### GET `/api/v1/clients/{clientId}/releases/{releaseId}/package` — 下载发布完整包

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `downloadReleasePackage` |
| 认证 | `SessionCookie` 或 `ApiToken` |
| 规范范围 | 完整规范 |
| 权限 | `RELEASE_READ` |
| 仅超管 | 否 |

管理下载始终返回 full，链接 300 秒；不依赖公开服务器上架。v1 要求规范 platform；新 v2 忽略平台输入，但管理响应仍含 platform=universal。READY 前返回 409；OSS 大小／摘要不符返回 422。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `clientId` | `path` | 是 | string (uuid) |  |  |
| `releaseId` | `path` | 是 | string (uuid) |  |  |
| `platform` | `query` | 否 | string |  |  |

##### 请求体

规范未声明请求体。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功；字段可见性仍受当前 RBAC 和资源状态约束。 | `application/json` → [ManagementFullPackage](#schema-managementfullpackage) | `Cache-Control`：string；规范示例：`"no-store"` |
| `400` | HTTP 400：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `401` | HTTP 401：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `403` | HTTP 403：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `404` | HTTP 404：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `409` | HTTP 409：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `413` | HTTP 413：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `415` | HTTP 415：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `422` | HTTP 422：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `429` | HTTP 429：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `500` | HTTP 500：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `503` | HTTP 503：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |

### 后台管理

<a id="operation-getAdminState"></a>

#### GET `/api/admin/state` — 读取后台范围和真实状态

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `getAdminState` |
| 认证 | `SessionCookie` |
| 规范范围 | 完整规范 |
| 权限 | 未列出额外权限标识；仍执行认证、范围与运行时校验 |
| 仅超管 | 否 |

所有有效后台会话可读。组织、服务器和成员按实时 RBAC 过滤；账号、事件和完整窗口审计曲线仅超管可读，其他账号为空数组。普通账号从 enabledPackageFormats／maxUploadSizeMb 读取开放格式和上传上限。

##### 参数

规范未声明路径、查询、Header 或 Cookie 参数；认证要求见上表。

##### 请求体

规范未声明请求体。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功；字段可见性仍受当前 RBAC 和资源状态约束。 | `application/json` → [AdminState](#schema-adminstate) | `Cache-Control`：string；规范示例：`"no-store"` |
| `400` | HTTP 400：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `401` | HTTP 401：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `403` | HTTP 403：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `404` | HTTP 404：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `409` | HTTP 409：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `413` | HTTP 413：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `415` | HTTP 415：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `422` | HTTP 422：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `429` | HTTP 429：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `500` | HTTP 500：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `503` | HTTP 503：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |

<a id="operation-getPipeline"></a>

#### GET `/api/admin/pipeline` — 读取存储、Worker 和签名状态

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `getPipeline` |
| 认证 | `SessionCookie` |
| 规范范围 | 完整规范 |
| 权限 | 未列出额外权限标识；仍执行认证、范围与运行时校验 |
| 仅超管 | 是 |

仅超管会话。返回真实 bucket 连通性、可为 null 的公钥身份、队列计数和最近 30 秒 Worker 心跳；不暴露私钥或 OSS 凭据。

##### 参数

规范未声明路径、查询、Header 或 Cookie 参数；认证要求见上表。

##### 请求体

规范未声明请求体。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功；字段可见性仍受当前 RBAC 和资源状态约束。 | `application/json` → [Infrastructure](#schema-infrastructure) | `Cache-Control`：string；规范示例：`"no-store"` |
| `400` | HTTP 400：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `401` | HTTP 401：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `403` | HTTP 403：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `404` | HTTP 404：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `409` | HTTP 409：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `413` | HTTP 413：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `415` | HTTP 415：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `422` | HTTP 422：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `429` | HTTP 429：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `500` | HTTP 500：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `503` | HTTP 503：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |

<a id="operation-getExecutionSettings"></a>

#### GET `/api/admin/execution-settings` — api.operations.getExecutionSettings.summary

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `getExecutionSettings` |
| 认证 | `SessionCookie` |
| 规范范围 | 完整规范 |
| 权限 | 未列出额外权限标识；仍执行认证、范围与运行时校验 |
| 仅超管 | 是 |

api.operations.getExecutionSettings.description

##### 参数

规范未声明路径、查询、Header 或 Cookie 参数；认证要求见上表。

##### 请求体

规范未声明请求体。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功；字段可见性仍受当前 RBAC 和资源状态约束。 | `application/json` → [getExecutionSettings 200 响应](#schema-inline-41) | `Cache-Control`：string；规范示例：`"no-store"` |
| `400` | HTTP 400：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `401` | HTTP 401：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `403` | HTTP 403：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `404` | HTTP 404：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `409` | HTTP 409：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `413` | HTTP 413：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `415` | HTTP 415：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `422` | HTTP 422：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `429` | HTTP 429：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `500` | HTTP 500：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `503` | HTTP 503：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |

<a id="operation-setExecutionSettings"></a>

#### PATCH `/api/admin/execution-settings` — api.operations.setExecutionSettings.summary

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `setExecutionSettings` |
| 认证 | `SessionCookie` |
| 规范范围 | 完整规范 |
| 权限 | 未列出额外权限标识；仍执行认证、范围与运行时校验 |
| 仅超管 | 是 |
| 请求体上限 | 32768 字节 |

api.operations.setExecutionSettings.description

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `Origin` | `header` | 是 | string |  | 当前网站的完整 origin；浏览器自动发送。 |

##### 请求体

必填：是。

- Content-Type：`application/json`；结构：[setExecutionSettings 请求体](#schema-inline-42)。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功；字段可见性仍受当前 RBAC 和资源状态约束。 | `application/json` → [getExecutionSettings 200 响应](#schema-inline-41) | `Cache-Control`：string；规范示例：`"no-store"` |
| `400` | HTTP 400：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `401` | HTTP 401：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `403` | HTTP 403：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `404` | HTTP 404：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `409` | HTTP 409：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `413` | HTTP 413：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `415` | HTTP 415：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `422` | HTTP 422：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `429` | HTTP 429：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `500` | HTTP 500：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `503` | HTTP 503：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |

<a id="operation-getExecutionInstances"></a>

#### GET `/api/admin/execution-instances` — api.operations.getExecutionInstances.summary

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `getExecutionInstances` |
| 认证 | `SessionCookie` |
| 规范范围 | 完整规范 |
| 权限 | 未列出额外权限标识；仍执行认证、范围与运行时校验 |
| 仅超管 | 是 |

api.operations.getExecutionInstances.description

##### 参数

规范未声明路径、查询、Header 或 Cookie 参数；认证要求见上表。

##### 请求体

规范未声明请求体。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功；字段可见性仍受当前 RBAC 和资源状态约束。 | `application/json` → [getExecutionInstances 200 响应](#schema-inline-43) | `Cache-Control`：string；规范示例：`"no-store"` |
| `400` | HTTP 400：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `401` | HTTP 401：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `403` | HTTP 403：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `404` | HTTP 404：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `409` | HTTP 409：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `413` | HTTP 413：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `415` | HTTP 415：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `422` | HTTP 422：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `429` | HTTP 429：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `500` | HTTP 500：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `503` | HTTP 503：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |

<a id="operation-getStorageTelemetry"></a>

#### GET `/api/admin/storage-telemetry` — 读取存储遥测

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `getStorageTelemetry` |
| 认证 | `SessionCookie` |
| 规范范围 | 完整规范 |
| 权限 | 未列出额外权限标识；仍执行认证、范围与运行时校验 |
| 仅超管 | 是 |

仅超管 Cookie 会话。读取 Worker 已采集的全平台容量及今日上海时区已采集流量，不随组织筛选变化。字节及对象数量为十进制字符串；缺失为 null。流量包含 Worker 与后台访问，非完整玩家下载量或账单。缺口与跨日区间不估算，CDN 保持 NOT_CONNECTED。

##### 参数

规范未声明路径、查询、Header 或 Cookie 参数；认证要求见上表。

##### 请求体

规范未声明请求体。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功；字段可见性仍受当前 RBAC 和资源状态约束。 | `application/json` → [getStorageTelemetry 200 响应](#schema-inline-44) | `Cache-Control`：string；规范示例：`"no-store"` |
| `400` | HTTP 400：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `401` | HTTP 401：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `403` | HTTP 403：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `404` | HTTP 404：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `409` | HTTP 409：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `413` | HTTP 413：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `415` | HTTP 415：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `422` | HTTP 422：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `429` | HTTP 429：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `500` | HTTP 500：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `503` | HTTP 503：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |

<a id="operation-searchOrganizationAccounts"></a>

#### GET `/api/admin/organizations/{organizationId}/account-search` — 搜索可授权白名单账号

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `searchOrganizationAccounts` |
| 认证 | `SessionCookie` |
| 规范范围 | 完整规范 |
| 权限 | `ORG_MEMBERS_READ` |
| 仅超管 | 否 |

ORG_MEMBERS_READ；q 去首尾空白后至少 3 字符，原值最多 64 字符。仅 ACTIVE 账号，忽略大小写搜索用户名／显示名称，按显示名称返回最多 10 项。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `organizationId` | `path` | 是 | string (uuid) |  |  |
| `q` | `query` | 是 | string | 最短长度：`3`<br>最长长度：`64` |  |

##### 请求体

规范未声明请求体。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功；字段可见性仍受当前 RBAC 和资源状态约束。 | `application/json` → [searchOrganizationAccounts 200 响应](#schema-inline-45) | `Cache-Control`：string；规范示例：`"no-store"` |
| `400` | HTTP 400：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `401` | HTTP 401：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `403` | HTTP 403：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `404` | HTTP 404：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `409` | HTTP 409：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `413` | HTTP 413：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `415` | HTTP 415：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `422` | HTTP 422：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `429` | HTTP 429：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `500` | HTTP 500：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `503` | HTTP 503：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |

<a id="operation-listApiTokens"></a>

#### GET `/api/admin/tokens` — 列出当前账号的 API Token 元数据

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `listApiTokens` |
| 认证 | `SessionCookie` |
| 规范范围 | 完整规范 |
| 权限 | 未列出额外权限标识；仍执行认证、范围与运行时校验 |
| 仅超管 | 否 |

仅列出本账号 Token，包括已撤销记录；不返回明文 Token。Token 不能认证本后台接口。

##### 参数

规范未声明路径、查询、Header 或 Cookie 参数；认证要求见上表。

##### 请求体

规范未声明请求体。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功；字段可见性仍受当前 RBAC 和资源状态约束。 | `application/json` → [listApiTokens 200 响应](#schema-inline-46) | `Cache-Control`：string；规范示例：`"no-store"` |
| `400` | HTTP 400：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `401` | HTTP 401：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `403` | HTTP 403：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `404` | HTTP 404：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `409` | HTTP 409：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `413` | HTTP 413：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `415` | HTTP 415：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `422` | HTTP 422：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `429` | HTTP 429：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `500` | HTTP 500：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `503` | HTTP 503：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |

<a id="operation-createApiToken"></a>

#### POST `/api/admin/tokens` — 创建受范围限制的 API Token

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `createApiToken` |
| 认证 | `SessionCookie` |
| 规范范围 | 完整规范 |
| 权限 | 未列出额外权限标识；仍执行认证、范围与运行时校验 |
| 仅超管 | 否 |
| 请求体上限 | 32768 字节 |

只通过 Cookie 会话创建。serverIds 必须为调用者当前有权限的服务器，permissions 必须包含 SERVER_READ，禁止 ORG_* 和 SERVER_EDIT；有效期 1–90 天。明文只在创建响应出现一次。Token 实际权限与账号当前 RBAC 取交集，停用／撤权／撤销立即生效。

写请求要求同源 Origin，Bearer 不能替代 Cookie。除图片上传外使用 application/json，必须包含正文。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `Origin` | `header` | 是 | string |  | 当前网站的完整 origin；浏览器自动发送。 |

##### 请求体

必填：是。

- Content-Type：`application/json`；结构：[createApiToken 请求体](#schema-inline-47)。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `201` | 成功；字段可见性仍受当前 RBAC 和资源状态约束。 | `application/json` → [CreatedApiToken](#schema-createdapitoken) | `Cache-Control`：string；规范示例：`"no-store"` |
| `400` | HTTP 400：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `401` | HTTP 401：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `403` | HTTP 403：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `404` | HTTP 404：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `409` | HTTP 409：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `413` | HTTP 413：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `415` | HTTP 415：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `422` | HTTP 422：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `429` | HTTP 429：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `500` | HTTP 500：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `503` | HTTP 503：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |

<a id="operation-revokeApiToken"></a>

#### POST `/api/admin/tokens/{tokenId}/revoke` — 撤销本账号的 API Token

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `revokeApiToken` |
| 认证 | `SessionCookie` |
| 规范范围 | 完整规范 |
| 权限 | 未列出额外权限标识；仍执行认证、范围与运行时校验 |
| 仅超管 | 否 |
| 请求体上限 | 32768 字节 |

只能撤销本账号 Token；撤销记录保留，之后 Bearer 请求返回 401。

写请求要求同源 Origin，Bearer 不能替代 Cookie。除图片上传外使用 application/json，必须包含正文。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `tokenId` | `path` | 是 | string (uuid) |  |  |
| `Origin` | `header` | 是 | string |  | 当前网站的完整 origin；浏览器自动发送。 |

##### 请求体

必填：是。

- Content-Type：`application/json`；结构：[deleteClient 请求体](#schema-inline-26)。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功；字段可见性仍受当前 RBAC 和资源状态约束。 | `application/json` → [unbindClient 200 响应](#schema-inline-24) | `Cache-Control`：string；规范示例：`"no-store"` |
| `400` | HTTP 400：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `401` | HTTP 401：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `403` | HTTP 403：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `404` | HTTP 404：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `409` | HTTP 409：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `413` | HTTP 413：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `415` | HTTP 415：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `422` | HTTP 422：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `429` | HTTP 429：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `500` | HTTP 500：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `503` | HTTP 503：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |

<a id="operation-createOrganization"></a>

#### POST `/api/admin/organizations` — 创建组织

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `createOrganization` |
| 认证 | `SessionCookie` |
| 规范范围 | 完整规范 |
| 权限 | 未列出额外权限标识；仍执行认证、范围与运行时校验 |
| 仅超管 | 是 |
| 请求体上限 | 32768 字节 |

仅超管；创建内部 UUID，别名和简介可随后编辑；头像通过独立上传接口保存。

写请求要求同源 Origin，Bearer 不能替代 Cookie。除图片上传外使用 application/json，必须包含正文。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `Origin` | `header` | 是 | string |  | 当前网站的完整 origin；浏览器自动发送。 |

##### 请求体

必填：是。

- Content-Type：`application/json`；结构：[createOrganization 请求体](#schema-inline-48)。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `201` | 成功；字段可见性仍受当前 RBAC 和资源状态约束。 | `application/json` → [createOrganization 201 响应](#schema-inline-49) | `Cache-Control`：string；规范示例：`"no-store"` |
| `400` | HTTP 400：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `401` | HTTP 401：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `403` | HTTP 403：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `404` | HTTP 404：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `409` | HTTP 409：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `413` | HTTP 413：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `415` | HTTP 415：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `422` | HTTP 422：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `429` | HTTP 429：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `500` | HTTP 500：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `503` | HTTP 503：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |

<a id="operation-updateOrganization"></a>

#### PATCH `/api/admin/organizations/{organizationId}` — 编辑组织资料

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `updateOrganization` |
| 认证 | `SessionCookie` |
| 规范范围 | 完整规范 |
| 权限 | `ORG_EDIT` |
| 仅超管 | 否 |
| 请求体上限 | 32768 字节 |

要求组织范围 ORG_EDIT；只允许修改列出的资料，内部 ID 不变。手动修改或清空简介后永久停止皮肤站名称自动同步；省略或原样保存简介不改变同步模式。

写请求要求同源 Origin，Bearer 不能替代 Cookie。除图片上传外使用 application/json，必须包含正文。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `organizationId` | `path` | 是 | string (uuid) |  |  |
| `Origin` | `header` | 是 | string |  | 当前网站的完整 origin；浏览器自动发送。 |

##### 请求体

必填：是。

- Content-Type：`application/json`；结构：[updateOrganization 请求体](#schema-inline-50)。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功；字段可见性仍受当前 RBAC 和资源状态约束。 | `application/json` → [unbindClient 200 响应](#schema-inline-24) | `Cache-Control`：string；规范示例：`"no-store"` |
| `400` | HTTP 400：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `401` | HTTP 401：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `403` | HTTP 403：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `404` | HTTP 404：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `409` | HTTP 409：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `413` | HTTP 413：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `415` | HTTP 415：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `422` | HTTP 422：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `429` | HTTP 429：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `500` | HTTP 500：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `503` | HTTP 503：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |

<a id="operation-createServer"></a>

#### POST `/api/admin/servers` — 登记已有 MUA server ID

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `createServer` |
| 认证 | `SessionCookie` |
| 规范范围 | 完整规范 |
| 权限 | `ORG_EDIT` |
| 仅超管 | 是 |
| 请求体上限 | 32768 字节 |

仅超管且检查 ORG_EDIT。使用已有 3–5 位字母 ID，不另造 ID。登记时可选 displayMode=PERMANENT 或 RANGE，省略默认永久；区间须提供带时区的开始与结束时间且开始早于结束，永久模式时间须为空。箴言图片通过专用上传接口设置。

写请求要求同源 Origin，Bearer 不能替代 Cookie。除图片上传外使用 application/json，必须包含正文。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `Origin` | `header` | 是 | string |  | 当前网站的完整 origin；浏览器自动发送。 |

##### 请求体

必填：是。

- Content-Type：`application/json`；结构：[createServer 请求体](#schema-inline-51)。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `201` | 成功；字段可见性仍受当前 RBAC 和资源状态约束。 | `application/json` → [createServer 201 响应](#schema-inline-52) | `Cache-Control`：string；规范示例：`"no-store"` |
| `400` | HTTP 400：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `401` | HTTP 401：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `403` | HTTP 403：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `404` | HTTP 404：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `409` | HTTP 409：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `413` | HTTP 413：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `415` | HTTP 415：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `422` | HTTP 422：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `429` | HTTP 429：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `500` | HTTP 500：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `503` | HTTP 503：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |

<a id="operation-updateServer"></a>

#### PATCH `/api/admin/servers/{serverId}` — 编辑服务器资料和展示配置

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `updateServer` |
| 认证 | `SessionCookie` |
| 规范范围 | 完整规范 |
| 权限 | `SERVER_EDIT` |
| 仅超管 | 否 |
| 请求体上限 | 32768 字节 |

SERVER_EDIT 可修改范围内资料、themeColor、displayMode、displayStartsAt、displayEndsAt；sortOrder、isListed 仍仅超管。RANGE 要求有效起止时间且开始早于结束；PERMANENT 清空区间。时间字段为 UTC／带时区 ISO 8601，网页以北京时间编辑。箴言图片通过专用上传接口修改。

写请求要求同源 Origin，Bearer 不能替代 Cookie。除图片上传外使用 application/json，必须包含正文。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `serverId` | `path` | 是 | string | 正则：`"^[A-Za-z]{3,5}$"` |  |
| `Origin` | `header` | 是 | string |  | 当前网站的完整 origin；浏览器自动发送。 |

##### 请求体

必填：是。

- Content-Type：`application/json`；结构：[updateServer 请求体](#schema-inline-53)。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功；字段可见性仍受当前 RBAC 和资源状态约束。 | `application/json` → [unbindClient 200 响应](#schema-inline-24) | `Cache-Control`：string；规范示例：`"no-store"` |
| `400` | HTTP 400：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `401` | HTTP 401：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `403` | HTTP 403：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `404` | HTTP 404：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `409` | HTTP 409：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `413` | HTTP 413：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `415` | HTTP 415：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `422` | HTTP 422：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `429` | HTTP 429：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `500` | HTTP 500：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `503` | HTTP 503：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |

<a id="operation-archiveOrganization"></a>

#### POST `/api/admin/organizations/{organizationId}/archive` — 归档或恢复组织

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `archiveOrganization` |
| 认证 | `SessionCookie` |
| 规范范围 | 完整规范 |
| 权限 | 未列出额外权限标识；仍执行认证、范围与运行时校验 |
| 仅超管 | 是 |
| 请求体上限 | 32768 字节 |

归档保留历史并停止对应分发、清除绑定。恢复不自动上架或绑定。组织／服务器仅超管。

写请求要求同源 Origin，Bearer 不能替代 Cookie。除图片上传外使用 application/json，必须包含正文。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `organizationId` | `path` | 是 | string (uuid) |  |  |
| `Origin` | `header` | 是 | string |  | 当前网站的完整 origin；浏览器自动发送。 |

##### 请求体

必填：是。

- Content-Type：`application/json`；结构：[archiveClient 请求体](#schema-inline-25)。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功；字段可见性仍受当前 RBAC 和资源状态约束。 | `application/json` → [unbindClient 200 响应](#schema-inline-24) | `Cache-Control`：string；规范示例：`"no-store"` |
| `400` | HTTP 400：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `401` | HTTP 401：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `403` | HTTP 403：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `404` | HTTP 404：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `409` | HTTP 409：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `413` | HTTP 413：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `415` | HTTP 415：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `422` | HTTP 422：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `429` | HTTP 429：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `500` | HTTP 500：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `503` | HTTP 503：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |

<a id="operation-archiveServer"></a>

#### POST `/api/admin/servers/{serverId}/archive` — 归档或恢复服务器

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `archiveServer` |
| 认证 | `SessionCookie` |
| 规范范围 | 完整规范 |
| 权限 | 未列出额外权限标识；仍执行认证、范围与运行时校验 |
| 仅超管 | 是 |
| 请求体上限 | 32768 字节 |

归档保留历史并停止对应分发、清除绑定。恢复不自动上架或绑定。组织／服务器仅超管。

写请求要求同源 Origin，Bearer 不能替代 Cookie。除图片上传外使用 application/json，必须包含正文。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `serverId` | `path` | 是 | string | 正则：`"^[A-Za-z]{3,5}$"` |  |
| `Origin` | `header` | 是 | string |  | 当前网站的完整 origin；浏览器自动发送。 |

##### 请求体

必填：是。

- Content-Type：`application/json`；结构：[archiveClient 请求体](#schema-inline-25)。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功；字段可见性仍受当前 RBAC 和资源状态约束。 | `application/json` → [unbindClient 200 响应](#schema-inline-24) | `Cache-Control`：string；规范示例：`"no-store"` |
| `400` | HTTP 400：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `401` | HTTP 401：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `403` | HTTP 403：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `404` | HTTP 404：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `409` | HTTP 409：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `413` | HTTP 413：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `415` | HTTP 415：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `422` | HTTP 422：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `429` | HTTP 429：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `500` | HTTP 500：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `503` | HTTP 503：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |

<a id="operation-setOrganizationMember"></a>

#### PUT `/api/admin/organizations/{organizationId}/members/{accountId}` — 设置成员状态和组织角色

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `setOrganizationMember` |
| 认证 | `SessionCookie` |
| 规范范围 | 完整规范 |
| 权限 | `ORG_MEMBERS_MANAGE` |
| 仅超管 | 否 |
| 请求体上限 | 32768 字节 |

ORG_MEMBERS_MANAGE；不能添加停用账号。普通管理员不能调整超管、保留角色及持有保留角色的成员资格；ORG_ADMIN／REVIEWER／PUBLISHER／RELEASE_OPERATOR 仅超管授予或撤销。停用保留记录。

写请求要求同源 Origin，Bearer 不能替代 Cookie。除图片上传外使用 application/json，必须包含正文。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `organizationId` | `path` | 是 | string (uuid) |  |  |
| `accountId` | `path` | 是 | string (uuid) |  |  |
| `Origin` | `header` | 是 | string |  | 当前网站的完整 origin；浏览器自动发送。 |

##### 请求体

必填：是。

- Content-Type：`application/json`；结构：[setOrganizationMember 请求体](#schema-inline-54)。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功；字段可见性仍受当前 RBAC 和资源状态约束。 | `application/json` → [unbindClient 200 响应](#schema-inline-24) | `Cache-Control`：string；规范示例：`"no-store"` |
| `400` | HTTP 400：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `401` | HTTP 401：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `403` | HTTP 403：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `404` | HTTP 404：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `409` | HTTP 409：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `413` | HTTP 413：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `415` | HTTP 415：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `422` | HTTP 422：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `429` | HTTP 429：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `500` | HTTP 500：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `503` | HTTP 503：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |

<a id="operation-setServerGrant"></a>

#### PUT `/api/admin/organizations/{organizationId}/members/{accountId}/servers/{serverId}` — 设置组织成员的单服角色

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `setServerGrant` |
| 认证 | `SessionCookie` |
| 规范范围 | 完整规范 |
| 权限 | `ORG_MEMBERS_MANAGE`, `SERVER_READ` |
| 仅超管 | 否 |
| 请求体上限 | 32768 字节 |

ORG_MEMBERS_MANAGE 加 SERVER_READ；账号须已加入同组织，服务器也须属于此组织。单服 roles 不可含 ORG_ADMIN；空数组撤销授权并保留记录。保留角色仍仅超管可调整。

写请求要求同源 Origin，Bearer 不能替代 Cookie。除图片上传外使用 application/json，必须包含正文。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `organizationId` | `path` | 是 | string (uuid) |  |  |
| `accountId` | `path` | 是 | string (uuid) |  |  |
| `serverId` | `path` | 是 | string | 正则：`"^[A-Za-z]{3,5}$"` |  |
| `Origin` | `header` | 是 | string |  | 当前网站的完整 origin；浏览器自动发送。 |

##### 请求体

必填：是。

- Content-Type：`application/json`；结构：[setServerGrant 请求体](#schema-inline-55)。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功；字段可见性仍受当前 RBAC 和资源状态约束。 | `application/json` → [unbindClient 200 响应](#schema-inline-24) | `Cache-Control`：string；规范示例：`"no-store"` |
| `400` | HTTP 400：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `401` | HTTP 401：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `403` | HTTP 403：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `404` | HTTP 404：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `409` | HTTP 409：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `413` | HTTP 413：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `415` | HTTP 415：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `422` | HTTP 422：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `429` | HTTP 429：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `500` | HTTP 500：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `503` | HTTP 503：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |

<a id="operation-createAccount"></a>

#### POST `/api/admin/accounts` — 创建白名单账号

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `createAccount` |
| 认证 | `SessionCookie` |
| 规范范围 | 完整规范 |
| 权限 | 未列出额外权限标识；仍执行认证、范围与运行时校验 |
| 仅超管 | 是 |
| 请求体上限 | 32768 字节 |

仅超管。用户名去首尾空白并转小写，3–64 位字母数字或 _. -；初始密码 12–128 字符。不要将真实密码填入文档示例或持久化调试配置。

写请求要求同源 Origin，Bearer 不能替代 Cookie。除图片上传外使用 application/json，必须包含正文。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `Origin` | `header` | 是 | string |  | 当前网站的完整 origin；浏览器自动发送。 |

##### 请求体

必填：是。

- Content-Type：`application/json`；结构：[createAccount 请求体](#schema-inline-56)。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `201` | 成功；字段可见性仍受当前 RBAC 和资源状态约束。 | `application/json` → [createOrganization 201 响应](#schema-inline-49) | `Cache-Control`：string；规范示例：`"no-store"` |
| `400` | HTTP 400：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `401` | HTTP 401：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `403` | HTTP 403：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `404` | HTTP 404：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `409` | HTTP 409：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `413` | HTTP 413：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `415` | HTTP 415：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `422` | HTTP 422：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `429` | HTTP 429：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `500` | HTTP 500：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `503` | HTTP 503：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |

<a id="operation-updateAccount"></a>

#### PATCH `/api/admin/accounts/{accountId}` — 修改账号状态、平台角色或重置密码

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `updateAccount` |
| 认证 | `SessionCookie` |
| 规范范围 | 完整规范 |
| 权限 | 未列出额外权限标识；仍执行认证、范围与运行时校验 |
| 仅超管 | 是 |
| 请求体上限 | 32768 字节 |

仅超管；至少保留一个 ACTIVE 超管。停用、变更超管标记或重置密码会撤销该账号会话；用户名不在允许字段内。

写请求要求同源 Origin，Bearer 不能替代 Cookie。除图片上传外使用 application/json，必须包含正文。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `accountId` | `path` | 是 | string (uuid) |  |  |
| `Origin` | `header` | 是 | string |  | 当前网站的完整 origin；浏览器自动发送。 |

##### 请求体

必填：是。

- Content-Type：`application/json`；结构：[updateAccount 请求体](#schema-inline-57)。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功；字段可见性仍受当前 RBAC 和资源状态约束。 | `application/json` → [unbindClient 200 响应](#schema-inline-24) | `Cache-Control`：string；规范示例：`"no-store"` |
| `400` | HTTP 400：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `401` | HTTP 401：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `403` | HTTP 403：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `404` | HTTP 404：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `409` | HTTP 409：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `413` | HTTP 413：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `415` | HTTP 415：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `422` | HTTP 422：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `429` | HTTP 429：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `500` | HTTP 500：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `503` | HTTP 503：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |

<a id="operation-revokeAccountCredentials"></a>

#### POST `/api/admin/accounts/{accountId}/revoke-credentials` — 撤销账号凭据

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `revokeAccountCredentials` |
| 认证 | `SessionCookie` |
| 规范范围 | 完整规范 |
| 权限 | 未列出额外权限标识；仍执行认证、范围与运行时校验 |
| 仅超管 | 是 |
| 请求体上限 | 32768 字节 |

仅限 MUA 超管浏览器会话。撤销目标账号全部浏览器和启动器会话、API Token 及已批准的启动器授权，返回影响数量并记录审计。不修改密码或上游 Token。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `accountId` | `path` | 是 | string (uuid) |  |  |
| `Origin` | `header` | 是 | string |  | 当前网站的完整 origin；浏览器自动发送。 |

##### 请求体

必填：是。

- Content-Type：`application/json`；结构：[revokeAccountCredentials 请求体](#schema-inline-58)。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功；字段可见性仍受当前 RBAC 和资源状态约束。 | `application/json` → [revokeAccountCredentials 200 响应](#schema-inline-59) | `Cache-Control`：string；规范示例：`"no-store"` |
| `400` | HTTP 400：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `401` | HTTP 401：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `403` | HTTP 403：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `404` | HTTP 404：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `409` | HTTP 409：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `413` | HTTP 413：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `415` | HTTP 415：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `422` | HTTP 422：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `429` | HTTP 429：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `500` | HTTP 500：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `503` | HTTP 503：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |

<a id="operation-getRecycleSettings"></a>

#### GET `/api/admin/recycle-settings` — 读取回收站保留期

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `getRecycleSettings` |
| 认证 | `SessionCookie` |
| 规范范围 | 完整规范 |
| 权限 | 未列出额外权限标识；仍执行认证、范围与运行时校验 |
| 仅超管 | 是 |

独立 GET／PATCH 均仅超管会话；普通账号从 /api/admin/state 读取可公开给后台账号的上传选项。整数 1–365 天，默认 7 天；缩短后已到期文件会在下一次 Worker 清理永久移除，共享引用仍受保护。

##### 参数

规范未声明路径、查询、Header 或 Cookie 参数；认证要求见上表。

##### 请求体

规范未声明请求体。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功；字段可见性仍受当前 RBAC 和资源状态约束。 | `application/json` → [getRecycleSettings 200 响应](#schema-inline-60) | `Cache-Control`：string；规范示例：`"no-store"` |
| `400` | HTTP 400：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `401` | HTTP 401：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `403` | HTTP 403：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `404` | HTTP 404：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `409` | HTTP 409：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `413` | HTTP 413：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `415` | HTTP 415：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `422` | HTTP 422：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `429` | HTTP 429：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `500` | HTTP 500：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `503` | HTTP 503：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |

<a id="operation-setRecycleSettings"></a>

#### PATCH `/api/admin/recycle-settings` — 修改回收站保留期

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `setRecycleSettings` |
| 认证 | `SessionCookie` |
| 规范范围 | 完整规范 |
| 权限 | 未列出额外权限标识；仍执行认证、范围与运行时校验 |
| 仅超管 | 是 |
| 请求体上限 | 32768 字节 |

整数 1–365 天，默认 7 天；缩短后已到期文件会在下一次 Worker 清理永久移除，共享引用仍受保护。修改写入审计。

写请求要求同源 Origin，Bearer 不能替代 Cookie。除图片上传外使用 application/json，必须包含正文。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `Origin` | `header` | 是 | string |  | 当前网站的完整 origin；浏览器自动发送。 |

##### 请求体

必填：是。

- Content-Type：`application/json`；结构：[getRecycleSettings 200 响应](#schema-inline-60)。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功；字段可见性仍受当前 RBAC 和资源状态约束。 | `application/json` → [getRecycleSettings 200 响应](#schema-inline-60) | `Cache-Control`：string；规范示例：`"no-store"` |
| `400` | HTTP 400：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `401` | HTTP 401：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `403` | HTTP 403：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `404` | HTTP 404：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `409` | HTTP 409：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `413` | HTTP 413：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `415` | HTTP 415：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `422` | HTTP 422：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `429` | HTTP 429：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `500` | HTTP 500：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `503` | HTTP 503：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |

<a id="operation-getUploadSizeSettings"></a>

#### GET `/api/admin/upload-size-settings` — 读取源包上传上限

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `getUploadSizeSettings` |
| 认证 | `SessionCookie` |
| 规范范围 | 完整规范 |
| 权限 | 未列出额外权限标识；仍执行认证、范围与运行时校验 |
| 仅超管 | 是 |

独立 GET／PATCH 均仅超管会话；普通账号从 /api/admin/state 读取可公开给后台账号的上传选项。整数 1–20480 MB，默认 1024 MB；1 MB=1024² 字节。只限制新建源包上传，不取消已有任务，不限制产物。

##### 参数

规范未声明路径、查询、Header 或 Cookie 参数；认证要求见上表。

##### 请求体

规范未声明请求体。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功；字段可见性仍受当前 RBAC 和资源状态约束。 | `application/json` → [getUploadSizeSettings 200 响应](#schema-inline-61) | `Cache-Control`：string；规范示例：`"no-store"` |
| `400` | HTTP 400：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `401` | HTTP 401：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `403` | HTTP 403：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `404` | HTTP 404：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `409` | HTTP 409：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `413` | HTTP 413：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `415` | HTTP 415：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `422` | HTTP 422：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `429` | HTTP 429：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `500` | HTTP 500：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `503` | HTTP 503：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |

<a id="operation-setUploadSizeSettings"></a>

#### PATCH `/api/admin/upload-size-settings` — 修改源包上传上限

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `setUploadSizeSettings` |
| 认证 | `SessionCookie` |
| 规范范围 | 完整规范 |
| 权限 | 未列出额外权限标识；仍执行认证、范围与运行时校验 |
| 仅超管 | 是 |
| 请求体上限 | 32768 字节 |

整数 1–20480 MB，默认 1024 MB；1 MB=1024² 字节。只限制新建源包上传，不取消已有任务，不限制产物。修改写入审计。

写请求要求同源 Origin，Bearer 不能替代 Cookie。除图片上传外使用 application/json，必须包含正文。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `Origin` | `header` | 是 | string |  | 当前网站的完整 origin；浏览器自动发送。 |

##### 请求体

必填：是。

- Content-Type：`application/json`；结构：[getUploadSizeSettings 200 响应](#schema-inline-61)。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功；字段可见性仍受当前 RBAC 和资源状态约束。 | `application/json` → [getUploadSizeSettings 200 响应](#schema-inline-61) | `Cache-Control`：string；规范示例：`"no-store"` |
| `400` | HTTP 400：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `401` | HTTP 401：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `403` | HTTP 403：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `404` | HTTP 404：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `409` | HTTP 409：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `413` | HTTP 413：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `415` | HTTP 415：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `422` | HTTP 422：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `429` | HTTP 429：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `500` | HTTP 500：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `503` | HTTP 503：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |

<a id="operation-getPackageFormatSettings"></a>

#### GET `/api/admin/package-format-settings` — 读取开放的 muapack 格式

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `getPackageFormatSettings` |
| 认证 | `SessionCookie` |
| 规范范围 | 完整规范 |
| 权限 | 未列出额外权限标识；仍执行认证、范围与运行时校验 |
| 仅超管 | 是 |

独立 GET／PATCH 均仅超管会话；普通账号从 /api/admin/state 读取可公开给后台账号的上传选项。默认 [1,2]，至少保留一种、不能重复。关闭仅阻止新建上传，不取消已有任务或下架历史。

##### 参数

规范未声明路径、查询、Header 或 Cookie 参数；认证要求见上表。

##### 请求体

规范未声明请求体。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功；字段可见性仍受当前 RBAC 和资源状态约束。 | `application/json` → [getPackageFormatSettings 200 响应](#schema-inline-62) | `Cache-Control`：string；规范示例：`"no-store"` |
| `400` | HTTP 400：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `401` | HTTP 401：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `403` | HTTP 403：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `404` | HTTP 404：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `409` | HTTP 409：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `413` | HTTP 413：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `415` | HTTP 415：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `422` | HTTP 422：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `429` | HTTP 429：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `500` | HTTP 500：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `503` | HTTP 503：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |

<a id="operation-setPackageFormatSettings"></a>

#### PATCH `/api/admin/package-format-settings` — 修改开放的 muapack 格式

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `setPackageFormatSettings` |
| 认证 | `SessionCookie` |
| 规范范围 | 完整规范 |
| 权限 | 未列出额外权限标识；仍执行认证、范围与运行时校验 |
| 仅超管 | 是 |
| 请求体上限 | 32768 字节 |

默认 [1,2]，至少保留一种、不能重复。关闭仅阻止新建上传，不取消已有任务或下架历史。修改写入审计。

写请求要求同源 Origin，Bearer 不能替代 Cookie。除图片上传外使用 application/json，必须包含正文。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `Origin` | `header` | 是 | string |  | 当前网站的完整 origin；浏览器自动发送。 |

##### 请求体

必填：是。

- Content-Type：`application/json`；结构：[getPackageFormatSettings 200 响应](#schema-inline-62)。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功；字段可见性仍受当前 RBAC 和资源状态约束。 | `application/json` → [getPackageFormatSettings 200 响应](#schema-inline-62) | `Cache-Control`：string；规范示例：`"no-store"` |
| `400` | HTTP 400：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `401` | HTTP 401：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `403` | HTTP 403：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `404` | HTTP 404：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `409` | HTTP 409：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `413` | HTTP 413：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `415` | HTTP 415：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `422` | HTTP 422：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `429` | HTTP 429：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `500` | HTTP 500：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `503` | HTTP 503：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |

<a id="operation-getDownloadSettings"></a>

#### GET `/api/admin/download-settings` — 读取 Worker 下载与代理设置

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `getDownloadSettings` |
| 认证 | `SessionCookie` |
| 规范范围 | 完整规范 |
| 权限 | 未列出额外权限标识；仍执行认证、范围与运行时校验 |
| 仅超管 | 是 |

仅超管会话；返回当前域名白名单、代理、镜像和 Java 镜像类型。

##### 参数

规范未声明路径、查询、Header 或 Cookie 参数；认证要求见上表。

##### 请求体

规范未声明请求体。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功；字段可见性仍受当前 RBAC 和资源状态约束。 | `application/json` → [getDownloadSettings 200 响应](#schema-inline-63) | `Cache-Control`：string；规范示例：`"no-store"` |
| `400` | HTTP 400：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `401` | HTTP 401：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `403` | HTTP 403：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `404` | HTTP 404：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `409` | HTTP 409：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `413` | HTTP 413：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `415` | HTTP 415：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `422` | HTTP 422：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `429` | HTTP 429：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `500` | HTTP 500：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `503` | HTTP 503：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |

<a id="operation-setDownloadSettings"></a>

#### PATCH `/api/admin/download-settings` — 修改 Worker 下载与代理设置

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `setDownloadSettings` |
| 认证 | `SessionCookie` |
| 规范范围 | 完整规范 |
| 权限 | 未列出额外权限标识；仍执行认证、范围与运行时校验 |
| 仅超管 | 是 |
| 请求体上限 | 32768 字节 |

仅超管并审计。旧调用可省略镜像相关字段，保留当前值；启用总代理必须提供无凭据的 HTTP(S) 主机／端口 URL。关闭白名单仍保留 HTTPS、公网地址、DNS 固定、重定向及哈希保护。mirrorProxyEnabled 还要求总代理启用；MinIO 不经过代理。默认 JRE，只有超管可选择 JDK。

写请求要求同源 Origin，Bearer 不能替代 Cookie。除图片上传外使用 application/json，必须包含正文。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `Origin` | `header` | 是 | string |  | 当前网站的完整 origin；浏览器自动发送。 |

##### 请求体

必填：是。

- Content-Type：`application/json`；结构：[setDownloadSettings 请求体](#schema-inline-64)。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功；字段可见性仍受当前 RBAC 和资源状态约束。 | `application/json` → [getDownloadSettings 200 响应](#schema-inline-63) | `Cache-Control`：string；规范示例：`"no-store"` |
| `400` | HTTP 400：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `401` | HTTP 401：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `403` | HTTP 403：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `404` | HTTP 404：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `409` | HTTP 409：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `413` | HTTP 413：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `415` | HTTP 415：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `422` | HTTP 422：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `429` | HTTP 429：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `500` | HTTP 500：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `503` | HTTP 503：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |

<a id="operation-probeServer"></a>

#### GET `/api/admin/servers/{serverId}/probe` — 读取真实 Minecraft 连接探测

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `probeServer` |
| 认证 | `SessionCookie` |
| 规范范围 | 完整规范 |
| 权限 | `SERVER_READ` |
| 仅超管 | 否 |

SERVER_READ，在探测前及返回前再次检查范围。仅探测已保存地址，固定公网 DNS、SRV、超时、缓存和并发保护保留。ONLINE 为确认 MC 且低延迟，默认 ≥300ms 为 HIGH_LATENCY；无配置、归档或服务错误为 UNKNOWN。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `serverId` | `path` | 是 | string | 正则：`"^[A-Za-z]{3,5}$"` |  |

##### 请求体

规范未声明请求体。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功；字段可见性仍受当前 RBAC 和资源状态约束。 | `application/json` → [ServerProbe](#schema-serverprobe) | `Cache-Control`：string；规范示例：`"no-store"` |
| `400` | HTTP 400：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `401` | HTTP 401：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `403` | HTTP 403：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `404` | HTTP 404：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `409` | HTTP 409：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `413` | HTTP 413：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `415` | HTTP 415：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `422` | HTTP 422：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `429` | HTTP 429：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `500` | HTTP 500：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `503` | HTTP 503：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |

<a id="operation-getServerMotto"></a>

#### GET `/api/admin/servers/{serverId}/motto-image` — 读取服务器箴言图片、原图或选区

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `getServerMotto` |
| 认证 | `SessionCookie` |
| 规范范围 | 完整规范 |
| 权限 | `SERVER_READ` |
| 仅超管 | 否 |

SERVER_READ；variant=image／source 返回 image/webp 二进制，metadata 返回 JSON。version 可选，为当前图片对象目录中的 UUID，变化返回 409。原图已归一化为 WebP，可重裁剪。私有读取 Cache-Control: private, no-store。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `serverId` | `path` | 是 | string | 正则：`"^[A-Za-z]{3,5}$"` |  |
| `variant` | `query` | 否 | string | 可选值：`["image","source","metadata"]`<br>默认值：`"image"` |  |
| `version` | `query` | 否 | string (uuid) |  |  |

##### 请求体

规范未声明请求体。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功；字段可见性仍受当前 RBAC 和资源状态约束。 | `application/json` → [MottoMetadata](#schema-mottometadata)<br>`image/webp` → [getServerMotto 200 响应](#schema-inline-65) | `Cache-Control`：string；规范示例：`"no-store"` |
| `400` | HTTP 400：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `401` | HTTP 401：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `403` | HTTP 403：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `404` | HTTP 404：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `409` | HTTP 409：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `413` | HTTP 413：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `415` | HTTP 415：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `422` | HTTP 422：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `429` | HTTP 429：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `500` | HTTP 500：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `503` | HTTP 503：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |

<a id="operation-uploadServerMotto"></a>

#### POST `/api/admin/servers/{serverId}/motto-image` — 上传或重新裁剪服务器箴言图片

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `uploadServerMotto` |
| 认证 | `SessionCookie` |
| 规范范围 | 完整规范 |
| 权限 | `SERVER_EDIT` |
| 仅超管 | 否 |
| 请求体上限 | 8454144 字节 |

SERVER_EDIT；multipart/form-data 字段 crop 和 expectedIconObjectKey 均为 JSON 编码文本（空对象键必须填 null 文本），不是嵌套表单对象。source 可省略以使用保留原图重裁剪；新 source 为静态 PNG／JPEG／WebP，最多 8 MiB／1600 万像素。固定 2.35:1，服务器复核选区和归属，存储完成后再次检查会话、范围和修订。

写请求要求同源 Origin，Bearer 不能替代 Cookie。除图片上传外使用 application/json，必须包含正文。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `serverId` | `path` | 是 | string | 正则：`"^[A-Za-z]{3,5}$"` |  |
| `Origin` | `header` | 是 | string |  | 当前网站的完整 origin；浏览器自动发送。 |

##### 请求体

必填：是。

- Content-Type：`multipart/form-data`；结构：[uploadServerMotto 请求体](#schema-inline-66)。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功；字段可见性仍受当前 RBAC 和资源状态约束。 | `application/json` → [uploadServerMotto 200 响应](#schema-inline-67) | `Cache-Control`：string；规范示例：`"no-store"` |
| `400` | HTTP 400：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `401` | HTTP 401：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `403` | HTTP 403：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `404` | HTTP 404：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `409` | HTTP 409：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `413` | HTTP 413：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `415` | HTTP 415：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `422` | HTTP 422：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `429` | HTTP 429：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `500` | HTTP 500：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `503` | HTTP 503：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |

<a id="operation-removeServerMotto"></a>

#### DELETE `/api/admin/servers/{serverId}/motto-image` — 移除当前服务器箴言图片

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `removeServerMotto` |
| 认证 | `SessionCookie` |
| 规范范围 | 完整规范 |
| 权限 | `SERVER_EDIT` |
| 仅超管 | 否 |
| 请求体上限 | 32768 字节 |

SERVER_EDIT；expectedIconObjectKey 必须匹配当前对象键，变化返回 409。移除绑定后旧 OSS 图片保留，本操作不改发布签名。

写请求要求同源 Origin，Bearer 不能替代 Cookie。除图片上传外使用 application/json，必须包含正文。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `serverId` | `path` | 是 | string | 正则：`"^[A-Za-z]{3,5}$"` |  |
| `Origin` | `header` | 是 | string |  | 当前网站的完整 origin；浏览器自动发送。 |

##### 请求体

必填：是。

- Content-Type：`application/json`；结构：[removeServerMotto 请求体](#schema-inline-68)。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功；字段可见性仍受当前 RBAC 和资源状态约束。 | `application/json` → [uploadServerMotto 200 响应](#schema-inline-67) | `Cache-Control`：string；规范示例：`"no-store"` |
| `400` | HTTP 400：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `401` | HTTP 401：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `403` | HTTP 403：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `404` | HTTP 404：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `409` | HTTP 409：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `413` | HTTP 413：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `415` | HTTP 415：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `422` | HTTP 422：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `429` | HTTP 429：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `500` | HTTP 500：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `503` | HTTP 503：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |

<a id="operation-listLauncherProvidersAdmin"></a>

#### GET `/api/admin/launcher-providers` — 超管读取启动器认证来源配置

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `listLauncherProvidersAdmin` |
| 认证 | `SessionCookie` |
| 规范范围 | 完整规范 |
| 仅超管 | 是 |

OAuth 使用独立五分钟 Lax Cookie、一次性 state 和 S256 PKCE；Launcher 会话仅成员读取。跨组织申请和审批使用有权限的管理员 Cookie 与同源校验，范围及自动新增选项绑定审批修订。

##### 参数

规范未声明路径、查询、Header 或 Cookie 参数；认证要求见上表。

##### 请求体

规范未声明请求体。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功响应；权限逐请求检查。 | `application/json` → [listLauncherProvidersAdmin 200 响应](#schema-inline-69) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `400` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `401` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `403` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `404` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `409` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `413` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `415` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `422` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `429` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `500` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `502` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `503` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |

<a id="operation-saveLauncherProvider"></a>

#### PUT `/api/admin/launcher-providers` — 超管核准或停用启动器认证来源

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `saveLauncherProvider` |
| 认证 | `SessionCookie` |
| 规范范围 | 完整规范 |
| 仅超管 | 是 |

仅超管 Cookie 且同源。新建使用随机 UUID 和 revision=0，修改携带当前 revision。来源必须对应目录主地址或别名，身份 CODE/地址创建后不能改写；认证根地址固定为 bsRoot + /api/yggdrasil。须确认实际 OAuth UID 对应关系和上游日志脱敏，并记录版本/验收说明。保存递增修订，使旧来源会话失效；目录变动须重新核准。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `Origin` | `header` | 是 | string |  |  |

##### 请求体

必填：是。

- Content-Type：`application/json`；结构：[saveLauncherProvider 请求体](#schema-inline-70)。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功响应；权限逐请求检查。 | `application/json` → [saveLauncherProvider 200 响应](#schema-inline-71) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `400` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `401` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `403` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `404` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `409` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `413` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `415` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `422` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `429` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `500` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `502` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `503` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |

<a id="operation-getUnionSync"></a>

#### GET `/api/admin/union-sync` — 读取联盟目录同步状态

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `getUnionSync` |
| 认证 | `SessionCookie` |
| 规范范围 | 完整规范 |
| 仅超管 | 是 |

OAuth 使用独立五分钟 Lax Cookie、一次性 state 和 S256 PKCE；Launcher 会话仅成员读取。跨组织申请和审批使用有权限的管理员 Cookie 与同源校验，范围及自动新增选项绑定审批修订。

##### 参数

规范未声明路径、查询、Header 或 Cookie 参数；认证要求见上表。

##### 请求体

规范未声明请求体。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功响应；权限逐请求检查。 | `application/json` → [getUnionSync 200 响应](#schema-inline-72) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `400` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `401` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `403` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `404` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `409` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `413` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `415` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `422` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `429` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `500` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `502` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `503` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |

<a id="operation-requestUnionSync"></a>

#### POST `/api/admin/union-sync` — 安排立即同步联盟目录

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `requestUnionSync` |
| 认证 | `SessionCookie` |
| 规范范围 | 完整规范 |
| 仅超管 | 是 |

OAuth 使用独立五分钟 Lax Cookie、一次性 state 和 S256 PKCE；Launcher 会话仅成员读取。跨组织申请和审批使用有权限的管理员 Cookie 与同源校验，范围及自动新增选项绑定审批修订。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `Origin` | `header` | 是 | string |  |  |

##### 请求体

必填：是。

- Content-Type：`application/json`；结构：[revokeAccountCredentials 请求体](#schema-inline-58)。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功响应；权限逐请求检查。 | `application/json` → [requestUnionSync 200 响应](#schema-inline-73) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `400` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `401` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `403` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `404` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `409` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `413` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `415` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `422` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `429` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `500` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `502` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `503` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |

<a id="operation-getOrganizationAvatar"></a>

#### GET `/api/admin/organizations/{organizationId}/avatar-image` — 读取组织头像、原图或裁剪资料

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `getOrganizationAvatar` |
| 认证 | `SessionCookie` |
| 规范范围 | 完整规范 |
| 仅超管 | 否 |

OAuth 使用独立五分钟 Lax Cookie、一次性 state 和 S256 PKCE；Launcher 会话仅成员读取。跨组织申请和审批使用有权限的管理员 Cookie 与同源校验，范围及自动新增选项绑定审批修订。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `organizationId` | `path` | 是 | string (uuid) |  |  |
| `variant` | `query` | 否 | string | 可选值：`["image","source","metadata"]` |  |
| `version` | `query` | 否 | string |  |  |

##### 请求体

规范未声明请求体。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功响应；权限逐请求检查。 | `application/json` → [getOrganizationAvatar 200 响应](#schema-inline-74)<br>`image/webp` → [getServerMotto 200 响应](#schema-inline-65) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `400` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `401` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `403` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `404` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `409` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `413` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `415` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `422` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `429` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `500` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `502` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `503` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |

<a id="operation-uploadOrganizationAvatar"></a>

#### POST `/api/admin/organizations/{organizationId}/avatar-image` — 上传或重新裁剪组织头像

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `uploadOrganizationAvatar` |
| 认证 | `SessionCookie` |
| 规范范围 | 完整规范 |
| 仅超管 | 否 |

OAuth 使用独立五分钟 Lax Cookie、一次性 state 和 S256 PKCE；Launcher 会话仅成员读取。跨组织申请和审批使用有权限的管理员 Cookie 与同源校验，范围及自动新增选项绑定审批修订。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `organizationId` | `path` | 是 | string (uuid) |  |  |
| `Origin` | `header` | 是 | string |  |  |

##### 请求体

必填：是。

- Content-Type：`multipart/form-data`；结构：[uploadOrganizationAvatar 请求体](#schema-inline-75)。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功响应；权限逐请求检查。 | `application/json` → [uploadOrganizationAvatar 200 响应](#schema-inline-76) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `400` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `401` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `403` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `404` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `409` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `413` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `415` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `422` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `429` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `500` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `502` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `503` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |

<a id="operation-removeOrganizationAvatar"></a>

#### DELETE `/api/admin/organizations/{organizationId}/avatar-image` — 移除组织头像并保留人工选择

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `removeOrganizationAvatar` |
| 认证 | `SessionCookie` |
| 规范范围 | 完整规范 |
| 仅超管 | 否 |

OAuth 使用独立五分钟 Lax Cookie、一次性 state 和 S256 PKCE；Launcher 会话仅成员读取。跨组织申请和审批使用有权限的管理员 Cookie 与同源校验，范围及自动新增选项绑定审批修订。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `organizationId` | `path` | 是 | string (uuid) |  |  |
| `Origin` | `header` | 是 | string |  |  |

##### 请求体

必填：是。

- Content-Type：`application/json`；结构：[removeOrganizationAvatar 请求体](#schema-inline-77)。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功响应；权限逐请求检查。 | `application/json` → [uploadOrganizationAvatar 200 响应](#schema-inline-76) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `400` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `401` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `403` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `404` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `409` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `413` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `415` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `422` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `429` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `500` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `502` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `503` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |

<a id="operation-listUnionSites"></a>

#### GET `/api/admin/union-sites` — 列出皮肤站组织映射

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `listUnionSites` |
| 认证 | `SessionCookie` |
| 规范范围 | 完整规范 |
| 仅超管 | 是 |

OAuth 使用独立五分钟 Lax Cookie、一次性 state 和 S256 PKCE；Launcher 会话仅成员读取。跨组织申请和审批使用有权限的管理员 Cookie 与同源校验，范围及自动新增选项绑定审批修订。

##### 参数

规范未声明路径、查询、Header 或 Cookie 参数；认证要求见上表。

##### 请求体

规范未声明请求体。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功响应；权限逐请求检查。 | `application/json` → [listUnionSites 200 响应](#schema-inline-78) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `400` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `401` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `403` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `404` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `409` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `413` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `415` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `422` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `429` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `500` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `502` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `503` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |

<a id="operation-saveUnionSite"></a>

#### PUT `/api/admin/union-sites` — 保存皮肤站组织映射

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `saveUnionSite` |
| 认证 | `SessionCookie` |
| 规范范围 | 完整规范 |
| 仅超管 | 是 |

OAuth 使用独立五分钟 Lax Cookie、一次性 state 和 S256 PKCE；Launcher 会话仅成员读取。跨组织申请和审批使用有权限的管理员 Cookie 与同源校验，范围及自动新增选项绑定审批修订。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `Origin` | `header` | 是 | string |  |  |

##### 请求体

必填：是。

- Content-Type：`application/json`；结构：[saveUnionSite 请求体](#schema-inline-79)。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功响应；权限逐请求检查。 | `application/json` → [saveUnionSite 200 响应](#schema-inline-80) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `400` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `401` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `403` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `404` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `409` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `413` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `415` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `422` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `429` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `500` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `502` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `503` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |

<a id="operation-getAccessCandidates"></a>

#### GET `/api/admin/access/candidates` — 列出跨组织访问候选资源

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `getAccessCandidates` |
| 认证 | `SessionCookie` |
| 规范范围 | 完整规范 |
| 仅超管 | 否 |

OAuth 使用独立五分钟 Lax Cookie、一次性 state 和 S256 PKCE；Launcher 会话仅成员读取。跨组织申请和审批使用有权限的管理员 Cookie 与同源校验，范围及自动新增选项绑定审批修订。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `sourceOrganizationId` | `query` | 是 | string (uuid) |  |  |
| `targetOrganizationId` | `query` | 否 | string (uuid) |  |  |

##### 请求体

规范未声明请求体。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功响应；权限逐请求检查。 | `application/json` → [getAccessCandidates 200 响应](#schema-inline-81) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `400` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `401` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `403` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `404` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `409` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `413` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `415` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `422` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `429` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `500` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `502` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `503` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |

<a id="operation-listAccessRequests"></a>

#### GET `/api/admin/access/requests` — 列出访问申请与授权

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `listAccessRequests` |
| 认证 | `SessionCookie` |
| 规范范围 | 完整规范 |
| 仅超管 | 否 |

OAuth 使用独立五分钟 Lax Cookie、一次性 state 和 S256 PKCE；Launcher 会话仅成员读取。跨组织申请和审批使用有权限的管理员 Cookie 与同源校验，范围及自动新增选项绑定审批修订。

##### 参数

规范未声明路径、查询、Header 或 Cookie 参数；认证要求见上表。

##### 请求体

规范未声明请求体。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功响应；权限逐请求检查。 | `application/json` → [listAccessRequests 200 响应](#schema-inline-82) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `400` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `401` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `403` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `404` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `409` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `413` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `415` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `422` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `429` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `500` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `502` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `503` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |

<a id="operation-submitAccessRequest"></a>

#### POST `/api/admin/access/requests` — 为本组织成员申请访问

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `submitAccessRequest` |
| 认证 | `SessionCookie` |
| 规范范围 | 完整规范 |
| 仅超管 | 否 |

OAuth 使用独立五分钟 Lax Cookie、一次性 state 和 S256 PKCE；Launcher 会话仅成员读取。跨组织申请和审批使用有权限的管理员 Cookie 与同源校验，范围及自动新增选项绑定审批修订。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `Origin` | `header` | 是 | string |  |  |

##### 请求体

必填：是。

- Content-Type：`application/json`；结构：[submitAccessRequest 请求体](#schema-inline-83)。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `201` | 成功响应；权限逐请求检查。 | `application/json` → [createOrganization 201 响应](#schema-inline-49) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `400` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `401` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `403` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `404` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `409` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `413` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `415` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `422` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `429` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `500` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `502` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `503` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |

<a id="operation-decideAccessRequest"></a>

#### POST `/api/admin/access/requests/{id}` — 审批或取消访问申请

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `decideAccessRequest` |
| 认证 | `SessionCookie` |
| 规范范围 | 完整规范 |
| 仅超管 | 否 |

OAuth 使用独立五分钟 Lax Cookie、一次性 state 和 S256 PKCE；Launcher 会话仅成员读取。跨组织申请和审批使用有权限的管理员 Cookie 与同源校验，范围及自动新增选项绑定审批修订。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `id` | `path` | 是 | string (uuid) |  |  |
| `Origin` | `header` | 是 | string |  |  |

##### 请求体

必填：是。

- Content-Type：`application/json`；结构：[decideAccessRequest 请求体](#schema-inline-84)。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功响应；权限逐请求检查。 | `application/json` → [requestUnionSync 200 响应](#schema-inline-73) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `400` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `401` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `403` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `404` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `409` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `413` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `415` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `422` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `429` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `500` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `502` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `503` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |

<a id="operation-revokeAccessGrant"></a>

#### POST `/api/admin/access/grants/{id}/revoke` — 撤销跨组织访问授权

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `revokeAccessGrant` |
| 认证 | `SessionCookie` |
| 规范范围 | 完整规范 |
| 仅超管 | 否 |

OAuth 使用独立五分钟 Lax Cookie、一次性 state 和 S256 PKCE；Launcher 会话仅成员读取。跨组织申请和审批使用有权限的管理员 Cookie 与同源校验，范围及自动新增选项绑定审批修订。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `id` | `path` | 是 | string (uuid) |  |  |
| `Origin` | `header` | 是 | string |  |  |

##### 请求体

必填：是。

- Content-Type：`application/json`；结构：[revokeAccessGrant 请求体](#schema-inline-85)。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功响应；权限逐请求检查。 | `application/json` → [requestUnionSync 200 响应](#schema-inline-73) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `400` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `401` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `403` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `404` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `409` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `413` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `415` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `422` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `429` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `500` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `502` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `503` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |

### 认证与会话

<a id="operation-listLauncherProviders"></a>

#### GET `/api/auth/launcher/providers` — 列出已核准的启动器认证来源

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `listLauncherProviders` |
| 认证 | 无需认证 |
| 规范范围 | 完整规范及公开规范 |
| 仅超管 | 否 |

匿名读取安全投影，仅返回已核准且有效的来源。Cookie 不参与账号选择，不接受 Authorization 或查询参数；目录同步不会自动启用新认证地址。空数组表示尚无来源通过核准，可使用浏览器登录桥接。

##### 参数

规范未声明路径、查询、Header 或 Cookie 参数；认证要求见上表。

##### 请求体

规范未声明请求体。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功响应；权限逐请求检查。 | `application/json` → [listLauncherProviders 200 响应](#schema-inline-86) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `400` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [listLauncherProviders 400 响应](#schema-inline-87) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `401` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [listLauncherProviders 400 响应](#schema-inline-87) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `403` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [listLauncherProviders 400 响应](#schema-inline-87) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `404` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [listLauncherProviders 400 响应](#schema-inline-87) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `409` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [listLauncherProviders 400 响应](#schema-inline-87) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `413` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [listLauncherProviders 400 响应](#schema-inline-87) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `415` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [listLauncherProviders 400 响应](#schema-inline-87) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `422` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [listLauncherProviders 400 响应](#schema-inline-87) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `429` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [listLauncherProviders 400 响应](#schema-inline-87) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `500` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [listLauncherProviders 400 响应](#schema-inline-87) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `502` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [listLauncherProviders 400 响应](#schema-inline-87) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `503` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [listLauncherProviders 400 响应](#schema-inline-87) | `Cache-Control`：string；固定值：`"private, no-store"` |

<a id="operation-startLauncherGameLogin"></a>

#### POST `/api/auth/launcher/yggdrasil/start` — 创建游戏令牌换票请求

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `startLauncherGameLogin` |
| 认证 | 无需认证 |
| 规范范围 | 完整规范及公开规范 |
| 仅超管 | 否 |
| 请求体上限 | 32768 字节 |

玩家手动选站并完成游戏角色选择后调用。S256 verifier 为 32 字节随机值的 base64url，仅存启动器内存；请求 120 秒有效。仅 JSON POST，不接受 Cookie 身份或 Authorization，不允许自选认证 URL。

##### 参数

规范未声明路径、查询、Header 或 Cookie 参数；认证要求见上表。

##### 请求体

必填：是。

- Content-Type：`application/json`；结构：[startLauncherGameLogin 请求体](#schema-inline-88)。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `201` | 成功响应；权限逐请求检查。 | `application/json` → [startLauncherGameLogin 201 响应](#schema-inline-89) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `400` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [listLauncherProviders 400 响应](#schema-inline-87) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `401` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [listLauncherProviders 400 响应](#schema-inline-87) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `403` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [listLauncherProviders 400 响应](#schema-inline-87) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `404` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [listLauncherProviders 400 响应](#schema-inline-87) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `409` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [listLauncherProviders 400 响应](#schema-inline-87) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `413` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [listLauncherProviders 400 响应](#schema-inline-87) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `415` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [listLauncherProviders 400 响应](#schema-inline-87) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `422` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [listLauncherProviders 400 响应](#schema-inline-87) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `429` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [listLauncherProviders 400 响应](#schema-inline-87) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `500` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [listLauncherProviders 400 响应](#schema-inline-87) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `502` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [listLauncherProviders 400 响应](#schema-inline-87) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `503` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [listLauncherProviders 400 响应](#schema-inline-87) | `Cache-Control`：string；固定值：`"private, no-store"` |

<a id="operation-exchangeLauncherGameLogin"></a>

#### POST `/api/auth/launcher/yggdrasil/exchange` — 验证游戏身份并签发 Launcher Token

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `exchangeLauncherGameLogin` |
| 认证 | 无需认证 |
| 规范范围 | 完整规范及公开规范 |
| 仅超管 | 否 |
| 请求体上限 | 32768 字节 |

一次性验证 nonce/verifier、固定来源在线验票、账号 UID 与选中角色归属。gameProfile 是待核对声明，不是登录凭据；通过验证的 CODE:UID 才用于关联本地账号。只支持已核准的新版本 MUA Yggdrasil Connect 适配器；不兼容的旧版使用浏览器桥接。Token 仅只读，有效期不超过 900 秒且早于上游到期 30 秒；不签发 refresh token、不设置网页登录 Cookie。请求不超过 32768 字节，游戏令牌不超过 16384 字符，拒绝额外字段、查询参数及 Authorization；敏感请求/响应必须脱敏且不缓存。重复或丢失响应应新建 attempt；上游撤销的本地传播窗口最长为剩余 15 分钟。

##### 参数

规范未声明路径、查询、Header 或 Cookie 参数；认证要求见上表。

##### 请求体

必填：是。

- Content-Type：`application/json`；结构：[exchangeLauncherGameLogin 请求体](#schema-inline-90)。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功响应；权限逐请求检查。 | `application/json` → [exchangeLauncherGameLogin 200 响应](#schema-inline-91) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `400` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [listLauncherProviders 400 响应](#schema-inline-87) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `401` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [listLauncherProviders 400 响应](#schema-inline-87) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `403` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [listLauncherProviders 400 响应](#schema-inline-87) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `404` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [listLauncherProviders 400 响应](#schema-inline-87) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `409` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [listLauncherProviders 400 响应](#schema-inline-87) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `413` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [listLauncherProviders 400 响应](#schema-inline-87) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `415` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [listLauncherProviders 400 响应](#schema-inline-87) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `422` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [listLauncherProviders 400 响应](#schema-inline-87) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `429` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [listLauncherProviders 400 响应](#schema-inline-87) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `500` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [listLauncherProviders 400 响应](#schema-inline-87) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `502` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [listLauncherProviders 400 响应](#schema-inline-87) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `503` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [listLauncherProviders 400 响应](#schema-inline-87) | `Cache-Control`：string；固定值：`"private, no-store"` |

<a id="operation-startLauncherLogin"></a>

#### POST `/api/auth/launcher/start` — 创建 Launcher 登录请求

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `startLauncherLogin` |
| 认证 | 无需认证 |
| 规范范围 | 完整规范及公开规范 |
| 仅超管 | 否 |

OAuth 使用独立五分钟 Lax Cookie、一次性 state 和 S256 PKCE；Launcher 会话仅成员读取。跨组织申请和审批使用有权限的管理员 Cookie 与同源校验，范围及自动新增选项绑定审批修订。

##### 参数

规范未声明路径、查询、Header 或 Cookie 参数；认证要求见上表。

##### 请求体

必填：是。

- Content-Type：`application/json`；结构：[startLauncherLogin 请求体](#schema-inline-92)。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `201` | 成功响应；权限逐请求检查。 | `application/json` → [startLauncherLogin 201 响应](#schema-inline-93) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `400` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `401` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `403` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `404` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `409` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `413` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `415` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `422` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `429` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `500` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `502` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `503` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |

<a id="operation-claimLauncherLogin"></a>

#### POST `/api/auth/launcher/claim` — 领取 Launcher 只读会话

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `claimLauncherLogin` |
| 认证 | 无需认证 |
| 规范范围 | 完整规范及公开规范 |
| 仅超管 | 否 |

OAuth 使用独立五分钟 Lax Cookie、一次性 state 和 S256 PKCE；Launcher 会话仅成员读取。跨组织申请和审批使用有权限的管理员 Cookie 与同源校验，范围及自动新增选项绑定审批修订。

##### 参数

规范未声明路径、查询、Header 或 Cookie 参数；认证要求见上表。

##### 请求体

必填：是。

- Content-Type：`application/json`；结构：[claimLauncherLogin 请求体](#schema-inline-94)。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功响应；权限逐请求检查。 | `application/json` → [claimLauncherLogin 200 响应](#schema-inline-95) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `202` | 成功响应；权限逐请求检查。 | `application/json` → [claimLauncherLogin 200 响应](#schema-inline-95) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `400` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `401` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `403` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `404` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `409` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `413` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `415` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `422` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `429` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `500` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `502` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `503` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |

<a id="operation-logoutLauncher"></a>

#### POST `/api/auth/launcher/logout` — 撤销当前 Launcher 会话

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `logoutLauncher` |
| 认证 | `LauncherToken` |
| 规范范围 | 完整规范及公开规范 |
| 仅超管 | 否 |

OAuth 使用独立五分钟 Lax Cookie、一次性 state 和 S256 PKCE；Launcher 会话仅成员读取。跨组织申请和审批使用有权限的管理员 Cookie 与同源校验，范围及自动新增选项绑定审批修订。

##### 参数

规范未声明路径、查询、Header 或 Cookie 参数；认证要求见上表。

##### 请求体

规范未声明请求体。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功响应；权限逐请求检查。 | `application/json` → [requestUnionSync 200 响应](#schema-inline-73) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `400` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `401` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `403` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `404` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `409` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `413` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `415` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `422` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `429` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `500` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `502` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `503` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |

<a id="operation-getMemberDirectory"></a>

#### GET `/api/member` — 读取成员身份与资源目录

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `getMemberDirectory` |
| 认证 | `SessionCookie` 或 `LauncherToken` |
| 规范范围 | 完整规范及公开规范 |
| 仅超管 | 否 |

OAuth 使用独立五分钟 Lax Cookie、一次性 state 和 S256 PKCE；Launcher 会话仅成员读取。跨组织申请和审批使用有权限的管理员 Cookie 与同源校验，范围及自动新增选项绑定审批修订。

##### 参数

规范未声明路径、查询、Header 或 Cookie 参数；认证要求见上表。

##### 请求体

规范未声明请求体。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功响应；权限逐请求检查。 | `application/json` → [getMemberDirectory 200 响应](#schema-inline-96) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `400` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `401` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `403` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `404` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `409` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `413` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `415` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `422` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `429` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `500` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `502` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `503` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |

<a id="operation-revokeOwnCredentials"></a>

#### POST `/api/auth/revoke-credentials` — 撤销本人凭据

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `revokeOwnCredentials` |
| 认证 | `SessionCookie` |
| 规范范围 | 完整规范 |
| 权限 | 未列出额外权限标识；仍执行认证、范围与运行时校验 |
| 仅超管 | 否 |
| 请求体上限 | 32768 字节 |

仅限浏览器会话，普通成员也可使用。原子撤销全部浏览器和启动器会话、API Token 及已批准的启动器授权，并清除当前会话 Cookie。不修改密码或上游皮肤站 Token。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `Origin` | `header` | 是 | string |  | 当前网站的完整 origin；浏览器自动发送。 |

##### 请求体

必填：是。

- Content-Type：`application/json`；结构：[revokeAccountCredentials 请求体](#schema-inline-58)。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功；字段可见性仍受当前 RBAC 和资源状态约束。 | `application/json` → [revokeAccountCredentials 200 响应](#schema-inline-59) | `Cache-Control`：string；规范示例：`"no-store"`<br>`Set-Cookie`：string；设置或清除 mua_session；密码登录也可能设置用于限流、无认证能力的 mua_login_client Cookie，包括凭据被拒绝时。 |
| `400` | HTTP 400：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `401` | HTTP 401：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `403` | HTTP 403：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `404` | HTTP 404：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `409` | HTTP 409：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `413` | HTTP 413：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `415` | HTTP 415：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `422` | HTTP 422：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `429` | HTTP 429：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `500` | HTTP 500：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `503` | HTTP 503：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |

<a id="operation-login"></a>

#### POST `/api/auth/login` — 使用白名单账号登录

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `login` |
| 认证 | 无需认证 |
| 规范范围 | 完整规范 |
| 权限 | 未列出额外权限标识；仍执行认证、范围与运行时校验 |
| 仅超管 | 否 |
| 请求体上限 | 32768 字节 |

同源 Origin 必需。返回 ok 并设置 HttpOnly、SameSite=Lax、Path=/ 的 mua_session；HTTPS 时 Secure，有效期 12 小时。密码错误／停用返回 401，节流返回 429；旧 Cookie 可选。

写请求要求同源 Origin，Bearer 不能替代 Cookie。除图片上传外使用 application/json，必须包含正文。

限流按可信代理客户端地址隔离；未配置 AUTH_CLIENT_IP_HEADER 时使用可重置的 HttpOnly mua_login_client Cookie（Path=/api/auth、SameSite=Lax、一天），该 Cookie 不是登录凭据。每客户端每五分钟 60 次，每客户端与用户名组合每十五分钟 10 次。密码校验限制进程内并发，不使用全站共享尝试次数配额。可信地址头无效返回 400，服务端头名称配置无效返回 503。未配置可信 IP 头的生产部署须在入口限流。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `Origin` | `header` | 是 | string |  | 当前网站的完整 origin；浏览器自动发送。 |

##### 请求体

必填：是。

- Content-Type：`application/json`；结构：[login 请求体](#schema-inline-97)。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功；字段可见性仍受当前 RBAC 和资源状态约束。 | `application/json` → [unbindClient 200 响应](#schema-inline-24) | `Cache-Control`：string；规范示例：`"no-store"`<br>`Set-Cookie`：string；设置或清除 mua_session；密码登录也可能设置用于限流、无认证能力的 mua_login_client Cookie，包括凭据被拒绝时。 |
| `400` | HTTP 400：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `401` | HTTP 401：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `403` | HTTP 403：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `404` | HTTP 404：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `409` | HTTP 409：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `413` | HTTP 413：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `415` | HTTP 415：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `422` | HTTP 422：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `429` | HTTP 429：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `500` | HTTP 500：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `503` | HTTP 503：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |

<a id="operation-logout"></a>

#### POST `/api/auth/logout` — 退出当前会话

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `logout` |
| 认证 | 无需认证 |
| 规范范围 | 完整规范 |
| 权限 | 未列出额外权限标识；仍执行认证、范围与运行时校验 |
| 仅超管 | 否 |
| 请求体上限 | 32768 字节 |

同源 Origin 必需，会话 Cookie 可选；删除当前会话并设置 Cookie Max-Age=0。请求为 {}。

写请求要求同源 Origin，Bearer 不能替代 Cookie。除图片上传外使用 application/json，必须包含正文。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `Origin` | `header` | 是 | string |  | 当前网站的完整 origin；浏览器自动发送。 |

##### 请求体

必填：是。

- Content-Type：`application/json`；结构：[revokeAccountCredentials 请求体](#schema-inline-58)。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功；字段可见性仍受当前 RBAC 和资源状态约束。 | `application/json` → [unbindClient 200 响应](#schema-inline-24) | `Cache-Control`：string；规范示例：`"no-store"`<br>`Set-Cookie`：string；设置或清除 mua_session；密码登录也可能设置用于限流、无认证能力的 mua_login_client Cookie，包括凭据被拒绝时。 |
| `400` | HTTP 400：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `401` | HTTP 401：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `403` | HTTP 403：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `404` | HTTP 404：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `409` | HTTP 409：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `413` | HTTP 413：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `415` | HTTP 415：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `422` | HTTP 422：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `429` | HTTP 429：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `500` | HTTP 500：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `503` | HTTP 503：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |

<a id="operation-changePassword"></a>

#### POST `/api/auth/password` — 修改当前账号密码

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `changePassword` |
| 认证 | `SessionCookie` |
| 规范范围 | 完整规范 |
| 权限 | 未列出额外权限标识；仍执行认证、范围与运行时校验 |
| 仅超管 | 否 |
| 请求体上限 | 32768 字节 |

有效 Cookie 会话和同源 Origin 必需；校验当前密码，要求新密码 12–128 字符，修改后撤销该账号全部会话并清除 Cookie，须重新登录。不会修改 API Token 的明文或权限。

写请求要求同源 Origin，Bearer 不能替代 Cookie。除图片上传外使用 application/json，必须包含正文。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `Origin` | `header` | 是 | string |  | 当前网站的完整 origin；浏览器自动发送。 |

##### 请求体

必填：是。

- Content-Type：`application/json`；结构：[changePassword 请求体](#schema-inline-98)。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功；字段可见性仍受当前 RBAC 和资源状态约束。 | `application/json` → [unbindClient 200 响应](#schema-inline-24) | `Cache-Control`：string；规范示例：`"no-store"`<br>`Set-Cookie`：string；设置或清除 mua_session；密码登录也可能设置用于限流、无认证能力的 mua_login_client Cookie，包括凭据被拒绝时。 |
| `400` | HTTP 400：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `401` | HTTP 401：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `403` | HTTP 403：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `404` | HTTP 404：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `409` | HTTP 409：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `413` | HTTP 413：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `415` | HTTP 415：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `422` | HTTP 422：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `429` | HTTP 429：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `500` | HTTP 500：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |
| `503` | HTTP 503：参数、会话、权限、资源状态或基础设施错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；规范示例：`"no-store"` |

<a id="operation-startUnionLogin"></a>

#### GET `/api/auth/union/start` — 开始 Union OAuth 登录

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `startUnionLogin` |
| 认证 | 无需认证 |
| 规范范围 | 完整规范 |
| 仅超管 | 否 |

OAuth 使用独立五分钟 Lax Cookie、一次性 state 和 S256 PKCE；Launcher 会话仅成员读取。跨组织申请和审批使用有权限的管理员 Cookie 与同源校验，范围及自动新增选项绑定审批修订。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `returnTo` | `query` | 否 | string |  |  |

##### 请求体

规范未声明请求体。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `303` | 浏览器跳转到登录结果或脱敏错误页；不返回 OAuth 凭据。 | 无响应体定义 | `Location`：string<br>`Set-Cookie`：string |
| `400` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `401` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `403` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `404` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `409` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `413` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `415` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `422` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `429` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `500` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `502` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `503` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |

<a id="operation-completeUnionLogin"></a>

#### GET `/api/auth/union/callback` — 处理 Union OAuth 回调

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `completeUnionLogin` |
| 认证 | 无需认证 |
| 规范范围 | 完整规范 |
| 仅超管 | 否 |

OAuth 使用独立五分钟 Lax Cookie、一次性 state 和 S256 PKCE；Launcher 会话仅成员读取。跨组织申请和审批使用有权限的管理员 Cookie 与同源校验，范围及自动新增选项绑定审批修订。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `code` | `query` | 否 | string |  |  |
| `state` | `query` | 是 | string |  |  |
| `error` | `query` | 否 | string |  |  |

##### 请求体

规范未声明请求体。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `303` | 浏览器跳转到登录结果或脱敏错误页；不返回 OAuth 凭据。 | 无响应体定义 | `Location`：string<br>`Set-Cookie`：string |
| `400` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `401` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `403` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `404` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `409` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `413` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `415` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `422` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `429` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `500` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `502` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `503` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |

<a id="operation-approveLauncherLogin"></a>

#### POST `/api/auth/launcher/approve` — 浏览器确认 Launcher 登录

| 项目 | 要求 |
| --- | --- |
| 操作 ID | `approveLauncherLogin` |
| 认证 | `SessionCookie` |
| 规范范围 | 完整规范 |
| 仅超管 | 否 |

OAuth 使用独立五分钟 Lax Cookie、一次性 state 和 S256 PKCE；Launcher 会话仅成员读取。跨组织申请和审批使用有权限的管理员 Cookie 与同源校验，范围及自动新增选项绑定审批修订。

##### 参数

| 名称 | 位置 | 必填 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `Origin` | `header` | 是 | string |  |  |

##### 请求体

必填：是。

- Content-Type：`application/json`；结构：[createOrganization 201 响应](#schema-inline-49)。

##### 响应

| HTTP 状态 | 说明 | Content-Type / 数据模型 | 响应头 |
| --- | --- | --- | --- |
| `200` | 成功响应；权限逐请求检查。 | `application/json` → [requestUnionSync 200 响应](#schema-inline-73) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `400` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `401` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `403` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `404` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `409` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `413` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `415` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `422` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `429` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `500` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `502` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |
| `503` | 参数、身份、权限、资源状态或上游响应错误。 | `application/json` → [Error](#schema-error) | `Cache-Control`：string；固定值：`"private, no-store"` |

<a id="schemas"></a>

## 数据模型与字段约束

字段表使用点号表示嵌套对象，`[]` 表示数组元素，`{key}` 表示动态键值。根节点使用 `$`。“必填”相对于该字段所属的对象；父对象可选时，不会因此使整个父对象变成必填。

`anyOf[n]` 表示至少满足一个分支，`oneOf[n]` 表示恰好满足一个分支，`allOf[n]` 表示须同时满足所有分支；这些标记用于说明 Schema 结构，不是实际 JSON 字段。引用模型通过链接查看。

每个模型都附有完整原始 JSON Schema，保留嵌套组合、额外属性、条件与所有约束；阅读字段表遇到歧义时，以原始 Schema 为准。

### 模型索引

| 模型 | 类型 | 直接引用接口数 |
| --- | --- | --- |
| [Error](#schema-error) | object | 90 |
| [ServerDirectory](#schema-serverdirectory) | object | 1 |
| [ClientManifest](#schema-clientmanifest) | object | 0 |
| [RecipeManifest](#schema-recipemanifest) | object | 0 |
| [PublicManifest](#schema-publicmanifest) | anyOf（2 个分支） | 1 |
| [PackageDownload](#schema-packagedownload) | anyOf（4 个分支） | 2 |
| [Client](#schema-client) | object | 1 |
| [Upload](#schema-upload) | object | 6 |
| [AdminState](#schema-adminstate) | object | 1 |
| [ApiToken](#schema-apitoken) | object | 0 |
| [CreatedApiToken](#schema-createdapitoken) | object | 1 |
| [Infrastructure](#schema-infrastructure) | object | 1 |
| [ServerProbe](#schema-serverprobe) | object | 1 |
| [MottoMetadata](#schema-mottometadata) | object | 1 |
| [ManagementFullPackage](#schema-managementfullpackage) | object | 2 |
| [PublishResult](#schema-publishresult) | object | 1 |
| [getUploadDistribution 200 响应](#schema-inline-17) | object | 3 |
| [listClients 200 响应](#schema-inline-18) | array：object | 1 |
| [createClient 请求体](#schema-inline-19) | object | 1 |
| [createClient 201 响应](#schema-inline-20) | object | 1 |
| [bindClient 请求体](#schema-inline-21) | object | 1 |
| [bindClient 200 响应](#schema-inline-22) | object | 1 |
| [unbindClient 请求体](#schema-inline-23) | object | 1 |
| [unbindClient 200 响应](#schema-inline-24) | object | 19 |
| [archiveClient 请求体](#schema-inline-25) | object | 3 |
| [deleteClient 请求体](#schema-inline-26) | 未限定类型 | 5 |
| [createClientUpload 请求体](#schema-inline-27) | object | 1 |
| [signUploadPart 请求体](#schema-inline-28) | object | 1 |
| [signUploadPart 200 响应](#schema-inline-29) | object | 1 |
| [completeClientUpload 请求体](#schema-inline-30) | object | 1 |
| [selectClientInstance 请求体](#schema-inline-31) | object | 1 |
| [submitClientUpload 请求体](#schema-inline-32) | object | 1 |
| [submitClientUpload 200 响应](#schema-inline-33) | object | 1 |
| [getDraftManifest 200 响应](#schema-inline-34) | anyOf（2 个分支） | 1 |
| [getDraftPlatformManifest 200 响应](#schema-inline-35) | anyOf（3 个分支） | 1 |
| [reviewClientDraft 请求体](#schema-inline-36) | object | 1 |
| [configureDraftPlatforms 请求体](#schema-inline-37) | object | 1 |
| [archiveClientDraft 请求体](#schema-inline-38) | object | 1 |
| [publishClientDraft 请求体](#schema-inline-39) | object | 1 |
| [activateClientRelease 请求体](#schema-inline-40) | object | 1 |
| [getExecutionSettings 200 响应](#schema-inline-41) | object | 2 |
| [setExecutionSettings 请求体](#schema-inline-42) | object | 1 |
| [getExecutionInstances 200 响应](#schema-inline-43) | object | 1 |
| [getStorageTelemetry 200 响应](#schema-inline-44) | object | 1 |
| [searchOrganizationAccounts 200 响应](#schema-inline-45) | array：object | 1 |
| [listApiTokens 200 响应](#schema-inline-46) | array：object | 1 |
| [createApiToken 请求体](#schema-inline-47) | object | 1 |
| [createOrganization 请求体](#schema-inline-48) | object | 1 |
| [createOrganization 201 响应](#schema-inline-49) | object | 4 |
| [updateOrganization 请求体](#schema-inline-50) | object | 1 |
| [createServer 请求体](#schema-inline-51) | object | 1 |
| [createServer 201 响应](#schema-inline-52) | object | 1 |
| [updateServer 请求体](#schema-inline-53) | object | 1 |
| [setOrganizationMember 请求体](#schema-inline-54) | object | 1 |
| [setServerGrant 请求体](#schema-inline-55) | object | 1 |
| [createAccount 请求体](#schema-inline-56) | object | 1 |
| [updateAccount 请求体](#schema-inline-57) | object | 1 |
| [revokeAccountCredentials 请求体](#schema-inline-58) | object | 4 |
| [revokeAccountCredentials 200 响应](#schema-inline-59) | object | 2 |
| [getRecycleSettings 200 响应](#schema-inline-60) | object | 2 |
| [getUploadSizeSettings 200 响应](#schema-inline-61) | object | 2 |
| [getPackageFormatSettings 200 响应](#schema-inline-62) | object | 2 |
| [getDownloadSettings 200 响应](#schema-inline-63) | object | 2 |
| [setDownloadSettings 请求体](#schema-inline-64) | object | 1 |
| [getServerMotto 200 响应](#schema-inline-65) | string (binary) | 2 |
| [uploadServerMotto 请求体](#schema-inline-66) | object | 1 |
| [uploadServerMotto 200 响应](#schema-inline-67) | object | 2 |
| [removeServerMotto 请求体](#schema-inline-68) | object | 1 |
| [listLauncherProvidersAdmin 200 响应](#schema-inline-69) | array：object | 1 |
| [saveLauncherProvider 请求体](#schema-inline-70) | object | 1 |
| [saveLauncherProvider 200 响应](#schema-inline-71) | object | 1 |
| [getUnionSync 200 响应](#schema-inline-72) | object | 1 |
| [requestUnionSync 200 响应](#schema-inline-73) | object | 5 |
| [getOrganizationAvatar 200 响应](#schema-inline-74) | object | 1 |
| [uploadOrganizationAvatar 请求体](#schema-inline-75) | object | 1 |
| [uploadOrganizationAvatar 200 响应](#schema-inline-76) | object | 2 |
| [removeOrganizationAvatar 请求体](#schema-inline-77) | object | 1 |
| [listUnionSites 200 响应](#schema-inline-78) | array：object | 1 |
| [saveUnionSite 请求体](#schema-inline-79) | object | 1 |
| [saveUnionSite 200 响应](#schema-inline-80) | object | 1 |
| [getAccessCandidates 200 响应](#schema-inline-81) | anyOf（2 个分支） | 1 |
| [listAccessRequests 200 响应](#schema-inline-82) | object | 1 |
| [submitAccessRequest 请求体](#schema-inline-83) | object | 1 |
| [decideAccessRequest 请求体](#schema-inline-84) | object | 1 |
| [revokeAccessGrant 请求体](#schema-inline-85) | object | 1 |
| [listLauncherProviders 200 响应](#schema-inline-86) | array：object | 1 |
| [listLauncherProviders 400 响应](#schema-inline-87) | object | 3 |
| [startLauncherGameLogin 请求体](#schema-inline-88) | object | 1 |
| [startLauncherGameLogin 201 响应](#schema-inline-89) | object | 1 |
| [exchangeLauncherGameLogin 请求体](#schema-inline-90) | object | 1 |
| [exchangeLauncherGameLogin 200 响应](#schema-inline-91) | object | 1 |
| [startLauncherLogin 请求体](#schema-inline-92) | object | 1 |
| [startLauncherLogin 201 响应](#schema-inline-93) | object | 1 |
| [claimLauncherLogin 请求体](#schema-inline-94) | object | 1 |
| [claimLauncherLogin 200 响应](#schema-inline-95) | anyOf（2 个分支） | 1 |
| [getMemberDirectory 200 响应](#schema-inline-96) | object | 1 |
| [login 请求体](#schema-inline-97) | object | 1 |
| [changePassword 请求体](#schema-inline-98) | object | 1 |

<a id="schema-error"></a>

### Error

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `error` | string | 是 |  |  |
| `code` | string | 是 |  |  |
| `params` | object | 是 | 动态字段值：anyOf（2 个分支） |  |
| `params{key}` | anyOf（2 个分支） | 动态字段 |  |  |
| `params{key}.anyOf[1]` | string | 分支内适用 |  |  |
| `params{key}.anyOf[2]` | number | 分支内适用 |  |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "error": {
      "type": "string"
    },
    "code": {
      "type": "string"
    },
    "params": {
      "type": "object",
      "additionalProperties": {
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "number"
          }
        ]
      }
    }
  },
  "required": [
    "error",
    "code",
    "params"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-serverdirectory"></a>

### ServerDirectory

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `servers` | array：anyOf（2 个分支） | 是 |  |  |
| `servers[]` | anyOf（2 个分支） | 每个元素 |  |  |
| `servers[].anyOf[1]` | object | 分支内适用 | 不接受额外字段 |  |
| `servers[].anyOf[1].serverId` | string | 是 | 正则：`"^[A-Za-z]{3,5}$"` |  |
| `servers[].anyOf[1].displayName` | string | 是 |  |  |
| `servers[].anyOf[1].description` | string | 是 |  |  |
| `servers[].anyOf[1].gameAddress` | string / null | 是 |  |  |
| `servers[].anyOf[1].themeColor` | string / null | 是 |  |  |
| `servers[].anyOf[1].sortOrder` | integer | 是 |  |  |
| `servers[].anyOf[1].organization` | object | 是 | 不接受额外字段 |  |
| `servers[].anyOf[1].organization.id` | string (uuid) | 是 |  |  |
| `servers[].anyOf[1].organization.displayName` | string | 是 |  |  |
| `servers[].anyOf[1].publicationRevision` | integer | 是 | 最小值（含）：`0` |  |
| `servers[].anyOf[1].currentRelease` | object | 是 | 不接受额外字段 |  |
| `servers[].anyOf[1].currentRelease.id` | string (uuid) | 是 |  |  |
| `servers[].anyOf[1].currentRelease.clientId` | string (uuid) | 是 |  |  |
| `servers[].anyOf[1].currentRelease.versionLabel` | string | 是 |  |  |
| `servers[].anyOf[1].currentRelease.name` | string | 是 |  |  |
| `servers[].anyOf[1].currentRelease.manifestSha256` | string | 是 | 正则：`"^[0-9a-f]{64}$"` |  |
| `servers[].anyOf[1].currentRelease.packageFormatVersion` | anyOf（2 个分支） | 是 |  |  |
| `servers[].anyOf[1].currentRelease.packageFormatVersion.anyOf[1]` | number | 分支内适用 | 可选值：`[1]` |  |
| `servers[].anyOf[1].currentRelease.packageFormatVersion.anyOf[2]` | number | 分支内适用 | 可选值：`[2]` |  |
| `servers[].anyOf[1].currentRelease.manifestUrl` | string | 是 |  |  |
| `servers[].anyOf[1].currentRelease.packagesUrl` | string | 是 |  |  |
| `servers[].anyOf[1].displayMode` | string | 是 | 可选值：`["PERMANENT"]` |  |
| `servers[].anyOf[1].displayStartsAt` | null | 是 |  |  |
| `servers[].anyOf[1].displayEndsAt` | null | 是 |  |  |
| `servers[].anyOf[2]` | object | 分支内适用 | 不接受额外字段 |  |
| `servers[].anyOf[2].serverId` | string | 是 | 正则：`"^[A-Za-z]{3,5}$"` |  |
| `servers[].anyOf[2].displayName` | string | 是 |  |  |
| `servers[].anyOf[2].description` | string | 是 |  |  |
| `servers[].anyOf[2].gameAddress` | string / null | 是 |  |  |
| `servers[].anyOf[2].themeColor` | string / null | 是 |  |  |
| `servers[].anyOf[2].sortOrder` | integer | 是 |  |  |
| `servers[].anyOf[2].organization` | object | 是 | 不接受额外字段 |  |
| `servers[].anyOf[2].organization.id` | string (uuid) | 是 |  |  |
| `servers[].anyOf[2].organization.displayName` | string | 是 |  |  |
| `servers[].anyOf[2].publicationRevision` | integer | 是 | 最小值（含）：`0` |  |
| `servers[].anyOf[2].currentRelease` | object | 是 | 不接受额外字段 |  |
| `servers[].anyOf[2].currentRelease.id` | string (uuid) | 是 |  |  |
| `servers[].anyOf[2].currentRelease.clientId` | string (uuid) | 是 |  |  |
| `servers[].anyOf[2].currentRelease.versionLabel` | string | 是 |  |  |
| `servers[].anyOf[2].currentRelease.name` | string | 是 |  |  |
| `servers[].anyOf[2].currentRelease.manifestSha256` | string | 是 | 正则：`"^[0-9a-f]{64}$"` |  |
| `servers[].anyOf[2].currentRelease.packageFormatVersion` | anyOf（2 个分支） | 是 |  |  |
| `servers[].anyOf[2].currentRelease.packageFormatVersion.anyOf[1]` | number | 分支内适用 | 可选值：`[1]` |  |
| `servers[].anyOf[2].currentRelease.packageFormatVersion.anyOf[2]` | number | 分支内适用 | 可选值：`[2]` |  |
| `servers[].anyOf[2].currentRelease.manifestUrl` | string | 是 |  |  |
| `servers[].anyOf[2].currentRelease.packagesUrl` | string | 是 |  |  |
| `servers[].anyOf[2].displayMode` | string | 是 | 可选值：`["RANGE"]` |  |
| `servers[].anyOf[2].displayStartsAt` | string (date-time) | 是 |  |  |
| `servers[].anyOf[2].displayEndsAt` | string (date-time) | 是 |  |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "servers": {
      "type": "array",
      "items": {
        "anyOf": [
          {
            "type": "object",
            "properties": {
              "serverId": {
                "type": "string",
                "pattern": "^[A-Za-z]{3,5}$"
              },
              "displayName": {
                "type": "string"
              },
              "description": {
                "type": "string"
              },
              "gameAddress": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "themeColor": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "sortOrder": {
                "type": "integer"
              },
              "organization": {
                "type": "object",
                "properties": {
                  "id": {
                    "type": "string",
                    "format": "uuid"
                  },
                  "displayName": {
                    "type": "string"
                  }
                },
                "required": [
                  "id",
                  "displayName"
                ],
                "additionalProperties": false
              },
              "publicationRevision": {
                "type": "integer",
                "minimum": 0
              },
              "currentRelease": {
                "type": "object",
                "properties": {
                  "id": {
                    "type": "string",
                    "format": "uuid"
                  },
                  "clientId": {
                    "type": "string",
                    "format": "uuid"
                  },
                  "versionLabel": {
                    "type": "string"
                  },
                  "name": {
                    "type": "string"
                  },
                  "manifestSha256": {
                    "type": "string",
                    "pattern": "^[0-9a-f]{64}$"
                  },
                  "packageFormatVersion": {
                    "anyOf": [
                      {
                        "type": "number",
                        "enum": [
                          1
                        ]
                      },
                      {
                        "type": "number",
                        "enum": [
                          2
                        ]
                      }
                    ]
                  },
                  "manifestUrl": {
                    "type": "string"
                  },
                  "packagesUrl": {
                    "type": "string"
                  }
                },
                "required": [
                  "id",
                  "clientId",
                  "versionLabel",
                  "name",
                  "manifestSha256",
                  "packageFormatVersion",
                  "manifestUrl",
                  "packagesUrl"
                ],
                "additionalProperties": false
              },
              "displayMode": {
                "type": "string",
                "enum": [
                  "PERMANENT"
                ]
              },
              "displayStartsAt": {
                "type": "null"
              },
              "displayEndsAt": {
                "type": "null"
              }
            },
            "required": [
              "serverId",
              "displayName",
              "description",
              "gameAddress",
              "themeColor",
              "sortOrder",
              "organization",
              "publicationRevision",
              "currentRelease",
              "displayMode",
              "displayStartsAt",
              "displayEndsAt"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "serverId": {
                "type": "string",
                "pattern": "^[A-Za-z]{3,5}$"
              },
              "displayName": {
                "type": "string"
              },
              "description": {
                "type": "string"
              },
              "gameAddress": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "themeColor": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "sortOrder": {
                "type": "integer"
              },
              "organization": {
                "type": "object",
                "properties": {
                  "id": {
                    "type": "string",
                    "format": "uuid"
                  },
                  "displayName": {
                    "type": "string"
                  }
                },
                "required": [
                  "id",
                  "displayName"
                ],
                "additionalProperties": false
              },
              "publicationRevision": {
                "type": "integer",
                "minimum": 0
              },
              "currentRelease": {
                "type": "object",
                "properties": {
                  "id": {
                    "type": "string",
                    "format": "uuid"
                  },
                  "clientId": {
                    "type": "string",
                    "format": "uuid"
                  },
                  "versionLabel": {
                    "type": "string"
                  },
                  "name": {
                    "type": "string"
                  },
                  "manifestSha256": {
                    "type": "string",
                    "pattern": "^[0-9a-f]{64}$"
                  },
                  "packageFormatVersion": {
                    "anyOf": [
                      {
                        "type": "number",
                        "enum": [
                          1
                        ]
                      },
                      {
                        "type": "number",
                        "enum": [
                          2
                        ]
                      }
                    ]
                  },
                  "manifestUrl": {
                    "type": "string"
                  },
                  "packagesUrl": {
                    "type": "string"
                  }
                },
                "required": [
                  "id",
                  "clientId",
                  "versionLabel",
                  "name",
                  "manifestSha256",
                  "packageFormatVersion",
                  "manifestUrl",
                  "packagesUrl"
                ],
                "additionalProperties": false
              },
              "displayMode": {
                "type": "string",
                "enum": [
                  "RANGE"
                ]
              },
              "displayStartsAt": {
                "type": "string",
                "format": "date-time"
              },
              "displayEndsAt": {
                "type": "string",
                "format": "date-time"
              }
            },
            "required": [
              "serverId",
              "displayName",
              "description",
              "gameAddress",
              "themeColor",
              "sortOrder",
              "organization",
              "publicationRevision",
              "currentRelease",
              "displayMode",
              "displayStartsAt",
              "displayEndsAt"
            ],
            "additionalProperties": false
          }
        ]
      }
    }
  },
  "required": [
    "servers"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-clientmanifest"></a>

### ClientManifest

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `format` | string | 是 | 可选值：`["mua-client-manifest"]` |  |
| `organizationId` | string (uuid) | 是 |  |  |
| `version` | string | 是 |  |  |
| `name` | string | 是 |  |  |
| `runtime` | object | 是 | 不接受额外字段 |  |
| `runtime.minecraft` | string | 是 |  |  |
| `runtime.java` | integer | 是 |  |  |
| `mods` | array：string | 是 |  |  |
| `mods[]` | string | 每个元素 |  |  |
| `modDetails` | array：object | 否 |  |  |
| `modDetails[]` | object | 每个元素 | 不接受额外字段 |  |
| `modDetails[].path` | string | 是 |  |  |
| `modDetails[].optional` | boolean | 是 |  |  |
| `summary` | string | 是 |  |  |
| `description` | string | 是 |  |  |
| `sourceSha256` | string | 是 | 正则：`"^[0-9a-f]{64}$"` |  |
| `files` | array：object | 是 |  |  |
| `files[]` | object | 每个元素 | 不接受额外字段 |  |
| `files[].path` | string | 是 |  |  |
| `files[].sha256` | string | 是 | 正则：`"^[0-9a-f]{64}$"` |  |
| `files[].size` | integer | 是 | 最小值（含）：`0` |  |
| `files[].policy` | string | 是 | 可选值：`["managed","preserve"]` |  |
| `files[].optional` | boolean | 否 |  |  |
| `update` | object | 是 | 不接受额外字段 |  |
| `update.previousVersion` | string / null | 是 |  |  |
| `update.addedFiles` | integer | 是 | 最小值（含）：`0` |  |
| `update.modifiedFiles` | integer | 是 | 最小值（含）：`0` |  |
| `update.deletedFiles` | integer | 是 | 最小值（含）：`0` |  |
| `update.fullSize` | integer | 是 | 最小值（含）：`0` |  |
| `update.newDataSize` | integer | 是 | 最小值（含）：`0` |  |
| `update.estimatedDownloadSize` | integer | 是 | 最小值（含）：`0` |  |
| `update.casReusePercent` | number | 是 |  |  |
| `update.fileCount` | integer | 是 | 最小值（含）：`0` |  |
| `update.sourceSize` | integer | 是 | 最小值（含）：`0` |  |
| `schemaVersion` | number | 是 | 可选值：`[2]` |  |
| `clientId` | string (uuid) | 是 |  |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "format": {
      "type": "string",
      "enum": [
        "mua-client-manifest"
      ]
    },
    "organizationId": {
      "type": "string",
      "format": "uuid"
    },
    "version": {
      "type": "string"
    },
    "name": {
      "type": "string"
    },
    "runtime": {
      "type": "object",
      "properties": {
        "minecraft": {
          "type": "string"
        },
        "java": {
          "type": "integer"
        }
      },
      "required": [
        "minecraft",
        "java"
      ],
      "additionalProperties": false
    },
    "mods": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "modDetails": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "path": {
            "type": "string"
          },
          "optional": {
            "type": "boolean"
          }
        },
        "required": [
          "path",
          "optional"
        ],
        "additionalProperties": false
      }
    },
    "summary": {
      "type": "string"
    },
    "description": {
      "type": "string"
    },
    "sourceSha256": {
      "type": "string",
      "pattern": "^[0-9a-f]{64}$"
    },
    "files": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "path": {
            "type": "string"
          },
          "sha256": {
            "type": "string",
            "pattern": "^[0-9a-f]{64}$"
          },
          "size": {
            "type": "integer",
            "minimum": 0
          },
          "policy": {
            "type": "string",
            "enum": [
              "managed",
              "preserve"
            ]
          },
          "optional": {
            "type": "boolean"
          }
        },
        "required": [
          "path",
          "sha256",
          "size",
          "policy"
        ],
        "additionalProperties": false
      }
    },
    "update": {
      "type": "object",
      "properties": {
        "previousVersion": {
          "type": [
            "string",
            "null"
          ]
        },
        "addedFiles": {
          "type": "integer",
          "minimum": 0
        },
        "modifiedFiles": {
          "type": "integer",
          "minimum": 0
        },
        "deletedFiles": {
          "type": "integer",
          "minimum": 0
        },
        "fullSize": {
          "type": "integer",
          "minimum": 0
        },
        "newDataSize": {
          "type": "integer",
          "minimum": 0
        },
        "estimatedDownloadSize": {
          "type": "integer",
          "minimum": 0
        },
        "casReusePercent": {
          "type": "number"
        },
        "fileCount": {
          "type": "integer",
          "minimum": 0
        },
        "sourceSize": {
          "type": "integer",
          "minimum": 0
        }
      },
      "required": [
        "previousVersion",
        "addedFiles",
        "modifiedFiles",
        "deletedFiles",
        "fullSize",
        "newDataSize",
        "estimatedDownloadSize",
        "casReusePercent",
        "fileCount",
        "sourceSize"
      ],
      "additionalProperties": false
    },
    "schemaVersion": {
      "type": "number",
      "enum": [
        2
      ]
    },
    "clientId": {
      "type": "string",
      "format": "uuid"
    }
  },
  "required": [
    "format",
    "organizationId",
    "version",
    "name",
    "runtime",
    "mods",
    "summary",
    "description",
    "sourceSha256",
    "files",
    "update",
    "schemaVersion",
    "clientId"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-recipemanifest"></a>

### RecipeManifest

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `format` | string | 是 | 可选值：`["mua-recipe-manifest"]` |  |
| `formatVersion` | number | 是 | 可选值：`[2]` |  |
| `release` | object | 是 | 不接受额外字段 |  |
| `release.organizationId` | string (uuid) | 是 |  |  |
| `release.clientId` | string (uuid) | 是 |  |  |
| `release.releaseId` | string (uuid) | 是 |  |  |
| `release.version` | string | 是 | 最短长度：`1`<br>最长长度：`200` |  |
| `release.name` | string | 是 | 最短长度：`1`<br>最长长度：`200` |  |
| `release.summary` | string | 是 | 最短长度：`1`<br>最长长度：`200` |  |
| `release.description` | string | 是 | 最长长度：`20000` |  |
| `release.sourceSha256` | string | 是 | 正则：`"^[0-9a-f]{64}$"` |  |
| `release.contentRevision` | integer | 是 | 最小值（不含）：`0` |  |
| `runtime` | object | 是 | 不接受额外字段 |  |
| `runtime.minecraft` | string | 是 | 最短长度：`1`<br>最长长度：`200` |  |
| `runtime.loader` | object / null | 是 | 不接受额外字段 |  |
| `runtime.loader.type` | string | 是 | 可选值：`["fabric","quilt","forge","neoforge"]` |  |
| `runtime.loader.version` | string | 是 | 最短长度：`1`<br>最长长度：`200` |  |
| `runtime.java` | object | 是 | 不接受额外字段 |  |
| `runtime.java.major` | integer | 是 | 最小值（含）：`7`<br>最大值（含）：`25` |  |
| `runtime.java.vendor` | string | 是 | 可选值：`["adoptium"]` |  |
| `runtime.java.imageType` | string | 是 | 可选值：`["jre","jdk"]` |  |
| `runtime.resolverVersion` | string | 是 | 可选值：`["mua-runtime-resolver-1"]` |  |
| `launch` | object | 是 | 不接受额外字段 |  |
| `launch.jvmArgs` | array：string | 是 | 最多元素：`256` |  |
| `launch.jvmArgs[]` | string | 每个元素 | 最长长度：`4000` |  |
| `launch.gameArgs` | array：string | 是 | 最多元素：`256` |  |
| `launch.gameArgs[]` | string | 每个元素 | 最长长度：`4000` |  |
| `launch.memory` | object | 是 | 不接受额外字段 |  |
| `launch.memory.mode` | string | 是 | 可选值：`["auto"]` |  |
| `launch.memory.minimumMiB` | integer | 是 | 最小值（含）：`256`<br>最大值（含）：`1048576` |  |
| `launch.memory.recommendedMiB` | integer | 是 | 最小值（含）：`256`<br>最大值（含）：`1048576` |  |
| `launch.preLaunch` | array：oneOf（3 个分支） | 是 | 最多元素：`32` |  |
| `launch.preLaunch[]` | oneOf（3 个分支） | 每个元素 |  |  |
| `launch.preLaunch[].oneOf[1]` | object | 分支内适用 | 不接受额外字段 |  |
| `launch.preLaunch[].oneOf[1].type` | string | 是 | 可选值：`["mkdir"]` |  |
| `launch.preLaunch[].oneOf[1].path` | string | 是 | 最短长度：`1`<br>最长长度：`1000` |  |
| `launch.preLaunch[].oneOf[2]` | object | 分支内适用 | 不接受额外字段 |  |
| `launch.preLaunch[].oneOf[2].type` | string | 是 | 可选值：`["copy"]` |  |
| `launch.preLaunch[].oneOf[2].from` | object | 是 | 不接受额外字段 |  |
| `launch.preLaunch[].oneOf[2].from.root` | string | 是 | 可选值：`["instance"]` |  |
| `launch.preLaunch[].oneOf[2].from.path` | string | 是 | 最短长度：`1`<br>最长长度：`1000` |  |
| `launch.preLaunch[].oneOf[2].to` | string | 是 | 最短长度：`1`<br>最长长度：`1000` |  |
| `launch.preLaunch[].oneOf[2].ifMissing` | boolean | 是 | 可选值：`[true]` |  |
| `launch.preLaunch[].oneOf[3]` | object | 分支内适用 | 不接受额外字段 |  |
| `launch.preLaunch[].oneOf[3].type` | string | 是 | 可选值：`["exec"]` |  |
| `launch.preLaunch[].oneOf[3].executable` | object | 是 | 不接受额外字段 |  |
| `launch.preLaunch[].oneOf[3].executable.root` | string | 是 | 可选值：`["instance"]` |  |
| `launch.preLaunch[].oneOf[3].executable.path` | string | 是 | 最短长度：`1`<br>最长长度：`1000` |  |
| `launch.preLaunch[].oneOf[3].args` | array：string | 是 | 最多元素：`256` |  |
| `launch.preLaunch[].oneOf[3].args[]` | string | 每个元素 | 最长长度：`4000` |  |
| `launch.preLaunch[].oneOf[3].workingDirectory` | string / null | 是 | 最短长度：`1`<br>最长长度：`1000` |  |
| `launch.preLaunch[].oneOf[3].requiresConsent` | boolean | 是 | 可选值：`[true]` |  |
| `launch.preLaunch[].oneOf[3].timeoutSeconds` | integer | 是 | 最小值（含）：`1`<br>最大值（含）：`300` |  |
| `launch.preLaunch[].oneOf[3].onFailure` | string | 是 | 可选值：`["abort","continue"]` |  |
| `files` | array：anyOf（2 个分支） | 是 | 最少元素：`1`<br>最多元素：`100000` |  |
| `files[]` | anyOf（2 个分支） | 每个元素 |  |  |
| `files[].anyOf[1]` | object | 分支内适用 | 不接受额外字段 |  |
| `files[].anyOf[1].path` | string | 是 |  |  |
| `files[].anyOf[1].size` | integer | 是 | 最小值（含）：`0`<br>最大值（含）：`2147483648` |  |
| `files[].anyOf[1].policy` | string | 是 | 可选值：`["managed","preserve"]` |  |
| `files[].anyOf[1].optional` | boolean | 是 |  |  |
| `files[].anyOf[1].executable` | boolean | 是 |  |  |
| `files[].anyOf[1].hashes` | object | 是 | 不接受额外字段 |  |
| `files[].anyOf[1].hashes.sha256` | string | 是 | 正则：`"^[a-f0-9]{64}$"` |  |
| `files[].anyOf[1].source` | object | 是 | 不接受额外字段 |  |
| `files[].anyOf[1].source.type` | string | 是 | 可选值：`["local"]` |  |
| `files[].anyOf[1].source.entry` | string | 是 |  |  |
| `files[].anyOf[2]` | object | 分支内适用 | 不接受额外字段 |  |
| `files[].anyOf[2].path` | string | 是 |  |  |
| `files[].anyOf[2].size` | integer | 是 | 最小值（含）：`0`<br>最大值（含）：`2147483648` |  |
| `files[].anyOf[2].policy` | string | 是 | 可选值：`["managed","preserve"]` |  |
| `files[].anyOf[2].optional` | boolean | 是 |  |  |
| `files[].anyOf[2].executable` | boolean | 是 |  |  |
| `files[].anyOf[2].hashes` | object | 是 | 不接受额外字段 |  |
| `files[].anyOf[2].hashes.sha1` | string | 是 | 正则：`"^[a-f0-9]{40}$"` |  |
| `files[].anyOf[2].hashes.sha512` | string | 是 | 正则：`"^[a-f0-9]{128}$"` |  |
| `files[].anyOf[2].hashes.sha256` | string | 否 | 正则：`"^[a-f0-9]{64}$"` |  |
| `files[].anyOf[2].source` | object | 是 | 不接受额外字段 |  |
| `files[].anyOf[2].source.type` | string | 是 | 可选值：`["remote"]` |  |
| `files[].anyOf[2].source.downloads` | array：string | 是 | 最少元素：`1`<br>最多元素：`10` |  |
| `files[].anyOf[2].source.downloads[]` | string | 每个元素 | 最长长度：`4000` |  |
| `protocolRevision` | number | 是 | 可选值：`[2]` |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "format": {
      "type": "string",
      "enum": [
        "mua-recipe-manifest"
      ]
    },
    "formatVersion": {
      "type": "number",
      "enum": [
        2
      ]
    },
    "release": {
      "type": "object",
      "properties": {
        "organizationId": {
          "type": "string",
          "format": "uuid"
        },
        "clientId": {
          "type": "string",
          "format": "uuid"
        },
        "releaseId": {
          "type": "string",
          "format": "uuid"
        },
        "version": {
          "type": "string",
          "minLength": 1,
          "maxLength": 200
        },
        "name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 200
        },
        "summary": {
          "type": "string",
          "minLength": 1,
          "maxLength": 200
        },
        "description": {
          "type": "string",
          "maxLength": 20000
        },
        "sourceSha256": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$"
        },
        "contentRevision": {
          "type": "integer",
          "exclusiveMinimum": 0
        }
      },
      "required": [
        "organizationId",
        "clientId",
        "releaseId",
        "version",
        "name",
        "summary",
        "description",
        "sourceSha256",
        "contentRevision"
      ],
      "additionalProperties": false
    },
    "runtime": {
      "type": "object",
      "properties": {
        "minecraft": {
          "type": "string",
          "minLength": 1,
          "maxLength": 200
        },
        "loader": {
          "type": [
            "object",
            "null"
          ],
          "properties": {
            "type": {
              "type": "string",
              "enum": [
                "fabric",
                "quilt",
                "forge",
                "neoforge"
              ]
            },
            "version": {
              "type": "string",
              "minLength": 1,
              "maxLength": 200
            }
          },
          "required": [
            "type",
            "version"
          ],
          "additionalProperties": false
        },
        "java": {
          "type": "object",
          "properties": {
            "major": {
              "type": "integer",
              "minimum": 7,
              "maximum": 25
            },
            "vendor": {
              "type": "string",
              "enum": [
                "adoptium"
              ]
            },
            "imageType": {
              "type": "string",
              "enum": [
                "jre",
                "jdk"
              ]
            }
          },
          "required": [
            "major",
            "vendor",
            "imageType"
          ],
          "additionalProperties": false
        },
        "resolverVersion": {
          "type": "string",
          "enum": [
            "mua-runtime-resolver-1"
          ]
        }
      },
      "required": [
        "minecraft",
        "loader",
        "java",
        "resolverVersion"
      ],
      "additionalProperties": false
    },
    "launch": {
      "type": "object",
      "properties": {
        "jvmArgs": {
          "type": "array",
          "items": {
            "type": "string",
            "maxLength": 4000
          },
          "maxItems": 256
        },
        "gameArgs": {
          "type": "array",
          "items": {
            "type": "string",
            "maxLength": 4000
          },
          "maxItems": 256
        },
        "memory": {
          "type": "object",
          "properties": {
            "mode": {
              "type": "string",
              "enum": [
                "auto"
              ]
            },
            "minimumMiB": {
              "type": "integer",
              "minimum": 256,
              "maximum": 1048576
            },
            "recommendedMiB": {
              "type": "integer",
              "minimum": 256,
              "maximum": 1048576
            }
          },
          "required": [
            "mode",
            "minimumMiB",
            "recommendedMiB"
          ],
          "additionalProperties": false
        },
        "preLaunch": {
          "type": "array",
          "items": {
            "oneOf": [
              {
                "type": "object",
                "properties": {
                  "type": {
                    "type": "string",
                    "enum": [
                      "mkdir"
                    ]
                  },
                  "path": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 1000
                  }
                },
                "required": [
                  "type",
                  "path"
                ],
                "additionalProperties": false
              },
              {
                "type": "object",
                "properties": {
                  "type": {
                    "type": "string",
                    "enum": [
                      "copy"
                    ]
                  },
                  "from": {
                    "type": "object",
                    "properties": {
                      "root": {
                        "type": "string",
                        "enum": [
                          "instance"
                        ]
                      },
                      "path": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 1000
                      }
                    },
                    "required": [
                      "root",
                      "path"
                    ],
                    "additionalProperties": false
                  },
                  "to": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 1000
                  },
                  "ifMissing": {
                    "type": "boolean",
                    "enum": [
                      true
                    ]
                  }
                },
                "required": [
                  "type",
                  "from",
                  "to",
                  "ifMissing"
                ],
                "additionalProperties": false
              },
              {
                "type": "object",
                "properties": {
                  "type": {
                    "type": "string",
                    "enum": [
                      "exec"
                    ]
                  },
                  "executable": {
                    "type": "object",
                    "properties": {
                      "root": {
                        "type": "string",
                        "enum": [
                          "instance"
                        ]
                      },
                      "path": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 1000
                      }
                    },
                    "required": [
                      "root",
                      "path"
                    ],
                    "additionalProperties": false
                  },
                  "args": {
                    "type": "array",
                    "items": {
                      "type": "string",
                      "maxLength": 4000
                    },
                    "maxItems": 256
                  },
                  "workingDirectory": {
                    "type": [
                      "string",
                      "null"
                    ],
                    "minLength": 1,
                    "maxLength": 1000
                  },
                  "requiresConsent": {
                    "type": "boolean",
                    "enum": [
                      true
                    ]
                  },
                  "timeoutSeconds": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 300
                  },
                  "onFailure": {
                    "type": "string",
                    "enum": [
                      "abort",
                      "continue"
                    ]
                  }
                },
                "required": [
                  "type",
                  "executable",
                  "args",
                  "workingDirectory",
                  "requiresConsent",
                  "timeoutSeconds",
                  "onFailure"
                ],
                "additionalProperties": false
              }
            ]
          },
          "maxItems": 32
        }
      },
      "required": [
        "jvmArgs",
        "gameArgs",
        "memory",
        "preLaunch"
      ],
      "additionalProperties": false
    },
    "files": {
      "type": "array",
      "items": {
        "anyOf": [
          {
            "type": "object",
            "properties": {
              "path": {
                "type": "string"
              },
              "size": {
                "type": "integer",
                "minimum": 0,
                "maximum": 2147483648
              },
              "policy": {
                "type": "string",
                "enum": [
                  "managed",
                  "preserve"
                ]
              },
              "optional": {
                "type": "boolean"
              },
              "executable": {
                "type": "boolean"
              },
              "hashes": {
                "type": "object",
                "properties": {
                  "sha256": {
                    "type": "string",
                    "pattern": "^[a-f0-9]{64}$"
                  }
                },
                "required": [
                  "sha256"
                ],
                "additionalProperties": false
              },
              "source": {
                "type": "object",
                "properties": {
                  "type": {
                    "type": "string",
                    "enum": [
                      "local"
                    ]
                  },
                  "entry": {
                    "type": "string"
                  }
                },
                "required": [
                  "type",
                  "entry"
                ],
                "additionalProperties": false
              }
            },
            "required": [
              "path",
              "size",
              "policy",
              "optional",
              "executable",
              "hashes",
              "source"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "path": {
                "type": "string"
              },
              "size": {
                "type": "integer",
                "minimum": 0,
                "maximum": 2147483648
              },
              "policy": {
                "type": "string",
                "enum": [
                  "managed",
                  "preserve"
                ]
              },
              "optional": {
                "type": "boolean"
              },
              "executable": {
                "type": "boolean"
              },
              "hashes": {
                "type": "object",
                "properties": {
                  "sha1": {
                    "type": "string",
                    "pattern": "^[a-f0-9]{40}$"
                  },
                  "sha512": {
                    "type": "string",
                    "pattern": "^[a-f0-9]{128}$"
                  },
                  "sha256": {
                    "type": "string",
                    "pattern": "^[a-f0-9]{64}$"
                  }
                },
                "required": [
                  "sha1",
                  "sha512"
                ],
                "additionalProperties": false
              },
              "source": {
                "type": "object",
                "properties": {
                  "type": {
                    "type": "string",
                    "enum": [
                      "remote"
                    ]
                  },
                  "downloads": {
                    "type": "array",
                    "items": {
                      "type": "string",
                      "maxLength": 4000
                    },
                    "minItems": 1,
                    "maxItems": 10
                  }
                },
                "required": [
                  "type",
                  "downloads"
                ],
                "additionalProperties": false
              }
            },
            "required": [
              "path",
              "size",
              "policy",
              "optional",
              "executable",
              "hashes",
              "source"
            ],
            "additionalProperties": false
          }
        ]
      },
      "minItems": 1,
      "maxItems": 100000
    },
    "protocolRevision": {
      "type": "number",
      "enum": [
        2
      ]
    }
  },
  "required": [
    "format",
    "formatVersion",
    "release",
    "runtime",
    "launch",
    "files",
    "protocolRevision"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-publicmanifest"></a>

### PublicManifest

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | anyOf（2 个分支） | — |  |  |
| `$.anyOf[1]` | [ClientManifest](#schema-clientmanifest) | 分支内适用 |  |  |
| `$.anyOf[2]` | [RecipeManifest](#schema-recipemanifest) | 分支内适用 |  |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "anyOf": [
    {
      "$ref": "#/components/schemas/ClientManifest"
    },
    {
      "$ref": "#/components/schemas/RecipeManifest"
    }
  ]
}
```

</details>

<a id="schema-packagedownload"></a>

### PackageDownload

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | anyOf（4 个分支） | — |  |  |
| `$.anyOf[1]` | object | 分支内适用 | 不接受额外字段 |  |
| `$.anyOf[1].url` | string (uri) | 是 |  |  |
| `$.anyOf[1].expiresIn` | number | 是 | 可选值：`[300]` |  |
| `$.anyOf[1].expiresAt` | string (date-time) | 是 |  |  |
| `$.anyOf[1].etag` | string / null | 是 |  |  |
| `$.anyOf[1].sha256` | string | 是 | 正则：`"^[0-9a-f]{64}$"` |  |
| `$.anyOf[1].size` | integer | 是 | 最小值（含）：`0` |  |
| `$.anyOf[1].refreshUrl` | string | 是 |  |  |
| `$.anyOf[1].format` | string | 是 | 可选值：`["muapack"]` |  |
| `$.anyOf[1].releaseId` | string (uuid) | 是 |  |  |
| `$.anyOf[1].version` | string | 是 |  |  |
| `$.anyOf[1].targetManifestSha256` | string | 是 | 正则：`"^[0-9a-f]{64}$"` |  |
| `$.anyOf[1].signingKeyId` | string | 是 | 正则：`"^[0-9a-f]{24}$"` |  |
| `$.anyOf[1].full` | object | 是 | 不接受额外字段 |  |
| `$.anyOf[1].full.url` | string (uri) | 是 |  |  |
| `$.anyOf[1].full.expiresIn` | number | 是 | 可选值：`[300]` |  |
| `$.anyOf[1].full.expiresAt` | string (date-time) | 是 |  |  |
| `$.anyOf[1].full.etag` | string / null | 是 |  |  |
| `$.anyOf[1].full.sha256` | string | 是 | 正则：`"^[0-9a-f]{64}$"` |  |
| `$.anyOf[1].full.size` | integer | 是 | 最小值（含）：`0` |  |
| `$.anyOf[1].full.refreshUrl` | string | 是 |  |  |
| `$.anyOf[1].packageType` | string | 是 | 可选值：`["full"]` |  |
| `$.anyOf[1].baseReleaseId` | null | 是 |  |  |
| `$.anyOf[1].baseManifestSha256` | null | 是 |  |  |
| `$.anyOf[1].formatVersion` | number | 是 | 可选值：`[1]` |  |
| `$.anyOf[1].platform` | string | 是 | 可选值：`["windows-amd64","windows-aarch64","linux-amd64","linux-aarch64","macos-amd64","macos-aarch64"]` |  |
| `$.anyOf[1].mods` | array：object | 是 |  |  |
| `$.anyOf[1].mods[]` | object | 每个元素 | 不接受额外字段 |  |
| `$.anyOf[1].mods[].path` | string | 是 | 最短长度：`1`<br>最长长度：`1000` |  |
| `$.anyOf[1].mods[].name` | string / null | 是 | 最短长度：`1`<br>最长长度：`200` |  |
| `$.anyOf[1].mods[].version` | string / null | 是 | 最短长度：`1`<br>最长长度：`200` |  |
| `$.anyOf[1].mods[].optional` | boolean | 是 |  |  |
| `$.anyOf[2]` | object | 分支内适用 | 不接受额外字段 |  |
| `$.anyOf[2].url` | string (uri) | 是 |  |  |
| `$.anyOf[2].expiresIn` | number | 是 | 可选值：`[300]` |  |
| `$.anyOf[2].expiresAt` | string (date-time) | 是 |  |  |
| `$.anyOf[2].etag` | string / null | 是 |  |  |
| `$.anyOf[2].sha256` | string | 是 | 正则：`"^[0-9a-f]{64}$"` |  |
| `$.anyOf[2].size` | integer | 是 | 最小值（含）：`0` |  |
| `$.anyOf[2].refreshUrl` | string | 是 |  |  |
| `$.anyOf[2].format` | string | 是 | 可选值：`["muapack"]` |  |
| `$.anyOf[2].releaseId` | string (uuid) | 是 |  |  |
| `$.anyOf[2].version` | string | 是 |  |  |
| `$.anyOf[2].targetManifestSha256` | string | 是 | 正则：`"^[0-9a-f]{64}$"` |  |
| `$.anyOf[2].signingKeyId` | string | 是 | 正则：`"^[0-9a-f]{24}$"` |  |
| `$.anyOf[2].full` | object | 是 | 不接受额外字段 |  |
| `$.anyOf[2].full.url` | string (uri) | 是 |  |  |
| `$.anyOf[2].full.expiresIn` | number | 是 | 可选值：`[300]` |  |
| `$.anyOf[2].full.expiresAt` | string (date-time) | 是 |  |  |
| `$.anyOf[2].full.etag` | string / null | 是 |  |  |
| `$.anyOf[2].full.sha256` | string | 是 | 正则：`"^[0-9a-f]{64}$"` |  |
| `$.anyOf[2].full.size` | integer | 是 | 最小值（含）：`0` |  |
| `$.anyOf[2].full.refreshUrl` | string | 是 |  |  |
| `$.anyOf[2].packageType` | string | 是 | 可选值：`["full"]` |  |
| `$.anyOf[2].baseReleaseId` | null | 是 |  |  |
| `$.anyOf[2].baseManifestSha256` | null | 是 |  |  |
| `$.anyOf[2].formatVersion` | number | 是 | 可选值：`[2]` |  |
| `$.anyOf[2].minimumLauncherProtocol` | number | 是 | 可选值：`[2]` |  |
| `$.anyOf[2].protocolRevision` | number | 是 | 可选值：`[2]` |  |
| `$.anyOf[2].runtime` | object | 是 | 不接受额外字段 |  |
| `$.anyOf[2].runtime.minecraft` | string | 是 | 最短长度：`1`<br>最长长度：`200` |  |
| `$.anyOf[2].runtime.loader` | object / null | 是 | 不接受额外字段 |  |
| `$.anyOf[2].runtime.loader.type` | string | 是 | 可选值：`["fabric","quilt","forge","neoforge"]` |  |
| `$.anyOf[2].runtime.loader.version` | string | 是 | 最短长度：`1`<br>最长长度：`200` |  |
| `$.anyOf[2].runtime.java` | object | 是 | 不接受额外字段 |  |
| `$.anyOf[2].runtime.java.major` | integer | 是 | 最小值（含）：`7`<br>最大值（含）：`25` |  |
| `$.anyOf[2].runtime.java.vendor` | string | 是 | 可选值：`["adoptium"]` |  |
| `$.anyOf[2].runtime.java.imageType` | string | 是 | 可选值：`["jre","jdk"]` |  |
| `$.anyOf[2].runtime.resolverVersion` | string | 是 | 可选值：`["mua-runtime-resolver-1"]` |  |
| `$.anyOf[2].mods` | array：anyOf（2 个分支） | 是 |  |  |
| `$.anyOf[2].mods[]` | anyOf（2 个分支） | 每个元素 |  |  |
| `$.anyOf[2].mods[].anyOf[1]` | object | 分支内适用 | 不接受额外字段 |  |
| `$.anyOf[2].mods[].anyOf[1].path` | string | 是 |  |  |
| `$.anyOf[2].mods[].anyOf[1].name` | null | 是 |  |  |
| `$.anyOf[2].mods[].anyOf[1].version` | null | 是 |  |  |
| `$.anyOf[2].mods[].anyOf[1].optional` | boolean | 是 |  |  |
| `$.anyOf[2].mods[].anyOf[1].source` | string | 是 | 可选值：`["local"]` |  |
| `$.anyOf[2].mods[].anyOf[1].hashes` | object | 是 | 不接受额外字段 |  |
| `$.anyOf[2].mods[].anyOf[1].hashes.sha256` | string | 是 | 正则：`"^[0-9a-f]{64}$"` |  |
| `$.anyOf[2].mods[].anyOf[2]` | object | 分支内适用 | 不接受额外字段 |  |
| `$.anyOf[2].mods[].anyOf[2].path` | string | 是 |  |  |
| `$.anyOf[2].mods[].anyOf[2].name` | null | 是 |  |  |
| `$.anyOf[2].mods[].anyOf[2].version` | null | 是 |  |  |
| `$.anyOf[2].mods[].anyOf[2].optional` | boolean | 是 |  |  |
| `$.anyOf[2].mods[].anyOf[2].source` | string | 是 | 可选值：`["remote"]` |  |
| `$.anyOf[2].mods[].anyOf[2].hashes` | object | 是 | 不接受额外字段 |  |
| `$.anyOf[2].mods[].anyOf[2].hashes.sha1` | string | 是 | 正则：`"^[0-9a-f]{40}$"` |  |
| `$.anyOf[2].mods[].anyOf[2].hashes.sha512` | string | 是 | 正则：`"^[0-9a-f]{128}$"` |  |
| `$.anyOf[2].mods[].anyOf[2].hashes.sha256` | string | 否 | 正则：`"^[0-9a-f]{64}$"` |  |
| `$.anyOf[3]` | object | 分支内适用 | 不接受额外字段 |  |
| `$.anyOf[3].url` | string (uri) | 是 |  |  |
| `$.anyOf[3].expiresIn` | number | 是 | 可选值：`[300]` |  |
| `$.anyOf[3].expiresAt` | string (date-time) | 是 |  |  |
| `$.anyOf[3].etag` | string / null | 是 |  |  |
| `$.anyOf[3].sha256` | string | 是 | 正则：`"^[0-9a-f]{64}$"` |  |
| `$.anyOf[3].size` | integer | 是 | 最小值（含）：`0` |  |
| `$.anyOf[3].refreshUrl` | string | 是 |  |  |
| `$.anyOf[3].format` | string | 是 | 可选值：`["muapack"]` |  |
| `$.anyOf[3].releaseId` | string (uuid) | 是 |  |  |
| `$.anyOf[3].version` | string | 是 |  |  |
| `$.anyOf[3].targetManifestSha256` | string | 是 | 正则：`"^[0-9a-f]{64}$"` |  |
| `$.anyOf[3].signingKeyId` | string | 是 | 正则：`"^[0-9a-f]{24}$"` |  |
| `$.anyOf[3].full` | object | 是 | 不接受额外字段 |  |
| `$.anyOf[3].full.url` | string (uri) | 是 |  |  |
| `$.anyOf[3].full.expiresIn` | number | 是 | 可选值：`[300]` |  |
| `$.anyOf[3].full.expiresAt` | string (date-time) | 是 |  |  |
| `$.anyOf[3].full.etag` | string / null | 是 |  |  |
| `$.anyOf[3].full.sha256` | string | 是 | 正则：`"^[0-9a-f]{64}$"` |  |
| `$.anyOf[3].full.size` | integer | 是 | 最小值（含）：`0` |  |
| `$.anyOf[3].full.refreshUrl` | string | 是 |  |  |
| `$.anyOf[3].packageType` | string | 是 | 可选值：`["update"]` |  |
| `$.anyOf[3].baseReleaseId` | string (uuid) | 是 |  |  |
| `$.anyOf[3].baseManifestSha256` | string | 是 | 正则：`"^[0-9a-f]{64}$"` |  |
| `$.anyOf[3].formatVersion` | number | 是 | 可选值：`[1]` |  |
| `$.anyOf[3].platform` | string | 是 | 可选值：`["windows-amd64","windows-aarch64","linux-amd64","linux-aarch64","macos-amd64","macos-aarch64"]` |  |
| `$.anyOf[3].mods` | array：object | 是 |  |  |
| `$.anyOf[3].mods[]` | object | 每个元素 | 不接受额外字段 |  |
| `$.anyOf[3].mods[].path` | string | 是 | 最短长度：`1`<br>最长长度：`1000` |  |
| `$.anyOf[3].mods[].name` | string / null | 是 | 最短长度：`1`<br>最长长度：`200` |  |
| `$.anyOf[3].mods[].version` | string / null | 是 | 最短长度：`1`<br>最长长度：`200` |  |
| `$.anyOf[3].mods[].optional` | boolean | 是 |  |  |
| `$.anyOf[4]` | object | 分支内适用 | 不接受额外字段 |  |
| `$.anyOf[4].url` | string (uri) | 是 |  |  |
| `$.anyOf[4].expiresIn` | number | 是 | 可选值：`[300]` |  |
| `$.anyOf[4].expiresAt` | string (date-time) | 是 |  |  |
| `$.anyOf[4].etag` | string / null | 是 |  |  |
| `$.anyOf[4].sha256` | string | 是 | 正则：`"^[0-9a-f]{64}$"` |  |
| `$.anyOf[4].size` | integer | 是 | 最小值（含）：`0` |  |
| `$.anyOf[4].refreshUrl` | string | 是 |  |  |
| `$.anyOf[4].format` | string | 是 | 可选值：`["muapack"]` |  |
| `$.anyOf[4].releaseId` | string (uuid) | 是 |  |  |
| `$.anyOf[4].version` | string | 是 |  |  |
| `$.anyOf[4].targetManifestSha256` | string | 是 | 正则：`"^[0-9a-f]{64}$"` |  |
| `$.anyOf[4].signingKeyId` | string | 是 | 正则：`"^[0-9a-f]{24}$"` |  |
| `$.anyOf[4].full` | object | 是 | 不接受额外字段 |  |
| `$.anyOf[4].full.url` | string (uri) | 是 |  |  |
| `$.anyOf[4].full.expiresIn` | number | 是 | 可选值：`[300]` |  |
| `$.anyOf[4].full.expiresAt` | string (date-time) | 是 |  |  |
| `$.anyOf[4].full.etag` | string / null | 是 |  |  |
| `$.anyOf[4].full.sha256` | string | 是 | 正则：`"^[0-9a-f]{64}$"` |  |
| `$.anyOf[4].full.size` | integer | 是 | 最小值（含）：`0` |  |
| `$.anyOf[4].full.refreshUrl` | string | 是 |  |  |
| `$.anyOf[4].packageType` | string | 是 | 可选值：`["update"]` |  |
| `$.anyOf[4].baseReleaseId` | string (uuid) | 是 |  |  |
| `$.anyOf[4].baseManifestSha256` | string | 是 | 正则：`"^[0-9a-f]{64}$"` |  |
| `$.anyOf[4].formatVersion` | number | 是 | 可选值：`[2]` |  |
| `$.anyOf[4].minimumLauncherProtocol` | number | 是 | 可选值：`[2]` |  |
| `$.anyOf[4].protocolRevision` | number | 是 | 可选值：`[2]` |  |
| `$.anyOf[4].runtime` | object | 是 | 不接受额外字段 |  |
| `$.anyOf[4].runtime.minecraft` | string | 是 | 最短长度：`1`<br>最长长度：`200` |  |
| `$.anyOf[4].runtime.loader` | object / null | 是 | 不接受额外字段 |  |
| `$.anyOf[4].runtime.loader.type` | string | 是 | 可选值：`["fabric","quilt","forge","neoforge"]` |  |
| `$.anyOf[4].runtime.loader.version` | string | 是 | 最短长度：`1`<br>最长长度：`200` |  |
| `$.anyOf[4].runtime.java` | object | 是 | 不接受额外字段 |  |
| `$.anyOf[4].runtime.java.major` | integer | 是 | 最小值（含）：`7`<br>最大值（含）：`25` |  |
| `$.anyOf[4].runtime.java.vendor` | string | 是 | 可选值：`["adoptium"]` |  |
| `$.anyOf[4].runtime.java.imageType` | string | 是 | 可选值：`["jre","jdk"]` |  |
| `$.anyOf[4].runtime.resolverVersion` | string | 是 | 可选值：`["mua-runtime-resolver-1"]` |  |
| `$.anyOf[4].mods` | array：anyOf（2 个分支） | 是 |  |  |
| `$.anyOf[4].mods[]` | anyOf（2 个分支） | 每个元素 |  |  |
| `$.anyOf[4].mods[].anyOf[1]` | object | 分支内适用 | 不接受额外字段 |  |
| `$.anyOf[4].mods[].anyOf[1].path` | string | 是 |  |  |
| `$.anyOf[4].mods[].anyOf[1].name` | null | 是 |  |  |
| `$.anyOf[4].mods[].anyOf[1].version` | null | 是 |  |  |
| `$.anyOf[4].mods[].anyOf[1].optional` | boolean | 是 |  |  |
| `$.anyOf[4].mods[].anyOf[1].source` | string | 是 | 可选值：`["local"]` |  |
| `$.anyOf[4].mods[].anyOf[1].hashes` | object | 是 | 不接受额外字段 |  |
| `$.anyOf[4].mods[].anyOf[1].hashes.sha256` | string | 是 | 正则：`"^[0-9a-f]{64}$"` |  |
| `$.anyOf[4].mods[].anyOf[2]` | object | 分支内适用 | 不接受额外字段 |  |
| `$.anyOf[4].mods[].anyOf[2].path` | string | 是 |  |  |
| `$.anyOf[4].mods[].anyOf[2].name` | null | 是 |  |  |
| `$.anyOf[4].mods[].anyOf[2].version` | null | 是 |  |  |
| `$.anyOf[4].mods[].anyOf[2].optional` | boolean | 是 |  |  |
| `$.anyOf[4].mods[].anyOf[2].source` | string | 是 | 可选值：`["remote"]` |  |
| `$.anyOf[4].mods[].anyOf[2].hashes` | object | 是 | 不接受额外字段 |  |
| `$.anyOf[4].mods[].anyOf[2].hashes.sha1` | string | 是 | 正则：`"^[0-9a-f]{40}$"` |  |
| `$.anyOf[4].mods[].anyOf[2].hashes.sha512` | string | 是 | 正则：`"^[0-9a-f]{128}$"` |  |
| `$.anyOf[4].mods[].anyOf[2].hashes.sha256` | string | 否 | 正则：`"^[0-9a-f]{64}$"` |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "anyOf": [
    {
      "type": "object",
      "properties": {
        "url": {
          "type": "string",
          "format": "uri"
        },
        "expiresIn": {
          "type": "number",
          "enum": [
            300
          ]
        },
        "expiresAt": {
          "type": "string",
          "format": "date-time"
        },
        "etag": {
          "type": [
            "string",
            "null"
          ]
        },
        "sha256": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$"
        },
        "size": {
          "type": "integer",
          "minimum": 0
        },
        "refreshUrl": {
          "type": "string"
        },
        "format": {
          "type": "string",
          "enum": [
            "muapack"
          ]
        },
        "releaseId": {
          "type": "string",
          "format": "uuid"
        },
        "version": {
          "type": "string"
        },
        "targetManifestSha256": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$"
        },
        "signingKeyId": {
          "type": "string",
          "pattern": "^[0-9a-f]{24}$"
        },
        "full": {
          "type": "object",
          "properties": {
            "url": {
              "type": "string",
              "format": "uri"
            },
            "expiresIn": {
              "type": "number",
              "enum": [
                300
              ]
            },
            "expiresAt": {
              "type": "string",
              "format": "date-time"
            },
            "etag": {
              "type": [
                "string",
                "null"
              ]
            },
            "sha256": {
              "type": "string",
              "pattern": "^[0-9a-f]{64}$"
            },
            "size": {
              "type": "integer",
              "minimum": 0
            },
            "refreshUrl": {
              "type": "string"
            }
          },
          "required": [
            "url",
            "expiresIn",
            "expiresAt",
            "etag",
            "sha256",
            "size",
            "refreshUrl"
          ],
          "additionalProperties": false
        },
        "packageType": {
          "type": "string",
          "enum": [
            "full"
          ]
        },
        "baseReleaseId": {
          "type": "null"
        },
        "baseManifestSha256": {
          "type": "null"
        },
        "formatVersion": {
          "type": "number",
          "enum": [
            1
          ]
        },
        "platform": {
          "type": "string",
          "enum": [
            "windows-amd64",
            "windows-aarch64",
            "linux-amd64",
            "linux-aarch64",
            "macos-amd64",
            "macos-aarch64"
          ]
        },
        "mods": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "path": {
                "type": "string",
                "minLength": 1,
                "maxLength": 1000
              },
              "name": {
                "type": [
                  "string",
                  "null"
                ],
                "minLength": 1,
                "maxLength": 200
              },
              "version": {
                "type": [
                  "string",
                  "null"
                ],
                "minLength": 1,
                "maxLength": 200
              },
              "optional": {
                "type": "boolean"
              }
            },
            "required": [
              "path",
              "name",
              "version",
              "optional"
            ],
            "additionalProperties": false
          }
        }
      },
      "required": [
        "url",
        "expiresIn",
        "expiresAt",
        "etag",
        "sha256",
        "size",
        "refreshUrl",
        "format",
        "releaseId",
        "version",
        "targetManifestSha256",
        "signingKeyId",
        "full",
        "packageType",
        "baseReleaseId",
        "baseManifestSha256",
        "formatVersion",
        "platform",
        "mods"
      ],
      "additionalProperties": false
    },
    {
      "type": "object",
      "properties": {
        "url": {
          "type": "string",
          "format": "uri"
        },
        "expiresIn": {
          "type": "number",
          "enum": [
            300
          ]
        },
        "expiresAt": {
          "type": "string",
          "format": "date-time"
        },
        "etag": {
          "type": [
            "string",
            "null"
          ]
        },
        "sha256": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$"
        },
        "size": {
          "type": "integer",
          "minimum": 0
        },
        "refreshUrl": {
          "type": "string"
        },
        "format": {
          "type": "string",
          "enum": [
            "muapack"
          ]
        },
        "releaseId": {
          "type": "string",
          "format": "uuid"
        },
        "version": {
          "type": "string"
        },
        "targetManifestSha256": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$"
        },
        "signingKeyId": {
          "type": "string",
          "pattern": "^[0-9a-f]{24}$"
        },
        "full": {
          "type": "object",
          "properties": {
            "url": {
              "type": "string",
              "format": "uri"
            },
            "expiresIn": {
              "type": "number",
              "enum": [
                300
              ]
            },
            "expiresAt": {
              "type": "string",
              "format": "date-time"
            },
            "etag": {
              "type": [
                "string",
                "null"
              ]
            },
            "sha256": {
              "type": "string",
              "pattern": "^[0-9a-f]{64}$"
            },
            "size": {
              "type": "integer",
              "minimum": 0
            },
            "refreshUrl": {
              "type": "string"
            }
          },
          "required": [
            "url",
            "expiresIn",
            "expiresAt",
            "etag",
            "sha256",
            "size",
            "refreshUrl"
          ],
          "additionalProperties": false
        },
        "packageType": {
          "type": "string",
          "enum": [
            "full"
          ]
        },
        "baseReleaseId": {
          "type": "null"
        },
        "baseManifestSha256": {
          "type": "null"
        },
        "formatVersion": {
          "type": "number",
          "enum": [
            2
          ]
        },
        "minimumLauncherProtocol": {
          "type": "number",
          "enum": [
            2
          ]
        },
        "protocolRevision": {
          "type": "number",
          "enum": [
            2
          ]
        },
        "runtime": {
          "type": "object",
          "properties": {
            "minecraft": {
              "type": "string",
              "minLength": 1,
              "maxLength": 200
            },
            "loader": {
              "type": [
                "object",
                "null"
              ],
              "properties": {
                "type": {
                  "type": "string",
                  "enum": [
                    "fabric",
                    "quilt",
                    "forge",
                    "neoforge"
                  ]
                },
                "version": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 200
                }
              },
              "required": [
                "type",
                "version"
              ],
              "additionalProperties": false
            },
            "java": {
              "type": "object",
              "properties": {
                "major": {
                  "type": "integer",
                  "minimum": 7,
                  "maximum": 25
                },
                "vendor": {
                  "type": "string",
                  "enum": [
                    "adoptium"
                  ]
                },
                "imageType": {
                  "type": "string",
                  "enum": [
                    "jre",
                    "jdk"
                  ]
                }
              },
              "required": [
                "major",
                "vendor",
                "imageType"
              ],
              "additionalProperties": false
            },
            "resolverVersion": {
              "type": "string",
              "enum": [
                "mua-runtime-resolver-1"
              ]
            }
          },
          "required": [
            "minecraft",
            "loader",
            "java",
            "resolverVersion"
          ],
          "additionalProperties": false
        },
        "mods": {
          "type": "array",
          "items": {
            "anyOf": [
              {
                "type": "object",
                "properties": {
                  "path": {
                    "type": "string"
                  },
                  "name": {
                    "type": "null"
                  },
                  "version": {
                    "type": "null"
                  },
                  "optional": {
                    "type": "boolean"
                  },
                  "source": {
                    "type": "string",
                    "enum": [
                      "local"
                    ]
                  },
                  "hashes": {
                    "type": "object",
                    "properties": {
                      "sha256": {
                        "type": "string",
                        "pattern": "^[0-9a-f]{64}$"
                      }
                    },
                    "required": [
                      "sha256"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "path",
                  "name",
                  "version",
                  "optional",
                  "source",
                  "hashes"
                ],
                "additionalProperties": false
              },
              {
                "type": "object",
                "properties": {
                  "path": {
                    "type": "string"
                  },
                  "name": {
                    "type": "null"
                  },
                  "version": {
                    "type": "null"
                  },
                  "optional": {
                    "type": "boolean"
                  },
                  "source": {
                    "type": "string",
                    "enum": [
                      "remote"
                    ]
                  },
                  "hashes": {
                    "type": "object",
                    "properties": {
                      "sha1": {
                        "type": "string",
                        "pattern": "^[0-9a-f]{40}$"
                      },
                      "sha512": {
                        "type": "string",
                        "pattern": "^[0-9a-f]{128}$"
                      },
                      "sha256": {
                        "type": "string",
                        "pattern": "^[0-9a-f]{64}$"
                      }
                    },
                    "required": [
                      "sha1",
                      "sha512"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "path",
                  "name",
                  "version",
                  "optional",
                  "source",
                  "hashes"
                ],
                "additionalProperties": false
              }
            ]
          }
        }
      },
      "required": [
        "url",
        "expiresIn",
        "expiresAt",
        "etag",
        "sha256",
        "size",
        "refreshUrl",
        "format",
        "releaseId",
        "version",
        "targetManifestSha256",
        "signingKeyId",
        "full",
        "packageType",
        "baseReleaseId",
        "baseManifestSha256",
        "formatVersion",
        "minimumLauncherProtocol",
        "protocolRevision",
        "runtime",
        "mods"
      ],
      "additionalProperties": false
    },
    {
      "type": "object",
      "properties": {
        "url": {
          "type": "string",
          "format": "uri"
        },
        "expiresIn": {
          "type": "number",
          "enum": [
            300
          ]
        },
        "expiresAt": {
          "type": "string",
          "format": "date-time"
        },
        "etag": {
          "type": [
            "string",
            "null"
          ]
        },
        "sha256": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$"
        },
        "size": {
          "type": "integer",
          "minimum": 0
        },
        "refreshUrl": {
          "type": "string"
        },
        "format": {
          "type": "string",
          "enum": [
            "muapack"
          ]
        },
        "releaseId": {
          "type": "string",
          "format": "uuid"
        },
        "version": {
          "type": "string"
        },
        "targetManifestSha256": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$"
        },
        "signingKeyId": {
          "type": "string",
          "pattern": "^[0-9a-f]{24}$"
        },
        "full": {
          "type": "object",
          "properties": {
            "url": {
              "type": "string",
              "format": "uri"
            },
            "expiresIn": {
              "type": "number",
              "enum": [
                300
              ]
            },
            "expiresAt": {
              "type": "string",
              "format": "date-time"
            },
            "etag": {
              "type": [
                "string",
                "null"
              ]
            },
            "sha256": {
              "type": "string",
              "pattern": "^[0-9a-f]{64}$"
            },
            "size": {
              "type": "integer",
              "minimum": 0
            },
            "refreshUrl": {
              "type": "string"
            }
          },
          "required": [
            "url",
            "expiresIn",
            "expiresAt",
            "etag",
            "sha256",
            "size",
            "refreshUrl"
          ],
          "additionalProperties": false
        },
        "packageType": {
          "type": "string",
          "enum": [
            "update"
          ]
        },
        "baseReleaseId": {
          "type": "string",
          "format": "uuid"
        },
        "baseManifestSha256": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$"
        },
        "formatVersion": {
          "type": "number",
          "enum": [
            1
          ]
        },
        "platform": {
          "type": "string",
          "enum": [
            "windows-amd64",
            "windows-aarch64",
            "linux-amd64",
            "linux-aarch64",
            "macos-amd64",
            "macos-aarch64"
          ]
        },
        "mods": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "path": {
                "type": "string",
                "minLength": 1,
                "maxLength": 1000
              },
              "name": {
                "type": [
                  "string",
                  "null"
                ],
                "minLength": 1,
                "maxLength": 200
              },
              "version": {
                "type": [
                  "string",
                  "null"
                ],
                "minLength": 1,
                "maxLength": 200
              },
              "optional": {
                "type": "boolean"
              }
            },
            "required": [
              "path",
              "name",
              "version",
              "optional"
            ],
            "additionalProperties": false
          }
        }
      },
      "required": [
        "url",
        "expiresIn",
        "expiresAt",
        "etag",
        "sha256",
        "size",
        "refreshUrl",
        "format",
        "releaseId",
        "version",
        "targetManifestSha256",
        "signingKeyId",
        "full",
        "packageType",
        "baseReleaseId",
        "baseManifestSha256",
        "formatVersion",
        "platform",
        "mods"
      ],
      "additionalProperties": false
    },
    {
      "type": "object",
      "properties": {
        "url": {
          "type": "string",
          "format": "uri"
        },
        "expiresIn": {
          "type": "number",
          "enum": [
            300
          ]
        },
        "expiresAt": {
          "type": "string",
          "format": "date-time"
        },
        "etag": {
          "type": [
            "string",
            "null"
          ]
        },
        "sha256": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$"
        },
        "size": {
          "type": "integer",
          "minimum": 0
        },
        "refreshUrl": {
          "type": "string"
        },
        "format": {
          "type": "string",
          "enum": [
            "muapack"
          ]
        },
        "releaseId": {
          "type": "string",
          "format": "uuid"
        },
        "version": {
          "type": "string"
        },
        "targetManifestSha256": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$"
        },
        "signingKeyId": {
          "type": "string",
          "pattern": "^[0-9a-f]{24}$"
        },
        "full": {
          "type": "object",
          "properties": {
            "url": {
              "type": "string",
              "format": "uri"
            },
            "expiresIn": {
              "type": "number",
              "enum": [
                300
              ]
            },
            "expiresAt": {
              "type": "string",
              "format": "date-time"
            },
            "etag": {
              "type": [
                "string",
                "null"
              ]
            },
            "sha256": {
              "type": "string",
              "pattern": "^[0-9a-f]{64}$"
            },
            "size": {
              "type": "integer",
              "minimum": 0
            },
            "refreshUrl": {
              "type": "string"
            }
          },
          "required": [
            "url",
            "expiresIn",
            "expiresAt",
            "etag",
            "sha256",
            "size",
            "refreshUrl"
          ],
          "additionalProperties": false
        },
        "packageType": {
          "type": "string",
          "enum": [
            "update"
          ]
        },
        "baseReleaseId": {
          "type": "string",
          "format": "uuid"
        },
        "baseManifestSha256": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$"
        },
        "formatVersion": {
          "type": "number",
          "enum": [
            2
          ]
        },
        "minimumLauncherProtocol": {
          "type": "number",
          "enum": [
            2
          ]
        },
        "protocolRevision": {
          "type": "number",
          "enum": [
            2
          ]
        },
        "runtime": {
          "type": "object",
          "properties": {
            "minecraft": {
              "type": "string",
              "minLength": 1,
              "maxLength": 200
            },
            "loader": {
              "type": [
                "object",
                "null"
              ],
              "properties": {
                "type": {
                  "type": "string",
                  "enum": [
                    "fabric",
                    "quilt",
                    "forge",
                    "neoforge"
                  ]
                },
                "version": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 200
                }
              },
              "required": [
                "type",
                "version"
              ],
              "additionalProperties": false
            },
            "java": {
              "type": "object",
              "properties": {
                "major": {
                  "type": "integer",
                  "minimum": 7,
                  "maximum": 25
                },
                "vendor": {
                  "type": "string",
                  "enum": [
                    "adoptium"
                  ]
                },
                "imageType": {
                  "type": "string",
                  "enum": [
                    "jre",
                    "jdk"
                  ]
                }
              },
              "required": [
                "major",
                "vendor",
                "imageType"
              ],
              "additionalProperties": false
            },
            "resolverVersion": {
              "type": "string",
              "enum": [
                "mua-runtime-resolver-1"
              ]
            }
          },
          "required": [
            "minecraft",
            "loader",
            "java",
            "resolverVersion"
          ],
          "additionalProperties": false
        },
        "mods": {
          "type": "array",
          "items": {
            "anyOf": [
              {
                "type": "object",
                "properties": {
                  "path": {
                    "type": "string"
                  },
                  "name": {
                    "type": "null"
                  },
                  "version": {
                    "type": "null"
                  },
                  "optional": {
                    "type": "boolean"
                  },
                  "source": {
                    "type": "string",
                    "enum": [
                      "local"
                    ]
                  },
                  "hashes": {
                    "type": "object",
                    "properties": {
                      "sha256": {
                        "type": "string",
                        "pattern": "^[0-9a-f]{64}$"
                      }
                    },
                    "required": [
                      "sha256"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "path",
                  "name",
                  "version",
                  "optional",
                  "source",
                  "hashes"
                ],
                "additionalProperties": false
              },
              {
                "type": "object",
                "properties": {
                  "path": {
                    "type": "string"
                  },
                  "name": {
                    "type": "null"
                  },
                  "version": {
                    "type": "null"
                  },
                  "optional": {
                    "type": "boolean"
                  },
                  "source": {
                    "type": "string",
                    "enum": [
                      "remote"
                    ]
                  },
                  "hashes": {
                    "type": "object",
                    "properties": {
                      "sha1": {
                        "type": "string",
                        "pattern": "^[0-9a-f]{40}$"
                      },
                      "sha512": {
                        "type": "string",
                        "pattern": "^[0-9a-f]{128}$"
                      },
                      "sha256": {
                        "type": "string",
                        "pattern": "^[0-9a-f]{64}$"
                      }
                    },
                    "required": [
                      "sha1",
                      "sha512"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "path",
                  "name",
                  "version",
                  "optional",
                  "source",
                  "hashes"
                ],
                "additionalProperties": false
              }
            ]
          }
        }
      },
      "required": [
        "url",
        "expiresIn",
        "expiresAt",
        "etag",
        "sha256",
        "size",
        "refreshUrl",
        "format",
        "releaseId",
        "version",
        "targetManifestSha256",
        "signingKeyId",
        "full",
        "packageType",
        "baseReleaseId",
        "baseManifestSha256",
        "formatVersion",
        "minimumLauncherProtocol",
        "protocolRevision",
        "runtime",
        "mods"
      ],
      "additionalProperties": false
    }
  ]
}
```

</details>

<a id="schema-client"></a>

### Client

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `clientId` | string (uuid) | 是 |  |  |
| `name` | string | 是 |  |  |
| `organizationId` | string (uuid) | 是 |  |  |
| `organizationName` | string | 是 |  |  |
| `serverId` | string / null | 是 | 正则：`"^[A-Za-z]{3,5}$"` |  |
| `serverName` | string | 是 |  |  |
| `requestedServerId` | string / null | 是 | 正则：`"^[A-Za-z]{3,5}$"` |  |
| `scopeServerId` | string / null | 是 | 正则：`"^[A-Za-z]{3,5}$"` |  |
| `archived` | boolean | 是 |  |  |
| `blocked` | boolean | 是 |  |  |
| `displaySchedule` | object / null | 是 | 不接受额外字段 |  |
| `displaySchedule.displayMode` | string | 是 | 可选值：`["PERMANENT","RANGE"]` |  |
| `displaySchedule.displayStartsAt` | string / null (date-time) | 是 |  |  |
| `displaySchedule.displayEndsAt` | string / null (date-time) | 是 |  |  |
| `lifecycleStatus` | string | 是 | 可选值：`["ARCHIVED","PUBLISHED","UNPUBLISHED"]` |  |
| `permissions` | array：string | 是 |  |  |
| `permissions[]` | string | 每个元素 | 可选值：`["SERVER_READ","SERVER_EDIT","DRAFT_READ","DRAFT_CREATE","DRAFT_EDIT","DRAFT_SUBMIT","DRAFT_ARCHIVE","RELEASE_READ","ORG_EDIT","ORG_MEMBERS_READ","ORG_MEMBERS_MANAGE","CLIENT_ARCHIVE","CLIENT_DELETE","CLIENT_BIND","DRAFT_REVIEW","RELEASE_PUBLISH","RELEASE_ACTIVATE"]` |  |
| `publicationRevision` | integer | 是 | 最小值（含）：`0` |  |
| `currentReleaseId` | string / null (uuid) | 是 |  |  |
| `initialPackageFormatVersion` | integer / null | 是 |  |  |
| `bindingRevision` | integer / null | 是 | 最小值（含）：`0` |  |
| `drafts` | array：object | 是 |  |  |
| `drafts[]` | object | 每个元素 | 不接受额外字段 |  |
| `drafts[].id` | string (uuid) | 是 |  |  |
| `drafts[].versionLabel` | string / null | 是 |  |  |
| `drafts[].name` | string / null | 是 |  |  |
| `drafts[].description` | string / null | 是 |  |  |
| `drafts[].changelog` | string | 是 |  |  |
| `drafts[].summary` | string / null | 是 |  |  |
| `drafts[].archivedAt` | string / null (date-time) | 是 |  |  |
| `drafts[].packageFormatVersion` | integer | 是 |  |  |
| `drafts[].versionSequence` | integer | 是 | 最小值（含）：`0` |  |
| `drafts[].replacesDraftId` | string / null (uuid) | 是 |  |  |
| `drafts[].archiveReason` | string / null | 是 |  |  |
| `drafts[].supersededByDraftId` | string / null (uuid) | 是 |  |  |
| `drafts[].candidateMetadata` | 未限定类型 | 否 |  |  |
| `drafts[].reviewNote` | string / null | 是 |  |  |
| `drafts[].status` | string | 是 | 可选值：`["DRAFT","SUBMITTED","APPROVED","REJECTED","RELEASED"]` |  |
| `drafts[].contentRevision` | integer | 是 | 最小值（含）：`0` |  |
| `drafts[].packageRevision` | integer | 是 | 最小值（含）：`0` |  |
| `drafts[].createdAt` | string (date-time) | 是 |  |  |
| `drafts[].upload` | object / null | 是 | 不接受额外字段 |  |
| `drafts[].upload.id` | string (uuid) | 是 |  |  |
| `drafts[].upload.statistics` | anyOf（3 个分支） | 是 |  |  |
| `drafts[].upload.statistics.anyOf[1]` | object | 分支内适用 | 不接受额外字段 |  |
| `drafts[].upload.statistics.anyOf[1].previousVersion` | string / null | 是 |  |  |
| `drafts[].upload.statistics.anyOf[1].addedFiles` | integer | 是 | 最小值（含）：`0` |  |
| `drafts[].upload.statistics.anyOf[1].modifiedFiles` | integer | 是 | 最小值（含）：`0` |  |
| `drafts[].upload.statistics.anyOf[1].deletedFiles` | integer | 是 | 最小值（含）：`0` |  |
| `drafts[].upload.statistics.anyOf[1].fullSize` | integer | 是 | 最小值（含）：`0` |  |
| `drafts[].upload.statistics.anyOf[1].newDataSize` | integer | 是 | 最小值（含）：`0` |  |
| `drafts[].upload.statistics.anyOf[1].estimatedDownloadSize` | integer | 是 | 最小值（含）：`0` |  |
| `drafts[].upload.statistics.anyOf[1].casReusePercent` | number | 是 |  |  |
| `drafts[].upload.statistics.anyOf[1].fileCount` | integer | 是 | 最小值（含）：`0` |  |
| `drafts[].upload.statistics.anyOf[1].sourceSize` | integer | 是 | 最小值（含）：`0` |  |
| `drafts[].upload.statistics.anyOf[2]` | object | 分支内适用 | 不接受额外字段 |  |
| `drafts[].upload.statistics.anyOf[2].localFiles` | integer | 是 | 最小值（含）：`0` |  |
| `drafts[].upload.statistics.anyOf[2].remoteFiles` | integer | 是 | 最小值（含）：`0` |  |
| `drafts[].upload.statistics.anyOf[2].optionalFiles` | integer | 是 | 最小值（含）：`0` |  |
| `drafts[].upload.statistics.anyOf[2].localSize` | integer | 是 | 最小值（含）：`0` |  |
| `drafts[].upload.statistics.anyOf[2].remoteDeclaredSize` | integer | 是 | 最小值（含）：`0` |  |
| `drafts[].upload.statistics.anyOf[2].newLocalDataSize` | integer | 是 | 最小值（含）：`0` |  |
| `drafts[].upload.statistics.anyOf[2].localCasReusePercent` | number | 是 |  |  |
| `drafts[].upload.statistics.anyOf[2].sourceSize` | integer | 是 | 最小值（含）：`0` |  |
| `drafts[].upload.statistics.anyOf[3]` | null | 分支内适用 |  |  |
| `drafts[].upload.comparisonStatistics` | object / null | 是 | 不接受额外字段 |  |
| `drafts[].upload.comparisonStatistics.previousVersion` | string / null | 是 |  |  |
| `drafts[].upload.comparisonStatistics.addedFiles` | integer | 是 | 最小值（含）：`0` |  |
| `drafts[].upload.comparisonStatistics.modifiedFiles` | integer | 是 | 最小值（含）：`0` |  |
| `drafts[].upload.comparisonStatistics.deletedFiles` | integer | 是 | 最小值（含）：`0` |  |
| `drafts[].upload.comparisonStatistics.fullSize` | integer | 是 | 最小值（含）：`0` |  |
| `drafts[].upload.comparisonStatistics.newDataSize` | integer | 是 | 最小值（含）：`0` |  |
| `drafts[].upload.comparisonStatistics.estimatedDownloadSize` | integer | 是 | 最小值（含）：`0` |  |
| `drafts[].upload.comparisonStatistics.casReusePercent` | number | 是 |  |  |
| `drafts[].upload.comparisonStatistics.fileCount` | integer | 是 | 最小值（含）：`0` |  |
| `drafts[].upload.comparisonStatistics.sourceSize` | integer | 是 | 最小值（含）：`0` |  |
| `drafts[].packageBuilds` | array：object | 是 |  |  |
| `drafts[].packageBuilds[]` | object | 每个元素 | 不接受额外字段 |  |
| `drafts[].packageBuilds[].platform` | string | 是 |  |  |
| `drafts[].packageBuilds[].status` | string | 是 | 可选值：`["QUEUED","PROCESSING","PREPARED","READY","FAILED"]` |  |
| `drafts[].packageBuilds[].phase` | object | 是 | 不接受额外字段 |  |
| `drafts[].packageBuilds[].phase.code` | string | 是 |  |  |
| `drafts[].packageBuilds[].phase.message` | string | 是 |  |  |
| `drafts[].packageBuilds[].phase.params` | object | 是 | 动态字段值：anyOf（2 个分支） |  |
| `drafts[].packageBuilds[].phase.params{key}` | anyOf（2 个分支） | 动态字段 |  |  |
| `drafts[].packageBuilds[].phase.params{key}.anyOf[1]` | string | 分支内适用 |  |  |
| `drafts[].packageBuilds[].phase.params{key}.anyOf[2]` | number | 分支内适用 |  |  |
| `drafts[].packageBuilds[].progress` | integer | 是 | 最小值（含）：`0` |  |
| `drafts[].packageBuilds[].error` | object / null | 是 | 不接受额外字段 |  |
| `drafts[].packageBuilds[].error.code` | string | 是 |  |  |
| `drafts[].packageBuilds[].error.message` | string | 是 |  |  |
| `drafts[].packageBuilds[].error.params` | object | 是 | 动态字段值：anyOf（2 个分支） |  |
| `drafts[].packageBuilds[].error.params{key}` | anyOf（2 个分支） | 动态字段 |  |  |
| `drafts[].packageBuilds[].error.params{key}.anyOf[1]` | string | 分支内适用 |  |  |
| `drafts[].packageBuilds[].error.params{key}.anyOf[2]` | number | 分支内适用 |  |  |
| `drafts[].packageBuilds[].artifacts` | object / null | 是 | 不接受额外字段 |  |
| `drafts[].packageBuilds[].artifacts.full` | object | 是 |  |  |
| `drafts[].packageBuilds[].artifacts.full.key` | string | 是 |  |  |
| `drafts[].packageBuilds[].artifacts.full.sha256` | string | 是 | 正则：`"^[a-f0-9]{64}$"` |  |
| `drafts[].packageBuilds[].artifacts.full.size` | integer | 是 | 最小值（含）：`0` |  |
| `drafts[].packageBuilds[].artifacts.update` | object / null | 是 |  |  |
| `drafts[].packageBuilds[].artifacts.update.key` | string | 是 |  |  |
| `drafts[].packageBuilds[].artifacts.update.sha256` | string | 是 | 正则：`"^[a-f0-9]{64}$"` |  |
| `drafts[].packageBuilds[].artifacts.update.size` | integer | 是 | 最小值（含）：`0` |  |
| `drafts[].packageBuilds[].artifacts.update.baseReleaseId` | string (uuid) | 是 |  |  |
| `drafts[].packageBuilds[].artifacts.update.baseManifestSha256` | string | 是 | 正则：`"^[a-f0-9]{64}$"` |  |
| `drafts[].packageBuilds[].artifacts.signingKeyId` | string | 是 | 正则：`"^[a-f0-9]{24}$"` |  |
| `releases` | array：object | 是 |  |  |
| `releases[]` | object | 每个元素 | 不接受额外字段 |  |
| `releases[].id` | string (uuid) | 是 |  |  |
| `releases[].versionLabel` | string | 是 |  |  |
| `releases[].name` | string | 是 |  |  |
| `releases[].description` | string | 是 |  |  |
| `releases[].changelog` | string | 是 |  |  |
| `releases[].summary` | string | 是 |  |  |
| `releases[].archivedAt` | string / null (date-time) | 是 |  |  |
| `releases[].packageFormatVersion` | integer | 是 |  |  |
| `releases[].environmentSnapshot` | 未限定类型 | 否 |  |  |
| `releases[].publishedAt` | string (date-time) | 是 |  |  |
| `releases[].sourceDraft` | object / null | 是 | 不接受额外字段 |  |
| `releases[].sourceDraft.packageRevision` | integer | 是 | 最小值（含）：`0` |  |
| `releases[].sourceDraft.upload` | object / null | 是 | 不接受额外字段 |  |
| `releases[].sourceDraft.upload.statistics` | anyOf（3 个分支） | 是 |  |  |
| `releases[].sourceDraft.upload.statistics.anyOf[1]` | object | 分支内适用 | 不接受额外字段 |  |
| `releases[].sourceDraft.upload.statistics.anyOf[1].previousVersion` | string / null | 是 |  |  |
| `releases[].sourceDraft.upload.statistics.anyOf[1].addedFiles` | integer | 是 | 最小值（含）：`0` |  |
| `releases[].sourceDraft.upload.statistics.anyOf[1].modifiedFiles` | integer | 是 | 最小值（含）：`0` |  |
| `releases[].sourceDraft.upload.statistics.anyOf[1].deletedFiles` | integer | 是 | 最小值（含）：`0` |  |
| `releases[].sourceDraft.upload.statistics.anyOf[1].fullSize` | integer | 是 | 最小值（含）：`0` |  |
| `releases[].sourceDraft.upload.statistics.anyOf[1].newDataSize` | integer | 是 | 最小值（含）：`0` |  |
| `releases[].sourceDraft.upload.statistics.anyOf[1].estimatedDownloadSize` | integer | 是 | 最小值（含）：`0` |  |
| `releases[].sourceDraft.upload.statistics.anyOf[1].casReusePercent` | number | 是 |  |  |
| `releases[].sourceDraft.upload.statistics.anyOf[1].fileCount` | integer | 是 | 最小值（含）：`0` |  |
| `releases[].sourceDraft.upload.statistics.anyOf[1].sourceSize` | integer | 是 | 最小值（含）：`0` |  |
| `releases[].sourceDraft.upload.statistics.anyOf[2]` | object | 分支内适用 | 不接受额外字段 |  |
| `releases[].sourceDraft.upload.statistics.anyOf[2].localFiles` | integer | 是 | 最小值（含）：`0` |  |
| `releases[].sourceDraft.upload.statistics.anyOf[2].remoteFiles` | integer | 是 | 最小值（含）：`0` |  |
| `releases[].sourceDraft.upload.statistics.anyOf[2].optionalFiles` | integer | 是 | 最小值（含）：`0` |  |
| `releases[].sourceDraft.upload.statistics.anyOf[2].localSize` | integer | 是 | 最小值（含）：`0` |  |
| `releases[].sourceDraft.upload.statistics.anyOf[2].remoteDeclaredSize` | integer | 是 | 最小值（含）：`0` |  |
| `releases[].sourceDraft.upload.statistics.anyOf[2].newLocalDataSize` | integer | 是 | 最小值（含）：`0` |  |
| `releases[].sourceDraft.upload.statistics.anyOf[2].localCasReusePercent` | number | 是 |  |  |
| `releases[].sourceDraft.upload.statistics.anyOf[2].sourceSize` | integer | 是 | 最小值（含）：`0` |  |
| `releases[].sourceDraft.upload.statistics.anyOf[3]` | null | 分支内适用 |  |  |
| `releases[].sourceDraft.upload.comparisonStatistics` | object / null | 是 | 不接受额外字段 |  |
| `releases[].sourceDraft.upload.comparisonStatistics.previousVersion` | string / null | 是 |  |  |
| `releases[].sourceDraft.upload.comparisonStatistics.addedFiles` | integer | 是 | 最小值（含）：`0` |  |
| `releases[].sourceDraft.upload.comparisonStatistics.modifiedFiles` | integer | 是 | 最小值（含）：`0` |  |
| `releases[].sourceDraft.upload.comparisonStatistics.deletedFiles` | integer | 是 | 最小值（含）：`0` |  |
| `releases[].sourceDraft.upload.comparisonStatistics.fullSize` | integer | 是 | 最小值（含）：`0` |  |
| `releases[].sourceDraft.upload.comparisonStatistics.newDataSize` | integer | 是 | 最小值（含）：`0` |  |
| `releases[].sourceDraft.upload.comparisonStatistics.estimatedDownloadSize` | integer | 是 | 最小值（含）：`0` |  |
| `releases[].sourceDraft.upload.comparisonStatistics.casReusePercent` | number | 是 |  |  |
| `releases[].sourceDraft.upload.comparisonStatistics.fileCount` | integer | 是 | 最小值（含）：`0` |  |
| `releases[].sourceDraft.upload.comparisonStatistics.sourceSize` | integer | 是 | 最小值（含）：`0` |  |
| `releases[].sourceDraft.packageBuilds` | array：object | 是 |  |  |
| `releases[].sourceDraft.packageBuilds[]` | object | 每个元素 | 不接受额外字段 |  |
| `releases[].sourceDraft.packageBuilds[].draftId` | string (uuid) | 是 |  |  |
| `releases[].sourceDraft.packageBuilds[].platform` | string | 是 |  |  |
| `releases[].sourceDraft.packageBuilds[].revision` | integer | 是 | 最小值（含）：`0` |  |
| `releases[].sourceDraft.packageBuilds[].status` | string | 是 |  |  |
| `releases[].sourceDraft.packageBuilds[].required` | boolean | 是 |  |  |
| `releases[].sourceDraft.packageBuilds[].artifacts` | 未限定类型 | 否 |  |  |
| `releases[].packageBuilds` | array：object | 是 |  |  |
| `releases[].packageBuilds[]` | object | 每个元素 | 不接受额外字段 |  |
| `releases[].packageBuilds[].draftId` | string (uuid) | 是 |  |  |
| `releases[].packageBuilds[].platform` | string | 是 |  |  |
| `releases[].packageBuilds[].revision` | integer | 是 | 最小值（含）：`0` |  |
| `releases[].packageBuilds[].status` | string | 是 |  |  |
| `releases[].packageBuilds[].required` | boolean | 是 |  |  |
| `releases[].packageBuilds[].artifacts` | object / null | 是 | 不接受额外字段 |  |
| `releases[].packageBuilds[].artifacts.full` | object | 是 |  |  |
| `releases[].packageBuilds[].artifacts.full.key` | string | 是 |  |  |
| `releases[].packageBuilds[].artifacts.full.sha256` | string | 是 | 正则：`"^[a-f0-9]{64}$"` |  |
| `releases[].packageBuilds[].artifacts.full.size` | integer | 是 | 最小值（含）：`0` |  |
| `releases[].packageBuilds[].artifacts.update` | object / null | 是 |  |  |
| `releases[].packageBuilds[].artifacts.update.key` | string | 是 |  |  |
| `releases[].packageBuilds[].artifacts.update.sha256` | string | 是 | 正则：`"^[a-f0-9]{64}$"` |  |
| `releases[].packageBuilds[].artifacts.update.size` | integer | 是 | 最小值（含）：`0` |  |
| `releases[].packageBuilds[].artifacts.update.baseReleaseId` | string (uuid) | 是 |  |  |
| `releases[].packageBuilds[].artifacts.update.baseManifestSha256` | string | 是 | 正则：`"^[a-f0-9]{64}$"` |  |
| `releases[].packageBuilds[].artifacts.signingKeyId` | string | 是 | 正则：`"^[a-f0-9]{24}$"` |  |
| `canDelete` | boolean | 是 |  |  |
| `uploads` | array：object | 是 |  |  |
| `uploads[]` | object | 每个元素 | 不接受额外字段 |  |
| `uploads[].id` | string (uuid) | 是 |  |  |
| `uploads[].clientId` | string (uuid) | 是 |  |  |
| `uploads[].fileName` | string | 是 |  |  |
| `uploads[].size` | integer | 是 | 最小值（含）：`0` |  |
| `uploads[].partSize` | integer | 是 | 最小值（含）：`0` |  |
| `uploads[].packageFormatVersion` | anyOf（2 个分支） | 是 |  |  |
| `uploads[].packageFormatVersion.anyOf[1]` | number | 分支内适用 | 可选值：`[1]` |  |
| `uploads[].packageFormatVersion.anyOf[2]` | number | 分支内适用 | 可选值：`[2]` |  |
| `uploads[].status` | string | 是 | 可选值：`["UPLOADING","QUEUED","PROCESSING","READY","FAILED","SUBMITTED","CANCELLED"]` |  |
| `uploads[].progress` | integer | 是 | 最小值（含）：`0` |  |
| `uploads[].error` | object / null | 是 | 不接受额外字段 |  |
| `uploads[].error.code` | string | 是 |  |  |
| `uploads[].error.message` | string | 是 |  |  |
| `uploads[].error.params` | object | 是 | 动态字段值：anyOf（2 个分支） |  |
| `uploads[].error.params{key}` | anyOf（2 个分支） | 动态字段 |  |  |
| `uploads[].error.params{key}.anyOf[1]` | string | 分支内适用 |  |  |
| `uploads[].error.params{key}.anyOf[2]` | number | 分支内适用 |  |  |
| `uploads[].draftId` | string / null (uuid) | 是 |  |  |
| `uploads[].statistics` | object / null | 是 | 不接受额外字段 |  |
| `uploads[].statistics.previousVersion` | string / null | 是 |  |  |
| `uploads[].statistics.addedFiles` | integer | 是 | 最小值（含）：`0` |  |
| `uploads[].statistics.modifiedFiles` | integer | 是 | 最小值（含）：`0` |  |
| `uploads[].statistics.deletedFiles` | integer | 是 | 最小值（含）：`0` |  |
| `uploads[].statistics.fullSize` | integer | 是 | 最小值（含）：`0` |  |
| `uploads[].statistics.newDataSize` | integer | 是 | 最小值（含）：`0` |  |
| `uploads[].statistics.estimatedDownloadSize` | integer | 是 | 最小值（含）：`0` |  |
| `uploads[].statistics.casReusePercent` | number | 是 |  |  |
| `uploads[].statistics.fileCount` | integer | 是 | 最小值（含）：`0` |  |
| `uploads[].statistics.sourceSize` | integer | 是 | 最小值（含）：`0` |  |
| `uploads[].recipeStatistics` | object / null | 是 | 不接受额外字段 |  |
| `uploads[].recipeStatistics.localFiles` | integer | 是 | 最小值（含）：`0` |  |
| `uploads[].recipeStatistics.remoteFiles` | integer | 是 | 最小值（含）：`0` |  |
| `uploads[].recipeStatistics.optionalFiles` | integer | 是 | 最小值（含）：`0` |  |
| `uploads[].recipeStatistics.localSize` | integer | 是 | 最小值（含）：`0` |  |
| `uploads[].recipeStatistics.remoteDeclaredSize` | integer | 是 | 最小值（含）：`0` |  |
| `uploads[].recipeStatistics.newLocalDataSize` | integer | 是 | 最小值（含）：`0` |  |
| `uploads[].recipeStatistics.localCasReusePercent` | number | 是 |  |  |
| `uploads[].recipeStatistics.sourceSize` | integer | 是 | 最小值（含）：`0` |  |
| `uploads[].detectedMods` | array：string | 是 |  |  |
| `uploads[].detectedMods[]` | string | 每个元素 |  |  |
| `uploads[].warnings` | array：object | 是 |  |  |
| `uploads[].warnings[]` | object | 每个元素 | 不接受额外字段 |  |
| `uploads[].warnings[].code` | string | 是 |  |  |
| `uploads[].warnings[].message` | string | 是 |  |  |
| `uploads[].warnings[].params` | object | 是 | 动态字段值：anyOf（2 个分支） |  |
| `uploads[].warnings[].params{key}` | anyOf（2 个分支） | 动态字段 |  |  |
| `uploads[].warnings[].params{key}.anyOf[1]` | string | 分支内适用 |  |  |
| `uploads[].warnings[].params{key}.anyOf[2]` | number | 分支内适用 |  |  |
| `uploads[].comparisonDraftId` | string / null (uuid) | 是 |  |  |
| `uploads[].comparisonStatistics` | object / null | 是 | 不接受额外字段 |  |
| `uploads[].comparisonStatistics.previousVersion` | string / null | 是 |  |  |
| `uploads[].comparisonStatistics.addedFiles` | integer | 是 | 最小值（含）：`0` |  |
| `uploads[].comparisonStatistics.modifiedFiles` | integer | 是 | 最小值（含）：`0` |  |
| `uploads[].comparisonStatistics.deletedFiles` | integer | 是 | 最小值（含）：`0` |  |
| `uploads[].comparisonStatistics.fullSize` | integer | 是 | 最小值（含）：`0` |  |
| `uploads[].comparisonStatistics.newDataSize` | integer | 是 | 最小值（含）：`0` |  |
| `uploads[].comparisonStatistics.estimatedDownloadSize` | integer | 是 | 最小值（含）：`0` |  |
| `uploads[].comparisonStatistics.casReusePercent` | number | 是 |  |  |
| `uploads[].comparisonStatistics.fileCount` | integer | 是 | 最小值（含）：`0` |  |
| `uploads[].comparisonStatistics.sourceSize` | integer | 是 | 最小值（含）：`0` |  |
| `uploads[].processingPhase` | anyOf（2 个分支） | 是 |  |  |
| `uploads[].processingPhase.anyOf[1]` | string | 分支内适用 | 可选值：`["FETCHING","INSPECTING","SELECT_INSTANCE","DOWNLOADING","CAS"]` |  |
| `uploads[].processingPhase.anyOf[2]` | null | 分支内适用 |  |  |
| `uploads[].detectedInfo` | object / null | 是 | 不接受额外字段 |  |
| `uploads[].detectedInfo.instanceId` | string / null | 是 |  |  |
| `uploads[].detectedInfo.minecraftVersion` | string / null | 是 |  |  |
| `uploads[].detectedInfo.javaVersion` | integer / null | 是 |  |  |
| `uploads[].detectedInfo.javaComponent` | string / null | 是 |  |  |
| `uploads[].detectedInfo.loader` | string / null | 是 |  |  |
| `uploads[].detectedInfo.loaderVersion` | string / null | 是 |  |  |
| `uploads[].detectedInfo.minecraftSource` | object / null | 是 | 不接受额外字段 |  |
| `uploads[].detectedInfo.minecraftSource.code` | string | 是 |  |  |
| `uploads[].detectedInfo.minecraftSource.message` | string | 是 |  |  |
| `uploads[].detectedInfo.minecraftSource.params` | object | 是 | 动态字段值：anyOf（2 个分支） |  |
| `uploads[].detectedInfo.minecraftSource.params{key}` | anyOf（2 个分支） | 动态字段 |  |  |
| `uploads[].detectedInfo.minecraftSource.params{key}.anyOf[1]` | string | 分支内适用 |  |  |
| `uploads[].detectedInfo.minecraftSource.params{key}.anyOf[2]` | number | 分支内适用 |  |  |
| `uploads[].detectedInfo.javaSource` | object / null | 是 | 不接受额外字段 |  |
| `uploads[].detectedInfo.javaSource.code` | string | 是 |  |  |
| `uploads[].detectedInfo.javaSource.message` | string | 是 |  |  |
| `uploads[].detectedInfo.javaSource.params` | object | 是 | 动态字段值：anyOf（2 个分支） |  |
| `uploads[].detectedInfo.javaSource.params{key}` | anyOf（2 个分支） | 动态字段 |  |  |
| `uploads[].detectedInfo.javaSource.params{key}.anyOf[1]` | string | 分支内适用 |  |  |
| `uploads[].detectedInfo.javaSource.params{key}.anyOf[2]` | number | 分支内适用 |  |  |
| `uploads[].detectedInfo.warnings` | array：object | 是 |  |  |
| `uploads[].detectedInfo.warnings[]` | object | 每个元素 | 不接受额外字段 |  |
| `uploads[].detectedInfo.warnings[].code` | string | 是 |  |  |
| `uploads[].detectedInfo.warnings[].message` | string | 是 |  |  |
| `uploads[].detectedInfo.warnings[].params` | object | 是 | 动态字段值：anyOf（2 个分支） |  |
| `uploads[].detectedInfo.warnings[].params{key}` | anyOf（2 个分支） | 动态字段 |  |  |
| `uploads[].detectedInfo.warnings[].params{key}.anyOf[1]` | string | 分支内适用 |  |  |
| `uploads[].detectedInfo.warnings[].params{key}.anyOf[2]` | number | 分支内适用 |  |  |
| `uploads[].detectedInfo.schemaVersion` | number | 是 | 可选值：`[1]` |  |
| `uploads[].detectedInfo.requiresSelection` | boolean | 是 |  |  |
| `uploads[].detectedInfo.candidates` | array：object | 是 |  |  |
| `uploads[].detectedInfo.candidates[]` | object | 每个元素 | 不接受额外字段 |  |
| `uploads[].detectedInfo.candidates[].instanceId` | string / null | 是 |  |  |
| `uploads[].detectedInfo.candidates[].minecraftVersion` | string / null | 是 |  |  |
| `uploads[].detectedInfo.candidates[].javaVersion` | integer / null | 是 |  |  |
| `uploads[].detectedInfo.candidates[].javaComponent` | string / null | 是 |  |  |
| `uploads[].detectedInfo.candidates[].loader` | string / null | 是 |  |  |
| `uploads[].detectedInfo.candidates[].loaderVersion` | string / null | 是 |  |  |
| `uploads[].detectedInfo.candidates[].minecraftSource` | object / null | 是 | 不接受额外字段 |  |
| `uploads[].detectedInfo.candidates[].minecraftSource.code` | string | 是 |  |  |
| `uploads[].detectedInfo.candidates[].minecraftSource.message` | string | 是 |  |  |
| `uploads[].detectedInfo.candidates[].minecraftSource.params` | object | 是 | 动态字段值：anyOf（2 个分支） |  |
| `uploads[].detectedInfo.candidates[].minecraftSource.params{key}` | anyOf（2 个分支） | 动态字段 |  |  |
| `uploads[].detectedInfo.candidates[].minecraftSource.params{key}.anyOf[1]` | string | 分支内适用 |  |  |
| `uploads[].detectedInfo.candidates[].minecraftSource.params{key}.anyOf[2]` | number | 分支内适用 |  |  |
| `uploads[].detectedInfo.candidates[].javaSource` | object / null | 是 | 不接受额外字段 |  |
| `uploads[].detectedInfo.candidates[].javaSource.code` | string | 是 |  |  |
| `uploads[].detectedInfo.candidates[].javaSource.message` | string | 是 |  |  |
| `uploads[].detectedInfo.candidates[].javaSource.params` | object | 是 | 动态字段值：anyOf（2 个分支） |  |
| `uploads[].detectedInfo.candidates[].javaSource.params{key}` | anyOf（2 个分支） | 动态字段 |  |  |
| `uploads[].detectedInfo.candidates[].javaSource.params{key}.anyOf[1]` | string | 分支内适用 |  |  |
| `uploads[].detectedInfo.candidates[].javaSource.params{key}.anyOf[2]` | number | 分支内适用 |  |  |
| `uploads[].detectedInfo.candidates[].warnings` | array：object | 是 |  |  |
| `uploads[].detectedInfo.candidates[].warnings[]` | object | 每个元素 | 不接受额外字段 |  |
| `uploads[].detectedInfo.candidates[].warnings[].code` | string | 是 |  |  |
| `uploads[].detectedInfo.candidates[].warnings[].message` | string | 是 |  |  |
| `uploads[].detectedInfo.candidates[].warnings[].params` | object | 是 | 动态字段值：anyOf（2 个分支） |  |
| `uploads[].detectedInfo.candidates[].warnings[].params{key}` | anyOf（2 个分支） | 动态字段 |  |  |
| `uploads[].detectedInfo.candidates[].warnings[].params{key}.anyOf[1]` | string | 分支内适用 |  |  |
| `uploads[].detectedInfo.candidates[].warnings[].params{key}.anyOf[2]` | number | 分支内适用 |  |  |
| `uploads[].detectedInfo.pack` | object | 否 | 不接受额外字段 |  |
| `uploads[].detectedInfo.pack.format` | string | 是 | 可选值：`["modrinth"]` |  |
| `uploads[].detectedInfo.pack.wrapper` | anyOf（2 个分支） | 是 |  |  |
| `uploads[].detectedInfo.pack.wrapper.anyOf[1]` | string | 分支内适用 | 可选值：`["pcl"]` |  |
| `uploads[].detectedInfo.pack.wrapper.anyOf[2]` | null | 分支内适用 |  |  |
| `uploads[].detectedInfo.pack.name` | string | 是 |  |  |
| `uploads[].detectedInfo.pack.version` | string | 是 |  |  |
| `uploads[].detectedInfo.pack.summary` | string / null | 是 |  |  |
| `uploads[].detectedInfo.importFiles` | array：object | 否 |  |  |
| `uploads[].detectedInfo.importFiles[]` | object | 每个元素 | 不接受额外字段 |  |
| `uploads[].detectedInfo.importFiles[].path` | string | 是 |  |  |
| `uploads[].detectedInfo.importFiles[].source` | string | 是 | 可选值：`["local","remote"]` |  |
| `uploads[].detectedInfo.importFiles[].optional` | boolean | 是 |  |  |
| `uploads[].detectedInfo.importFiles[].size` | integer | 是 | 最小值（含）：`0` |  |
| `uploads[].detectedInfo.importFiles[].downloads` | array：string | 是 |  |  |
| `uploads[].detectedInfo.importFiles[].downloads[]` | string | 每个元素 |  |  |
| `uploads[].detectedInfo.importFiles[].hashes` | object | 否 | 不接受额外字段 |  |
| `uploads[].detectedInfo.importFiles[].hashes.sha1` | string | 否 |  |  |
| `uploads[].detectedInfo.importFiles[].hashes.sha512` | string | 否 |  |  |
| `uploads[].detectedInfo.importFiles[].hashes.sha256` | string | 否 |  |  |
| `uploads[].detectedInfo.importFiles[].status` | string | 是 | 可选值：`["PENDING","DECLARED","DOWNLOADING","VERIFIED","FAILED"]` |  |
| `uploads[].detectedInfo.importFiles[].downloadedBytes` | integer | 是 | 最小值（含）：`0` |  |
| `uploads[].detectedInfo.importFiles[].error` | object / null | 是 | 不接受额外字段 |  |
| `uploads[].detectedInfo.importFiles[].error.code` | string | 是 |  |  |
| `uploads[].detectedInfo.importFiles[].error.message` | string | 是 |  |  |
| `uploads[].detectedInfo.importFiles[].error.params` | object | 是 | 动态字段值：anyOf（2 个分支） |  |
| `uploads[].detectedInfo.importFiles[].error.params{key}` | anyOf（2 个分支） | 动态字段 |  |  |
| `uploads[].detectedInfo.importFiles[].error.params{key}.anyOf[1]` | string | 分支内适用 |  |  |
| `uploads[].detectedInfo.importFiles[].error.params{key}.anyOf[2]` | number | 分支内适用 |  |  |
| `uploads[].selectedInstanceId` | string / null | 是 |  |  |
| `uploads[].baseReleaseId` | string / null (uuid) | 是 |  |  |
| `uploads[].basePublicationRevision` | integer | 是 | 最小值（含）：`0` |  |
| `uploads[].createdAt` | string (date-time) | 是 |  |  |
| `uploads[].canEdit` | boolean | 是 |  |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "clientId": {
      "type": "string",
      "format": "uuid"
    },
    "name": {
      "type": "string"
    },
    "organizationId": {
      "type": "string",
      "format": "uuid"
    },
    "organizationName": {
      "type": "string"
    },
    "serverId": {
      "type": [
        "string",
        "null"
      ],
      "pattern": "^[A-Za-z]{3,5}$"
    },
    "serverName": {
      "type": "string"
    },
    "requestedServerId": {
      "type": [
        "string",
        "null"
      ],
      "pattern": "^[A-Za-z]{3,5}$"
    },
    "scopeServerId": {
      "type": [
        "string",
        "null"
      ],
      "pattern": "^[A-Za-z]{3,5}$"
    },
    "archived": {
      "type": "boolean"
    },
    "blocked": {
      "type": "boolean"
    },
    "displaySchedule": {
      "type": [
        "object",
        "null"
      ],
      "properties": {
        "displayMode": {
          "type": "string",
          "enum": [
            "PERMANENT",
            "RANGE"
          ]
        },
        "displayStartsAt": {
          "type": [
            "string",
            "null"
          ],
          "format": "date-time"
        },
        "displayEndsAt": {
          "type": [
            "string",
            "null"
          ],
          "format": "date-time"
        }
      },
      "required": [
        "displayMode",
        "displayStartsAt",
        "displayEndsAt"
      ],
      "additionalProperties": false
    },
    "lifecycleStatus": {
      "type": "string",
      "enum": [
        "ARCHIVED",
        "PUBLISHED",
        "UNPUBLISHED"
      ]
    },
    "permissions": {
      "type": "array",
      "items": {
        "type": "string",
        "enum": [
          "SERVER_READ",
          "SERVER_EDIT",
          "DRAFT_READ",
          "DRAFT_CREATE",
          "DRAFT_EDIT",
          "DRAFT_SUBMIT",
          "DRAFT_ARCHIVE",
          "RELEASE_READ",
          "ORG_EDIT",
          "ORG_MEMBERS_READ",
          "ORG_MEMBERS_MANAGE",
          "CLIENT_ARCHIVE",
          "CLIENT_DELETE",
          "CLIENT_BIND",
          "DRAFT_REVIEW",
          "RELEASE_PUBLISH",
          "RELEASE_ACTIVATE"
        ]
      }
    },
    "publicationRevision": {
      "type": "integer",
      "minimum": 0
    },
    "currentReleaseId": {
      "type": [
        "string",
        "null"
      ],
      "format": "uuid"
    },
    "initialPackageFormatVersion": {
      "type": [
        "integer",
        "null"
      ]
    },
    "bindingRevision": {
      "type": [
        "integer",
        "null"
      ],
      "minimum": 0
    },
    "drafts": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "versionLabel": {
            "type": [
              "string",
              "null"
            ]
          },
          "name": {
            "type": [
              "string",
              "null"
            ]
          },
          "description": {
            "type": [
              "string",
              "null"
            ]
          },
          "changelog": {
            "type": "string"
          },
          "summary": {
            "type": [
              "string",
              "null"
            ]
          },
          "archivedAt": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          },
          "packageFormatVersion": {
            "type": "integer"
          },
          "versionSequence": {
            "type": "integer",
            "minimum": 0
          },
          "replacesDraftId": {
            "type": [
              "string",
              "null"
            ],
            "format": "uuid"
          },
          "archiveReason": {
            "type": [
              "string",
              "null"
            ]
          },
          "supersededByDraftId": {
            "type": [
              "string",
              "null"
            ],
            "format": "uuid"
          },
          "candidateMetadata": {},
          "reviewNote": {
            "type": [
              "string",
              "null"
            ]
          },
          "status": {
            "type": "string",
            "enum": [
              "DRAFT",
              "SUBMITTED",
              "APPROVED",
              "REJECTED",
              "RELEASED"
            ]
          },
          "contentRevision": {
            "type": "integer",
            "minimum": 0
          },
          "packageRevision": {
            "type": "integer",
            "minimum": 0
          },
          "createdAt": {
            "type": "string",
            "format": "date-time"
          },
          "upload": {
            "type": [
              "object",
              "null"
            ],
            "properties": {
              "id": {
                "type": "string",
                "format": "uuid"
              },
              "statistics": {
                "anyOf": [
                  {
                    "type": "object",
                    "properties": {
                      "previousVersion": {
                        "type": [
                          "string",
                          "null"
                        ]
                      },
                      "addedFiles": {
                        "type": "integer",
                        "minimum": 0
                      },
                      "modifiedFiles": {
                        "type": "integer",
                        "minimum": 0
                      },
                      "deletedFiles": {
                        "type": "integer",
                        "minimum": 0
                      },
                      "fullSize": {
                        "type": "integer",
                        "minimum": 0
                      },
                      "newDataSize": {
                        "type": "integer",
                        "minimum": 0
                      },
                      "estimatedDownloadSize": {
                        "type": "integer",
                        "minimum": 0
                      },
                      "casReusePercent": {
                        "type": "number"
                      },
                      "fileCount": {
                        "type": "integer",
                        "minimum": 0
                      },
                      "sourceSize": {
                        "type": "integer",
                        "minimum": 0
                      }
                    },
                    "required": [
                      "previousVersion",
                      "addedFiles",
                      "modifiedFiles",
                      "deletedFiles",
                      "fullSize",
                      "newDataSize",
                      "estimatedDownloadSize",
                      "casReusePercent",
                      "fileCount",
                      "sourceSize"
                    ],
                    "additionalProperties": false
                  },
                  {
                    "type": "object",
                    "properties": {
                      "localFiles": {
                        "type": "integer",
                        "minimum": 0
                      },
                      "remoteFiles": {
                        "type": "integer",
                        "minimum": 0
                      },
                      "optionalFiles": {
                        "type": "integer",
                        "minimum": 0
                      },
                      "localSize": {
                        "type": "integer",
                        "minimum": 0
                      },
                      "remoteDeclaredSize": {
                        "type": "integer",
                        "minimum": 0
                      },
                      "newLocalDataSize": {
                        "type": "integer",
                        "minimum": 0
                      },
                      "localCasReusePercent": {
                        "type": "number"
                      },
                      "sourceSize": {
                        "type": "integer",
                        "minimum": 0
                      }
                    },
                    "required": [
                      "localFiles",
                      "remoteFiles",
                      "optionalFiles",
                      "localSize",
                      "remoteDeclaredSize",
                      "newLocalDataSize",
                      "localCasReusePercent",
                      "sourceSize"
                    ],
                    "additionalProperties": false
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "comparisonStatistics": {
                "type": [
                  "object",
                  "null"
                ],
                "properties": {
                  "previousVersion": {
                    "type": [
                      "string",
                      "null"
                    ]
                  },
                  "addedFiles": {
                    "type": "integer",
                    "minimum": 0
                  },
                  "modifiedFiles": {
                    "type": "integer",
                    "minimum": 0
                  },
                  "deletedFiles": {
                    "type": "integer",
                    "minimum": 0
                  },
                  "fullSize": {
                    "type": "integer",
                    "minimum": 0
                  },
                  "newDataSize": {
                    "type": "integer",
                    "minimum": 0
                  },
                  "estimatedDownloadSize": {
                    "type": "integer",
                    "minimum": 0
                  },
                  "casReusePercent": {
                    "type": "number"
                  },
                  "fileCount": {
                    "type": "integer",
                    "minimum": 0
                  },
                  "sourceSize": {
                    "type": "integer",
                    "minimum": 0
                  }
                },
                "required": [
                  "previousVersion",
                  "addedFiles",
                  "modifiedFiles",
                  "deletedFiles",
                  "fullSize",
                  "newDataSize",
                  "estimatedDownloadSize",
                  "casReusePercent",
                  "fileCount",
                  "sourceSize"
                ],
                "additionalProperties": false
              }
            },
            "required": [
              "id",
              "statistics",
              "comparisonStatistics"
            ],
            "additionalProperties": false
          },
          "packageBuilds": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "platform": {
                  "type": "string"
                },
                "status": {
                  "type": "string",
                  "enum": [
                    "QUEUED",
                    "PROCESSING",
                    "PREPARED",
                    "READY",
                    "FAILED"
                  ]
                },
                "phase": {
                  "type": "object",
                  "properties": {
                    "code": {
                      "type": "string"
                    },
                    "message": {
                      "type": "string"
                    },
                    "params": {
                      "type": "object",
                      "additionalProperties": {
                        "anyOf": [
                          {
                            "type": "string"
                          },
                          {
                            "type": "number"
                          }
                        ]
                      }
                    }
                  },
                  "required": [
                    "code",
                    "message",
                    "params"
                  ],
                  "additionalProperties": false
                },
                "progress": {
                  "type": "integer",
                  "minimum": 0
                },
                "error": {
                  "type": [
                    "object",
                    "null"
                  ],
                  "properties": {
                    "code": {
                      "type": "string"
                    },
                    "message": {
                      "type": "string"
                    },
                    "params": {
                      "type": "object",
                      "additionalProperties": {
                        "anyOf": [
                          {
                            "type": "string"
                          },
                          {
                            "type": "number"
                          }
                        ]
                      }
                    }
                  },
                  "required": [
                    "code",
                    "message",
                    "params"
                  ],
                  "additionalProperties": false
                },
                "artifacts": {
                  "type": [
                    "object",
                    "null"
                  ],
                  "properties": {
                    "full": {
                      "type": "object",
                      "properties": {
                        "key": {
                          "type": "string"
                        },
                        "sha256": {
                          "type": "string",
                          "pattern": "^[a-f0-9]{64}$"
                        },
                        "size": {
                          "type": "integer",
                          "minimum": 0
                        }
                      },
                      "required": [
                        "key",
                        "sha256",
                        "size"
                      ]
                    },
                    "update": {
                      "type": [
                        "object",
                        "null"
                      ],
                      "properties": {
                        "key": {
                          "type": "string"
                        },
                        "sha256": {
                          "type": "string",
                          "pattern": "^[a-f0-9]{64}$"
                        },
                        "size": {
                          "type": "integer",
                          "minimum": 0
                        },
                        "baseReleaseId": {
                          "type": "string",
                          "format": "uuid"
                        },
                        "baseManifestSha256": {
                          "type": "string",
                          "pattern": "^[a-f0-9]{64}$"
                        }
                      },
                      "required": [
                        "key",
                        "sha256",
                        "size",
                        "baseReleaseId",
                        "baseManifestSha256"
                      ]
                    },
                    "signingKeyId": {
                      "type": "string",
                      "pattern": "^[a-f0-9]{24}$"
                    }
                  },
                  "required": [
                    "full",
                    "update",
                    "signingKeyId"
                  ],
                  "additionalProperties": false
                }
              },
              "required": [
                "platform",
                "status",
                "phase",
                "progress",
                "error",
                "artifacts"
              ],
              "additionalProperties": false
            }
          }
        },
        "required": [
          "id",
          "versionLabel",
          "name",
          "description",
          "changelog",
          "summary",
          "archivedAt",
          "packageFormatVersion",
          "versionSequence",
          "replacesDraftId",
          "archiveReason",
          "supersededByDraftId",
          "reviewNote",
          "status",
          "contentRevision",
          "packageRevision",
          "createdAt",
          "upload",
          "packageBuilds"
        ],
        "additionalProperties": false
      }
    },
    "releases": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "versionLabel": {
            "type": "string"
          },
          "name": {
            "type": "string"
          },
          "description": {
            "type": "string"
          },
          "changelog": {
            "type": "string"
          },
          "summary": {
            "type": "string"
          },
          "archivedAt": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          },
          "packageFormatVersion": {
            "type": "integer"
          },
          "environmentSnapshot": {},
          "publishedAt": {
            "type": "string",
            "format": "date-time"
          },
          "sourceDraft": {
            "type": [
              "object",
              "null"
            ],
            "properties": {
              "packageRevision": {
                "type": "integer",
                "minimum": 0
              },
              "upload": {
                "type": [
                  "object",
                  "null"
                ],
                "properties": {
                  "statistics": {
                    "anyOf": [
                      {
                        "type": "object",
                        "properties": {
                          "previousVersion": {
                            "type": [
                              "string",
                              "null"
                            ]
                          },
                          "addedFiles": {
                            "type": "integer",
                            "minimum": 0
                          },
                          "modifiedFiles": {
                            "type": "integer",
                            "minimum": 0
                          },
                          "deletedFiles": {
                            "type": "integer",
                            "minimum": 0
                          },
                          "fullSize": {
                            "type": "integer",
                            "minimum": 0
                          },
                          "newDataSize": {
                            "type": "integer",
                            "minimum": 0
                          },
                          "estimatedDownloadSize": {
                            "type": "integer",
                            "minimum": 0
                          },
                          "casReusePercent": {
                            "type": "number"
                          },
                          "fileCount": {
                            "type": "integer",
                            "minimum": 0
                          },
                          "sourceSize": {
                            "type": "integer",
                            "minimum": 0
                          }
                        },
                        "required": [
                          "previousVersion",
                          "addedFiles",
                          "modifiedFiles",
                          "deletedFiles",
                          "fullSize",
                          "newDataSize",
                          "estimatedDownloadSize",
                          "casReusePercent",
                          "fileCount",
                          "sourceSize"
                        ],
                        "additionalProperties": false
                      },
                      {
                        "type": "object",
                        "properties": {
                          "localFiles": {
                            "type": "integer",
                            "minimum": 0
                          },
                          "remoteFiles": {
                            "type": "integer",
                            "minimum": 0
                          },
                          "optionalFiles": {
                            "type": "integer",
                            "minimum": 0
                          },
                          "localSize": {
                            "type": "integer",
                            "minimum": 0
                          },
                          "remoteDeclaredSize": {
                            "type": "integer",
                            "minimum": 0
                          },
                          "newLocalDataSize": {
                            "type": "integer",
                            "minimum": 0
                          },
                          "localCasReusePercent": {
                            "type": "number"
                          },
                          "sourceSize": {
                            "type": "integer",
                            "minimum": 0
                          }
                        },
                        "required": [
                          "localFiles",
                          "remoteFiles",
                          "optionalFiles",
                          "localSize",
                          "remoteDeclaredSize",
                          "newLocalDataSize",
                          "localCasReusePercent",
                          "sourceSize"
                        ],
                        "additionalProperties": false
                      },
                      {
                        "type": "null"
                      }
                    ]
                  },
                  "comparisonStatistics": {
                    "type": [
                      "object",
                      "null"
                    ],
                    "properties": {
                      "previousVersion": {
                        "type": [
                          "string",
                          "null"
                        ]
                      },
                      "addedFiles": {
                        "type": "integer",
                        "minimum": 0
                      },
                      "modifiedFiles": {
                        "type": "integer",
                        "minimum": 0
                      },
                      "deletedFiles": {
                        "type": "integer",
                        "minimum": 0
                      },
                      "fullSize": {
                        "type": "integer",
                        "minimum": 0
                      },
                      "newDataSize": {
                        "type": "integer",
                        "minimum": 0
                      },
                      "estimatedDownloadSize": {
                        "type": "integer",
                        "minimum": 0
                      },
                      "casReusePercent": {
                        "type": "number"
                      },
                      "fileCount": {
                        "type": "integer",
                        "minimum": 0
                      },
                      "sourceSize": {
                        "type": "integer",
                        "minimum": 0
                      }
                    },
                    "required": [
                      "previousVersion",
                      "addedFiles",
                      "modifiedFiles",
                      "deletedFiles",
                      "fullSize",
                      "newDataSize",
                      "estimatedDownloadSize",
                      "casReusePercent",
                      "fileCount",
                      "sourceSize"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "statistics",
                  "comparisonStatistics"
                ],
                "additionalProperties": false
              },
              "packageBuilds": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "draftId": {
                      "type": "string",
                      "format": "uuid"
                    },
                    "platform": {
                      "type": "string"
                    },
                    "revision": {
                      "type": "integer",
                      "minimum": 0
                    },
                    "status": {
                      "type": "string"
                    },
                    "required": {
                      "type": "boolean"
                    },
                    "artifacts": {}
                  },
                  "required": [
                    "draftId",
                    "platform",
                    "revision",
                    "status",
                    "required"
                  ],
                  "additionalProperties": false
                }
              }
            },
            "required": [
              "packageRevision",
              "upload",
              "packageBuilds"
            ],
            "additionalProperties": false
          },
          "packageBuilds": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "draftId": {
                  "type": "string",
                  "format": "uuid"
                },
                "platform": {
                  "type": "string"
                },
                "revision": {
                  "type": "integer",
                  "minimum": 0
                },
                "status": {
                  "type": "string"
                },
                "required": {
                  "type": "boolean"
                },
                "artifacts": {
                  "type": [
                    "object",
                    "null"
                  ],
                  "properties": {
                    "full": {
                      "type": "object",
                      "properties": {
                        "key": {
                          "type": "string"
                        },
                        "sha256": {
                          "type": "string",
                          "pattern": "^[a-f0-9]{64}$"
                        },
                        "size": {
                          "type": "integer",
                          "minimum": 0
                        }
                      },
                      "required": [
                        "key",
                        "sha256",
                        "size"
                      ]
                    },
                    "update": {
                      "type": [
                        "object",
                        "null"
                      ],
                      "properties": {
                        "key": {
                          "type": "string"
                        },
                        "sha256": {
                          "type": "string",
                          "pattern": "^[a-f0-9]{64}$"
                        },
                        "size": {
                          "type": "integer",
                          "minimum": 0
                        },
                        "baseReleaseId": {
                          "type": "string",
                          "format": "uuid"
                        },
                        "baseManifestSha256": {
                          "type": "string",
                          "pattern": "^[a-f0-9]{64}$"
                        }
                      },
                      "required": [
                        "key",
                        "sha256",
                        "size",
                        "baseReleaseId",
                        "baseManifestSha256"
                      ]
                    },
                    "signingKeyId": {
                      "type": "string",
                      "pattern": "^[a-f0-9]{24}$"
                    }
                  },
                  "required": [
                    "full",
                    "update",
                    "signingKeyId"
                  ],
                  "additionalProperties": false
                }
              },
              "required": [
                "draftId",
                "platform",
                "revision",
                "status",
                "required",
                "artifacts"
              ],
              "additionalProperties": false
            }
          }
        },
        "required": [
          "id",
          "versionLabel",
          "name",
          "description",
          "changelog",
          "summary",
          "archivedAt",
          "packageFormatVersion",
          "publishedAt",
          "sourceDraft",
          "packageBuilds"
        ],
        "additionalProperties": false
      }
    },
    "canDelete": {
      "type": "boolean"
    },
    "uploads": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "clientId": {
            "type": "string",
            "format": "uuid"
          },
          "fileName": {
            "type": "string"
          },
          "size": {
            "type": "integer",
            "minimum": 0
          },
          "partSize": {
            "type": "integer",
            "minimum": 0
          },
          "packageFormatVersion": {
            "anyOf": [
              {
                "type": "number",
                "enum": [
                  1
                ]
              },
              {
                "type": "number",
                "enum": [
                  2
                ]
              }
            ]
          },
          "status": {
            "type": "string",
            "enum": [
              "UPLOADING",
              "QUEUED",
              "PROCESSING",
              "READY",
              "FAILED",
              "SUBMITTED",
              "CANCELLED"
            ]
          },
          "progress": {
            "type": "integer",
            "minimum": 0
          },
          "error": {
            "type": [
              "object",
              "null"
            ],
            "properties": {
              "code": {
                "type": "string"
              },
              "message": {
                "type": "string"
              },
              "params": {
                "type": "object",
                "additionalProperties": {
                  "anyOf": [
                    {
                      "type": "string"
                    },
                    {
                      "type": "number"
                    }
                  ]
                }
              }
            },
            "required": [
              "code",
              "message",
              "params"
            ],
            "additionalProperties": false
          },
          "draftId": {
            "type": [
              "string",
              "null"
            ],
            "format": "uuid"
          },
          "statistics": {
            "type": [
              "object",
              "null"
            ],
            "properties": {
              "previousVersion": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "addedFiles": {
                "type": "integer",
                "minimum": 0
              },
              "modifiedFiles": {
                "type": "integer",
                "minimum": 0
              },
              "deletedFiles": {
                "type": "integer",
                "minimum": 0
              },
              "fullSize": {
                "type": "integer",
                "minimum": 0
              },
              "newDataSize": {
                "type": "integer",
                "minimum": 0
              },
              "estimatedDownloadSize": {
                "type": "integer",
                "minimum": 0
              },
              "casReusePercent": {
                "type": "number"
              },
              "fileCount": {
                "type": "integer",
                "minimum": 0
              },
              "sourceSize": {
                "type": "integer",
                "minimum": 0
              }
            },
            "required": [
              "previousVersion",
              "addedFiles",
              "modifiedFiles",
              "deletedFiles",
              "fullSize",
              "newDataSize",
              "estimatedDownloadSize",
              "casReusePercent",
              "fileCount",
              "sourceSize"
            ],
            "additionalProperties": false
          },
          "recipeStatistics": {
            "type": [
              "object",
              "null"
            ],
            "properties": {
              "localFiles": {
                "type": "integer",
                "minimum": 0
              },
              "remoteFiles": {
                "type": "integer",
                "minimum": 0
              },
              "optionalFiles": {
                "type": "integer",
                "minimum": 0
              },
              "localSize": {
                "type": "integer",
                "minimum": 0
              },
              "remoteDeclaredSize": {
                "type": "integer",
                "minimum": 0
              },
              "newLocalDataSize": {
                "type": "integer",
                "minimum": 0
              },
              "localCasReusePercent": {
                "type": "number"
              },
              "sourceSize": {
                "type": "integer",
                "minimum": 0
              }
            },
            "required": [
              "localFiles",
              "remoteFiles",
              "optionalFiles",
              "localSize",
              "remoteDeclaredSize",
              "newLocalDataSize",
              "localCasReusePercent",
              "sourceSize"
            ],
            "additionalProperties": false
          },
          "detectedMods": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "warnings": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "code": {
                  "type": "string"
                },
                "message": {
                  "type": "string"
                },
                "params": {
                  "type": "object",
                  "additionalProperties": {
                    "anyOf": [
                      {
                        "type": "string"
                      },
                      {
                        "type": "number"
                      }
                    ]
                  }
                }
              },
              "required": [
                "code",
                "message",
                "params"
              ],
              "additionalProperties": false
            }
          },
          "comparisonDraftId": {
            "type": [
              "string",
              "null"
            ],
            "format": "uuid"
          },
          "comparisonStatistics": {
            "type": [
              "object",
              "null"
            ],
            "properties": {
              "previousVersion": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "addedFiles": {
                "type": "integer",
                "minimum": 0
              },
              "modifiedFiles": {
                "type": "integer",
                "minimum": 0
              },
              "deletedFiles": {
                "type": "integer",
                "minimum": 0
              },
              "fullSize": {
                "type": "integer",
                "minimum": 0
              },
              "newDataSize": {
                "type": "integer",
                "minimum": 0
              },
              "estimatedDownloadSize": {
                "type": "integer",
                "minimum": 0
              },
              "casReusePercent": {
                "type": "number"
              },
              "fileCount": {
                "type": "integer",
                "minimum": 0
              },
              "sourceSize": {
                "type": "integer",
                "minimum": 0
              }
            },
            "required": [
              "previousVersion",
              "addedFiles",
              "modifiedFiles",
              "deletedFiles",
              "fullSize",
              "newDataSize",
              "estimatedDownloadSize",
              "casReusePercent",
              "fileCount",
              "sourceSize"
            ],
            "additionalProperties": false
          },
          "processingPhase": {
            "anyOf": [
              {
                "type": "string",
                "enum": [
                  "FETCHING",
                  "INSPECTING",
                  "SELECT_INSTANCE",
                  "DOWNLOADING",
                  "CAS"
                ]
              },
              {
                "type": "null"
              }
            ]
          },
          "detectedInfo": {
            "type": [
              "object",
              "null"
            ],
            "properties": {
              "instanceId": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "minecraftVersion": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "javaVersion": {
                "type": [
                  "integer",
                  "null"
                ]
              },
              "javaComponent": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "loader": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "loaderVersion": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "minecraftSource": {
                "type": [
                  "object",
                  "null"
                ],
                "properties": {
                  "code": {
                    "type": "string"
                  },
                  "message": {
                    "type": "string"
                  },
                  "params": {
                    "type": "object",
                    "additionalProperties": {
                      "anyOf": [
                        {
                          "type": "string"
                        },
                        {
                          "type": "number"
                        }
                      ]
                    }
                  }
                },
                "required": [
                  "code",
                  "message",
                  "params"
                ],
                "additionalProperties": false
              },
              "javaSource": {
                "type": [
                  "object",
                  "null"
                ],
                "properties": {
                  "code": {
                    "type": "string"
                  },
                  "message": {
                    "type": "string"
                  },
                  "params": {
                    "type": "object",
                    "additionalProperties": {
                      "anyOf": [
                        {
                          "type": "string"
                        },
                        {
                          "type": "number"
                        }
                      ]
                    }
                  }
                },
                "required": [
                  "code",
                  "message",
                  "params"
                ],
                "additionalProperties": false
              },
              "warnings": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "code": {
                      "type": "string"
                    },
                    "message": {
                      "type": "string"
                    },
                    "params": {
                      "type": "object",
                      "additionalProperties": {
                        "anyOf": [
                          {
                            "type": "string"
                          },
                          {
                            "type": "number"
                          }
                        ]
                      }
                    }
                  },
                  "required": [
                    "code",
                    "message",
                    "params"
                  ],
                  "additionalProperties": false
                }
              },
              "schemaVersion": {
                "type": "number",
                "enum": [
                  1
                ]
              },
              "requiresSelection": {
                "type": "boolean"
              },
              "candidates": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "instanceId": {
                      "type": [
                        "string",
                        "null"
                      ]
                    },
                    "minecraftVersion": {
                      "type": [
                        "string",
                        "null"
                      ]
                    },
                    "javaVersion": {
                      "type": [
                        "integer",
                        "null"
                      ]
                    },
                    "javaComponent": {
                      "type": [
                        "string",
                        "null"
                      ]
                    },
                    "loader": {
                      "type": [
                        "string",
                        "null"
                      ]
                    },
                    "loaderVersion": {
                      "type": [
                        "string",
                        "null"
                      ]
                    },
                    "minecraftSource": {
                      "type": [
                        "object",
                        "null"
                      ],
                      "properties": {
                        "code": {
                          "type": "string"
                        },
                        "message": {
                          "type": "string"
                        },
                        "params": {
                          "type": "object",
                          "additionalProperties": {
                            "anyOf": [
                              {
                                "type": "string"
                              },
                              {
                                "type": "number"
                              }
                            ]
                          }
                        }
                      },
                      "required": [
                        "code",
                        "message",
                        "params"
                      ],
                      "additionalProperties": false
                    },
                    "javaSource": {
                      "type": [
                        "object",
                        "null"
                      ],
                      "properties": {
                        "code": {
                          "type": "string"
                        },
                        "message": {
                          "type": "string"
                        },
                        "params": {
                          "type": "object",
                          "additionalProperties": {
                            "anyOf": [
                              {
                                "type": "string"
                              },
                              {
                                "type": "number"
                              }
                            ]
                          }
                        }
                      },
                      "required": [
                        "code",
                        "message",
                        "params"
                      ],
                      "additionalProperties": false
                    },
                    "warnings": {
                      "type": "array",
                      "items": {
                        "type": "object",
                        "properties": {
                          "code": {
                            "type": "string"
                          },
                          "message": {
                            "type": "string"
                          },
                          "params": {
                            "type": "object",
                            "additionalProperties": {
                              "anyOf": [
                                {
                                  "type": "string"
                                },
                                {
                                  "type": "number"
                                }
                              ]
                            }
                          }
                        },
                        "required": [
                          "code",
                          "message",
                          "params"
                        ],
                        "additionalProperties": false
                      }
                    }
                  },
                  "required": [
                    "instanceId",
                    "minecraftVersion",
                    "javaVersion",
                    "javaComponent",
                    "loader",
                    "loaderVersion",
                    "minecraftSource",
                    "javaSource",
                    "warnings"
                  ],
                  "additionalProperties": false
                }
              },
              "pack": {
                "type": "object",
                "properties": {
                  "format": {
                    "type": "string",
                    "enum": [
                      "modrinth"
                    ]
                  },
                  "wrapper": {
                    "anyOf": [
                      {
                        "type": "string",
                        "enum": [
                          "pcl"
                        ]
                      },
                      {
                        "type": "null"
                      }
                    ]
                  },
                  "name": {
                    "type": "string"
                  },
                  "version": {
                    "type": "string"
                  },
                  "summary": {
                    "type": [
                      "string",
                      "null"
                    ]
                  }
                },
                "required": [
                  "format",
                  "wrapper",
                  "name",
                  "version",
                  "summary"
                ],
                "additionalProperties": false
              },
              "importFiles": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "path": {
                      "type": "string"
                    },
                    "source": {
                      "type": "string",
                      "enum": [
                        "local",
                        "remote"
                      ]
                    },
                    "optional": {
                      "type": "boolean"
                    },
                    "size": {
                      "type": "integer",
                      "minimum": 0
                    },
                    "downloads": {
                      "type": "array",
                      "items": {
                        "type": "string"
                      }
                    },
                    "hashes": {
                      "type": "object",
                      "properties": {
                        "sha1": {
                          "type": "string"
                        },
                        "sha512": {
                          "type": "string"
                        },
                        "sha256": {
                          "type": "string"
                        }
                      },
                      "additionalProperties": false
                    },
                    "status": {
                      "type": "string",
                      "enum": [
                        "PENDING",
                        "DECLARED",
                        "DOWNLOADING",
                        "VERIFIED",
                        "FAILED"
                      ]
                    },
                    "downloadedBytes": {
                      "type": "integer",
                      "minimum": 0
                    },
                    "error": {
                      "type": [
                        "object",
                        "null"
                      ],
                      "properties": {
                        "code": {
                          "type": "string"
                        },
                        "message": {
                          "type": "string"
                        },
                        "params": {
                          "type": "object",
                          "additionalProperties": {
                            "anyOf": [
                              {
                                "type": "string"
                              },
                              {
                                "type": "number"
                              }
                            ]
                          }
                        }
                      },
                      "required": [
                        "code",
                        "message",
                        "params"
                      ],
                      "additionalProperties": false
                    }
                  },
                  "required": [
                    "path",
                    "source",
                    "optional",
                    "size",
                    "downloads",
                    "status",
                    "downloadedBytes",
                    "error"
                  ],
                  "additionalProperties": false
                }
              }
            },
            "required": [
              "instanceId",
              "minecraftVersion",
              "javaVersion",
              "javaComponent",
              "loader",
              "loaderVersion",
              "minecraftSource",
              "javaSource",
              "warnings",
              "schemaVersion",
              "requiresSelection",
              "candidates"
            ],
            "additionalProperties": false
          },
          "selectedInstanceId": {
            "type": [
              "string",
              "null"
            ]
          },
          "baseReleaseId": {
            "type": [
              "string",
              "null"
            ],
            "format": "uuid"
          },
          "basePublicationRevision": {
            "type": "integer",
            "minimum": 0
          },
          "createdAt": {
            "type": "string",
            "format": "date-time"
          },
          "canEdit": {
            "type": "boolean"
          }
        },
        "required": [
          "id",
          "clientId",
          "fileName",
          "size",
          "partSize",
          "packageFormatVersion",
          "status",
          "progress",
          "error",
          "draftId",
          "statistics",
          "recipeStatistics",
          "detectedMods",
          "warnings",
          "comparisonDraftId",
          "comparisonStatistics",
          "processingPhase",
          "detectedInfo",
          "selectedInstanceId",
          "baseReleaseId",
          "basePublicationRevision",
          "createdAt",
          "canEdit"
        ],
        "additionalProperties": false
      }
    }
  },
  "required": [
    "clientId",
    "name",
    "organizationId",
    "organizationName",
    "serverId",
    "serverName",
    "requestedServerId",
    "scopeServerId",
    "archived",
    "blocked",
    "displaySchedule",
    "lifecycleStatus",
    "permissions",
    "publicationRevision",
    "currentReleaseId",
    "initialPackageFormatVersion",
    "bindingRevision",
    "drafts",
    "releases",
    "canDelete",
    "uploads"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-upload"></a>

### Upload

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `id` | string (uuid) | 是 |  |  |
| `clientId` | string (uuid) | 是 |  |  |
| `fileName` | string | 是 |  |  |
| `size` | integer | 是 | 最小值（含）：`0` |  |
| `partSize` | integer | 是 | 最小值（含）：`0` |  |
| `packageFormatVersion` | anyOf（2 个分支） | 是 |  |  |
| `packageFormatVersion.anyOf[1]` | number | 分支内适用 | 可选值：`[1]` |  |
| `packageFormatVersion.anyOf[2]` | number | 分支内适用 | 可选值：`[2]` |  |
| `status` | string | 是 | 可选值：`["UPLOADING","QUEUED","PROCESSING","READY","FAILED","SUBMITTED","CANCELLED"]` |  |
| `progress` | integer | 是 | 最小值（含）：`0` |  |
| `error` | object / null | 是 | 不接受额外字段 |  |
| `error.code` | string | 是 |  |  |
| `error.message` | string | 是 |  |  |
| `error.params` | object | 是 | 动态字段值：anyOf（2 个分支） |  |
| `error.params{key}` | anyOf（2 个分支） | 动态字段 |  |  |
| `error.params{key}.anyOf[1]` | string | 分支内适用 |  |  |
| `error.params{key}.anyOf[2]` | number | 分支内适用 |  |  |
| `draftId` | string / null (uuid) | 是 |  |  |
| `statistics` | object / null | 是 | 不接受额外字段 |  |
| `statistics.previousVersion` | string / null | 是 |  |  |
| `statistics.addedFiles` | integer | 是 | 最小值（含）：`0` |  |
| `statistics.modifiedFiles` | integer | 是 | 最小值（含）：`0` |  |
| `statistics.deletedFiles` | integer | 是 | 最小值（含）：`0` |  |
| `statistics.fullSize` | integer | 是 | 最小值（含）：`0` |  |
| `statistics.newDataSize` | integer | 是 | 最小值（含）：`0` |  |
| `statistics.estimatedDownloadSize` | integer | 是 | 最小值（含）：`0` |  |
| `statistics.casReusePercent` | number | 是 |  |  |
| `statistics.fileCount` | integer | 是 | 最小值（含）：`0` |  |
| `statistics.sourceSize` | integer | 是 | 最小值（含）：`0` |  |
| `recipeStatistics` | object / null | 是 | 不接受额外字段 |  |
| `recipeStatistics.localFiles` | integer | 是 | 最小值（含）：`0` |  |
| `recipeStatistics.remoteFiles` | integer | 是 | 最小值（含）：`0` |  |
| `recipeStatistics.optionalFiles` | integer | 是 | 最小值（含）：`0` |  |
| `recipeStatistics.localSize` | integer | 是 | 最小值（含）：`0` |  |
| `recipeStatistics.remoteDeclaredSize` | integer | 是 | 最小值（含）：`0` |  |
| `recipeStatistics.newLocalDataSize` | integer | 是 | 最小值（含）：`0` |  |
| `recipeStatistics.localCasReusePercent` | number | 是 |  |  |
| `recipeStatistics.sourceSize` | integer | 是 | 最小值（含）：`0` |  |
| `detectedMods` | array：string | 是 |  |  |
| `detectedMods[]` | string | 每个元素 |  |  |
| `warnings` | array：object | 是 |  |  |
| `warnings[]` | object | 每个元素 | 不接受额外字段 |  |
| `warnings[].code` | string | 是 |  |  |
| `warnings[].message` | string | 是 |  |  |
| `warnings[].params` | object | 是 | 动态字段值：anyOf（2 个分支） |  |
| `warnings[].params{key}` | anyOf（2 个分支） | 动态字段 |  |  |
| `warnings[].params{key}.anyOf[1]` | string | 分支内适用 |  |  |
| `warnings[].params{key}.anyOf[2]` | number | 分支内适用 |  |  |
| `comparisonDraftId` | string / null (uuid) | 是 |  |  |
| `comparisonStatistics` | object / null | 是 | 不接受额外字段 |  |
| `comparisonStatistics.previousVersion` | string / null | 是 |  |  |
| `comparisonStatistics.addedFiles` | integer | 是 | 最小值（含）：`0` |  |
| `comparisonStatistics.modifiedFiles` | integer | 是 | 最小值（含）：`0` |  |
| `comparisonStatistics.deletedFiles` | integer | 是 | 最小值（含）：`0` |  |
| `comparisonStatistics.fullSize` | integer | 是 | 最小值（含）：`0` |  |
| `comparisonStatistics.newDataSize` | integer | 是 | 最小值（含）：`0` |  |
| `comparisonStatistics.estimatedDownloadSize` | integer | 是 | 最小值（含）：`0` |  |
| `comparisonStatistics.casReusePercent` | number | 是 |  |  |
| `comparisonStatistics.fileCount` | integer | 是 | 最小值（含）：`0` |  |
| `comparisonStatistics.sourceSize` | integer | 是 | 最小值（含）：`0` |  |
| `processingPhase` | anyOf（2 个分支） | 是 |  |  |
| `processingPhase.anyOf[1]` | string | 分支内适用 | 可选值：`["FETCHING","INSPECTING","SELECT_INSTANCE","DOWNLOADING","CAS"]` |  |
| `processingPhase.anyOf[2]` | null | 分支内适用 |  |  |
| `detectedInfo` | object / null | 是 | 不接受额外字段 |  |
| `detectedInfo.instanceId` | string / null | 是 |  |  |
| `detectedInfo.minecraftVersion` | string / null | 是 |  |  |
| `detectedInfo.javaVersion` | integer / null | 是 |  |  |
| `detectedInfo.javaComponent` | string / null | 是 |  |  |
| `detectedInfo.loader` | string / null | 是 |  |  |
| `detectedInfo.loaderVersion` | string / null | 是 |  |  |
| `detectedInfo.minecraftSource` | object / null | 是 | 不接受额外字段 |  |
| `detectedInfo.minecraftSource.code` | string | 是 |  |  |
| `detectedInfo.minecraftSource.message` | string | 是 |  |  |
| `detectedInfo.minecraftSource.params` | object | 是 | 动态字段值：anyOf（2 个分支） |  |
| `detectedInfo.minecraftSource.params{key}` | anyOf（2 个分支） | 动态字段 |  |  |
| `detectedInfo.minecraftSource.params{key}.anyOf[1]` | string | 分支内适用 |  |  |
| `detectedInfo.minecraftSource.params{key}.anyOf[2]` | number | 分支内适用 |  |  |
| `detectedInfo.javaSource` | object / null | 是 | 不接受额外字段 |  |
| `detectedInfo.javaSource.code` | string | 是 |  |  |
| `detectedInfo.javaSource.message` | string | 是 |  |  |
| `detectedInfo.javaSource.params` | object | 是 | 动态字段值：anyOf（2 个分支） |  |
| `detectedInfo.javaSource.params{key}` | anyOf（2 个分支） | 动态字段 |  |  |
| `detectedInfo.javaSource.params{key}.anyOf[1]` | string | 分支内适用 |  |  |
| `detectedInfo.javaSource.params{key}.anyOf[2]` | number | 分支内适用 |  |  |
| `detectedInfo.warnings` | array：object | 是 |  |  |
| `detectedInfo.warnings[]` | object | 每个元素 | 不接受额外字段 |  |
| `detectedInfo.warnings[].code` | string | 是 |  |  |
| `detectedInfo.warnings[].message` | string | 是 |  |  |
| `detectedInfo.warnings[].params` | object | 是 | 动态字段值：anyOf（2 个分支） |  |
| `detectedInfo.warnings[].params{key}` | anyOf（2 个分支） | 动态字段 |  |  |
| `detectedInfo.warnings[].params{key}.anyOf[1]` | string | 分支内适用 |  |  |
| `detectedInfo.warnings[].params{key}.anyOf[2]` | number | 分支内适用 |  |  |
| `detectedInfo.schemaVersion` | number | 是 | 可选值：`[1]` |  |
| `detectedInfo.requiresSelection` | boolean | 是 |  |  |
| `detectedInfo.candidates` | array：object | 是 |  |  |
| `detectedInfo.candidates[]` | object | 每个元素 | 不接受额外字段 |  |
| `detectedInfo.candidates[].instanceId` | string / null | 是 |  |  |
| `detectedInfo.candidates[].minecraftVersion` | string / null | 是 |  |  |
| `detectedInfo.candidates[].javaVersion` | integer / null | 是 |  |  |
| `detectedInfo.candidates[].javaComponent` | string / null | 是 |  |  |
| `detectedInfo.candidates[].loader` | string / null | 是 |  |  |
| `detectedInfo.candidates[].loaderVersion` | string / null | 是 |  |  |
| `detectedInfo.candidates[].minecraftSource` | object / null | 是 | 不接受额外字段 |  |
| `detectedInfo.candidates[].minecraftSource.code` | string | 是 |  |  |
| `detectedInfo.candidates[].minecraftSource.message` | string | 是 |  |  |
| `detectedInfo.candidates[].minecraftSource.params` | object | 是 | 动态字段值：anyOf（2 个分支） |  |
| `detectedInfo.candidates[].minecraftSource.params{key}` | anyOf（2 个分支） | 动态字段 |  |  |
| `detectedInfo.candidates[].minecraftSource.params{key}.anyOf[1]` | string | 分支内适用 |  |  |
| `detectedInfo.candidates[].minecraftSource.params{key}.anyOf[2]` | number | 分支内适用 |  |  |
| `detectedInfo.candidates[].javaSource` | object / null | 是 | 不接受额外字段 |  |
| `detectedInfo.candidates[].javaSource.code` | string | 是 |  |  |
| `detectedInfo.candidates[].javaSource.message` | string | 是 |  |  |
| `detectedInfo.candidates[].javaSource.params` | object | 是 | 动态字段值：anyOf（2 个分支） |  |
| `detectedInfo.candidates[].javaSource.params{key}` | anyOf（2 个分支） | 动态字段 |  |  |
| `detectedInfo.candidates[].javaSource.params{key}.anyOf[1]` | string | 分支内适用 |  |  |
| `detectedInfo.candidates[].javaSource.params{key}.anyOf[2]` | number | 分支内适用 |  |  |
| `detectedInfo.candidates[].warnings` | array：object | 是 |  |  |
| `detectedInfo.candidates[].warnings[]` | object | 每个元素 | 不接受额外字段 |  |
| `detectedInfo.candidates[].warnings[].code` | string | 是 |  |  |
| `detectedInfo.candidates[].warnings[].message` | string | 是 |  |  |
| `detectedInfo.candidates[].warnings[].params` | object | 是 | 动态字段值：anyOf（2 个分支） |  |
| `detectedInfo.candidates[].warnings[].params{key}` | anyOf（2 个分支） | 动态字段 |  |  |
| `detectedInfo.candidates[].warnings[].params{key}.anyOf[1]` | string | 分支内适用 |  |  |
| `detectedInfo.candidates[].warnings[].params{key}.anyOf[2]` | number | 分支内适用 |  |  |
| `detectedInfo.pack` | object | 否 | 不接受额外字段 |  |
| `detectedInfo.pack.format` | string | 是 | 可选值：`["modrinth"]` |  |
| `detectedInfo.pack.wrapper` | anyOf（2 个分支） | 是 |  |  |
| `detectedInfo.pack.wrapper.anyOf[1]` | string | 分支内适用 | 可选值：`["pcl"]` |  |
| `detectedInfo.pack.wrapper.anyOf[2]` | null | 分支内适用 |  |  |
| `detectedInfo.pack.name` | string | 是 |  |  |
| `detectedInfo.pack.version` | string | 是 |  |  |
| `detectedInfo.pack.summary` | string / null | 是 |  |  |
| `detectedInfo.importFiles` | array：object | 否 |  |  |
| `detectedInfo.importFiles[]` | object | 每个元素 | 不接受额外字段 |  |
| `detectedInfo.importFiles[].path` | string | 是 |  |  |
| `detectedInfo.importFiles[].source` | string | 是 | 可选值：`["local","remote"]` |  |
| `detectedInfo.importFiles[].optional` | boolean | 是 |  |  |
| `detectedInfo.importFiles[].size` | integer | 是 | 最小值（含）：`0` |  |
| `detectedInfo.importFiles[].downloads` | array：string | 是 |  |  |
| `detectedInfo.importFiles[].downloads[]` | string | 每个元素 |  |  |
| `detectedInfo.importFiles[].hashes` | object | 否 | 不接受额外字段 |  |
| `detectedInfo.importFiles[].hashes.sha1` | string | 否 |  |  |
| `detectedInfo.importFiles[].hashes.sha512` | string | 否 |  |  |
| `detectedInfo.importFiles[].hashes.sha256` | string | 否 |  |  |
| `detectedInfo.importFiles[].status` | string | 是 | 可选值：`["PENDING","DECLARED","DOWNLOADING","VERIFIED","FAILED"]` |  |
| `detectedInfo.importFiles[].downloadedBytes` | integer | 是 | 最小值（含）：`0` |  |
| `detectedInfo.importFiles[].error` | object / null | 是 | 不接受额外字段 |  |
| `detectedInfo.importFiles[].error.code` | string | 是 |  |  |
| `detectedInfo.importFiles[].error.message` | string | 是 |  |  |
| `detectedInfo.importFiles[].error.params` | object | 是 | 动态字段值：anyOf（2 个分支） |  |
| `detectedInfo.importFiles[].error.params{key}` | anyOf（2 个分支） | 动态字段 |  |  |
| `detectedInfo.importFiles[].error.params{key}.anyOf[1]` | string | 分支内适用 |  |  |
| `detectedInfo.importFiles[].error.params{key}.anyOf[2]` | number | 分支内适用 |  |  |
| `selectedInstanceId` | string / null | 是 |  |  |
| `baseReleaseId` | string / null (uuid) | 是 |  |  |
| `basePublicationRevision` | integer | 是 | 最小值（含）：`0` |  |
| `createdAt` | string (date-time) | 是 |  |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "uuid"
    },
    "clientId": {
      "type": "string",
      "format": "uuid"
    },
    "fileName": {
      "type": "string"
    },
    "size": {
      "type": "integer",
      "minimum": 0
    },
    "partSize": {
      "type": "integer",
      "minimum": 0
    },
    "packageFormatVersion": {
      "anyOf": [
        {
          "type": "number",
          "enum": [
            1
          ]
        },
        {
          "type": "number",
          "enum": [
            2
          ]
        }
      ]
    },
    "status": {
      "type": "string",
      "enum": [
        "UPLOADING",
        "QUEUED",
        "PROCESSING",
        "READY",
        "FAILED",
        "SUBMITTED",
        "CANCELLED"
      ]
    },
    "progress": {
      "type": "integer",
      "minimum": 0
    },
    "error": {
      "type": [
        "object",
        "null"
      ],
      "properties": {
        "code": {
          "type": "string"
        },
        "message": {
          "type": "string"
        },
        "params": {
          "type": "object",
          "additionalProperties": {
            "anyOf": [
              {
                "type": "string"
              },
              {
                "type": "number"
              }
            ]
          }
        }
      },
      "required": [
        "code",
        "message",
        "params"
      ],
      "additionalProperties": false
    },
    "draftId": {
      "type": [
        "string",
        "null"
      ],
      "format": "uuid"
    },
    "statistics": {
      "type": [
        "object",
        "null"
      ],
      "properties": {
        "previousVersion": {
          "type": [
            "string",
            "null"
          ]
        },
        "addedFiles": {
          "type": "integer",
          "minimum": 0
        },
        "modifiedFiles": {
          "type": "integer",
          "minimum": 0
        },
        "deletedFiles": {
          "type": "integer",
          "minimum": 0
        },
        "fullSize": {
          "type": "integer",
          "minimum": 0
        },
        "newDataSize": {
          "type": "integer",
          "minimum": 0
        },
        "estimatedDownloadSize": {
          "type": "integer",
          "minimum": 0
        },
        "casReusePercent": {
          "type": "number"
        },
        "fileCount": {
          "type": "integer",
          "minimum": 0
        },
        "sourceSize": {
          "type": "integer",
          "minimum": 0
        }
      },
      "required": [
        "previousVersion",
        "addedFiles",
        "modifiedFiles",
        "deletedFiles",
        "fullSize",
        "newDataSize",
        "estimatedDownloadSize",
        "casReusePercent",
        "fileCount",
        "sourceSize"
      ],
      "additionalProperties": false
    },
    "recipeStatistics": {
      "type": [
        "object",
        "null"
      ],
      "properties": {
        "localFiles": {
          "type": "integer",
          "minimum": 0
        },
        "remoteFiles": {
          "type": "integer",
          "minimum": 0
        },
        "optionalFiles": {
          "type": "integer",
          "minimum": 0
        },
        "localSize": {
          "type": "integer",
          "minimum": 0
        },
        "remoteDeclaredSize": {
          "type": "integer",
          "minimum": 0
        },
        "newLocalDataSize": {
          "type": "integer",
          "minimum": 0
        },
        "localCasReusePercent": {
          "type": "number"
        },
        "sourceSize": {
          "type": "integer",
          "minimum": 0
        }
      },
      "required": [
        "localFiles",
        "remoteFiles",
        "optionalFiles",
        "localSize",
        "remoteDeclaredSize",
        "newLocalDataSize",
        "localCasReusePercent",
        "sourceSize"
      ],
      "additionalProperties": false
    },
    "detectedMods": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "warnings": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "code": {
            "type": "string"
          },
          "message": {
            "type": "string"
          },
          "params": {
            "type": "object",
            "additionalProperties": {
              "anyOf": [
                {
                  "type": "string"
                },
                {
                  "type": "number"
                }
              ]
            }
          }
        },
        "required": [
          "code",
          "message",
          "params"
        ],
        "additionalProperties": false
      }
    },
    "comparisonDraftId": {
      "type": [
        "string",
        "null"
      ],
      "format": "uuid"
    },
    "comparisonStatistics": {
      "type": [
        "object",
        "null"
      ],
      "properties": {
        "previousVersion": {
          "type": [
            "string",
            "null"
          ]
        },
        "addedFiles": {
          "type": "integer",
          "minimum": 0
        },
        "modifiedFiles": {
          "type": "integer",
          "minimum": 0
        },
        "deletedFiles": {
          "type": "integer",
          "minimum": 0
        },
        "fullSize": {
          "type": "integer",
          "minimum": 0
        },
        "newDataSize": {
          "type": "integer",
          "minimum": 0
        },
        "estimatedDownloadSize": {
          "type": "integer",
          "minimum": 0
        },
        "casReusePercent": {
          "type": "number"
        },
        "fileCount": {
          "type": "integer",
          "minimum": 0
        },
        "sourceSize": {
          "type": "integer",
          "minimum": 0
        }
      },
      "required": [
        "previousVersion",
        "addedFiles",
        "modifiedFiles",
        "deletedFiles",
        "fullSize",
        "newDataSize",
        "estimatedDownloadSize",
        "casReusePercent",
        "fileCount",
        "sourceSize"
      ],
      "additionalProperties": false
    },
    "processingPhase": {
      "anyOf": [
        {
          "type": "string",
          "enum": [
            "FETCHING",
            "INSPECTING",
            "SELECT_INSTANCE",
            "DOWNLOADING",
            "CAS"
          ]
        },
        {
          "type": "null"
        }
      ]
    },
    "detectedInfo": {
      "type": [
        "object",
        "null"
      ],
      "properties": {
        "instanceId": {
          "type": [
            "string",
            "null"
          ]
        },
        "minecraftVersion": {
          "type": [
            "string",
            "null"
          ]
        },
        "javaVersion": {
          "type": [
            "integer",
            "null"
          ]
        },
        "javaComponent": {
          "type": [
            "string",
            "null"
          ]
        },
        "loader": {
          "type": [
            "string",
            "null"
          ]
        },
        "loaderVersion": {
          "type": [
            "string",
            "null"
          ]
        },
        "minecraftSource": {
          "type": [
            "object",
            "null"
          ],
          "properties": {
            "code": {
              "type": "string"
            },
            "message": {
              "type": "string"
            },
            "params": {
              "type": "object",
              "additionalProperties": {
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "number"
                  }
                ]
              }
            }
          },
          "required": [
            "code",
            "message",
            "params"
          ],
          "additionalProperties": false
        },
        "javaSource": {
          "type": [
            "object",
            "null"
          ],
          "properties": {
            "code": {
              "type": "string"
            },
            "message": {
              "type": "string"
            },
            "params": {
              "type": "object",
              "additionalProperties": {
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "number"
                  }
                ]
              }
            }
          },
          "required": [
            "code",
            "message",
            "params"
          ],
          "additionalProperties": false
        },
        "warnings": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "code": {
                "type": "string"
              },
              "message": {
                "type": "string"
              },
              "params": {
                "type": "object",
                "additionalProperties": {
                  "anyOf": [
                    {
                      "type": "string"
                    },
                    {
                      "type": "number"
                    }
                  ]
                }
              }
            },
            "required": [
              "code",
              "message",
              "params"
            ],
            "additionalProperties": false
          }
        },
        "schemaVersion": {
          "type": "number",
          "enum": [
            1
          ]
        },
        "requiresSelection": {
          "type": "boolean"
        },
        "candidates": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "instanceId": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "minecraftVersion": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "javaVersion": {
                "type": [
                  "integer",
                  "null"
                ]
              },
              "javaComponent": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "loader": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "loaderVersion": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "minecraftSource": {
                "type": [
                  "object",
                  "null"
                ],
                "properties": {
                  "code": {
                    "type": "string"
                  },
                  "message": {
                    "type": "string"
                  },
                  "params": {
                    "type": "object",
                    "additionalProperties": {
                      "anyOf": [
                        {
                          "type": "string"
                        },
                        {
                          "type": "number"
                        }
                      ]
                    }
                  }
                },
                "required": [
                  "code",
                  "message",
                  "params"
                ],
                "additionalProperties": false
              },
              "javaSource": {
                "type": [
                  "object",
                  "null"
                ],
                "properties": {
                  "code": {
                    "type": "string"
                  },
                  "message": {
                    "type": "string"
                  },
                  "params": {
                    "type": "object",
                    "additionalProperties": {
                      "anyOf": [
                        {
                          "type": "string"
                        },
                        {
                          "type": "number"
                        }
                      ]
                    }
                  }
                },
                "required": [
                  "code",
                  "message",
                  "params"
                ],
                "additionalProperties": false
              },
              "warnings": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "code": {
                      "type": "string"
                    },
                    "message": {
                      "type": "string"
                    },
                    "params": {
                      "type": "object",
                      "additionalProperties": {
                        "anyOf": [
                          {
                            "type": "string"
                          },
                          {
                            "type": "number"
                          }
                        ]
                      }
                    }
                  },
                  "required": [
                    "code",
                    "message",
                    "params"
                  ],
                  "additionalProperties": false
                }
              }
            },
            "required": [
              "instanceId",
              "minecraftVersion",
              "javaVersion",
              "javaComponent",
              "loader",
              "loaderVersion",
              "minecraftSource",
              "javaSource",
              "warnings"
            ],
            "additionalProperties": false
          }
        },
        "pack": {
          "type": "object",
          "properties": {
            "format": {
              "type": "string",
              "enum": [
                "modrinth"
              ]
            },
            "wrapper": {
              "anyOf": [
                {
                  "type": "string",
                  "enum": [
                    "pcl"
                  ]
                },
                {
                  "type": "null"
                }
              ]
            },
            "name": {
              "type": "string"
            },
            "version": {
              "type": "string"
            },
            "summary": {
              "type": [
                "string",
                "null"
              ]
            }
          },
          "required": [
            "format",
            "wrapper",
            "name",
            "version",
            "summary"
          ],
          "additionalProperties": false
        },
        "importFiles": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "path": {
                "type": "string"
              },
              "source": {
                "type": "string",
                "enum": [
                  "local",
                  "remote"
                ]
              },
              "optional": {
                "type": "boolean"
              },
              "size": {
                "type": "integer",
                "minimum": 0
              },
              "downloads": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              },
              "hashes": {
                "type": "object",
                "properties": {
                  "sha1": {
                    "type": "string"
                  },
                  "sha512": {
                    "type": "string"
                  },
                  "sha256": {
                    "type": "string"
                  }
                },
                "additionalProperties": false
              },
              "status": {
                "type": "string",
                "enum": [
                  "PENDING",
                  "DECLARED",
                  "DOWNLOADING",
                  "VERIFIED",
                  "FAILED"
                ]
              },
              "downloadedBytes": {
                "type": "integer",
                "minimum": 0
              },
              "error": {
                "type": [
                  "object",
                  "null"
                ],
                "properties": {
                  "code": {
                    "type": "string"
                  },
                  "message": {
                    "type": "string"
                  },
                  "params": {
                    "type": "object",
                    "additionalProperties": {
                      "anyOf": [
                        {
                          "type": "string"
                        },
                        {
                          "type": "number"
                        }
                      ]
                    }
                  }
                },
                "required": [
                  "code",
                  "message",
                  "params"
                ],
                "additionalProperties": false
              }
            },
            "required": [
              "path",
              "source",
              "optional",
              "size",
              "downloads",
              "status",
              "downloadedBytes",
              "error"
            ],
            "additionalProperties": false
          }
        }
      },
      "required": [
        "instanceId",
        "minecraftVersion",
        "javaVersion",
        "javaComponent",
        "loader",
        "loaderVersion",
        "minecraftSource",
        "javaSource",
        "warnings",
        "schemaVersion",
        "requiresSelection",
        "candidates"
      ],
      "additionalProperties": false
    },
    "selectedInstanceId": {
      "type": [
        "string",
        "null"
      ]
    },
    "baseReleaseId": {
      "type": [
        "string",
        "null"
      ],
      "format": "uuid"
    },
    "basePublicationRevision": {
      "type": "integer",
      "minimum": 0
    },
    "createdAt": {
      "type": "string",
      "format": "date-time"
    }
  },
  "required": [
    "id",
    "clientId",
    "fileName",
    "size",
    "partSize",
    "packageFormatVersion",
    "status",
    "progress",
    "error",
    "draftId",
    "statistics",
    "recipeStatistics",
    "detectedMods",
    "warnings",
    "comparisonDraftId",
    "comparisonStatistics",
    "processingPhase",
    "detectedInfo",
    "selectedInstanceId",
    "baseReleaseId",
    "basePublicationRevision",
    "createdAt"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-adminstate"></a>

### AdminState

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `actor` | object | 是 | 不接受额外字段 |  |
| `actor.id` | string (uuid) | 是 |  |  |
| `actor.displayName` | string | 是 |  |  |
| `actor.isSuperAdmin` | boolean | 是 |  |  |
| `actor.username` | string / null | 否 |  |  |
| `actor.unionSubject` | string | 否 |  |  |
| `organizations` | array：object | 是 |  |  |
| `organizations[]` | object | 每个元素 | 不接受额外字段 |  |
| `organizations[].id` | string (uuid) | 是 |  |  |
| `organizations[].displayName` | string | 是 |  |  |
| `organizations[].description` | string | 是 |  |  |
| `organizations[].clientCount` | integer | 是 | 最小值（含）：`0` |  |
| `organizations[].avatarObjectKey` | string / null | 是 |  |  |
| `organizations[].skinSites` | array：object | 否 |  |  |
| `organizations[].skinSites[]` | object | 每个元素 | 不接受额外字段 |  |
| `organizations[].skinSites[].code` | string | 是 |  |  |
| `organizations[].skinSites[].url` | string (uri) | 是 |  |  |
| `organizations[].archivedAt` | string / null (date-time) | 是 |  |  |
| `organizations[].permissions` | array：string | 是 |  |  |
| `organizations[].permissions[]` | string | 每个元素 | 可选值：`["SERVER_READ","SERVER_EDIT","DRAFT_READ","DRAFT_CREATE","DRAFT_EDIT","DRAFT_SUBMIT","DRAFT_ARCHIVE","RELEASE_READ","ORG_EDIT","ORG_MEMBERS_READ","ORG_MEMBERS_MANAGE","CLIENT_ARCHIVE","CLIENT_DELETE","CLIENT_BIND","DRAFT_REVIEW","RELEASE_PUBLISH","RELEASE_ACTIVATE"]` |  |
| `organizations[].servers` | array：object | 是 |  |  |
| `organizations[].servers[]` | object | 每个元素 | 不接受额外字段 |  |
| `organizations[].servers[].serverId` | string | 是 | 正则：`"^[A-Za-z]{3,5}$"` |  |
| `organizations[].servers[].organizationId` | string (uuid) | 是 |  |  |
| `organizations[].servers[].displayName` | string | 是 |  |  |
| `organizations[].servers[].description` | string | 是 |  |  |
| `organizations[].servers[].gameAddress` | string / null | 是 |  |  |
| `organizations[].servers[].iconObjectKey` | string / null | 是 |  |  |
| `organizations[].servers[].sortOrder` | integer | 是 |  |  |
| `organizations[].servers[].themeColor` | string / null | 是 |  |  |
| `organizations[].servers[].mottoImageUrl` | string / null | 是 |  |  |
| `organizations[].servers[].displayMode` | string | 是 | 可选值：`["PERMANENT","RANGE"]` |  |
| `organizations[].servers[].displayStartsAt` | string / null (date-time) | 是 |  |  |
| `organizations[].servers[].displayEndsAt` | string / null (date-time) | 是 |  |  |
| `organizations[].servers[].isListed` | boolean | 是 |  |  |
| `organizations[].servers[].archivedAt` | string / null (date-time) | 是 |  |  |
| `organizations[].servers[].clientArchivedAt` | string / null (date-time) | 是 |  |  |
| `organizations[].servers[].currentReleaseId` | string / null (uuid) | 是 |  |  |
| `organizations[].servers[].currentReleaseActive` | boolean | 是 |  |  |
| `organizations[].servers[].publicationRevision` | integer | 是 | 最小值（含）：`0` |  |
| `organizations[].servers[].boundClientId` | string / null (uuid) | 是 |  |  |
| `organizations[].servers[].boundClientName` | string / null | 是 |  |  |
| `organizations[].servers[].permissions` | array：string | 是 |  |  |
| `organizations[].servers[].permissions[]` | string | 每个元素 | 可选值：`["SERVER_READ","SERVER_EDIT","DRAFT_READ","DRAFT_CREATE","DRAFT_EDIT","DRAFT_SUBMIT","DRAFT_ARCHIVE","RELEASE_READ","ORG_EDIT","ORG_MEMBERS_READ","ORG_MEMBERS_MANAGE","CLIENT_ARCHIVE","CLIENT_DELETE","CLIENT_BIND","DRAFT_REVIEW","RELEASE_PUBLISH","RELEASE_ACTIVATE"]` |  |
| `organizations[].members` | array：object | 是 |  |  |
| `organizations[].members[]` | object | 每个元素 | 不接受额外字段 |  |
| `organizations[].members[].account` | object | 是 | 不接受额外字段 |  |
| `organizations[].members[].account.id` | string (uuid) | 是 |  |  |
| `organizations[].members[].account.displayName` | string | 是 |  |  |
| `organizations[].members[].account.status` | string | 是 | 可选值：`["ACTIVE","DISABLED"]` |  |
| `organizations[].members[].account.isSuperAdmin` | boolean | 是 |  |  |
| `organizations[].members[].account.username` | string | 是 |  |  |
| `organizations[].members[].account.unionSubject` | string | 否 |  |  |
| `organizations[].members[].status` | string | 是 | 可选值：`["ACTIVE","DISABLED"]` |  |
| `organizations[].members[].roles` | array：string | 是 |  |  |
| `organizations[].members[].roles[]` | string | 每个元素 | 可选值：`["PLAYER","ORG_ADMIN","SERVER_ADMIN","CLIENT_EDITOR","SERVER_EDITOR","REVIEWER","PUBLISHER","RELEASE_OPERATOR","READ_ONLY"]` |  |
| `organizations[].members[].grants` | array：object | 是 |  |  |
| `organizations[].members[].grants[]` | object | 每个元素 | 不接受额外字段 |  |
| `organizations[].members[].grants[].serverId` | string | 是 | 正则：`"^[A-Za-z]{3,5}$"` |  |
| `organizations[].members[].grants[].roles` | array：string | 是 |  |  |
| `organizations[].members[].grants[].roles[]` | string | 每个元素 | 可选值：`["PLAYER","ORG_ADMIN","SERVER_ADMIN","CLIENT_EDITOR","SERVER_EDITOR","REVIEWER","PUBLISHER","RELEASE_OPERATOR","READ_ONLY"]` |  |
| `organizations[].members[].protected` | boolean | 是 |  |  |
| `accounts` | array：object | 是 |  |  |
| `accounts[]` | object | 每个元素 | 不接受额外字段 |  |
| `accounts[].id` | string (uuid) | 是 |  |  |
| `accounts[].displayName` | string | 是 |  |  |
| `accounts[].status` | string | 是 | 可选值：`["ACTIVE","DISABLED"]` |  |
| `accounts[].isSuperAdmin` | boolean | 是 |  |  |
| `accounts[].username` | string | 是 |  |  |
| `accounts[].unionSubject` | string | 否 |  |  |
| `events` | array：object | 是 |  |  |
| `events[]` | object | 每个元素 | 不接受额外字段 |  |
| `events[].id` | string (uuid) | 是 |  |  |
| `events[].action` | string | 是 |  |  |
| `events[].targetType` | string | 是 |  |  |
| `events[].targetId` | string | 是 |  |  |
| `events[].organizationId` | string / null (uuid) | 是 |  |  |
| `events[].serverId` | string / null | 是 | 正则：`"^[A-Za-z]{3,5}$"` |  |
| `events[].details` | 未限定类型 | 否 |  |  |
| `events[].createdAt` | string (date-time) | 是 |  |  |
| `events[].actor` | object / null | 是 | 不接受额外字段 |  |
| `events[].actor.displayName` | string | 是 |  |  |
| `auditActivity` | array：object | 是 |  |  |
| `auditActivity[]` | object | 每个元素 | 不接受额外字段 |  |
| `auditActivity[].date` | string | 是 | 正则：`"^\\d{4}-\\d{2}-\\d{2}$"` |  |
| `auditActivity[].count` | integer | 是 | 最小值（含）：`0` |  |
| `enabledPackageFormats` | array：anyOf（2 个分支） | 是 |  |  |
| `enabledPackageFormats[]` | anyOf（2 个分支） | 每个元素 |  |  |
| `enabledPackageFormats[].anyOf[1]` | number | 分支内适用 | 可选值：`[1]` |  |
| `enabledPackageFormats[].anyOf[2]` | number | 分支内适用 | 可选值：`[2]` |  |
| `maxUploadSizeMb` | integer | 是 | 最小值（含）：`1`<br>最大值（含）：`20480` |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "actor": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "format": "uuid"
        },
        "displayName": {
          "type": "string"
        },
        "isSuperAdmin": {
          "type": "boolean"
        },
        "username": {
          "type": [
            "string",
            "null"
          ]
        },
        "unionSubject": {
          "type": "string"
        }
      },
      "required": [
        "id",
        "displayName",
        "isSuperAdmin"
      ],
      "additionalProperties": false
    },
    "organizations": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "displayName": {
            "type": "string"
          },
          "description": {
            "type": "string"
          },
          "clientCount": {
            "type": "integer",
            "minimum": 0
          },
          "avatarObjectKey": {
            "type": [
              "string",
              "null"
            ]
          },
          "skinSites": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "code": {
                  "type": "string"
                },
                "url": {
                  "type": "string",
                  "format": "uri"
                }
              },
              "required": [
                "code",
                "url"
              ],
              "additionalProperties": false
            }
          },
          "archivedAt": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          },
          "permissions": {
            "type": "array",
            "items": {
              "type": "string",
              "enum": [
                "SERVER_READ",
                "SERVER_EDIT",
                "DRAFT_READ",
                "DRAFT_CREATE",
                "DRAFT_EDIT",
                "DRAFT_SUBMIT",
                "DRAFT_ARCHIVE",
                "RELEASE_READ",
                "ORG_EDIT",
                "ORG_MEMBERS_READ",
                "ORG_MEMBERS_MANAGE",
                "CLIENT_ARCHIVE",
                "CLIENT_DELETE",
                "CLIENT_BIND",
                "DRAFT_REVIEW",
                "RELEASE_PUBLISH",
                "RELEASE_ACTIVATE"
              ]
            }
          },
          "servers": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "serverId": {
                  "type": "string",
                  "pattern": "^[A-Za-z]{3,5}$"
                },
                "organizationId": {
                  "type": "string",
                  "format": "uuid"
                },
                "displayName": {
                  "type": "string"
                },
                "description": {
                  "type": "string"
                },
                "gameAddress": {
                  "type": [
                    "string",
                    "null"
                  ]
                },
                "iconObjectKey": {
                  "type": [
                    "string",
                    "null"
                  ]
                },
                "sortOrder": {
                  "type": "integer"
                },
                "themeColor": {
                  "type": [
                    "string",
                    "null"
                  ]
                },
                "mottoImageUrl": {
                  "type": [
                    "string",
                    "null"
                  ]
                },
                "displayMode": {
                  "type": "string",
                  "enum": [
                    "PERMANENT",
                    "RANGE"
                  ]
                },
                "displayStartsAt": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "format": "date-time"
                },
                "displayEndsAt": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "format": "date-time"
                },
                "isListed": {
                  "type": "boolean"
                },
                "archivedAt": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "format": "date-time"
                },
                "clientArchivedAt": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "format": "date-time"
                },
                "currentReleaseId": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "format": "uuid"
                },
                "currentReleaseActive": {
                  "type": "boolean"
                },
                "publicationRevision": {
                  "type": "integer",
                  "minimum": 0
                },
                "boundClientId": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "format": "uuid"
                },
                "boundClientName": {
                  "type": [
                    "string",
                    "null"
                  ]
                },
                "permissions": {
                  "type": "array",
                  "items": {
                    "type": "string",
                    "enum": [
                      "SERVER_READ",
                      "SERVER_EDIT",
                      "DRAFT_READ",
                      "DRAFT_CREATE",
                      "DRAFT_EDIT",
                      "DRAFT_SUBMIT",
                      "DRAFT_ARCHIVE",
                      "RELEASE_READ",
                      "ORG_EDIT",
                      "ORG_MEMBERS_READ",
                      "ORG_MEMBERS_MANAGE",
                      "CLIENT_ARCHIVE",
                      "CLIENT_DELETE",
                      "CLIENT_BIND",
                      "DRAFT_REVIEW",
                      "RELEASE_PUBLISH",
                      "RELEASE_ACTIVATE"
                    ]
                  }
                }
              },
              "required": [
                "serverId",
                "organizationId",
                "displayName",
                "description",
                "gameAddress",
                "iconObjectKey",
                "sortOrder",
                "themeColor",
                "mottoImageUrl",
                "displayMode",
                "displayStartsAt",
                "displayEndsAt",
                "isListed",
                "archivedAt",
                "clientArchivedAt",
                "currentReleaseId",
                "currentReleaseActive",
                "publicationRevision",
                "boundClientId",
                "boundClientName",
                "permissions"
              ],
              "additionalProperties": false
            }
          },
          "members": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "account": {
                  "type": "object",
                  "properties": {
                    "id": {
                      "type": "string",
                      "format": "uuid"
                    },
                    "displayName": {
                      "type": "string"
                    },
                    "status": {
                      "type": "string",
                      "enum": [
                        "ACTIVE",
                        "DISABLED"
                      ]
                    },
                    "isSuperAdmin": {
                      "type": "boolean"
                    },
                    "username": {
                      "type": "string"
                    },
                    "unionSubject": {
                      "type": "string"
                    }
                  },
                  "required": [
                    "id",
                    "displayName",
                    "status",
                    "isSuperAdmin",
                    "username"
                  ],
                  "additionalProperties": false
                },
                "status": {
                  "type": "string",
                  "enum": [
                    "ACTIVE",
                    "DISABLED"
                  ]
                },
                "roles": {
                  "type": "array",
                  "items": {
                    "type": "string",
                    "enum": [
                      "PLAYER",
                      "ORG_ADMIN",
                      "SERVER_ADMIN",
                      "CLIENT_EDITOR",
                      "SERVER_EDITOR",
                      "REVIEWER",
                      "PUBLISHER",
                      "RELEASE_OPERATOR",
                      "READ_ONLY"
                    ]
                  }
                },
                "grants": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "serverId": {
                        "type": "string",
                        "pattern": "^[A-Za-z]{3,5}$"
                      },
                      "roles": {
                        "type": "array",
                        "items": {
                          "type": "string",
                          "enum": [
                            "PLAYER",
                            "ORG_ADMIN",
                            "SERVER_ADMIN",
                            "CLIENT_EDITOR",
                            "SERVER_EDITOR",
                            "REVIEWER",
                            "PUBLISHER",
                            "RELEASE_OPERATOR",
                            "READ_ONLY"
                          ]
                        }
                      }
                    },
                    "required": [
                      "serverId",
                      "roles"
                    ],
                    "additionalProperties": false
                  }
                },
                "protected": {
                  "type": "boolean"
                }
              },
              "required": [
                "account",
                "status",
                "roles",
                "grants",
                "protected"
              ],
              "additionalProperties": false
            }
          }
        },
        "required": [
          "id",
          "displayName",
          "description",
          "clientCount",
          "avatarObjectKey",
          "archivedAt",
          "permissions",
          "servers",
          "members"
        ],
        "additionalProperties": false
      }
    },
    "accounts": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "displayName": {
            "type": "string"
          },
          "status": {
            "type": "string",
            "enum": [
              "ACTIVE",
              "DISABLED"
            ]
          },
          "isSuperAdmin": {
            "type": "boolean"
          },
          "username": {
            "type": "string"
          },
          "unionSubject": {
            "type": "string"
          }
        },
        "required": [
          "id",
          "displayName",
          "status",
          "isSuperAdmin",
          "username"
        ],
        "additionalProperties": false
      }
    },
    "events": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "action": {
            "type": "string"
          },
          "targetType": {
            "type": "string"
          },
          "targetId": {
            "type": "string"
          },
          "organizationId": {
            "type": [
              "string",
              "null"
            ],
            "format": "uuid"
          },
          "serverId": {
            "type": [
              "string",
              "null"
            ],
            "pattern": "^[A-Za-z]{3,5}$"
          },
          "details": {},
          "createdAt": {
            "type": "string",
            "format": "date-time"
          },
          "actor": {
            "type": [
              "object",
              "null"
            ],
            "properties": {
              "displayName": {
                "type": "string"
              }
            },
            "required": [
              "displayName"
            ],
            "additionalProperties": false
          }
        },
        "required": [
          "id",
          "action",
          "targetType",
          "targetId",
          "organizationId",
          "serverId",
          "createdAt",
          "actor"
        ],
        "additionalProperties": false
      }
    },
    "auditActivity": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "date": {
            "type": "string",
            "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
          },
          "count": {
            "type": "integer",
            "minimum": 0
          }
        },
        "required": [
          "date",
          "count"
        ],
        "additionalProperties": false
      }
    },
    "enabledPackageFormats": {
      "type": "array",
      "items": {
        "anyOf": [
          {
            "type": "number",
            "enum": [
              1
            ]
          },
          {
            "type": "number",
            "enum": [
              2
            ]
          }
        ]
      }
    },
    "maxUploadSizeMb": {
      "type": "integer",
      "minimum": 1,
      "maximum": 20480
    }
  },
  "required": [
    "actor",
    "organizations",
    "accounts",
    "events",
    "auditActivity",
    "enabledPackageFormats",
    "maxUploadSizeMb"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-apitoken"></a>

### ApiToken

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `id` | string (uuid) | 是 |  |  |
| `name` | string | 是 |  |  |
| `permissions` | array：string | 是 |  |  |
| `permissions[]` | string | 每个元素 | 可选值：`["SERVER_READ","SERVER_EDIT","DRAFT_READ","DRAFT_CREATE","DRAFT_EDIT","DRAFT_SUBMIT","DRAFT_ARCHIVE","RELEASE_READ","ORG_EDIT","ORG_MEMBERS_READ","ORG_MEMBERS_MANAGE","CLIENT_ARCHIVE","CLIENT_DELETE","CLIENT_BIND","DRAFT_REVIEW","RELEASE_PUBLISH","RELEASE_ACTIVATE"]` |  |
| `serverIds` | array：string | 是 |  |  |
| `serverIds[]` | string | 每个元素 | 正则：`"^[A-Za-z]{3,5}$"` |  |
| `expiresAt` | string (date-time) | 是 |  |  |
| `revokedAt` | string / null (date-time) | 是 |  |  |
| `createdAt` | string (date-time) | 是 |  |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "uuid"
    },
    "name": {
      "type": "string"
    },
    "permissions": {
      "type": "array",
      "items": {
        "type": "string",
        "enum": [
          "SERVER_READ",
          "SERVER_EDIT",
          "DRAFT_READ",
          "DRAFT_CREATE",
          "DRAFT_EDIT",
          "DRAFT_SUBMIT",
          "DRAFT_ARCHIVE",
          "RELEASE_READ",
          "ORG_EDIT",
          "ORG_MEMBERS_READ",
          "ORG_MEMBERS_MANAGE",
          "CLIENT_ARCHIVE",
          "CLIENT_DELETE",
          "CLIENT_BIND",
          "DRAFT_REVIEW",
          "RELEASE_PUBLISH",
          "RELEASE_ACTIVATE"
        ]
      }
    },
    "serverIds": {
      "type": "array",
      "items": {
        "type": "string",
        "pattern": "^[A-Za-z]{3,5}$"
      }
    },
    "expiresAt": {
      "type": "string",
      "format": "date-time"
    },
    "revokedAt": {
      "type": [
        "string",
        "null"
      ],
      "format": "date-time"
    },
    "createdAt": {
      "type": "string",
      "format": "date-time"
    }
  },
  "required": [
    "id",
    "name",
    "permissions",
    "serverIds",
    "expiresAt",
    "revokedAt",
    "createdAt"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-createdapitoken"></a>

### CreatedApiToken

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `id` | string (uuid) | 是 |  |  |
| `name` | string | 是 |  |  |
| `permissions` | array：string | 是 |  |  |
| `permissions[]` | string | 每个元素 | 可选值：`["SERVER_READ","SERVER_EDIT","DRAFT_READ","DRAFT_CREATE","DRAFT_EDIT","DRAFT_SUBMIT","DRAFT_ARCHIVE","RELEASE_READ","ORG_EDIT","ORG_MEMBERS_READ","ORG_MEMBERS_MANAGE","CLIENT_ARCHIVE","CLIENT_DELETE","CLIENT_BIND","DRAFT_REVIEW","RELEASE_PUBLISH","RELEASE_ACTIVATE"]` |  |
| `serverIds` | array：string | 是 |  |  |
| `serverIds[]` | string | 每个元素 | 正则：`"^[A-Za-z]{3,5}$"` |  |
| `expiresAt` | string (date-time) | 是 |  |  |
| `revokedAt` | string / null (date-time) | 是 |  |  |
| `createdAt` | string (date-time) | 是 |  |  |
| `token` | string | 是 | 正则：`"^mua_[0-9a-f]{64}$"` |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "uuid"
    },
    "name": {
      "type": "string"
    },
    "permissions": {
      "type": "array",
      "items": {
        "type": "string",
        "enum": [
          "SERVER_READ",
          "SERVER_EDIT",
          "DRAFT_READ",
          "DRAFT_CREATE",
          "DRAFT_EDIT",
          "DRAFT_SUBMIT",
          "DRAFT_ARCHIVE",
          "RELEASE_READ",
          "ORG_EDIT",
          "ORG_MEMBERS_READ",
          "ORG_MEMBERS_MANAGE",
          "CLIENT_ARCHIVE",
          "CLIENT_DELETE",
          "CLIENT_BIND",
          "DRAFT_REVIEW",
          "RELEASE_PUBLISH",
          "RELEASE_ACTIVATE"
        ]
      }
    },
    "serverIds": {
      "type": "array",
      "items": {
        "type": "string",
        "pattern": "^[A-Za-z]{3,5}$"
      }
    },
    "expiresAt": {
      "type": "string",
      "format": "date-time"
    },
    "revokedAt": {
      "type": [
        "string",
        "null"
      ],
      "format": "date-time"
    },
    "createdAt": {
      "type": "string",
      "format": "date-time"
    },
    "token": {
      "type": "string",
      "pattern": "^mua_[0-9a-f]{64}$"
    }
  },
  "required": [
    "id",
    "name",
    "permissions",
    "serverIds",
    "expiresAt",
    "revokedAt",
    "createdAt",
    "token"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-infrastructure"></a>

### Infrastructure

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `storageReady` | boolean | 是 |  |  |
| `packagesBucket` | string | 是 |  |  |
| `casBucket` | string | 是 |  |  |
| `environmentsBucket` | string | 是 |  |  |
| `signing` | object / null | 是 | 不接受额外字段 |  |
| `signing.keyId` | string | 是 |  |  |
| `signing.publicKey` | string | 是 |  |  |
| `queue` | array：object | 是 |  |  |
| `queue[]` | object | 每个元素 | 不接受额外字段 |  |
| `queue[].status` | string | 是 | 可选值：`["UPLOADING","QUEUED","PROCESSING","READY","FAILED","SUBMITTED","CANCELLED"]` |  |
| `queue[].count` | integer | 是 | 最小值（含）：`0` |  |
| `packageQueue` | array：object | 是 |  |  |
| `packageQueue[]` | object | 每个元素 | 不接受额外字段 |  |
| `packageQueue[].status` | string | 是 |  |  |
| `packageQueue[].count` | integer | 是 | 最小值（含）：`0` |  |
| `workers` | array：object | 是 |  |  |
| `workers[]` | object | 每个元素 | 不接受额外字段 |  |
| `workers[].id` | string | 是 |  |  |
| `workers[].lastSeen` | string (date-time) | 是 |  |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "storageReady": {
      "type": "boolean"
    },
    "packagesBucket": {
      "type": "string"
    },
    "casBucket": {
      "type": "string"
    },
    "environmentsBucket": {
      "type": "string"
    },
    "signing": {
      "type": [
        "object",
        "null"
      ],
      "properties": {
        "keyId": {
          "type": "string"
        },
        "publicKey": {
          "type": "string"
        }
      },
      "required": [
        "keyId",
        "publicKey"
      ],
      "additionalProperties": false
    },
    "queue": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "status": {
            "type": "string",
            "enum": [
              "UPLOADING",
              "QUEUED",
              "PROCESSING",
              "READY",
              "FAILED",
              "SUBMITTED",
              "CANCELLED"
            ]
          },
          "count": {
            "type": "integer",
            "minimum": 0
          }
        },
        "required": [
          "status",
          "count"
        ],
        "additionalProperties": false
      }
    },
    "packageQueue": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "status": {
            "type": "string"
          },
          "count": {
            "type": "integer",
            "minimum": 0
          }
        },
        "required": [
          "status",
          "count"
        ],
        "additionalProperties": false
      }
    },
    "workers": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "lastSeen": {
            "type": "string",
            "format": "date-time"
          }
        },
        "required": [
          "id",
          "lastSeen"
        ],
        "additionalProperties": false
      }
    }
  },
  "required": [
    "storageReady",
    "packagesBucket",
    "casBucket",
    "environmentsBucket",
    "signing",
    "queue",
    "packageQueue",
    "workers"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-serverprobe"></a>

### ServerProbe

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `serverId` | string | 是 | 正则：`"^[A-Za-z]{3,5}$"` |  |
| `state` | string | 是 | 可选值：`["ONLINE","HIGH_LATENCY","OFFLINE","UNKNOWN"]` |  |
| `address` | string / null | 是 |  |  |
| `checkedAt` | string / null (date-time) | 是 |  |  |
| `latencyMs` | number / null | 是 |  |  |
| `latencyKind` | anyOf（2 个分支） | 是 |  |  |
| `latencyKind.anyOf[1]` | string | 分支内适用 | 可选值：`["PONG","STATUS"]` |  |
| `latencyKind.anyOf[2]` | null | 分支内适用 |  |  |
| `highLatencyMs` | number | 是 |  |  |
| `message` | object | 是 | 不接受额外字段 |  |
| `message.code` | string | 是 |  |  |
| `message.message` | string | 是 |  |  |
| `message.params` | object | 是 | 动态字段值：anyOf（2 个分支） |  |
| `message.params{key}` | anyOf（2 个分支） | 动态字段 |  |  |
| `message.params{key}.anyOf[1]` | string | 分支内适用 |  |  |
| `message.params{key}.anyOf[2]` | number | 分支内适用 |  |  |
| `version` | string / null | 是 |  |  |
| `playersOnline` | integer / null | 是 |  |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "serverId": {
      "type": "string",
      "pattern": "^[A-Za-z]{3,5}$"
    },
    "state": {
      "type": "string",
      "enum": [
        "ONLINE",
        "HIGH_LATENCY",
        "OFFLINE",
        "UNKNOWN"
      ]
    },
    "address": {
      "type": [
        "string",
        "null"
      ]
    },
    "checkedAt": {
      "type": [
        "string",
        "null"
      ],
      "format": "date-time"
    },
    "latencyMs": {
      "type": [
        "number",
        "null"
      ]
    },
    "latencyKind": {
      "anyOf": [
        {
          "type": "string",
          "enum": [
            "PONG",
            "STATUS"
          ]
        },
        {
          "type": "null"
        }
      ]
    },
    "highLatencyMs": {
      "type": "number"
    },
    "message": {
      "type": "object",
      "properties": {
        "code": {
          "type": "string"
        },
        "message": {
          "type": "string"
        },
        "params": {
          "type": "object",
          "additionalProperties": {
            "anyOf": [
              {
                "type": "string"
              },
              {
                "type": "number"
              }
            ]
          }
        }
      },
      "required": [
        "code",
        "message",
        "params"
      ],
      "additionalProperties": false
    },
    "version": {
      "type": [
        "string",
        "null"
      ]
    },
    "playersOnline": {
      "type": [
        "integer",
        "null"
      ]
    }
  },
  "required": [
    "serverId",
    "state",
    "address",
    "checkedAt",
    "latencyMs",
    "latencyKind",
    "highLatencyMs",
    "message",
    "version",
    "playersOnline"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-mottometadata"></a>

### MottoMetadata

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `version` | number | 是 | 可选值：`[1]` |  |
| `width` | integer | 是 | 最小值（不含）：`0` |  |
| `height` | integer | 是 | 最小值（不含）：`0` |  |
| `crop` | object | 是 | 不接受额外字段 |  |
| `crop.left` | number | 是 | 最小值（含）：`0`<br>最大值（含）：`1` |  |
| `crop.top` | number | 是 | 最小值（含）：`0`<br>最大值（含）：`1` |  |
| `crop.width` | number | 是 | 最大值（含）：`1`<br>最小值（不含）：`0` |  |
| `crop.height` | number | 是 | 最大值（含）：`1`<br>最小值（不含）：`0` |  |
| `sourceSha256` | string | 是 | 正则：`"^[a-f0-9]{64}$"` |  |
| `imageSha256` | string | 是 | 正则：`"^[a-f0-9]{64}$"` |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "version": {
      "type": "number",
      "enum": [
        1
      ]
    },
    "width": {
      "type": "integer",
      "exclusiveMinimum": 0
    },
    "height": {
      "type": "integer",
      "exclusiveMinimum": 0
    },
    "crop": {
      "type": "object",
      "properties": {
        "left": {
          "type": "number",
          "minimum": 0,
          "maximum": 1
        },
        "top": {
          "type": "number",
          "minimum": 0,
          "maximum": 1
        },
        "width": {
          "type": "number",
          "exclusiveMinimum": 0,
          "maximum": 1
        },
        "height": {
          "type": "number",
          "exclusiveMinimum": 0,
          "maximum": 1
        }
      },
      "required": [
        "left",
        "top",
        "width",
        "height"
      ],
      "additionalProperties": false
    },
    "sourceSha256": {
      "type": "string",
      "pattern": "^[a-f0-9]{64}$"
    },
    "imageSha256": {
      "type": "string",
      "pattern": "^[a-f0-9]{64}$"
    }
  },
  "required": [
    "version",
    "width",
    "height",
    "crop",
    "sourceSha256",
    "imageSha256"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-managementfullpackage"></a>

### ManagementFullPackage

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `packageType` | string | 是 | 可选值：`["full"]` |  |
| `packageFormatVersion` | integer | 是 |  |  |
| `platform` | string | 是 |  |  |
| `versionLabel` | string | 是 |  |  |
| `fileName` | string | 是 |  |  |
| `sha256` | string | 是 | 正则：`"^[a-f0-9]{64}$"` |  |
| `size` | integer | 是 | 最小值（含）：`0` |  |
| `expiresIn` | number | 是 | 可选值：`[300]` |  |
| `url` | string (uri) | 是 |  |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "packageType": {
      "type": "string",
      "enum": [
        "full"
      ]
    },
    "packageFormatVersion": {
      "type": "integer"
    },
    "platform": {
      "type": "string"
    },
    "versionLabel": {
      "type": "string"
    },
    "fileName": {
      "type": "string"
    },
    "sha256": {
      "type": "string",
      "pattern": "^[a-f0-9]{64}$"
    },
    "size": {
      "type": "integer",
      "minimum": 0
    },
    "expiresIn": {
      "type": "number",
      "enum": [
        300
      ]
    },
    "url": {
      "type": "string",
      "format": "uri"
    }
  },
  "required": [
    "packageType",
    "packageFormatVersion",
    "platform",
    "versionLabel",
    "fileName",
    "sha256",
    "size",
    "expiresIn",
    "url"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-publishresult"></a>

### PublishResult

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `releaseId` | string (uuid) | 是 |  |  |
| `versionLabel` | string | 是 |  |  |
| `activated` | boolean | 否 |  |  |
| `archivedDraftIds` | array：string (uuid) | 否 |  |  |
| `archivedDraftIds[]` | string (uuid) | 每个元素 |  |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "releaseId": {
      "type": "string",
      "format": "uuid"
    },
    "versionLabel": {
      "type": "string"
    },
    "activated": {
      "type": "boolean"
    },
    "archivedDraftIds": {
      "type": "array",
      "items": {
        "type": "string",
        "format": "uuid"
      }
    }
  },
  "required": [
    "releaseId",
    "versionLabel"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-17"></a>

### getUploadDistribution 200 响应

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `formatVersion` | number | 是 | 可选值：`[2]` |  |
| `base` | object / null | 是 | 不接受额外字段 |  |
| `base.releaseId` | string (uuid) | 是 |  |  |
| `base.version` | string | 是 |  |  |
| `base.manifestSha256` | string | 是 | 正则：`"^[a-f0-9]{64}$"` |  |
| `localFiles` | integer | 是 | 最小值（含）：`0` |  |
| `localBytes` | integer | 是 | 最小值（含）：`0` |  |
| `remoteFiles` | integer | 是 | 最小值（含）：`0` |  |
| `remoteDeclaredBytes` | integer | 是 | 最小值（含）：`0` |  |
| `optionalFiles` | integer | 是 | 最小值（含）：`0` |  |
| `localPayloadBytes` | integer | 是 | 最小值（含）：`0` |  |
| `remoteDownloadBytes` | integer | 是 | 最小值（含）：`0` |  |
| `fullPackageBytes` | integer / null | 是 | 最小值（含）：`0` |  |
| `updatePackageBytes` | integer / null | 是 | 最小值（含）：`0` |  |
| `selectedPackageBytes` | integer / null | 是 | 最小值（含）：`0` |  |
| `knownNetworkBytes` | integer / null | 是 | 最小值（含）：`0` |  |
| `environmentBytes` | null | 是 |  |  |
| `runtimeChanged` | boolean / null | 是 |  |  |
| `launchChanged` | boolean / null | 是 |  |  |
| `changes` | array：object | 是 |  |  |
| `changes[]` | object | 每个元素 | 不接受额外字段 |  |
| `changes[].path` | string | 是 |  |  |
| `changes[].kinds` | array：string | 是 |  |  |
| `changes[].kinds[]` | string | 每个元素 | 可选值：`["added","modified","removed","policy","source"]` |  |
| `changes[].before` | anyOf（3 个分支） | 是 |  |  |
| `changes[].before.anyOf[1]` | object | 分支内适用 | 不接受额外字段 |  |
| `changes[].before.anyOf[1].path` | string | 是 |  |  |
| `changes[].before.anyOf[1].size` | integer | 是 | 最小值（含）：`0`<br>最大值（含）：`2147483648` |  |
| `changes[].before.anyOf[1].policy` | string | 是 | 可选值：`["managed","preserve"]` |  |
| `changes[].before.anyOf[1].optional` | boolean | 是 |  |  |
| `changes[].before.anyOf[1].executable` | boolean | 是 |  |  |
| `changes[].before.anyOf[1].hashes` | object | 是 | 不接受额外字段 |  |
| `changes[].before.anyOf[1].hashes.sha256` | string | 是 | 正则：`"^[a-f0-9]{64}$"` |  |
| `changes[].before.anyOf[1].source` | object | 是 | 不接受额外字段 |  |
| `changes[].before.anyOf[1].source.type` | string | 是 | 可选值：`["local"]` |  |
| `changes[].before.anyOf[1].source.entry` | string | 是 |  |  |
| `changes[].before.anyOf[2]` | object | 分支内适用 | 不接受额外字段 |  |
| `changes[].before.anyOf[2].path` | string | 是 |  |  |
| `changes[].before.anyOf[2].size` | integer | 是 | 最小值（含）：`0`<br>最大值（含）：`2147483648` |  |
| `changes[].before.anyOf[2].policy` | string | 是 | 可选值：`["managed","preserve"]` |  |
| `changes[].before.anyOf[2].optional` | boolean | 是 |  |  |
| `changes[].before.anyOf[2].executable` | boolean | 是 |  |  |
| `changes[].before.anyOf[2].hashes` | object | 是 | 不接受额外字段 |  |
| `changes[].before.anyOf[2].hashes.sha1` | string | 是 | 正则：`"^[a-f0-9]{40}$"` |  |
| `changes[].before.anyOf[2].hashes.sha512` | string | 是 | 正则：`"^[a-f0-9]{128}$"` |  |
| `changes[].before.anyOf[2].hashes.sha256` | string | 否 | 正则：`"^[a-f0-9]{64}$"` |  |
| `changes[].before.anyOf[2].source` | object | 是 | 不接受额外字段 |  |
| `changes[].before.anyOf[2].source.type` | string | 是 | 可选值：`["remote"]` |  |
| `changes[].before.anyOf[2].source.downloads` | array：string | 是 | 最少元素：`1`<br>最多元素：`10` |  |
| `changes[].before.anyOf[2].source.downloads[]` | string | 每个元素 | 最长长度：`4000` |  |
| `changes[].before.anyOf[3]` | null | 分支内适用 |  |  |
| `changes[].after` | anyOf（3 个分支） | 是 |  |  |
| `changes[].after.anyOf[1]` | object | 分支内适用 | 不接受额外字段 |  |
| `changes[].after.anyOf[1].path` | string | 是 |  |  |
| `changes[].after.anyOf[1].size` | integer | 是 | 最小值（含）：`0`<br>最大值（含）：`2147483648` |  |
| `changes[].after.anyOf[1].policy` | string | 是 | 可选值：`["managed","preserve"]` |  |
| `changes[].after.anyOf[1].optional` | boolean | 是 |  |  |
| `changes[].after.anyOf[1].executable` | boolean | 是 |  |  |
| `changes[].after.anyOf[1].hashes` | object | 是 | 不接受额外字段 |  |
| `changes[].after.anyOf[1].hashes.sha256` | string | 是 | 正则：`"^[a-f0-9]{64}$"` |  |
| `changes[].after.anyOf[1].source` | object | 是 | 不接受额外字段 |  |
| `changes[].after.anyOf[1].source.type` | string | 是 | 可选值：`["local"]` |  |
| `changes[].after.anyOf[1].source.entry` | string | 是 |  |  |
| `changes[].after.anyOf[2]` | object | 分支内适用 | 不接受额外字段 |  |
| `changes[].after.anyOf[2].path` | string | 是 |  |  |
| `changes[].after.anyOf[2].size` | integer | 是 | 最小值（含）：`0`<br>最大值（含）：`2147483648` |  |
| `changes[].after.anyOf[2].policy` | string | 是 | 可选值：`["managed","preserve"]` |  |
| `changes[].after.anyOf[2].optional` | boolean | 是 |  |  |
| `changes[].after.anyOf[2].executable` | boolean | 是 |  |  |
| `changes[].after.anyOf[2].hashes` | object | 是 | 不接受额外字段 |  |
| `changes[].after.anyOf[2].hashes.sha1` | string | 是 | 正则：`"^[a-f0-9]{40}$"` |  |
| `changes[].after.anyOf[2].hashes.sha512` | string | 是 | 正则：`"^[a-f0-9]{128}$"` |  |
| `changes[].after.anyOf[2].hashes.sha256` | string | 否 | 正则：`"^[a-f0-9]{64}$"` |  |
| `changes[].after.anyOf[2].source` | object | 是 | 不接受额外字段 |  |
| `changes[].after.anyOf[2].source.type` | string | 是 | 可选值：`["remote"]` |  |
| `changes[].after.anyOf[2].source.downloads` | array：string | 是 | 最少元素：`1`<br>最多元素：`10` |  |
| `changes[].after.anyOf[2].source.downloads[]` | string | 每个元素 | 最长长度：`4000` |  |
| `changes[].after.anyOf[3]` | null | 分支内适用 |  |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "formatVersion": {
      "type": "number",
      "enum": [
        2
      ]
    },
    "base": {
      "type": [
        "object",
        "null"
      ],
      "properties": {
        "releaseId": {
          "type": "string",
          "format": "uuid"
        },
        "version": {
          "type": "string"
        },
        "manifestSha256": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        }
      },
      "required": [
        "releaseId",
        "version",
        "manifestSha256"
      ],
      "additionalProperties": false
    },
    "localFiles": {
      "type": "integer",
      "minimum": 0
    },
    "localBytes": {
      "type": "integer",
      "minimum": 0
    },
    "remoteFiles": {
      "type": "integer",
      "minimum": 0
    },
    "remoteDeclaredBytes": {
      "type": "integer",
      "minimum": 0
    },
    "optionalFiles": {
      "type": "integer",
      "minimum": 0
    },
    "localPayloadBytes": {
      "type": "integer",
      "minimum": 0
    },
    "remoteDownloadBytes": {
      "type": "integer",
      "minimum": 0
    },
    "fullPackageBytes": {
      "type": [
        "integer",
        "null"
      ],
      "minimum": 0
    },
    "updatePackageBytes": {
      "type": [
        "integer",
        "null"
      ],
      "minimum": 0
    },
    "selectedPackageBytes": {
      "type": [
        "integer",
        "null"
      ],
      "minimum": 0
    },
    "knownNetworkBytes": {
      "type": [
        "integer",
        "null"
      ],
      "minimum": 0
    },
    "environmentBytes": {
      "type": "null"
    },
    "runtimeChanged": {
      "type": [
        "boolean",
        "null"
      ]
    },
    "launchChanged": {
      "type": [
        "boolean",
        "null"
      ]
    },
    "changes": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "path": {
            "type": "string"
          },
          "kinds": {
            "type": "array",
            "items": {
              "type": "string",
              "enum": [
                "added",
                "modified",
                "removed",
                "policy",
                "source"
              ]
            }
          },
          "before": {
            "anyOf": [
              {
                "type": "object",
                "properties": {
                  "path": {
                    "type": "string"
                  },
                  "size": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 2147483648
                  },
                  "policy": {
                    "type": "string",
                    "enum": [
                      "managed",
                      "preserve"
                    ]
                  },
                  "optional": {
                    "type": "boolean"
                  },
                  "executable": {
                    "type": "boolean"
                  },
                  "hashes": {
                    "type": "object",
                    "properties": {
                      "sha256": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{64}$"
                      }
                    },
                    "required": [
                      "sha256"
                    ],
                    "additionalProperties": false
                  },
                  "source": {
                    "type": "object",
                    "properties": {
                      "type": {
                        "type": "string",
                        "enum": [
                          "local"
                        ]
                      },
                      "entry": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "type",
                      "entry"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "path",
                  "size",
                  "policy",
                  "optional",
                  "executable",
                  "hashes",
                  "source"
                ],
                "additionalProperties": false
              },
              {
                "type": "object",
                "properties": {
                  "path": {
                    "type": "string"
                  },
                  "size": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 2147483648
                  },
                  "policy": {
                    "type": "string",
                    "enum": [
                      "managed",
                      "preserve"
                    ]
                  },
                  "optional": {
                    "type": "boolean"
                  },
                  "executable": {
                    "type": "boolean"
                  },
                  "hashes": {
                    "type": "object",
                    "properties": {
                      "sha1": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{40}$"
                      },
                      "sha512": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{128}$"
                      },
                      "sha256": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{64}$"
                      }
                    },
                    "required": [
                      "sha1",
                      "sha512"
                    ],
                    "additionalProperties": false
                  },
                  "source": {
                    "type": "object",
                    "properties": {
                      "type": {
                        "type": "string",
                        "enum": [
                          "remote"
                        ]
                      },
                      "downloads": {
                        "type": "array",
                        "items": {
                          "type": "string",
                          "maxLength": 4000
                        },
                        "minItems": 1,
                        "maxItems": 10
                      }
                    },
                    "required": [
                      "type",
                      "downloads"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "path",
                  "size",
                  "policy",
                  "optional",
                  "executable",
                  "hashes",
                  "source"
                ],
                "additionalProperties": false
              },
              {
                "type": "null"
              }
            ]
          },
          "after": {
            "anyOf": [
              {
                "type": "object",
                "properties": {
                  "path": {
                    "type": "string"
                  },
                  "size": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 2147483648
                  },
                  "policy": {
                    "type": "string",
                    "enum": [
                      "managed",
                      "preserve"
                    ]
                  },
                  "optional": {
                    "type": "boolean"
                  },
                  "executable": {
                    "type": "boolean"
                  },
                  "hashes": {
                    "type": "object",
                    "properties": {
                      "sha256": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{64}$"
                      }
                    },
                    "required": [
                      "sha256"
                    ],
                    "additionalProperties": false
                  },
                  "source": {
                    "type": "object",
                    "properties": {
                      "type": {
                        "type": "string",
                        "enum": [
                          "local"
                        ]
                      },
                      "entry": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "type",
                      "entry"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "path",
                  "size",
                  "policy",
                  "optional",
                  "executable",
                  "hashes",
                  "source"
                ],
                "additionalProperties": false
              },
              {
                "type": "object",
                "properties": {
                  "path": {
                    "type": "string"
                  },
                  "size": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 2147483648
                  },
                  "policy": {
                    "type": "string",
                    "enum": [
                      "managed",
                      "preserve"
                    ]
                  },
                  "optional": {
                    "type": "boolean"
                  },
                  "executable": {
                    "type": "boolean"
                  },
                  "hashes": {
                    "type": "object",
                    "properties": {
                      "sha1": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{40}$"
                      },
                      "sha512": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{128}$"
                      },
                      "sha256": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{64}$"
                      }
                    },
                    "required": [
                      "sha1",
                      "sha512"
                    ],
                    "additionalProperties": false
                  },
                  "source": {
                    "type": "object",
                    "properties": {
                      "type": {
                        "type": "string",
                        "enum": [
                          "remote"
                        ]
                      },
                      "downloads": {
                        "type": "array",
                        "items": {
                          "type": "string",
                          "maxLength": 4000
                        },
                        "minItems": 1,
                        "maxItems": 10
                      }
                    },
                    "required": [
                      "type",
                      "downloads"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "path",
                  "size",
                  "policy",
                  "optional",
                  "executable",
                  "hashes",
                  "source"
                ],
                "additionalProperties": false
              },
              {
                "type": "null"
              }
            ]
          }
        },
        "required": [
          "path",
          "kinds",
          "before",
          "after"
        ],
        "additionalProperties": false
      }
    }
  },
  "required": [
    "formatVersion",
    "base",
    "localFiles",
    "localBytes",
    "remoteFiles",
    "remoteDeclaredBytes",
    "optionalFiles",
    "localPayloadBytes",
    "remoteDownloadBytes",
    "fullPackageBytes",
    "updatePackageBytes",
    "selectedPackageBytes",
    "knownNetworkBytes",
    "environmentBytes",
    "runtimeChanged",
    "launchChanged",
    "changes"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-18"></a>

### listClients 200 响应

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | array：object | — |  |  |
| `$[]` | object | 每个元素 | 不接受额外字段 |  |
| `$[].clientId` | string (uuid) | 是 |  |  |
| `$[].name` | string | 是 |  |  |
| `$[].organizationId` | string (uuid) | 是 |  |  |
| `$[].organizationName` | string | 是 |  |  |
| `$[].serverId` | string / null | 是 | 正则：`"^[A-Za-z]{3,5}$"` |  |
| `$[].serverName` | string | 是 |  |  |
| `$[].requestedServerId` | string / null | 是 | 正则：`"^[A-Za-z]{3,5}$"` |  |
| `$[].scopeServerId` | string / null | 是 | 正则：`"^[A-Za-z]{3,5}$"` |  |
| `$[].archived` | boolean | 是 |  |  |
| `$[].blocked` | boolean | 是 |  |  |
| `$[].displaySchedule` | object / null | 是 | 不接受额外字段 |  |
| `$[].displaySchedule.displayMode` | string | 是 | 可选值：`["PERMANENT","RANGE"]` |  |
| `$[].displaySchedule.displayStartsAt` | string / null (date-time) | 是 |  |  |
| `$[].displaySchedule.displayEndsAt` | string / null (date-time) | 是 |  |  |
| `$[].lifecycleStatus` | string | 是 | 可选值：`["ARCHIVED","PUBLISHED","UNPUBLISHED"]` |  |
| `$[].permissions` | array：string | 是 |  |  |
| `$[].permissions[]` | string | 每个元素 | 可选值：`["SERVER_READ","SERVER_EDIT","DRAFT_READ","DRAFT_CREATE","DRAFT_EDIT","DRAFT_SUBMIT","DRAFT_ARCHIVE","RELEASE_READ","ORG_EDIT","ORG_MEMBERS_READ","ORG_MEMBERS_MANAGE","CLIENT_ARCHIVE","CLIENT_DELETE","CLIENT_BIND","DRAFT_REVIEW","RELEASE_PUBLISH","RELEASE_ACTIVATE"]` |  |
| `$[].publicationRevision` | integer | 是 | 最小值（含）：`0` |  |
| `$[].currentReleaseId` | string / null (uuid) | 是 |  |  |
| `$[].initialPackageFormatVersion` | integer / null | 是 |  |  |
| `$[].bindingRevision` | integer / null | 是 | 最小值（含）：`0` |  |
| `$[].drafts` | array：object | 是 |  |  |
| `$[].drafts[]` | object | 每个元素 | 不接受额外字段 |  |
| `$[].drafts[].id` | string (uuid) | 是 |  |  |
| `$[].drafts[].versionLabel` | string / null | 是 |  |  |
| `$[].drafts[].name` | string / null | 是 |  |  |
| `$[].drafts[].description` | string / null | 是 |  |  |
| `$[].drafts[].changelog` | string | 是 |  |  |
| `$[].drafts[].summary` | string / null | 是 |  |  |
| `$[].drafts[].archivedAt` | string / null (date-time) | 是 |  |  |
| `$[].drafts[].packageFormatVersion` | integer | 是 |  |  |
| `$[].drafts[].versionSequence` | integer | 是 | 最小值（含）：`0` |  |
| `$[].drafts[].replacesDraftId` | string / null (uuid) | 是 |  |  |
| `$[].drafts[].archiveReason` | string / null | 是 |  |  |
| `$[].drafts[].supersededByDraftId` | string / null (uuid) | 是 |  |  |
| `$[].drafts[].candidateMetadata` | 未限定类型 | 否 |  |  |
| `$[].drafts[].reviewNote` | string / null | 是 |  |  |
| `$[].drafts[].status` | string | 是 | 可选值：`["DRAFT","SUBMITTED","APPROVED","REJECTED","RELEASED"]` |  |
| `$[].drafts[].contentRevision` | integer | 是 | 最小值（含）：`0` |  |
| `$[].drafts[].packageRevision` | integer | 是 | 最小值（含）：`0` |  |
| `$[].drafts[].createdAt` | string (date-time) | 是 |  |  |
| `$[].drafts[].upload` | object / null | 是 | 不接受额外字段 |  |
| `$[].drafts[].upload.id` | string (uuid) | 是 |  |  |
| `$[].drafts[].upload.statistics` | anyOf（3 个分支） | 是 |  |  |
| `$[].drafts[].upload.statistics.anyOf[1]` | object | 分支内适用 | 不接受额外字段 |  |
| `$[].drafts[].upload.statistics.anyOf[1].previousVersion` | string / null | 是 |  |  |
| `$[].drafts[].upload.statistics.anyOf[1].addedFiles` | integer | 是 | 最小值（含）：`0` |  |
| `$[].drafts[].upload.statistics.anyOf[1].modifiedFiles` | integer | 是 | 最小值（含）：`0` |  |
| `$[].drafts[].upload.statistics.anyOf[1].deletedFiles` | integer | 是 | 最小值（含）：`0` |  |
| `$[].drafts[].upload.statistics.anyOf[1].fullSize` | integer | 是 | 最小值（含）：`0` |  |
| `$[].drafts[].upload.statistics.anyOf[1].newDataSize` | integer | 是 | 最小值（含）：`0` |  |
| `$[].drafts[].upload.statistics.anyOf[1].estimatedDownloadSize` | integer | 是 | 最小值（含）：`0` |  |
| `$[].drafts[].upload.statistics.anyOf[1].casReusePercent` | number | 是 |  |  |
| `$[].drafts[].upload.statistics.anyOf[1].fileCount` | integer | 是 | 最小值（含）：`0` |  |
| `$[].drafts[].upload.statistics.anyOf[1].sourceSize` | integer | 是 | 最小值（含）：`0` |  |
| `$[].drafts[].upload.statistics.anyOf[2]` | object | 分支内适用 | 不接受额外字段 |  |
| `$[].drafts[].upload.statistics.anyOf[2].localFiles` | integer | 是 | 最小值（含）：`0` |  |
| `$[].drafts[].upload.statistics.anyOf[2].remoteFiles` | integer | 是 | 最小值（含）：`0` |  |
| `$[].drafts[].upload.statistics.anyOf[2].optionalFiles` | integer | 是 | 最小值（含）：`0` |  |
| `$[].drafts[].upload.statistics.anyOf[2].localSize` | integer | 是 | 最小值（含）：`0` |  |
| `$[].drafts[].upload.statistics.anyOf[2].remoteDeclaredSize` | integer | 是 | 最小值（含）：`0` |  |
| `$[].drafts[].upload.statistics.anyOf[2].newLocalDataSize` | integer | 是 | 最小值（含）：`0` |  |
| `$[].drafts[].upload.statistics.anyOf[2].localCasReusePercent` | number | 是 |  |  |
| `$[].drafts[].upload.statistics.anyOf[2].sourceSize` | integer | 是 | 最小值（含）：`0` |  |
| `$[].drafts[].upload.statistics.anyOf[3]` | null | 分支内适用 |  |  |
| `$[].drafts[].upload.comparisonStatistics` | object / null | 是 | 不接受额外字段 |  |
| `$[].drafts[].upload.comparisonStatistics.previousVersion` | string / null | 是 |  |  |
| `$[].drafts[].upload.comparisonStatistics.addedFiles` | integer | 是 | 最小值（含）：`0` |  |
| `$[].drafts[].upload.comparisonStatistics.modifiedFiles` | integer | 是 | 最小值（含）：`0` |  |
| `$[].drafts[].upload.comparisonStatistics.deletedFiles` | integer | 是 | 最小值（含）：`0` |  |
| `$[].drafts[].upload.comparisonStatistics.fullSize` | integer | 是 | 最小值（含）：`0` |  |
| `$[].drafts[].upload.comparisonStatistics.newDataSize` | integer | 是 | 最小值（含）：`0` |  |
| `$[].drafts[].upload.comparisonStatistics.estimatedDownloadSize` | integer | 是 | 最小值（含）：`0` |  |
| `$[].drafts[].upload.comparisonStatistics.casReusePercent` | number | 是 |  |  |
| `$[].drafts[].upload.comparisonStatistics.fileCount` | integer | 是 | 最小值（含）：`0` |  |
| `$[].drafts[].upload.comparisonStatistics.sourceSize` | integer | 是 | 最小值（含）：`0` |  |
| `$[].drafts[].packageBuilds` | array：object | 是 |  |  |
| `$[].drafts[].packageBuilds[]` | object | 每个元素 | 不接受额外字段 |  |
| `$[].drafts[].packageBuilds[].platform` | string | 是 |  |  |
| `$[].drafts[].packageBuilds[].status` | string | 是 | 可选值：`["QUEUED","PROCESSING","PREPARED","READY","FAILED"]` |  |
| `$[].drafts[].packageBuilds[].phase` | object | 是 | 不接受额外字段 |  |
| `$[].drafts[].packageBuilds[].phase.code` | string | 是 |  |  |
| `$[].drafts[].packageBuilds[].phase.message` | string | 是 |  |  |
| `$[].drafts[].packageBuilds[].phase.params` | object | 是 | 动态字段值：anyOf（2 个分支） |  |
| `$[].drafts[].packageBuilds[].phase.params{key}` | anyOf（2 个分支） | 动态字段 |  |  |
| `$[].drafts[].packageBuilds[].phase.params{key}.anyOf[1]` | string | 分支内适用 |  |  |
| `$[].drafts[].packageBuilds[].phase.params{key}.anyOf[2]` | number | 分支内适用 |  |  |
| `$[].drafts[].packageBuilds[].progress` | integer | 是 | 最小值（含）：`0` |  |
| `$[].drafts[].packageBuilds[].error` | object / null | 是 | 不接受额外字段 |  |
| `$[].drafts[].packageBuilds[].error.code` | string | 是 |  |  |
| `$[].drafts[].packageBuilds[].error.message` | string | 是 |  |  |
| `$[].drafts[].packageBuilds[].error.params` | object | 是 | 动态字段值：anyOf（2 个分支） |  |
| `$[].drafts[].packageBuilds[].error.params{key}` | anyOf（2 个分支） | 动态字段 |  |  |
| `$[].drafts[].packageBuilds[].error.params{key}.anyOf[1]` | string | 分支内适用 |  |  |
| `$[].drafts[].packageBuilds[].error.params{key}.anyOf[2]` | number | 分支内适用 |  |  |
| `$[].drafts[].packageBuilds[].artifacts` | object / null | 是 | 不接受额外字段 |  |
| `$[].drafts[].packageBuilds[].artifacts.full` | object | 是 |  |  |
| `$[].drafts[].packageBuilds[].artifacts.full.key` | string | 是 |  |  |
| `$[].drafts[].packageBuilds[].artifacts.full.sha256` | string | 是 | 正则：`"^[a-f0-9]{64}$"` |  |
| `$[].drafts[].packageBuilds[].artifacts.full.size` | integer | 是 | 最小值（含）：`0` |  |
| `$[].drafts[].packageBuilds[].artifacts.update` | object / null | 是 |  |  |
| `$[].drafts[].packageBuilds[].artifacts.update.key` | string | 是 |  |  |
| `$[].drafts[].packageBuilds[].artifacts.update.sha256` | string | 是 | 正则：`"^[a-f0-9]{64}$"` |  |
| `$[].drafts[].packageBuilds[].artifacts.update.size` | integer | 是 | 最小值（含）：`0` |  |
| `$[].drafts[].packageBuilds[].artifacts.update.baseReleaseId` | string (uuid) | 是 |  |  |
| `$[].drafts[].packageBuilds[].artifacts.update.baseManifestSha256` | string | 是 | 正则：`"^[a-f0-9]{64}$"` |  |
| `$[].drafts[].packageBuilds[].artifacts.signingKeyId` | string | 是 | 正则：`"^[a-f0-9]{24}$"` |  |
| `$[].releases` | array：object | 是 |  |  |
| `$[].releases[]` | object | 每个元素 | 不接受额外字段 |  |
| `$[].releases[].id` | string (uuid) | 是 |  |  |
| `$[].releases[].versionLabel` | string | 是 |  |  |
| `$[].releases[].name` | string | 是 |  |  |
| `$[].releases[].description` | string | 是 |  |  |
| `$[].releases[].changelog` | string | 是 |  |  |
| `$[].releases[].summary` | string | 是 |  |  |
| `$[].releases[].archivedAt` | string / null (date-time) | 是 |  |  |
| `$[].releases[].packageFormatVersion` | integer | 是 |  |  |
| `$[].releases[].environmentSnapshot` | 未限定类型 | 否 |  |  |
| `$[].releases[].publishedAt` | string (date-time) | 是 |  |  |
| `$[].releases[].sourceDraft` | object / null | 是 | 不接受额外字段 |  |
| `$[].releases[].sourceDraft.packageRevision` | integer | 是 | 最小值（含）：`0` |  |
| `$[].releases[].sourceDraft.upload` | object / null | 是 | 不接受额外字段 |  |
| `$[].releases[].sourceDraft.upload.statistics` | anyOf（3 个分支） | 是 |  |  |
| `$[].releases[].sourceDraft.upload.statistics.anyOf[1]` | object | 分支内适用 | 不接受额外字段 |  |
| `$[].releases[].sourceDraft.upload.statistics.anyOf[1].previousVersion` | string / null | 是 |  |  |
| `$[].releases[].sourceDraft.upload.statistics.anyOf[1].addedFiles` | integer | 是 | 最小值（含）：`0` |  |
| `$[].releases[].sourceDraft.upload.statistics.anyOf[1].modifiedFiles` | integer | 是 | 最小值（含）：`0` |  |
| `$[].releases[].sourceDraft.upload.statistics.anyOf[1].deletedFiles` | integer | 是 | 最小值（含）：`0` |  |
| `$[].releases[].sourceDraft.upload.statistics.anyOf[1].fullSize` | integer | 是 | 最小值（含）：`0` |  |
| `$[].releases[].sourceDraft.upload.statistics.anyOf[1].newDataSize` | integer | 是 | 最小值（含）：`0` |  |
| `$[].releases[].sourceDraft.upload.statistics.anyOf[1].estimatedDownloadSize` | integer | 是 | 最小值（含）：`0` |  |
| `$[].releases[].sourceDraft.upload.statistics.anyOf[1].casReusePercent` | number | 是 |  |  |
| `$[].releases[].sourceDraft.upload.statistics.anyOf[1].fileCount` | integer | 是 | 最小值（含）：`0` |  |
| `$[].releases[].sourceDraft.upload.statistics.anyOf[1].sourceSize` | integer | 是 | 最小值（含）：`0` |  |
| `$[].releases[].sourceDraft.upload.statistics.anyOf[2]` | object | 分支内适用 | 不接受额外字段 |  |
| `$[].releases[].sourceDraft.upload.statistics.anyOf[2].localFiles` | integer | 是 | 最小值（含）：`0` |  |
| `$[].releases[].sourceDraft.upload.statistics.anyOf[2].remoteFiles` | integer | 是 | 最小值（含）：`0` |  |
| `$[].releases[].sourceDraft.upload.statistics.anyOf[2].optionalFiles` | integer | 是 | 最小值（含）：`0` |  |
| `$[].releases[].sourceDraft.upload.statistics.anyOf[2].localSize` | integer | 是 | 最小值（含）：`0` |  |
| `$[].releases[].sourceDraft.upload.statistics.anyOf[2].remoteDeclaredSize` | integer | 是 | 最小值（含）：`0` |  |
| `$[].releases[].sourceDraft.upload.statistics.anyOf[2].newLocalDataSize` | integer | 是 | 最小值（含）：`0` |  |
| `$[].releases[].sourceDraft.upload.statistics.anyOf[2].localCasReusePercent` | number | 是 |  |  |
| `$[].releases[].sourceDraft.upload.statistics.anyOf[2].sourceSize` | integer | 是 | 最小值（含）：`0` |  |
| `$[].releases[].sourceDraft.upload.statistics.anyOf[3]` | null | 分支内适用 |  |  |
| `$[].releases[].sourceDraft.upload.comparisonStatistics` | object / null | 是 | 不接受额外字段 |  |
| `$[].releases[].sourceDraft.upload.comparisonStatistics.previousVersion` | string / null | 是 |  |  |
| `$[].releases[].sourceDraft.upload.comparisonStatistics.addedFiles` | integer | 是 | 最小值（含）：`0` |  |
| `$[].releases[].sourceDraft.upload.comparisonStatistics.modifiedFiles` | integer | 是 | 最小值（含）：`0` |  |
| `$[].releases[].sourceDraft.upload.comparisonStatistics.deletedFiles` | integer | 是 | 最小值（含）：`0` |  |
| `$[].releases[].sourceDraft.upload.comparisonStatistics.fullSize` | integer | 是 | 最小值（含）：`0` |  |
| `$[].releases[].sourceDraft.upload.comparisonStatistics.newDataSize` | integer | 是 | 最小值（含）：`0` |  |
| `$[].releases[].sourceDraft.upload.comparisonStatistics.estimatedDownloadSize` | integer | 是 | 最小值（含）：`0` |  |
| `$[].releases[].sourceDraft.upload.comparisonStatistics.casReusePercent` | number | 是 |  |  |
| `$[].releases[].sourceDraft.upload.comparisonStatistics.fileCount` | integer | 是 | 最小值（含）：`0` |  |
| `$[].releases[].sourceDraft.upload.comparisonStatistics.sourceSize` | integer | 是 | 最小值（含）：`0` |  |
| `$[].releases[].sourceDraft.packageBuilds` | array：object | 是 |  |  |
| `$[].releases[].sourceDraft.packageBuilds[]` | object | 每个元素 | 不接受额外字段 |  |
| `$[].releases[].sourceDraft.packageBuilds[].draftId` | string (uuid) | 是 |  |  |
| `$[].releases[].sourceDraft.packageBuilds[].platform` | string | 是 |  |  |
| `$[].releases[].sourceDraft.packageBuilds[].revision` | integer | 是 | 最小值（含）：`0` |  |
| `$[].releases[].sourceDraft.packageBuilds[].status` | string | 是 |  |  |
| `$[].releases[].sourceDraft.packageBuilds[].required` | boolean | 是 |  |  |
| `$[].releases[].sourceDraft.packageBuilds[].artifacts` | 未限定类型 | 否 |  |  |
| `$[].releases[].packageBuilds` | array：object | 是 |  |  |
| `$[].releases[].packageBuilds[]` | object | 每个元素 | 不接受额外字段 |  |
| `$[].releases[].packageBuilds[].draftId` | string (uuid) | 是 |  |  |
| `$[].releases[].packageBuilds[].platform` | string | 是 |  |  |
| `$[].releases[].packageBuilds[].revision` | integer | 是 | 最小值（含）：`0` |  |
| `$[].releases[].packageBuilds[].status` | string | 是 |  |  |
| `$[].releases[].packageBuilds[].required` | boolean | 是 |  |  |
| `$[].releases[].packageBuilds[].artifacts` | object / null | 是 | 不接受额外字段 |  |
| `$[].releases[].packageBuilds[].artifacts.full` | object | 是 |  |  |
| `$[].releases[].packageBuilds[].artifacts.full.key` | string | 是 |  |  |
| `$[].releases[].packageBuilds[].artifacts.full.sha256` | string | 是 | 正则：`"^[a-f0-9]{64}$"` |  |
| `$[].releases[].packageBuilds[].artifacts.full.size` | integer | 是 | 最小值（含）：`0` |  |
| `$[].releases[].packageBuilds[].artifacts.update` | object / null | 是 |  |  |
| `$[].releases[].packageBuilds[].artifacts.update.key` | string | 是 |  |  |
| `$[].releases[].packageBuilds[].artifacts.update.sha256` | string | 是 | 正则：`"^[a-f0-9]{64}$"` |  |
| `$[].releases[].packageBuilds[].artifacts.update.size` | integer | 是 | 最小值（含）：`0` |  |
| `$[].releases[].packageBuilds[].artifacts.update.baseReleaseId` | string (uuid) | 是 |  |  |
| `$[].releases[].packageBuilds[].artifacts.update.baseManifestSha256` | string | 是 | 正则：`"^[a-f0-9]{64}$"` |  |
| `$[].releases[].packageBuilds[].artifacts.signingKeyId` | string | 是 | 正则：`"^[a-f0-9]{24}$"` |  |
| `$[].canDelete` | boolean | 是 |  |  |
| `$[].uploads` | array：object | 是 |  |  |
| `$[].uploads[]` | object | 每个元素 | 不接受额外字段 |  |
| `$[].uploads[].id` | string (uuid) | 是 |  |  |
| `$[].uploads[].clientId` | string (uuid) | 是 |  |  |
| `$[].uploads[].fileName` | string | 是 |  |  |
| `$[].uploads[].size` | integer | 是 | 最小值（含）：`0` |  |
| `$[].uploads[].partSize` | integer | 是 | 最小值（含）：`0` |  |
| `$[].uploads[].packageFormatVersion` | anyOf（2 个分支） | 是 |  |  |
| `$[].uploads[].packageFormatVersion.anyOf[1]` | number | 分支内适用 | 可选值：`[1]` |  |
| `$[].uploads[].packageFormatVersion.anyOf[2]` | number | 分支内适用 | 可选值：`[2]` |  |
| `$[].uploads[].status` | string | 是 | 可选值：`["UPLOADING","QUEUED","PROCESSING","READY","FAILED","SUBMITTED","CANCELLED"]` |  |
| `$[].uploads[].progress` | integer | 是 | 最小值（含）：`0` |  |
| `$[].uploads[].error` | object / null | 是 | 不接受额外字段 |  |
| `$[].uploads[].error.code` | string | 是 |  |  |
| `$[].uploads[].error.message` | string | 是 |  |  |
| `$[].uploads[].error.params` | object | 是 | 动态字段值：anyOf（2 个分支） |  |
| `$[].uploads[].error.params{key}` | anyOf（2 个分支） | 动态字段 |  |  |
| `$[].uploads[].error.params{key}.anyOf[1]` | string | 分支内适用 |  |  |
| `$[].uploads[].error.params{key}.anyOf[2]` | number | 分支内适用 |  |  |
| `$[].uploads[].draftId` | string / null (uuid) | 是 |  |  |
| `$[].uploads[].statistics` | object / null | 是 | 不接受额外字段 |  |
| `$[].uploads[].statistics.previousVersion` | string / null | 是 |  |  |
| `$[].uploads[].statistics.addedFiles` | integer | 是 | 最小值（含）：`0` |  |
| `$[].uploads[].statistics.modifiedFiles` | integer | 是 | 最小值（含）：`0` |  |
| `$[].uploads[].statistics.deletedFiles` | integer | 是 | 最小值（含）：`0` |  |
| `$[].uploads[].statistics.fullSize` | integer | 是 | 最小值（含）：`0` |  |
| `$[].uploads[].statistics.newDataSize` | integer | 是 | 最小值（含）：`0` |  |
| `$[].uploads[].statistics.estimatedDownloadSize` | integer | 是 | 最小值（含）：`0` |  |
| `$[].uploads[].statistics.casReusePercent` | number | 是 |  |  |
| `$[].uploads[].statistics.fileCount` | integer | 是 | 最小值（含）：`0` |  |
| `$[].uploads[].statistics.sourceSize` | integer | 是 | 最小值（含）：`0` |  |
| `$[].uploads[].recipeStatistics` | object / null | 是 | 不接受额外字段 |  |
| `$[].uploads[].recipeStatistics.localFiles` | integer | 是 | 最小值（含）：`0` |  |
| `$[].uploads[].recipeStatistics.remoteFiles` | integer | 是 | 最小值（含）：`0` |  |
| `$[].uploads[].recipeStatistics.optionalFiles` | integer | 是 | 最小值（含）：`0` |  |
| `$[].uploads[].recipeStatistics.localSize` | integer | 是 | 最小值（含）：`0` |  |
| `$[].uploads[].recipeStatistics.remoteDeclaredSize` | integer | 是 | 最小值（含）：`0` |  |
| `$[].uploads[].recipeStatistics.newLocalDataSize` | integer | 是 | 最小值（含）：`0` |  |
| `$[].uploads[].recipeStatistics.localCasReusePercent` | number | 是 |  |  |
| `$[].uploads[].recipeStatistics.sourceSize` | integer | 是 | 最小值（含）：`0` |  |
| `$[].uploads[].detectedMods` | array：string | 是 |  |  |
| `$[].uploads[].detectedMods[]` | string | 每个元素 |  |  |
| `$[].uploads[].warnings` | array：object | 是 |  |  |
| `$[].uploads[].warnings[]` | object | 每个元素 | 不接受额外字段 |  |
| `$[].uploads[].warnings[].code` | string | 是 |  |  |
| `$[].uploads[].warnings[].message` | string | 是 |  |  |
| `$[].uploads[].warnings[].params` | object | 是 | 动态字段值：anyOf（2 个分支） |  |
| `$[].uploads[].warnings[].params{key}` | anyOf（2 个分支） | 动态字段 |  |  |
| `$[].uploads[].warnings[].params{key}.anyOf[1]` | string | 分支内适用 |  |  |
| `$[].uploads[].warnings[].params{key}.anyOf[2]` | number | 分支内适用 |  |  |
| `$[].uploads[].comparisonDraftId` | string / null (uuid) | 是 |  |  |
| `$[].uploads[].comparisonStatistics` | object / null | 是 | 不接受额外字段 |  |
| `$[].uploads[].comparisonStatistics.previousVersion` | string / null | 是 |  |  |
| `$[].uploads[].comparisonStatistics.addedFiles` | integer | 是 | 最小值（含）：`0` |  |
| `$[].uploads[].comparisonStatistics.modifiedFiles` | integer | 是 | 最小值（含）：`0` |  |
| `$[].uploads[].comparisonStatistics.deletedFiles` | integer | 是 | 最小值（含）：`0` |  |
| `$[].uploads[].comparisonStatistics.fullSize` | integer | 是 | 最小值（含）：`0` |  |
| `$[].uploads[].comparisonStatistics.newDataSize` | integer | 是 | 最小值（含）：`0` |  |
| `$[].uploads[].comparisonStatistics.estimatedDownloadSize` | integer | 是 | 最小值（含）：`0` |  |
| `$[].uploads[].comparisonStatistics.casReusePercent` | number | 是 |  |  |
| `$[].uploads[].comparisonStatistics.fileCount` | integer | 是 | 最小值（含）：`0` |  |
| `$[].uploads[].comparisonStatistics.sourceSize` | integer | 是 | 最小值（含）：`0` |  |
| `$[].uploads[].processingPhase` | anyOf（2 个分支） | 是 |  |  |
| `$[].uploads[].processingPhase.anyOf[1]` | string | 分支内适用 | 可选值：`["FETCHING","INSPECTING","SELECT_INSTANCE","DOWNLOADING","CAS"]` |  |
| `$[].uploads[].processingPhase.anyOf[2]` | null | 分支内适用 |  |  |
| `$[].uploads[].detectedInfo` | object / null | 是 | 不接受额外字段 |  |
| `$[].uploads[].detectedInfo.instanceId` | string / null | 是 |  |  |
| `$[].uploads[].detectedInfo.minecraftVersion` | string / null | 是 |  |  |
| `$[].uploads[].detectedInfo.javaVersion` | integer / null | 是 |  |  |
| `$[].uploads[].detectedInfo.javaComponent` | string / null | 是 |  |  |
| `$[].uploads[].detectedInfo.loader` | string / null | 是 |  |  |
| `$[].uploads[].detectedInfo.loaderVersion` | string / null | 是 |  |  |
| `$[].uploads[].detectedInfo.minecraftSource` | object / null | 是 | 不接受额外字段 |  |
| `$[].uploads[].detectedInfo.minecraftSource.code` | string | 是 |  |  |
| `$[].uploads[].detectedInfo.minecraftSource.message` | string | 是 |  |  |
| `$[].uploads[].detectedInfo.minecraftSource.params` | object | 是 | 动态字段值：anyOf（2 个分支） |  |
| `$[].uploads[].detectedInfo.minecraftSource.params{key}` | anyOf（2 个分支） | 动态字段 |  |  |
| `$[].uploads[].detectedInfo.minecraftSource.params{key}.anyOf[1]` | string | 分支内适用 |  |  |
| `$[].uploads[].detectedInfo.minecraftSource.params{key}.anyOf[2]` | number | 分支内适用 |  |  |
| `$[].uploads[].detectedInfo.javaSource` | object / null | 是 | 不接受额外字段 |  |
| `$[].uploads[].detectedInfo.javaSource.code` | string | 是 |  |  |
| `$[].uploads[].detectedInfo.javaSource.message` | string | 是 |  |  |
| `$[].uploads[].detectedInfo.javaSource.params` | object | 是 | 动态字段值：anyOf（2 个分支） |  |
| `$[].uploads[].detectedInfo.javaSource.params{key}` | anyOf（2 个分支） | 动态字段 |  |  |
| `$[].uploads[].detectedInfo.javaSource.params{key}.anyOf[1]` | string | 分支内适用 |  |  |
| `$[].uploads[].detectedInfo.javaSource.params{key}.anyOf[2]` | number | 分支内适用 |  |  |
| `$[].uploads[].detectedInfo.warnings` | array：object | 是 |  |  |
| `$[].uploads[].detectedInfo.warnings[]` | object | 每个元素 | 不接受额外字段 |  |
| `$[].uploads[].detectedInfo.warnings[].code` | string | 是 |  |  |
| `$[].uploads[].detectedInfo.warnings[].message` | string | 是 |  |  |
| `$[].uploads[].detectedInfo.warnings[].params` | object | 是 | 动态字段值：anyOf（2 个分支） |  |
| `$[].uploads[].detectedInfo.warnings[].params{key}` | anyOf（2 个分支） | 动态字段 |  |  |
| `$[].uploads[].detectedInfo.warnings[].params{key}.anyOf[1]` | string | 分支内适用 |  |  |
| `$[].uploads[].detectedInfo.warnings[].params{key}.anyOf[2]` | number | 分支内适用 |  |  |
| `$[].uploads[].detectedInfo.schemaVersion` | number | 是 | 可选值：`[1]` |  |
| `$[].uploads[].detectedInfo.requiresSelection` | boolean | 是 |  |  |
| `$[].uploads[].detectedInfo.candidates` | array：object | 是 |  |  |
| `$[].uploads[].detectedInfo.candidates[]` | object | 每个元素 | 不接受额外字段 |  |
| `$[].uploads[].detectedInfo.candidates[].instanceId` | string / null | 是 |  |  |
| `$[].uploads[].detectedInfo.candidates[].minecraftVersion` | string / null | 是 |  |  |
| `$[].uploads[].detectedInfo.candidates[].javaVersion` | integer / null | 是 |  |  |
| `$[].uploads[].detectedInfo.candidates[].javaComponent` | string / null | 是 |  |  |
| `$[].uploads[].detectedInfo.candidates[].loader` | string / null | 是 |  |  |
| `$[].uploads[].detectedInfo.candidates[].loaderVersion` | string / null | 是 |  |  |
| `$[].uploads[].detectedInfo.candidates[].minecraftSource` | object / null | 是 | 不接受额外字段 |  |
| `$[].uploads[].detectedInfo.candidates[].minecraftSource.code` | string | 是 |  |  |
| `$[].uploads[].detectedInfo.candidates[].minecraftSource.message` | string | 是 |  |  |
| `$[].uploads[].detectedInfo.candidates[].minecraftSource.params` | object | 是 | 动态字段值：anyOf（2 个分支） |  |
| `$[].uploads[].detectedInfo.candidates[].minecraftSource.params{key}` | anyOf（2 个分支） | 动态字段 |  |  |
| `$[].uploads[].detectedInfo.candidates[].minecraftSource.params{key}.anyOf[1]` | string | 分支内适用 |  |  |
| `$[].uploads[].detectedInfo.candidates[].minecraftSource.params{key}.anyOf[2]` | number | 分支内适用 |  |  |
| `$[].uploads[].detectedInfo.candidates[].javaSource` | object / null | 是 | 不接受额外字段 |  |
| `$[].uploads[].detectedInfo.candidates[].javaSource.code` | string | 是 |  |  |
| `$[].uploads[].detectedInfo.candidates[].javaSource.message` | string | 是 |  |  |
| `$[].uploads[].detectedInfo.candidates[].javaSource.params` | object | 是 | 动态字段值：anyOf（2 个分支） |  |
| `$[].uploads[].detectedInfo.candidates[].javaSource.params{key}` | anyOf（2 个分支） | 动态字段 |  |  |
| `$[].uploads[].detectedInfo.candidates[].javaSource.params{key}.anyOf[1]` | string | 分支内适用 |  |  |
| `$[].uploads[].detectedInfo.candidates[].javaSource.params{key}.anyOf[2]` | number | 分支内适用 |  |  |
| `$[].uploads[].detectedInfo.candidates[].warnings` | array：object | 是 |  |  |
| `$[].uploads[].detectedInfo.candidates[].warnings[]` | object | 每个元素 | 不接受额外字段 |  |
| `$[].uploads[].detectedInfo.candidates[].warnings[].code` | string | 是 |  |  |
| `$[].uploads[].detectedInfo.candidates[].warnings[].message` | string | 是 |  |  |
| `$[].uploads[].detectedInfo.candidates[].warnings[].params` | object | 是 | 动态字段值：anyOf（2 个分支） |  |
| `$[].uploads[].detectedInfo.candidates[].warnings[].params{key}` | anyOf（2 个分支） | 动态字段 |  |  |
| `$[].uploads[].detectedInfo.candidates[].warnings[].params{key}.anyOf[1]` | string | 分支内适用 |  |  |
| `$[].uploads[].detectedInfo.candidates[].warnings[].params{key}.anyOf[2]` | number | 分支内适用 |  |  |
| `$[].uploads[].detectedInfo.pack` | object | 否 | 不接受额外字段 |  |
| `$[].uploads[].detectedInfo.pack.format` | string | 是 | 可选值：`["modrinth"]` |  |
| `$[].uploads[].detectedInfo.pack.wrapper` | anyOf（2 个分支） | 是 |  |  |
| `$[].uploads[].detectedInfo.pack.wrapper.anyOf[1]` | string | 分支内适用 | 可选值：`["pcl"]` |  |
| `$[].uploads[].detectedInfo.pack.wrapper.anyOf[2]` | null | 分支内适用 |  |  |
| `$[].uploads[].detectedInfo.pack.name` | string | 是 |  |  |
| `$[].uploads[].detectedInfo.pack.version` | string | 是 |  |  |
| `$[].uploads[].detectedInfo.pack.summary` | string / null | 是 |  |  |
| `$[].uploads[].detectedInfo.importFiles` | array：object | 否 |  |  |
| `$[].uploads[].detectedInfo.importFiles[]` | object | 每个元素 | 不接受额外字段 |  |
| `$[].uploads[].detectedInfo.importFiles[].path` | string | 是 |  |  |
| `$[].uploads[].detectedInfo.importFiles[].source` | string | 是 | 可选值：`["local","remote"]` |  |
| `$[].uploads[].detectedInfo.importFiles[].optional` | boolean | 是 |  |  |
| `$[].uploads[].detectedInfo.importFiles[].size` | integer | 是 | 最小值（含）：`0` |  |
| `$[].uploads[].detectedInfo.importFiles[].downloads` | array：string | 是 |  |  |
| `$[].uploads[].detectedInfo.importFiles[].downloads[]` | string | 每个元素 |  |  |
| `$[].uploads[].detectedInfo.importFiles[].hashes` | object | 否 | 不接受额外字段 |  |
| `$[].uploads[].detectedInfo.importFiles[].hashes.sha1` | string | 否 |  |  |
| `$[].uploads[].detectedInfo.importFiles[].hashes.sha512` | string | 否 |  |  |
| `$[].uploads[].detectedInfo.importFiles[].hashes.sha256` | string | 否 |  |  |
| `$[].uploads[].detectedInfo.importFiles[].status` | string | 是 | 可选值：`["PENDING","DECLARED","DOWNLOADING","VERIFIED","FAILED"]` |  |
| `$[].uploads[].detectedInfo.importFiles[].downloadedBytes` | integer | 是 | 最小值（含）：`0` |  |
| `$[].uploads[].detectedInfo.importFiles[].error` | object / null | 是 | 不接受额外字段 |  |
| `$[].uploads[].detectedInfo.importFiles[].error.code` | string | 是 |  |  |
| `$[].uploads[].detectedInfo.importFiles[].error.message` | string | 是 |  |  |
| `$[].uploads[].detectedInfo.importFiles[].error.params` | object | 是 | 动态字段值：anyOf（2 个分支） |  |
| `$[].uploads[].detectedInfo.importFiles[].error.params{key}` | anyOf（2 个分支） | 动态字段 |  |  |
| `$[].uploads[].detectedInfo.importFiles[].error.params{key}.anyOf[1]` | string | 分支内适用 |  |  |
| `$[].uploads[].detectedInfo.importFiles[].error.params{key}.anyOf[2]` | number | 分支内适用 |  |  |
| `$[].uploads[].selectedInstanceId` | string / null | 是 |  |  |
| `$[].uploads[].baseReleaseId` | string / null (uuid) | 是 |  |  |
| `$[].uploads[].basePublicationRevision` | integer | 是 | 最小值（含）：`0` |  |
| `$[].uploads[].createdAt` | string (date-time) | 是 |  |  |
| `$[].uploads[].canEdit` | boolean | 是 |  |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "array",
  "items": {
    "type": "object",
    "properties": {
      "clientId": {
        "type": "string",
        "format": "uuid"
      },
      "name": {
        "type": "string"
      },
      "organizationId": {
        "type": "string",
        "format": "uuid"
      },
      "organizationName": {
        "type": "string"
      },
      "serverId": {
        "type": [
          "string",
          "null"
        ],
        "pattern": "^[A-Za-z]{3,5}$"
      },
      "serverName": {
        "type": "string"
      },
      "requestedServerId": {
        "type": [
          "string",
          "null"
        ],
        "pattern": "^[A-Za-z]{3,5}$"
      },
      "scopeServerId": {
        "type": [
          "string",
          "null"
        ],
        "pattern": "^[A-Za-z]{3,5}$"
      },
      "archived": {
        "type": "boolean"
      },
      "blocked": {
        "type": "boolean"
      },
      "displaySchedule": {
        "type": [
          "object",
          "null"
        ],
        "properties": {
          "displayMode": {
            "type": "string",
            "enum": [
              "PERMANENT",
              "RANGE"
            ]
          },
          "displayStartsAt": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          },
          "displayEndsAt": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          }
        },
        "required": [
          "displayMode",
          "displayStartsAt",
          "displayEndsAt"
        ],
        "additionalProperties": false
      },
      "lifecycleStatus": {
        "type": "string",
        "enum": [
          "ARCHIVED",
          "PUBLISHED",
          "UNPUBLISHED"
        ]
      },
      "permissions": {
        "type": "array",
        "items": {
          "type": "string",
          "enum": [
            "SERVER_READ",
            "SERVER_EDIT",
            "DRAFT_READ",
            "DRAFT_CREATE",
            "DRAFT_EDIT",
            "DRAFT_SUBMIT",
            "DRAFT_ARCHIVE",
            "RELEASE_READ",
            "ORG_EDIT",
            "ORG_MEMBERS_READ",
            "ORG_MEMBERS_MANAGE",
            "CLIENT_ARCHIVE",
            "CLIENT_DELETE",
            "CLIENT_BIND",
            "DRAFT_REVIEW",
            "RELEASE_PUBLISH",
            "RELEASE_ACTIVATE"
          ]
        }
      },
      "publicationRevision": {
        "type": "integer",
        "minimum": 0
      },
      "currentReleaseId": {
        "type": [
          "string",
          "null"
        ],
        "format": "uuid"
      },
      "initialPackageFormatVersion": {
        "type": [
          "integer",
          "null"
        ]
      },
      "bindingRevision": {
        "type": [
          "integer",
          "null"
        ],
        "minimum": 0
      },
      "drafts": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "id": {
              "type": "string",
              "format": "uuid"
            },
            "versionLabel": {
              "type": [
                "string",
                "null"
              ]
            },
            "name": {
              "type": [
                "string",
                "null"
              ]
            },
            "description": {
              "type": [
                "string",
                "null"
              ]
            },
            "changelog": {
              "type": "string"
            },
            "summary": {
              "type": [
                "string",
                "null"
              ]
            },
            "archivedAt": {
              "type": [
                "string",
                "null"
              ],
              "format": "date-time"
            },
            "packageFormatVersion": {
              "type": "integer"
            },
            "versionSequence": {
              "type": "integer",
              "minimum": 0
            },
            "replacesDraftId": {
              "type": [
                "string",
                "null"
              ],
              "format": "uuid"
            },
            "archiveReason": {
              "type": [
                "string",
                "null"
              ]
            },
            "supersededByDraftId": {
              "type": [
                "string",
                "null"
              ],
              "format": "uuid"
            },
            "candidateMetadata": {},
            "reviewNote": {
              "type": [
                "string",
                "null"
              ]
            },
            "status": {
              "type": "string",
              "enum": [
                "DRAFT",
                "SUBMITTED",
                "APPROVED",
                "REJECTED",
                "RELEASED"
              ]
            },
            "contentRevision": {
              "type": "integer",
              "minimum": 0
            },
            "packageRevision": {
              "type": "integer",
              "minimum": 0
            },
            "createdAt": {
              "type": "string",
              "format": "date-time"
            },
            "upload": {
              "type": [
                "object",
                "null"
              ],
              "properties": {
                "id": {
                  "type": "string",
                  "format": "uuid"
                },
                "statistics": {
                  "anyOf": [
                    {
                      "type": "object",
                      "properties": {
                        "previousVersion": {
                          "type": [
                            "string",
                            "null"
                          ]
                        },
                        "addedFiles": {
                          "type": "integer",
                          "minimum": 0
                        },
                        "modifiedFiles": {
                          "type": "integer",
                          "minimum": 0
                        },
                        "deletedFiles": {
                          "type": "integer",
                          "minimum": 0
                        },
                        "fullSize": {
                          "type": "integer",
                          "minimum": 0
                        },
                        "newDataSize": {
                          "type": "integer",
                          "minimum": 0
                        },
                        "estimatedDownloadSize": {
                          "type": "integer",
                          "minimum": 0
                        },
                        "casReusePercent": {
                          "type": "number"
                        },
                        "fileCount": {
                          "type": "integer",
                          "minimum": 0
                        },
                        "sourceSize": {
                          "type": "integer",
                          "minimum": 0
                        }
                      },
                      "required": [
                        "previousVersion",
                        "addedFiles",
                        "modifiedFiles",
                        "deletedFiles",
                        "fullSize",
                        "newDataSize",
                        "estimatedDownloadSize",
                        "casReusePercent",
                        "fileCount",
                        "sourceSize"
                      ],
                      "additionalProperties": false
                    },
                    {
                      "type": "object",
                      "properties": {
                        "localFiles": {
                          "type": "integer",
                          "minimum": 0
                        },
                        "remoteFiles": {
                          "type": "integer",
                          "minimum": 0
                        },
                        "optionalFiles": {
                          "type": "integer",
                          "minimum": 0
                        },
                        "localSize": {
                          "type": "integer",
                          "minimum": 0
                        },
                        "remoteDeclaredSize": {
                          "type": "integer",
                          "minimum": 0
                        },
                        "newLocalDataSize": {
                          "type": "integer",
                          "minimum": 0
                        },
                        "localCasReusePercent": {
                          "type": "number"
                        },
                        "sourceSize": {
                          "type": "integer",
                          "minimum": 0
                        }
                      },
                      "required": [
                        "localFiles",
                        "remoteFiles",
                        "optionalFiles",
                        "localSize",
                        "remoteDeclaredSize",
                        "newLocalDataSize",
                        "localCasReusePercent",
                        "sourceSize"
                      ],
                      "additionalProperties": false
                    },
                    {
                      "type": "null"
                    }
                  ]
                },
                "comparisonStatistics": {
                  "type": [
                    "object",
                    "null"
                  ],
                  "properties": {
                    "previousVersion": {
                      "type": [
                        "string",
                        "null"
                      ]
                    },
                    "addedFiles": {
                      "type": "integer",
                      "minimum": 0
                    },
                    "modifiedFiles": {
                      "type": "integer",
                      "minimum": 0
                    },
                    "deletedFiles": {
                      "type": "integer",
                      "minimum": 0
                    },
                    "fullSize": {
                      "type": "integer",
                      "minimum": 0
                    },
                    "newDataSize": {
                      "type": "integer",
                      "minimum": 0
                    },
                    "estimatedDownloadSize": {
                      "type": "integer",
                      "minimum": 0
                    },
                    "casReusePercent": {
                      "type": "number"
                    },
                    "fileCount": {
                      "type": "integer",
                      "minimum": 0
                    },
                    "sourceSize": {
                      "type": "integer",
                      "minimum": 0
                    }
                  },
                  "required": [
                    "previousVersion",
                    "addedFiles",
                    "modifiedFiles",
                    "deletedFiles",
                    "fullSize",
                    "newDataSize",
                    "estimatedDownloadSize",
                    "casReusePercent",
                    "fileCount",
                    "sourceSize"
                  ],
                  "additionalProperties": false
                }
              },
              "required": [
                "id",
                "statistics",
                "comparisonStatistics"
              ],
              "additionalProperties": false
            },
            "packageBuilds": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "platform": {
                    "type": "string"
                  },
                  "status": {
                    "type": "string",
                    "enum": [
                      "QUEUED",
                      "PROCESSING",
                      "PREPARED",
                      "READY",
                      "FAILED"
                    ]
                  },
                  "phase": {
                    "type": "object",
                    "properties": {
                      "code": {
                        "type": "string"
                      },
                      "message": {
                        "type": "string"
                      },
                      "params": {
                        "type": "object",
                        "additionalProperties": {
                          "anyOf": [
                            {
                              "type": "string"
                            },
                            {
                              "type": "number"
                            }
                          ]
                        }
                      }
                    },
                    "required": [
                      "code",
                      "message",
                      "params"
                    ],
                    "additionalProperties": false
                  },
                  "progress": {
                    "type": "integer",
                    "minimum": 0
                  },
                  "error": {
                    "type": [
                      "object",
                      "null"
                    ],
                    "properties": {
                      "code": {
                        "type": "string"
                      },
                      "message": {
                        "type": "string"
                      },
                      "params": {
                        "type": "object",
                        "additionalProperties": {
                          "anyOf": [
                            {
                              "type": "string"
                            },
                            {
                              "type": "number"
                            }
                          ]
                        }
                      }
                    },
                    "required": [
                      "code",
                      "message",
                      "params"
                    ],
                    "additionalProperties": false
                  },
                  "artifacts": {
                    "type": [
                      "object",
                      "null"
                    ],
                    "properties": {
                      "full": {
                        "type": "object",
                        "properties": {
                          "key": {
                            "type": "string"
                          },
                          "sha256": {
                            "type": "string",
                            "pattern": "^[a-f0-9]{64}$"
                          },
                          "size": {
                            "type": "integer",
                            "minimum": 0
                          }
                        },
                        "required": [
                          "key",
                          "sha256",
                          "size"
                        ]
                      },
                      "update": {
                        "type": [
                          "object",
                          "null"
                        ],
                        "properties": {
                          "key": {
                            "type": "string"
                          },
                          "sha256": {
                            "type": "string",
                            "pattern": "^[a-f0-9]{64}$"
                          },
                          "size": {
                            "type": "integer",
                            "minimum": 0
                          },
                          "baseReleaseId": {
                            "type": "string",
                            "format": "uuid"
                          },
                          "baseManifestSha256": {
                            "type": "string",
                            "pattern": "^[a-f0-9]{64}$"
                          }
                        },
                        "required": [
                          "key",
                          "sha256",
                          "size",
                          "baseReleaseId",
                          "baseManifestSha256"
                        ]
                      },
                      "signingKeyId": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{24}$"
                      }
                    },
                    "required": [
                      "full",
                      "update",
                      "signingKeyId"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "platform",
                  "status",
                  "phase",
                  "progress",
                  "error",
                  "artifacts"
                ],
                "additionalProperties": false
              }
            }
          },
          "required": [
            "id",
            "versionLabel",
            "name",
            "description",
            "changelog",
            "summary",
            "archivedAt",
            "packageFormatVersion",
            "versionSequence",
            "replacesDraftId",
            "archiveReason",
            "supersededByDraftId",
            "reviewNote",
            "status",
            "contentRevision",
            "packageRevision",
            "createdAt",
            "upload",
            "packageBuilds"
          ],
          "additionalProperties": false
        }
      },
      "releases": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "id": {
              "type": "string",
              "format": "uuid"
            },
            "versionLabel": {
              "type": "string"
            },
            "name": {
              "type": "string"
            },
            "description": {
              "type": "string"
            },
            "changelog": {
              "type": "string"
            },
            "summary": {
              "type": "string"
            },
            "archivedAt": {
              "type": [
                "string",
                "null"
              ],
              "format": "date-time"
            },
            "packageFormatVersion": {
              "type": "integer"
            },
            "environmentSnapshot": {},
            "publishedAt": {
              "type": "string",
              "format": "date-time"
            },
            "sourceDraft": {
              "type": [
                "object",
                "null"
              ],
              "properties": {
                "packageRevision": {
                  "type": "integer",
                  "minimum": 0
                },
                "upload": {
                  "type": [
                    "object",
                    "null"
                  ],
                  "properties": {
                    "statistics": {
                      "anyOf": [
                        {
                          "type": "object",
                          "properties": {
                            "previousVersion": {
                              "type": [
                                "string",
                                "null"
                              ]
                            },
                            "addedFiles": {
                              "type": "integer",
                              "minimum": 0
                            },
                            "modifiedFiles": {
                              "type": "integer",
                              "minimum": 0
                            },
                            "deletedFiles": {
                              "type": "integer",
                              "minimum": 0
                            },
                            "fullSize": {
                              "type": "integer",
                              "minimum": 0
                            },
                            "newDataSize": {
                              "type": "integer",
                              "minimum": 0
                            },
                            "estimatedDownloadSize": {
                              "type": "integer",
                              "minimum": 0
                            },
                            "casReusePercent": {
                              "type": "number"
                            },
                            "fileCount": {
                              "type": "integer",
                              "minimum": 0
                            },
                            "sourceSize": {
                              "type": "integer",
                              "minimum": 0
                            }
                          },
                          "required": [
                            "previousVersion",
                            "addedFiles",
                            "modifiedFiles",
                            "deletedFiles",
                            "fullSize",
                            "newDataSize",
                            "estimatedDownloadSize",
                            "casReusePercent",
                            "fileCount",
                            "sourceSize"
                          ],
                          "additionalProperties": false
                        },
                        {
                          "type": "object",
                          "properties": {
                            "localFiles": {
                              "type": "integer",
                              "minimum": 0
                            },
                            "remoteFiles": {
                              "type": "integer",
                              "minimum": 0
                            },
                            "optionalFiles": {
                              "type": "integer",
                              "minimum": 0
                            },
                            "localSize": {
                              "type": "integer",
                              "minimum": 0
                            },
                            "remoteDeclaredSize": {
                              "type": "integer",
                              "minimum": 0
                            },
                            "newLocalDataSize": {
                              "type": "integer",
                              "minimum": 0
                            },
                            "localCasReusePercent": {
                              "type": "number"
                            },
                            "sourceSize": {
                              "type": "integer",
                              "minimum": 0
                            }
                          },
                          "required": [
                            "localFiles",
                            "remoteFiles",
                            "optionalFiles",
                            "localSize",
                            "remoteDeclaredSize",
                            "newLocalDataSize",
                            "localCasReusePercent",
                            "sourceSize"
                          ],
                          "additionalProperties": false
                        },
                        {
                          "type": "null"
                        }
                      ]
                    },
                    "comparisonStatistics": {
                      "type": [
                        "object",
                        "null"
                      ],
                      "properties": {
                        "previousVersion": {
                          "type": [
                            "string",
                            "null"
                          ]
                        },
                        "addedFiles": {
                          "type": "integer",
                          "minimum": 0
                        },
                        "modifiedFiles": {
                          "type": "integer",
                          "minimum": 0
                        },
                        "deletedFiles": {
                          "type": "integer",
                          "minimum": 0
                        },
                        "fullSize": {
                          "type": "integer",
                          "minimum": 0
                        },
                        "newDataSize": {
                          "type": "integer",
                          "minimum": 0
                        },
                        "estimatedDownloadSize": {
                          "type": "integer",
                          "minimum": 0
                        },
                        "casReusePercent": {
                          "type": "number"
                        },
                        "fileCount": {
                          "type": "integer",
                          "minimum": 0
                        },
                        "sourceSize": {
                          "type": "integer",
                          "minimum": 0
                        }
                      },
                      "required": [
                        "previousVersion",
                        "addedFiles",
                        "modifiedFiles",
                        "deletedFiles",
                        "fullSize",
                        "newDataSize",
                        "estimatedDownloadSize",
                        "casReusePercent",
                        "fileCount",
                        "sourceSize"
                      ],
                      "additionalProperties": false
                    }
                  },
                  "required": [
                    "statistics",
                    "comparisonStatistics"
                  ],
                  "additionalProperties": false
                },
                "packageBuilds": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "draftId": {
                        "type": "string",
                        "format": "uuid"
                      },
                      "platform": {
                        "type": "string"
                      },
                      "revision": {
                        "type": "integer",
                        "minimum": 0
                      },
                      "status": {
                        "type": "string"
                      },
                      "required": {
                        "type": "boolean"
                      },
                      "artifacts": {}
                    },
                    "required": [
                      "draftId",
                      "platform",
                      "revision",
                      "status",
                      "required"
                    ],
                    "additionalProperties": false
                  }
                }
              },
              "required": [
                "packageRevision",
                "upload",
                "packageBuilds"
              ],
              "additionalProperties": false
            },
            "packageBuilds": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "draftId": {
                    "type": "string",
                    "format": "uuid"
                  },
                  "platform": {
                    "type": "string"
                  },
                  "revision": {
                    "type": "integer",
                    "minimum": 0
                  },
                  "status": {
                    "type": "string"
                  },
                  "required": {
                    "type": "boolean"
                  },
                  "artifacts": {
                    "type": [
                      "object",
                      "null"
                    ],
                    "properties": {
                      "full": {
                        "type": "object",
                        "properties": {
                          "key": {
                            "type": "string"
                          },
                          "sha256": {
                            "type": "string",
                            "pattern": "^[a-f0-9]{64}$"
                          },
                          "size": {
                            "type": "integer",
                            "minimum": 0
                          }
                        },
                        "required": [
                          "key",
                          "sha256",
                          "size"
                        ]
                      },
                      "update": {
                        "type": [
                          "object",
                          "null"
                        ],
                        "properties": {
                          "key": {
                            "type": "string"
                          },
                          "sha256": {
                            "type": "string",
                            "pattern": "^[a-f0-9]{64}$"
                          },
                          "size": {
                            "type": "integer",
                            "minimum": 0
                          },
                          "baseReleaseId": {
                            "type": "string",
                            "format": "uuid"
                          },
                          "baseManifestSha256": {
                            "type": "string",
                            "pattern": "^[a-f0-9]{64}$"
                          }
                        },
                        "required": [
                          "key",
                          "sha256",
                          "size",
                          "baseReleaseId",
                          "baseManifestSha256"
                        ]
                      },
                      "signingKeyId": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{24}$"
                      }
                    },
                    "required": [
                      "full",
                      "update",
                      "signingKeyId"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "draftId",
                  "platform",
                  "revision",
                  "status",
                  "required",
                  "artifacts"
                ],
                "additionalProperties": false
              }
            }
          },
          "required": [
            "id",
            "versionLabel",
            "name",
            "description",
            "changelog",
            "summary",
            "archivedAt",
            "packageFormatVersion",
            "publishedAt",
            "sourceDraft",
            "packageBuilds"
          ],
          "additionalProperties": false
        }
      },
      "canDelete": {
        "type": "boolean"
      },
      "uploads": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "id": {
              "type": "string",
              "format": "uuid"
            },
            "clientId": {
              "type": "string",
              "format": "uuid"
            },
            "fileName": {
              "type": "string"
            },
            "size": {
              "type": "integer",
              "minimum": 0
            },
            "partSize": {
              "type": "integer",
              "minimum": 0
            },
            "packageFormatVersion": {
              "anyOf": [
                {
                  "type": "number",
                  "enum": [
                    1
                  ]
                },
                {
                  "type": "number",
                  "enum": [
                    2
                  ]
                }
              ]
            },
            "status": {
              "type": "string",
              "enum": [
                "UPLOADING",
                "QUEUED",
                "PROCESSING",
                "READY",
                "FAILED",
                "SUBMITTED",
                "CANCELLED"
              ]
            },
            "progress": {
              "type": "integer",
              "minimum": 0
            },
            "error": {
              "type": [
                "object",
                "null"
              ],
              "properties": {
                "code": {
                  "type": "string"
                },
                "message": {
                  "type": "string"
                },
                "params": {
                  "type": "object",
                  "additionalProperties": {
                    "anyOf": [
                      {
                        "type": "string"
                      },
                      {
                        "type": "number"
                      }
                    ]
                  }
                }
              },
              "required": [
                "code",
                "message",
                "params"
              ],
              "additionalProperties": false
            },
            "draftId": {
              "type": [
                "string",
                "null"
              ],
              "format": "uuid"
            },
            "statistics": {
              "type": [
                "object",
                "null"
              ],
              "properties": {
                "previousVersion": {
                  "type": [
                    "string",
                    "null"
                  ]
                },
                "addedFiles": {
                  "type": "integer",
                  "minimum": 0
                },
                "modifiedFiles": {
                  "type": "integer",
                  "minimum": 0
                },
                "deletedFiles": {
                  "type": "integer",
                  "minimum": 0
                },
                "fullSize": {
                  "type": "integer",
                  "minimum": 0
                },
                "newDataSize": {
                  "type": "integer",
                  "minimum": 0
                },
                "estimatedDownloadSize": {
                  "type": "integer",
                  "minimum": 0
                },
                "casReusePercent": {
                  "type": "number"
                },
                "fileCount": {
                  "type": "integer",
                  "minimum": 0
                },
                "sourceSize": {
                  "type": "integer",
                  "minimum": 0
                }
              },
              "required": [
                "previousVersion",
                "addedFiles",
                "modifiedFiles",
                "deletedFiles",
                "fullSize",
                "newDataSize",
                "estimatedDownloadSize",
                "casReusePercent",
                "fileCount",
                "sourceSize"
              ],
              "additionalProperties": false
            },
            "recipeStatistics": {
              "type": [
                "object",
                "null"
              ],
              "properties": {
                "localFiles": {
                  "type": "integer",
                  "minimum": 0
                },
                "remoteFiles": {
                  "type": "integer",
                  "minimum": 0
                },
                "optionalFiles": {
                  "type": "integer",
                  "minimum": 0
                },
                "localSize": {
                  "type": "integer",
                  "minimum": 0
                },
                "remoteDeclaredSize": {
                  "type": "integer",
                  "minimum": 0
                },
                "newLocalDataSize": {
                  "type": "integer",
                  "minimum": 0
                },
                "localCasReusePercent": {
                  "type": "number"
                },
                "sourceSize": {
                  "type": "integer",
                  "minimum": 0
                }
              },
              "required": [
                "localFiles",
                "remoteFiles",
                "optionalFiles",
                "localSize",
                "remoteDeclaredSize",
                "newLocalDataSize",
                "localCasReusePercent",
                "sourceSize"
              ],
              "additionalProperties": false
            },
            "detectedMods": {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            "warnings": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "code": {
                    "type": "string"
                  },
                  "message": {
                    "type": "string"
                  },
                  "params": {
                    "type": "object",
                    "additionalProperties": {
                      "anyOf": [
                        {
                          "type": "string"
                        },
                        {
                          "type": "number"
                        }
                      ]
                    }
                  }
                },
                "required": [
                  "code",
                  "message",
                  "params"
                ],
                "additionalProperties": false
              }
            },
            "comparisonDraftId": {
              "type": [
                "string",
                "null"
              ],
              "format": "uuid"
            },
            "comparisonStatistics": {
              "type": [
                "object",
                "null"
              ],
              "properties": {
                "previousVersion": {
                  "type": [
                    "string",
                    "null"
                  ]
                },
                "addedFiles": {
                  "type": "integer",
                  "minimum": 0
                },
                "modifiedFiles": {
                  "type": "integer",
                  "minimum": 0
                },
                "deletedFiles": {
                  "type": "integer",
                  "minimum": 0
                },
                "fullSize": {
                  "type": "integer",
                  "minimum": 0
                },
                "newDataSize": {
                  "type": "integer",
                  "minimum": 0
                },
                "estimatedDownloadSize": {
                  "type": "integer",
                  "minimum": 0
                },
                "casReusePercent": {
                  "type": "number"
                },
                "fileCount": {
                  "type": "integer",
                  "minimum": 0
                },
                "sourceSize": {
                  "type": "integer",
                  "minimum": 0
                }
              },
              "required": [
                "previousVersion",
                "addedFiles",
                "modifiedFiles",
                "deletedFiles",
                "fullSize",
                "newDataSize",
                "estimatedDownloadSize",
                "casReusePercent",
                "fileCount",
                "sourceSize"
              ],
              "additionalProperties": false
            },
            "processingPhase": {
              "anyOf": [
                {
                  "type": "string",
                  "enum": [
                    "FETCHING",
                    "INSPECTING",
                    "SELECT_INSTANCE",
                    "DOWNLOADING",
                    "CAS"
                  ]
                },
                {
                  "type": "null"
                }
              ]
            },
            "detectedInfo": {
              "type": [
                "object",
                "null"
              ],
              "properties": {
                "instanceId": {
                  "type": [
                    "string",
                    "null"
                  ]
                },
                "minecraftVersion": {
                  "type": [
                    "string",
                    "null"
                  ]
                },
                "javaVersion": {
                  "type": [
                    "integer",
                    "null"
                  ]
                },
                "javaComponent": {
                  "type": [
                    "string",
                    "null"
                  ]
                },
                "loader": {
                  "type": [
                    "string",
                    "null"
                  ]
                },
                "loaderVersion": {
                  "type": [
                    "string",
                    "null"
                  ]
                },
                "minecraftSource": {
                  "type": [
                    "object",
                    "null"
                  ],
                  "properties": {
                    "code": {
                      "type": "string"
                    },
                    "message": {
                      "type": "string"
                    },
                    "params": {
                      "type": "object",
                      "additionalProperties": {
                        "anyOf": [
                          {
                            "type": "string"
                          },
                          {
                            "type": "number"
                          }
                        ]
                      }
                    }
                  },
                  "required": [
                    "code",
                    "message",
                    "params"
                  ],
                  "additionalProperties": false
                },
                "javaSource": {
                  "type": [
                    "object",
                    "null"
                  ],
                  "properties": {
                    "code": {
                      "type": "string"
                    },
                    "message": {
                      "type": "string"
                    },
                    "params": {
                      "type": "object",
                      "additionalProperties": {
                        "anyOf": [
                          {
                            "type": "string"
                          },
                          {
                            "type": "number"
                          }
                        ]
                      }
                    }
                  },
                  "required": [
                    "code",
                    "message",
                    "params"
                  ],
                  "additionalProperties": false
                },
                "warnings": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "code": {
                        "type": "string"
                      },
                      "message": {
                        "type": "string"
                      },
                      "params": {
                        "type": "object",
                        "additionalProperties": {
                          "anyOf": [
                            {
                              "type": "string"
                            },
                            {
                              "type": "number"
                            }
                          ]
                        }
                      }
                    },
                    "required": [
                      "code",
                      "message",
                      "params"
                    ],
                    "additionalProperties": false
                  }
                },
                "schemaVersion": {
                  "type": "number",
                  "enum": [
                    1
                  ]
                },
                "requiresSelection": {
                  "type": "boolean"
                },
                "candidates": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "instanceId": {
                        "type": [
                          "string",
                          "null"
                        ]
                      },
                      "minecraftVersion": {
                        "type": [
                          "string",
                          "null"
                        ]
                      },
                      "javaVersion": {
                        "type": [
                          "integer",
                          "null"
                        ]
                      },
                      "javaComponent": {
                        "type": [
                          "string",
                          "null"
                        ]
                      },
                      "loader": {
                        "type": [
                          "string",
                          "null"
                        ]
                      },
                      "loaderVersion": {
                        "type": [
                          "string",
                          "null"
                        ]
                      },
                      "minecraftSource": {
                        "type": [
                          "object",
                          "null"
                        ],
                        "properties": {
                          "code": {
                            "type": "string"
                          },
                          "message": {
                            "type": "string"
                          },
                          "params": {
                            "type": "object",
                            "additionalProperties": {
                              "anyOf": [
                                {
                                  "type": "string"
                                },
                                {
                                  "type": "number"
                                }
                              ]
                            }
                          }
                        },
                        "required": [
                          "code",
                          "message",
                          "params"
                        ],
                        "additionalProperties": false
                      },
                      "javaSource": {
                        "type": [
                          "object",
                          "null"
                        ],
                        "properties": {
                          "code": {
                            "type": "string"
                          },
                          "message": {
                            "type": "string"
                          },
                          "params": {
                            "type": "object",
                            "additionalProperties": {
                              "anyOf": [
                                {
                                  "type": "string"
                                },
                                {
                                  "type": "number"
                                }
                              ]
                            }
                          }
                        },
                        "required": [
                          "code",
                          "message",
                          "params"
                        ],
                        "additionalProperties": false
                      },
                      "warnings": {
                        "type": "array",
                        "items": {
                          "type": "object",
                          "properties": {
                            "code": {
                              "type": "string"
                            },
                            "message": {
                              "type": "string"
                            },
                            "params": {
                              "type": "object",
                              "additionalProperties": {
                                "anyOf": [
                                  {
                                    "type": "string"
                                  },
                                  {
                                    "type": "number"
                                  }
                                ]
                              }
                            }
                          },
                          "required": [
                            "code",
                            "message",
                            "params"
                          ],
                          "additionalProperties": false
                        }
                      }
                    },
                    "required": [
                      "instanceId",
                      "minecraftVersion",
                      "javaVersion",
                      "javaComponent",
                      "loader",
                      "loaderVersion",
                      "minecraftSource",
                      "javaSource",
                      "warnings"
                    ],
                    "additionalProperties": false
                  }
                },
                "pack": {
                  "type": "object",
                  "properties": {
                    "format": {
                      "type": "string",
                      "enum": [
                        "modrinth"
                      ]
                    },
                    "wrapper": {
                      "anyOf": [
                        {
                          "type": "string",
                          "enum": [
                            "pcl"
                          ]
                        },
                        {
                          "type": "null"
                        }
                      ]
                    },
                    "name": {
                      "type": "string"
                    },
                    "version": {
                      "type": "string"
                    },
                    "summary": {
                      "type": [
                        "string",
                        "null"
                      ]
                    }
                  },
                  "required": [
                    "format",
                    "wrapper",
                    "name",
                    "version",
                    "summary"
                  ],
                  "additionalProperties": false
                },
                "importFiles": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "path": {
                        "type": "string"
                      },
                      "source": {
                        "type": "string",
                        "enum": [
                          "local",
                          "remote"
                        ]
                      },
                      "optional": {
                        "type": "boolean"
                      },
                      "size": {
                        "type": "integer",
                        "minimum": 0
                      },
                      "downloads": {
                        "type": "array",
                        "items": {
                          "type": "string"
                        }
                      },
                      "hashes": {
                        "type": "object",
                        "properties": {
                          "sha1": {
                            "type": "string"
                          },
                          "sha512": {
                            "type": "string"
                          },
                          "sha256": {
                            "type": "string"
                          }
                        },
                        "additionalProperties": false
                      },
                      "status": {
                        "type": "string",
                        "enum": [
                          "PENDING",
                          "DECLARED",
                          "DOWNLOADING",
                          "VERIFIED",
                          "FAILED"
                        ]
                      },
                      "downloadedBytes": {
                        "type": "integer",
                        "minimum": 0
                      },
                      "error": {
                        "type": [
                          "object",
                          "null"
                        ],
                        "properties": {
                          "code": {
                            "type": "string"
                          },
                          "message": {
                            "type": "string"
                          },
                          "params": {
                            "type": "object",
                            "additionalProperties": {
                              "anyOf": [
                                {
                                  "type": "string"
                                },
                                {
                                  "type": "number"
                                }
                              ]
                            }
                          }
                        },
                        "required": [
                          "code",
                          "message",
                          "params"
                        ],
                        "additionalProperties": false
                      }
                    },
                    "required": [
                      "path",
                      "source",
                      "optional",
                      "size",
                      "downloads",
                      "status",
                      "downloadedBytes",
                      "error"
                    ],
                    "additionalProperties": false
                  }
                }
              },
              "required": [
                "instanceId",
                "minecraftVersion",
                "javaVersion",
                "javaComponent",
                "loader",
                "loaderVersion",
                "minecraftSource",
                "javaSource",
                "warnings",
                "schemaVersion",
                "requiresSelection",
                "candidates"
              ],
              "additionalProperties": false
            },
            "selectedInstanceId": {
              "type": [
                "string",
                "null"
              ]
            },
            "baseReleaseId": {
              "type": [
                "string",
                "null"
              ],
              "format": "uuid"
            },
            "basePublicationRevision": {
              "type": "integer",
              "minimum": 0
            },
            "createdAt": {
              "type": "string",
              "format": "date-time"
            },
            "canEdit": {
              "type": "boolean"
            }
          },
          "required": [
            "id",
            "clientId",
            "fileName",
            "size",
            "partSize",
            "packageFormatVersion",
            "status",
            "progress",
            "error",
            "draftId",
            "statistics",
            "recipeStatistics",
            "detectedMods",
            "warnings",
            "comparisonDraftId",
            "comparisonStatistics",
            "processingPhase",
            "detectedInfo",
            "selectedInstanceId",
            "baseReleaseId",
            "basePublicationRevision",
            "createdAt",
            "canEdit"
          ],
          "additionalProperties": false
        }
      }
    },
    "required": [
      "clientId",
      "name",
      "organizationId",
      "organizationName",
      "serverId",
      "serverName",
      "requestedServerId",
      "scopeServerId",
      "archived",
      "blocked",
      "displaySchedule",
      "lifecycleStatus",
      "permissions",
      "publicationRevision",
      "currentReleaseId",
      "initialPackageFormatVersion",
      "bindingRevision",
      "drafts",
      "releases",
      "canDelete",
      "uploads"
    ],
    "additionalProperties": false
  }
}
```

</details>

<a id="schema-inline-19"></a>

### createClient 请求体

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `organizationId` | string (uuid) | 是 |  |  |
| `name` | string | 是 | 最短长度：`1`<br>最长长度：`200` |  |
| `serverId` | string / null | 否 | 正则：`"^[A-Za-z]{3,5}$"` |  |
| `publicationRevision` | integer | 否 | 最小值（含）：`0` |  |
| `expectedClientId` | string / null (uuid) | 否 |  |  |
| `replaceConfirmed` | boolean | 否 |  |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "organizationId": {
      "type": "string",
      "format": "uuid"
    },
    "name": {
      "type": "string",
      "minLength": 1,
      "maxLength": 200
    },
    "serverId": {
      "type": [
        "string",
        "null"
      ],
      "pattern": "^[A-Za-z]{3,5}$"
    },
    "publicationRevision": {
      "type": "integer",
      "minimum": 0
    },
    "expectedClientId": {
      "type": [
        "string",
        "null"
      ],
      "format": "uuid"
    },
    "replaceConfirmed": {
      "type": "boolean"
    }
  },
  "required": [
    "organizationId",
    "name"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-20"></a>

### createClient 201 响应

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `clientId` | string (uuid) | 是 |  |  |
| `name` | string | 是 |  |  |
| `currentReleaseId` | null | 是 |  |  |
| `publicationRevision` | number | 是 | 可选值：`[0]` |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "clientId": {
      "type": "string",
      "format": "uuid"
    },
    "name": {
      "type": "string"
    },
    "currentReleaseId": {
      "type": "null"
    },
    "publicationRevision": {
      "type": "number",
      "enum": [
        0
      ]
    }
  },
  "required": [
    "clientId",
    "name",
    "currentReleaseId",
    "publicationRevision"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-21"></a>

### bindClient 请求体

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `serverId` | string | 是 | 正则：`"^[A-Za-z]{3,5}$"` |  |
| `publicationRevision` | integer | 是 | 最小值（含）：`0` |  |
| `expectedClientId` | string / null (uuid) | 是 |  |  |
| `replaceConfirmed` | boolean | 是 |  |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "serverId": {
      "type": "string",
      "pattern": "^[A-Za-z]{3,5}$"
    },
    "publicationRevision": {
      "type": "integer",
      "minimum": 0
    },
    "expectedClientId": {
      "type": [
        "string",
        "null"
      ],
      "format": "uuid"
    },
    "replaceConfirmed": {
      "type": "boolean"
    }
  },
  "required": [
    "serverId",
    "publicationRevision",
    "expectedClientId",
    "replaceConfirmed"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-22"></a>

### bindClient 200 响应

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `ok` | boolean | 是 | 可选值：`[true]` |  |
| `pending` | boolean | 是 |  |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "ok": {
      "type": "boolean",
      "enum": [
        true
      ]
    },
    "pending": {
      "type": "boolean"
    }
  },
  "required": [
    "ok",
    "pending"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-23"></a>

### unbindClient 请求体

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `serverId` | string / null | 是 |  |  |
| `publicationRevision` | integer / null | 是 | 最小值（含）：`0` |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "serverId": {
      "type": [
        "string",
        "null"
      ]
    },
    "publicationRevision": {
      "type": [
        "integer",
        "null"
      ],
      "minimum": 0
    }
  },
  "required": [
    "serverId",
    "publicationRevision"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-24"></a>

### unbindClient 200 响应

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `ok` | boolean | 是 | 可选值：`[true]` |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "ok": {
      "type": "boolean",
      "enum": [
        true
      ]
    }
  },
  "required": [
    "ok"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-25"></a>

### archiveClient 请求体

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `archived` | boolean | 是 |  |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "archived": {
      "type": "boolean"
    }
  },
  "required": [
    "archived"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-26"></a>

### deleteClient 请求体

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | 未限定类型 | — |  |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{}
```

</details>

<a id="schema-inline-27"></a>

### createClientUpload 请求体

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `clientId` | string (uuid) | 是 |  |  |
| `fileName` | string | 是 | 最短长度：`1`<br>最长长度：`255`<br>正则：`"\\.(zip&#124;mrpack)$"` |  |
| `size` | integer | 是 | 最大值（含）：`21474836480`<br>最小值（不含）：`0` |  |
| `baseReleaseId` | string / null (uuid) | 是 |  |  |
| `basePublicationRevision` | integer | 是 | 最小值（含）：`0` |  |
| `comparisonDraftId` | string / null (uuid) | 否 |  |  |
| `packageFormatVersion` | anyOf（2 个分支） | 是 |  |  |
| `packageFormatVersion.anyOf[1]` | number | 分支内适用 | 可选值：`[1]` |  |
| `packageFormatVersion.anyOf[2]` | number | 分支内适用 | 可选值：`[2]` |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "clientId": {
      "type": "string",
      "format": "uuid"
    },
    "fileName": {
      "type": "string",
      "minLength": 1,
      "maxLength": 255,
      "pattern": "\\.(zip|mrpack)$"
    },
    "size": {
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 21474836480
    },
    "baseReleaseId": {
      "type": [
        "string",
        "null"
      ],
      "format": "uuid"
    },
    "basePublicationRevision": {
      "type": "integer",
      "minimum": 0
    },
    "comparisonDraftId": {
      "type": [
        "string",
        "null"
      ],
      "format": "uuid"
    },
    "packageFormatVersion": {
      "anyOf": [
        {
          "type": "number",
          "enum": [
            1
          ]
        },
        {
          "type": "number",
          "enum": [
            2
          ]
        }
      ]
    }
  },
  "required": [
    "clientId",
    "fileName",
    "size",
    "baseReleaseId",
    "basePublicationRevision",
    "packageFormatVersion"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-28"></a>

### signUploadPart 请求体

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `partNumber` | integer | 是 | 最小值（含）：`1`<br>最大值（含）：`320` |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "partNumber": {
      "type": "integer",
      "minimum": 1,
      "maximum": 320
    }
  },
  "required": [
    "partNumber"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-29"></a>

### signUploadPart 200 响应

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `url` | string (uri) | 是 |  |  |
| `expiresIn` | number | 是 | 可选值：`[600]` |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "url": {
      "type": "string",
      "format": "uri"
    },
    "expiresIn": {
      "type": "number",
      "enum": [
        600
      ]
    }
  },
  "required": [
    "url",
    "expiresIn"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-30"></a>

### completeClientUpload 请求体

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `parts` | array：object | 是 | 最少元素：`1`<br>最多元素：`320` |  |
| `parts[]` | object | 每个元素 | 不接受额外字段 |  |
| `parts[].partNumber` | integer | 是 | 最小值（不含）：`0` |  |
| `parts[].etag` | string | 是 | 最短长度：`1`<br>最长长度：`200` |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "parts": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "partNumber": {
            "type": "integer",
            "exclusiveMinimum": 0
          },
          "etag": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200
          }
        },
        "required": [
          "partNumber",
          "etag"
        ],
        "additionalProperties": false
      },
      "minItems": 1,
      "maxItems": 320
    }
  },
  "required": [
    "parts"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-31"></a>

### selectClientInstance 请求体

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `instanceId` | string | 是 | 最短长度：`1`<br>最长长度：`100` |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "instanceId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 100
    }
  },
  "required": [
    "instanceId"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-32"></a>

### submitClientUpload 请求体

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `versionLabel` | string | 是 | 最短长度：`1`<br>最长长度：`100` |  |
| `name` | string | 是 | 最短长度：`1`<br>最长长度：`200` |  |
| `minecraftVersion` | string | 否 | 最短长度：`1`<br>最长长度：`100` |  |
| `javaVersion` | integer | 否 | 最小值（含）：`7`<br>最大值（含）：`25` |  |
| `summary` | string | 是 | 最短长度：`1`<br>最长长度：`200` |  |
| `description` | string | 是 | 最长长度：`20000` |  |
| `platforms` | array：string | 否 | 最少元素：`1`<br>最多元素：`6` |  |
| `platforms[]` | string | 每个元素 | 可选值：`["windows-amd64","windows-aarch64","linux-amd64","linux-aarch64","macos-amd64","macos-aarch64"]` |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "versionLabel": {
      "type": "string",
      "minLength": 1,
      "maxLength": 100
    },
    "name": {
      "type": "string",
      "minLength": 1,
      "maxLength": 200
    },
    "minecraftVersion": {
      "type": "string",
      "minLength": 1,
      "maxLength": 100
    },
    "javaVersion": {
      "type": "integer",
      "minimum": 7,
      "maximum": 25
    },
    "summary": {
      "type": "string",
      "minLength": 1,
      "maxLength": 200
    },
    "description": {
      "type": "string",
      "maxLength": 20000
    },
    "platforms": {
      "type": "array",
      "items": {
        "type": "string",
        "enum": [
          "windows-amd64",
          "windows-aarch64",
          "linux-amd64",
          "linux-aarch64",
          "macos-amd64",
          "macos-aarch64"
        ]
      },
      "minItems": 1,
      "maxItems": 6
    }
  },
  "required": [
    "versionLabel",
    "name",
    "summary",
    "description"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-33"></a>

### submitClientUpload 200 响应

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `draftId` | string (uuid) | 是 |  |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "draftId": {
      "type": "string",
      "format": "uuid"
    }
  },
  "required": [
    "draftId"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-34"></a>

### getDraftManifest 200 响应

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | anyOf（2 个分支） | — |  |  |
| `$.anyOf[1]` | object | 分支内适用 | 不接受额外字段 |  |
| `$.anyOf[1].format` | string | 是 | 可选值：`["mua-client-manifest"]` |  |
| `$.anyOf[1].organizationId` | string (uuid) | 是 |  |  |
| `$.anyOf[1].version` | string | 是 |  |  |
| `$.anyOf[1].name` | string | 是 |  |  |
| `$.anyOf[1].runtime` | object | 是 | 不接受额外字段 |  |
| `$.anyOf[1].runtime.minecraft` | string | 是 |  |  |
| `$.anyOf[1].runtime.java` | integer | 是 |  |  |
| `$.anyOf[1].mods` | array：string | 是 |  |  |
| `$.anyOf[1].mods[]` | string | 每个元素 |  |  |
| `$.anyOf[1].modDetails` | array：object | 否 |  |  |
| `$.anyOf[1].modDetails[]` | object | 每个元素 | 不接受额外字段 |  |
| `$.anyOf[1].modDetails[].path` | string | 是 |  |  |
| `$.anyOf[1].modDetails[].optional` | boolean | 是 |  |  |
| `$.anyOf[1].summary` | string | 是 |  |  |
| `$.anyOf[1].description` | string | 是 |  |  |
| `$.anyOf[1].sourceSha256` | string | 是 | 正则：`"^[0-9a-f]{64}$"` |  |
| `$.anyOf[1].files` | array：object | 是 |  |  |
| `$.anyOf[1].files[]` | object | 每个元素 | 不接受额外字段 |  |
| `$.anyOf[1].files[].path` | string | 是 |  |  |
| `$.anyOf[1].files[].sha256` | string | 是 | 正则：`"^[0-9a-f]{64}$"` |  |
| `$.anyOf[1].files[].size` | integer | 是 | 最小值（含）：`0` |  |
| `$.anyOf[1].files[].policy` | string | 是 | 可选值：`["managed","preserve"]` |  |
| `$.anyOf[1].files[].optional` | boolean | 否 |  |  |
| `$.anyOf[1].update` | object | 是 | 不接受额外字段 |  |
| `$.anyOf[1].update.previousVersion` | string / null | 是 |  |  |
| `$.anyOf[1].update.addedFiles` | integer | 是 | 最小值（含）：`0` |  |
| `$.anyOf[1].update.modifiedFiles` | integer | 是 | 最小值（含）：`0` |  |
| `$.anyOf[1].update.deletedFiles` | integer | 是 | 最小值（含）：`0` |  |
| `$.anyOf[1].update.fullSize` | integer | 是 | 最小值（含）：`0` |  |
| `$.anyOf[1].update.newDataSize` | integer | 是 | 最小值（含）：`0` |  |
| `$.anyOf[1].update.estimatedDownloadSize` | integer | 是 | 最小值（含）：`0` |  |
| `$.anyOf[1].update.casReusePercent` | number | 是 |  |  |
| `$.anyOf[1].update.fileCount` | integer | 是 | 最小值（含）：`0` |  |
| `$.anyOf[1].update.sourceSize` | integer | 是 | 最小值（含）：`0` |  |
| `$.anyOf[1].schemaVersion` | number | 是 | 可选值：`[2]` |  |
| `$.anyOf[1].clientId` | string (uuid) | 是 |  |  |
| `$.anyOf[2]` | object | 分支内适用 | 不接受额外字段 |  |
| `$.anyOf[2].format` | string | 是 | 可选值：`["mua-recipe-manifest"]` |  |
| `$.anyOf[2].formatVersion` | number | 是 | 可选值：`[2]` |  |
| `$.anyOf[2].release` | object | 是 | 不接受额外字段 |  |
| `$.anyOf[2].release.organizationId` | string (uuid) | 是 |  |  |
| `$.anyOf[2].release.clientId` | string (uuid) | 是 |  |  |
| `$.anyOf[2].release.releaseId` | string (uuid) | 是 |  |  |
| `$.anyOf[2].release.version` | string | 是 | 最短长度：`1`<br>最长长度：`200` |  |
| `$.anyOf[2].release.name` | string | 是 | 最短长度：`1`<br>最长长度：`200` |  |
| `$.anyOf[2].release.summary` | string | 是 | 最短长度：`1`<br>最长长度：`200` |  |
| `$.anyOf[2].release.description` | string | 是 | 最长长度：`20000` |  |
| `$.anyOf[2].release.sourceSha256` | string | 是 | 正则：`"^[0-9a-f]{64}$"` |  |
| `$.anyOf[2].release.contentRevision` | integer | 是 | 最小值（不含）：`0` |  |
| `$.anyOf[2].runtime` | object | 是 | 不接受额外字段 |  |
| `$.anyOf[2].runtime.minecraft` | string | 是 | 最短长度：`1`<br>最长长度：`200` |  |
| `$.anyOf[2].runtime.loader` | object / null | 是 | 不接受额外字段 |  |
| `$.anyOf[2].runtime.loader.type` | string | 是 | 可选值：`["fabric","quilt","forge","neoforge"]` |  |
| `$.anyOf[2].runtime.loader.version` | string | 是 | 最短长度：`1`<br>最长长度：`200` |  |
| `$.anyOf[2].runtime.java` | object | 是 | 不接受额外字段 |  |
| `$.anyOf[2].runtime.java.major` | integer | 是 | 最小值（含）：`7`<br>最大值（含）：`25` |  |
| `$.anyOf[2].runtime.java.vendor` | string | 是 | 可选值：`["adoptium"]` |  |
| `$.anyOf[2].runtime.java.imageType` | string | 是 | 可选值：`["jre","jdk"]` |  |
| `$.anyOf[2].runtime.resolverVersion` | string | 是 | 可选值：`["mua-runtime-resolver-1"]` |  |
| `$.anyOf[2].launch` | object | 是 | 不接受额外字段 |  |
| `$.anyOf[2].launch.jvmArgs` | array：string | 是 | 最多元素：`256` |  |
| `$.anyOf[2].launch.jvmArgs[]` | string | 每个元素 | 最长长度：`4000` |  |
| `$.anyOf[2].launch.gameArgs` | array：string | 是 | 最多元素：`256` |  |
| `$.anyOf[2].launch.gameArgs[]` | string | 每个元素 | 最长长度：`4000` |  |
| `$.anyOf[2].launch.memory` | object | 是 | 不接受额外字段 |  |
| `$.anyOf[2].launch.memory.mode` | string | 是 | 可选值：`["auto"]` |  |
| `$.anyOf[2].launch.memory.minimumMiB` | integer | 是 | 最小值（含）：`256`<br>最大值（含）：`1048576` |  |
| `$.anyOf[2].launch.memory.recommendedMiB` | integer | 是 | 最小值（含）：`256`<br>最大值（含）：`1048576` |  |
| `$.anyOf[2].launch.preLaunch` | array：oneOf（3 个分支） | 是 | 最多元素：`32` |  |
| `$.anyOf[2].launch.preLaunch[]` | oneOf（3 个分支） | 每个元素 |  |  |
| `$.anyOf[2].launch.preLaunch[].oneOf[1]` | object | 分支内适用 | 不接受额外字段 |  |
| `$.anyOf[2].launch.preLaunch[].oneOf[1].type` | string | 是 | 可选值：`["mkdir"]` |  |
| `$.anyOf[2].launch.preLaunch[].oneOf[1].path` | string | 是 | 最短长度：`1`<br>最长长度：`1000` |  |
| `$.anyOf[2].launch.preLaunch[].oneOf[2]` | object | 分支内适用 | 不接受额外字段 |  |
| `$.anyOf[2].launch.preLaunch[].oneOf[2].type` | string | 是 | 可选值：`["copy"]` |  |
| `$.anyOf[2].launch.preLaunch[].oneOf[2].from` | object | 是 | 不接受额外字段 |  |
| `$.anyOf[2].launch.preLaunch[].oneOf[2].from.root` | string | 是 | 可选值：`["instance"]` |  |
| `$.anyOf[2].launch.preLaunch[].oneOf[2].from.path` | string | 是 | 最短长度：`1`<br>最长长度：`1000` |  |
| `$.anyOf[2].launch.preLaunch[].oneOf[2].to` | string | 是 | 最短长度：`1`<br>最长长度：`1000` |  |
| `$.anyOf[2].launch.preLaunch[].oneOf[2].ifMissing` | boolean | 是 | 可选值：`[true]` |  |
| `$.anyOf[2].launch.preLaunch[].oneOf[3]` | object | 分支内适用 | 不接受额外字段 |  |
| `$.anyOf[2].launch.preLaunch[].oneOf[3].type` | string | 是 | 可选值：`["exec"]` |  |
| `$.anyOf[2].launch.preLaunch[].oneOf[3].executable` | object | 是 | 不接受额外字段 |  |
| `$.anyOf[2].launch.preLaunch[].oneOf[3].executable.root` | string | 是 | 可选值：`["instance"]` |  |
| `$.anyOf[2].launch.preLaunch[].oneOf[3].executable.path` | string | 是 | 最短长度：`1`<br>最长长度：`1000` |  |
| `$.anyOf[2].launch.preLaunch[].oneOf[3].args` | array：string | 是 | 最多元素：`256` |  |
| `$.anyOf[2].launch.preLaunch[].oneOf[3].args[]` | string | 每个元素 | 最长长度：`4000` |  |
| `$.anyOf[2].launch.preLaunch[].oneOf[3].workingDirectory` | string / null | 是 | 最短长度：`1`<br>最长长度：`1000` |  |
| `$.anyOf[2].launch.preLaunch[].oneOf[3].requiresConsent` | boolean | 是 | 可选值：`[true]` |  |
| `$.anyOf[2].launch.preLaunch[].oneOf[3].timeoutSeconds` | integer | 是 | 最小值（含）：`1`<br>最大值（含）：`300` |  |
| `$.anyOf[2].launch.preLaunch[].oneOf[3].onFailure` | string | 是 | 可选值：`["abort","continue"]` |  |
| `$.anyOf[2].files` | array：anyOf（2 个分支） | 是 | 最少元素：`1`<br>最多元素：`100000` |  |
| `$.anyOf[2].files[]` | anyOf（2 个分支） | 每个元素 |  |  |
| `$.anyOf[2].files[].anyOf[1]` | object | 分支内适用 | 不接受额外字段 |  |
| `$.anyOf[2].files[].anyOf[1].path` | string | 是 |  |  |
| `$.anyOf[2].files[].anyOf[1].size` | integer | 是 | 最小值（含）：`0`<br>最大值（含）：`2147483648` |  |
| `$.anyOf[2].files[].anyOf[1].policy` | string | 是 | 可选值：`["managed","preserve"]` |  |
| `$.anyOf[2].files[].anyOf[1].optional` | boolean | 是 |  |  |
| `$.anyOf[2].files[].anyOf[1].executable` | boolean | 是 |  |  |
| `$.anyOf[2].files[].anyOf[1].hashes` | object | 是 | 不接受额外字段 |  |
| `$.anyOf[2].files[].anyOf[1].hashes.sha256` | string | 是 | 正则：`"^[a-f0-9]{64}$"` |  |
| `$.anyOf[2].files[].anyOf[1].source` | object | 是 | 不接受额外字段 |  |
| `$.anyOf[2].files[].anyOf[1].source.type` | string | 是 | 可选值：`["local"]` |  |
| `$.anyOf[2].files[].anyOf[1].source.entry` | string | 是 |  |  |
| `$.anyOf[2].files[].anyOf[2]` | object | 分支内适用 | 不接受额外字段 |  |
| `$.anyOf[2].files[].anyOf[2].path` | string | 是 |  |  |
| `$.anyOf[2].files[].anyOf[2].size` | integer | 是 | 最小值（含）：`0`<br>最大值（含）：`2147483648` |  |
| `$.anyOf[2].files[].anyOf[2].policy` | string | 是 | 可选值：`["managed","preserve"]` |  |
| `$.anyOf[2].files[].anyOf[2].optional` | boolean | 是 |  |  |
| `$.anyOf[2].files[].anyOf[2].executable` | boolean | 是 |  |  |
| `$.anyOf[2].files[].anyOf[2].hashes` | object | 是 | 不接受额外字段 |  |
| `$.anyOf[2].files[].anyOf[2].hashes.sha1` | string | 是 | 正则：`"^[a-f0-9]{40}$"` |  |
| `$.anyOf[2].files[].anyOf[2].hashes.sha512` | string | 是 | 正则：`"^[a-f0-9]{128}$"` |  |
| `$.anyOf[2].files[].anyOf[2].hashes.sha256` | string | 否 | 正则：`"^[a-f0-9]{64}$"` |  |
| `$.anyOf[2].files[].anyOf[2].source` | object | 是 | 不接受额外字段 |  |
| `$.anyOf[2].files[].anyOf[2].source.type` | string | 是 | 可选值：`["remote"]` |  |
| `$.anyOf[2].files[].anyOf[2].source.downloads` | array：string | 是 | 最少元素：`1`<br>最多元素：`10` |  |
| `$.anyOf[2].files[].anyOf[2].source.downloads[]` | string | 每个元素 | 最长长度：`4000` |  |
| `$.anyOf[2].protocolRevision` | number | 是 | 可选值：`[2]` |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "anyOf": [
    {
      "type": "object",
      "properties": {
        "format": {
          "type": "string",
          "enum": [
            "mua-client-manifest"
          ]
        },
        "organizationId": {
          "type": "string",
          "format": "uuid"
        },
        "version": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "runtime": {
          "type": "object",
          "properties": {
            "minecraft": {
              "type": "string"
            },
            "java": {
              "type": "integer"
            }
          },
          "required": [
            "minecraft",
            "java"
          ],
          "additionalProperties": false
        },
        "mods": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "modDetails": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "path": {
                "type": "string"
              },
              "optional": {
                "type": "boolean"
              }
            },
            "required": [
              "path",
              "optional"
            ],
            "additionalProperties": false
          }
        },
        "summary": {
          "type": "string"
        },
        "description": {
          "type": "string"
        },
        "sourceSha256": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$"
        },
        "files": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "path": {
                "type": "string"
              },
              "sha256": {
                "type": "string",
                "pattern": "^[0-9a-f]{64}$"
              },
              "size": {
                "type": "integer",
                "minimum": 0
              },
              "policy": {
                "type": "string",
                "enum": [
                  "managed",
                  "preserve"
                ]
              },
              "optional": {
                "type": "boolean"
              }
            },
            "required": [
              "path",
              "sha256",
              "size",
              "policy"
            ],
            "additionalProperties": false
          }
        },
        "update": {
          "type": "object",
          "properties": {
            "previousVersion": {
              "type": [
                "string",
                "null"
              ]
            },
            "addedFiles": {
              "type": "integer",
              "minimum": 0
            },
            "modifiedFiles": {
              "type": "integer",
              "minimum": 0
            },
            "deletedFiles": {
              "type": "integer",
              "minimum": 0
            },
            "fullSize": {
              "type": "integer",
              "minimum": 0
            },
            "newDataSize": {
              "type": "integer",
              "minimum": 0
            },
            "estimatedDownloadSize": {
              "type": "integer",
              "minimum": 0
            },
            "casReusePercent": {
              "type": "number"
            },
            "fileCount": {
              "type": "integer",
              "minimum": 0
            },
            "sourceSize": {
              "type": "integer",
              "minimum": 0
            }
          },
          "required": [
            "previousVersion",
            "addedFiles",
            "modifiedFiles",
            "deletedFiles",
            "fullSize",
            "newDataSize",
            "estimatedDownloadSize",
            "casReusePercent",
            "fileCount",
            "sourceSize"
          ],
          "additionalProperties": false
        },
        "schemaVersion": {
          "type": "number",
          "enum": [
            2
          ]
        },
        "clientId": {
          "type": "string",
          "format": "uuid"
        }
      },
      "required": [
        "format",
        "organizationId",
        "version",
        "name",
        "runtime",
        "mods",
        "summary",
        "description",
        "sourceSha256",
        "files",
        "update",
        "schemaVersion",
        "clientId"
      ],
      "additionalProperties": false
    },
    {
      "type": "object",
      "properties": {
        "format": {
          "type": "string",
          "enum": [
            "mua-recipe-manifest"
          ]
        },
        "formatVersion": {
          "type": "number",
          "enum": [
            2
          ]
        },
        "release": {
          "type": "object",
          "properties": {
            "organizationId": {
              "type": "string",
              "format": "uuid"
            },
            "clientId": {
              "type": "string",
              "format": "uuid"
            },
            "releaseId": {
              "type": "string",
              "format": "uuid"
            },
            "version": {
              "type": "string",
              "minLength": 1,
              "maxLength": 200
            },
            "name": {
              "type": "string",
              "minLength": 1,
              "maxLength": 200
            },
            "summary": {
              "type": "string",
              "minLength": 1,
              "maxLength": 200
            },
            "description": {
              "type": "string",
              "maxLength": 20000
            },
            "sourceSha256": {
              "type": "string",
              "pattern": "^[0-9a-f]{64}$"
            },
            "contentRevision": {
              "type": "integer",
              "exclusiveMinimum": 0
            }
          },
          "required": [
            "organizationId",
            "clientId",
            "releaseId",
            "version",
            "name",
            "summary",
            "description",
            "sourceSha256",
            "contentRevision"
          ],
          "additionalProperties": false
        },
        "runtime": {
          "type": "object",
          "properties": {
            "minecraft": {
              "type": "string",
              "minLength": 1,
              "maxLength": 200
            },
            "loader": {
              "type": [
                "object",
                "null"
              ],
              "properties": {
                "type": {
                  "type": "string",
                  "enum": [
                    "fabric",
                    "quilt",
                    "forge",
                    "neoforge"
                  ]
                },
                "version": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 200
                }
              },
              "required": [
                "type",
                "version"
              ],
              "additionalProperties": false
            },
            "java": {
              "type": "object",
              "properties": {
                "major": {
                  "type": "integer",
                  "minimum": 7,
                  "maximum": 25
                },
                "vendor": {
                  "type": "string",
                  "enum": [
                    "adoptium"
                  ]
                },
                "imageType": {
                  "type": "string",
                  "enum": [
                    "jre",
                    "jdk"
                  ]
                }
              },
              "required": [
                "major",
                "vendor",
                "imageType"
              ],
              "additionalProperties": false
            },
            "resolverVersion": {
              "type": "string",
              "enum": [
                "mua-runtime-resolver-1"
              ]
            }
          },
          "required": [
            "minecraft",
            "loader",
            "java",
            "resolverVersion"
          ],
          "additionalProperties": false
        },
        "launch": {
          "type": "object",
          "properties": {
            "jvmArgs": {
              "type": "array",
              "items": {
                "type": "string",
                "maxLength": 4000
              },
              "maxItems": 256
            },
            "gameArgs": {
              "type": "array",
              "items": {
                "type": "string",
                "maxLength": 4000
              },
              "maxItems": 256
            },
            "memory": {
              "type": "object",
              "properties": {
                "mode": {
                  "type": "string",
                  "enum": [
                    "auto"
                  ]
                },
                "minimumMiB": {
                  "type": "integer",
                  "minimum": 256,
                  "maximum": 1048576
                },
                "recommendedMiB": {
                  "type": "integer",
                  "minimum": 256,
                  "maximum": 1048576
                }
              },
              "required": [
                "mode",
                "minimumMiB",
                "recommendedMiB"
              ],
              "additionalProperties": false
            },
            "preLaunch": {
              "type": "array",
              "items": {
                "oneOf": [
                  {
                    "type": "object",
                    "properties": {
                      "type": {
                        "type": "string",
                        "enum": [
                          "mkdir"
                        ]
                      },
                      "path": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 1000
                      }
                    },
                    "required": [
                      "type",
                      "path"
                    ],
                    "additionalProperties": false
                  },
                  {
                    "type": "object",
                    "properties": {
                      "type": {
                        "type": "string",
                        "enum": [
                          "copy"
                        ]
                      },
                      "from": {
                        "type": "object",
                        "properties": {
                          "root": {
                            "type": "string",
                            "enum": [
                              "instance"
                            ]
                          },
                          "path": {
                            "type": "string",
                            "minLength": 1,
                            "maxLength": 1000
                          }
                        },
                        "required": [
                          "root",
                          "path"
                        ],
                        "additionalProperties": false
                      },
                      "to": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 1000
                      },
                      "ifMissing": {
                        "type": "boolean",
                        "enum": [
                          true
                        ]
                      }
                    },
                    "required": [
                      "type",
                      "from",
                      "to",
                      "ifMissing"
                    ],
                    "additionalProperties": false
                  },
                  {
                    "type": "object",
                    "properties": {
                      "type": {
                        "type": "string",
                        "enum": [
                          "exec"
                        ]
                      },
                      "executable": {
                        "type": "object",
                        "properties": {
                          "root": {
                            "type": "string",
                            "enum": [
                              "instance"
                            ]
                          },
                          "path": {
                            "type": "string",
                            "minLength": 1,
                            "maxLength": 1000
                          }
                        },
                        "required": [
                          "root",
                          "path"
                        ],
                        "additionalProperties": false
                      },
                      "args": {
                        "type": "array",
                        "items": {
                          "type": "string",
                          "maxLength": 4000
                        },
                        "maxItems": 256
                      },
                      "workingDirectory": {
                        "type": [
                          "string",
                          "null"
                        ],
                        "minLength": 1,
                        "maxLength": 1000
                      },
                      "requiresConsent": {
                        "type": "boolean",
                        "enum": [
                          true
                        ]
                      },
                      "timeoutSeconds": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": 300
                      },
                      "onFailure": {
                        "type": "string",
                        "enum": [
                          "abort",
                          "continue"
                        ]
                      }
                    },
                    "required": [
                      "type",
                      "executable",
                      "args",
                      "workingDirectory",
                      "requiresConsent",
                      "timeoutSeconds",
                      "onFailure"
                    ],
                    "additionalProperties": false
                  }
                ]
              },
              "maxItems": 32
            }
          },
          "required": [
            "jvmArgs",
            "gameArgs",
            "memory",
            "preLaunch"
          ],
          "additionalProperties": false
        },
        "files": {
          "type": "array",
          "items": {
            "anyOf": [
              {
                "type": "object",
                "properties": {
                  "path": {
                    "type": "string"
                  },
                  "size": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 2147483648
                  },
                  "policy": {
                    "type": "string",
                    "enum": [
                      "managed",
                      "preserve"
                    ]
                  },
                  "optional": {
                    "type": "boolean"
                  },
                  "executable": {
                    "type": "boolean"
                  },
                  "hashes": {
                    "type": "object",
                    "properties": {
                      "sha256": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{64}$"
                      }
                    },
                    "required": [
                      "sha256"
                    ],
                    "additionalProperties": false
                  },
                  "source": {
                    "type": "object",
                    "properties": {
                      "type": {
                        "type": "string",
                        "enum": [
                          "local"
                        ]
                      },
                      "entry": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "type",
                      "entry"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "path",
                  "size",
                  "policy",
                  "optional",
                  "executable",
                  "hashes",
                  "source"
                ],
                "additionalProperties": false
              },
              {
                "type": "object",
                "properties": {
                  "path": {
                    "type": "string"
                  },
                  "size": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 2147483648
                  },
                  "policy": {
                    "type": "string",
                    "enum": [
                      "managed",
                      "preserve"
                    ]
                  },
                  "optional": {
                    "type": "boolean"
                  },
                  "executable": {
                    "type": "boolean"
                  },
                  "hashes": {
                    "type": "object",
                    "properties": {
                      "sha1": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{40}$"
                      },
                      "sha512": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{128}$"
                      },
                      "sha256": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{64}$"
                      }
                    },
                    "required": [
                      "sha1",
                      "sha512"
                    ],
                    "additionalProperties": false
                  },
                  "source": {
                    "type": "object",
                    "properties": {
                      "type": {
                        "type": "string",
                        "enum": [
                          "remote"
                        ]
                      },
                      "downloads": {
                        "type": "array",
                        "items": {
                          "type": "string",
                          "maxLength": 4000
                        },
                        "minItems": 1,
                        "maxItems": 10
                      }
                    },
                    "required": [
                      "type",
                      "downloads"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "path",
                  "size",
                  "policy",
                  "optional",
                  "executable",
                  "hashes",
                  "source"
                ],
                "additionalProperties": false
              }
            ]
          },
          "minItems": 1,
          "maxItems": 100000
        },
        "protocolRevision": {
          "type": "number",
          "enum": [
            2
          ]
        }
      },
      "required": [
        "format",
        "formatVersion",
        "release",
        "runtime",
        "launch",
        "files",
        "protocolRevision"
      ],
      "additionalProperties": false
    }
  ]
}
```

</details>

<a id="schema-inline-35"></a>

### getDraftPlatformManifest 200 响应

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | anyOf（3 个分支） | — |  |  |
| `$.anyOf[1]` | object | 分支内适用 | 不接受额外字段 |  |
| `$.anyOf[1].format` | string | 是 | 可选值：`["mua-platform-manifest"]` |  |
| `$.anyOf[1].formatVersion` | number | 是 | 可选值：`[1]` |  |
| `$.anyOf[1].release` | object | 是 | 不接受额外字段 |  |
| `$.anyOf[1].release.organizationId` | string (uuid) | 是 |  |  |
| `$.anyOf[1].release.clientId` | string (uuid) | 是 |  |  |
| `$.anyOf[1].release.releaseId` | string (uuid) | 是 |  |  |
| `$.anyOf[1].release.version` | string | 是 | 最短长度：`1`<br>最长长度：`200` |  |
| `$.anyOf[1].release.name` | string | 是 | 最短长度：`1`<br>最长长度：`200` |  |
| `$.anyOf[1].release.summary` | string | 是 | 最短长度：`1`<br>最长长度：`200` |  |
| `$.anyOf[1].release.description` | string | 是 | 最长长度：`20000` |  |
| `$.anyOf[1].release.sourceSha256` | string | 是 | 正则：`"^[0-9a-f]{64}$"` |  |
| `$.anyOf[1].release.contentRevision` | integer | 是 | 最小值（含）：`1`<br>最大值（含）：`9007199254740991` |  |
| `$.anyOf[1].platform` | string | 是 | 可选值：`["windows-amd64","windows-aarch64","linux-amd64","linux-aarch64","macos-amd64","macos-aarch64"]` |  |
| `$.anyOf[1].runtime` | object | 是 | 不接受额外字段 |  |
| `$.anyOf[1].runtime.minecraft` | string | 是 | 最短长度：`1`<br>最长长度：`200` |  |
| `$.anyOf[1].runtime.loader` | object / null | 是 | 不接受额外字段 |  |
| `$.anyOf[1].runtime.loader.type` | string | 是 | 可选值：`["fabric","quilt","forge","neoforge"]` |  |
| `$.anyOf[1].runtime.loader.version` | string | 是 | 最短长度：`1`<br>最长长度：`200` |  |
| `$.anyOf[1].runtime.java` | object | 是 | 不接受额外字段 |  |
| `$.anyOf[1].runtime.java.major` | integer | 是 | 最小值（含）：`7`<br>最大值（含）：`9007199254740991` |  |
| `$.anyOf[1].runtime.java.vendor` | string | 是 | 最短长度：`1`<br>最长长度：`200` |  |
| `$.anyOf[1].runtime.java.version` | string | 是 | 最短长度：`1`<br>最长长度：`200` |  |
| `$.anyOf[1].runtime.java.build` | string | 是 | 最短长度：`1`<br>最长长度：`200` |  |
| `$.anyOf[1].runtime.java.imageType` | string | 是 | 可选值：`["jre","jdk"]` |  |
| `$.anyOf[1].runtime.java.manifestSha256` | string | 是 | 正则：`"^[0-9a-f]{64}$"` |  |
| `$.anyOf[1].runtime.java.executable` | string | 是 | 最短长度：`1`<br>最长长度：`1000` |  |
| `$.anyOf[1].environments` | array：object | 是 | 最少元素：`2`<br>最多元素：`3` |  |
| `$.anyOf[1].environments[]` | object | 每个元素 | 不接受额外字段 |  |
| `$.anyOf[1].environments[].kind` | string | 是 | 可选值：`["minecraft","loader","java"]` |  |
| `$.anyOf[1].environments[].sha256` | string | 是 | 正则：`"^[0-9a-f]{64}$"` |  |
| `$.anyOf[1].launch` | object | 是 | 不接受额外字段 |  |
| `$.anyOf[1].launch.mainClass` | string | 是 | 正则：`"^[A-Za-z_$][A-Za-z0-9_$]*(?:\\.[A-Za-z_$][A-Za-z0-9_$]*)+$"` |  |
| `$.anyOf[1].launch.classpath` | array：string | 是 | 最少元素：`1`<br>最多元素：`10000` |  |
| `$.anyOf[1].launch.classpath[]` | string | 每个元素 | 最短长度：`1`<br>最长长度：`1000` |  |
| `$.anyOf[1].launch.jvmArgs` | array：string | 是 | 最多元素：`256` |  |
| `$.anyOf[1].launch.jvmArgs[]` | string | 每个元素 | 最长长度：`4000` |  |
| `$.anyOf[1].launch.gameArgs` | array：string | 是 | 最多元素：`256` |  |
| `$.anyOf[1].launch.gameArgs[]` | string | 每个元素 | 最长长度：`4000` |  |
| `$.anyOf[1].launch.memory` | object | 是 | 不接受额外字段 |  |
| `$.anyOf[1].launch.memory.mode` | string | 是 | 可选值：`["auto"]` |  |
| `$.anyOf[1].launch.memory.minimumMiB` | integer | 是 | 最小值（含）：`256`<br>最大值（含）：`1048576` |  |
| `$.anyOf[1].launch.memory.recommendedMiB` | integer | 是 | 最小值（含）：`256`<br>最大值（含）：`1048576` |  |
| `$.anyOf[1].launch.preLaunch` | array：oneOf（3 个分支） | 是 | 最多元素：`32` |  |
| `$.anyOf[1].launch.preLaunch[]` | oneOf（3 个分支） | 每个元素 |  |  |
| `$.anyOf[1].launch.preLaunch[].oneOf[1]` | object | 分支内适用 | 不接受额外字段 |  |
| `$.anyOf[1].launch.preLaunch[].oneOf[1].type` | string | 是 | 可选值：`["mkdir"]` |  |
| `$.anyOf[1].launch.preLaunch[].oneOf[1].path` | string | 是 | 最短长度：`1`<br>最长长度：`1000` |  |
| `$.anyOf[1].launch.preLaunch[].oneOf[2]` | object | 分支内适用 | 不接受额外字段 |  |
| `$.anyOf[1].launch.preLaunch[].oneOf[2].type` | string | 是 | 可选值：`["copy"]` |  |
| `$.anyOf[1].launch.preLaunch[].oneOf[2].from` | object | 是 | 不接受额外字段 |  |
| `$.anyOf[1].launch.preLaunch[].oneOf[2].from.root` | string | 是 | 可选值：`["instance","java"]` |  |
| `$.anyOf[1].launch.preLaunch[].oneOf[2].from.path` | string | 是 | 最短长度：`1`<br>最长长度：`1000` |  |
| `$.anyOf[1].launch.preLaunch[].oneOf[2].to` | string | 是 | 最短长度：`1`<br>最长长度：`1000` |  |
| `$.anyOf[1].launch.preLaunch[].oneOf[2].ifMissing` | boolean | 是 | 可选值：`[true]` |  |
| `$.anyOf[1].launch.preLaunch[].oneOf[3]` | object | 分支内适用 | 不接受额外字段 |  |
| `$.anyOf[1].launch.preLaunch[].oneOf[3].type` | string | 是 | 可选值：`["exec"]` |  |
| `$.anyOf[1].launch.preLaunch[].oneOf[3].executable` | object | 是 | 不接受额外字段 |  |
| `$.anyOf[1].launch.preLaunch[].oneOf[3].executable.root` | string | 是 | 可选值：`["instance","java"]` |  |
| `$.anyOf[1].launch.preLaunch[].oneOf[3].executable.path` | string | 是 | 最短长度：`1`<br>最长长度：`1000` |  |
| `$.anyOf[1].launch.preLaunch[].oneOf[3].args` | array：string | 是 | 最多元素：`256` |  |
| `$.anyOf[1].launch.preLaunch[].oneOf[3].args[]` | string | 每个元素 | 最长长度：`4000` |  |
| `$.anyOf[1].launch.preLaunch[].oneOf[3].workingDirectory` | string / null | 是 | 最短长度：`1`<br>最长长度：`1000` |  |
| `$.anyOf[1].launch.preLaunch[].oneOf[3].requiresConsent` | boolean | 是 | 可选值：`[true]` |  |
| `$.anyOf[1].launch.preLaunch[].oneOf[3].timeoutSeconds` | integer | 是 | 最小值（含）：`1`<br>最大值（含）：`300` |  |
| `$.anyOf[1].launch.preLaunch[].oneOf[3].onFailure` | string | 是 | 可选值：`["abort","continue"]` |  |
| `$.anyOf[1].mods` | array：object | 是 | 最多元素：`2000` |  |
| `$.anyOf[1].mods[]` | object | 每个元素 | 不接受额外字段 |  |
| `$.anyOf[1].mods[].path` | string | 是 | 最短长度：`1`<br>最长长度：`1000` |  |
| `$.anyOf[1].mods[].name` | string / null | 是 | 最短长度：`1`<br>最长长度：`200` |  |
| `$.anyOf[1].mods[].version` | string / null | 是 | 最短长度：`1`<br>最长长度：`200` |  |
| `$.anyOf[1].mods[].optional` | boolean | 否 |  |  |
| `$.anyOf[1].files` | array：object | 是 | 最多元素：`100000` |  |
| `$.anyOf[1].files[]` | object | 每个元素 | 不接受额外字段 |  |
| `$.anyOf[1].files[].root` | string | 是 | 可选值：`["instance","java"]` |  |
| `$.anyOf[1].files[].path` | string | 是 | 最短长度：`1`<br>最长长度：`1000` |  |
| `$.anyOf[1].files[].sha256` | string | 是 | 正则：`"^[0-9a-f]{64}$"` |  |
| `$.anyOf[1].files[].size` | integer | 是 | 最小值（含）：`0`<br>最大值（含）：`2147483648` |  |
| `$.anyOf[1].files[].policy` | string | 是 | 可选值：`["managed","preserve"]` |  |
| `$.anyOf[1].files[].executable` | boolean | 是 |  |  |
| `$.anyOf[1].files[].optional` | boolean | 否 |  |  |
| `$.anyOf[2]` | object | 分支内适用 | 不接受额外字段 |  |
| `$.anyOf[2].format` | string | 是 | 可选值：`["mua-client-manifest"]` |  |
| `$.anyOf[2].organizationId` | string (uuid) | 是 |  |  |
| `$.anyOf[2].version` | string | 是 |  |  |
| `$.anyOf[2].name` | string | 是 |  |  |
| `$.anyOf[2].runtime` | object | 是 | 不接受额外字段 |  |
| `$.anyOf[2].runtime.minecraft` | string | 是 |  |  |
| `$.anyOf[2].runtime.java` | integer | 是 |  |  |
| `$.anyOf[2].mods` | array：string | 是 |  |  |
| `$.anyOf[2].mods[]` | string | 每个元素 |  |  |
| `$.anyOf[2].modDetails` | array：object | 否 |  |  |
| `$.anyOf[2].modDetails[]` | object | 每个元素 | 不接受额外字段 |  |
| `$.anyOf[2].modDetails[].path` | string | 是 |  |  |
| `$.anyOf[2].modDetails[].optional` | boolean | 是 |  |  |
| `$.anyOf[2].summary` | string | 是 |  |  |
| `$.anyOf[2].description` | string | 是 |  |  |
| `$.anyOf[2].sourceSha256` | string | 是 | 正则：`"^[0-9a-f]{64}$"` |  |
| `$.anyOf[2].files` | array：object | 是 |  |  |
| `$.anyOf[2].files[]` | object | 每个元素 | 不接受额外字段 |  |
| `$.anyOf[2].files[].path` | string | 是 |  |  |
| `$.anyOf[2].files[].sha256` | string | 是 | 正则：`"^[0-9a-f]{64}$"` |  |
| `$.anyOf[2].files[].size` | integer | 是 | 最小值（含）：`0` |  |
| `$.anyOf[2].files[].policy` | string | 是 | 可选值：`["managed","preserve"]` |  |
| `$.anyOf[2].files[].optional` | boolean | 否 |  |  |
| `$.anyOf[2].update` | object | 是 | 不接受额外字段 |  |
| `$.anyOf[2].update.previousVersion` | string / null | 是 |  |  |
| `$.anyOf[2].update.addedFiles` | integer | 是 | 最小值（含）：`0` |  |
| `$.anyOf[2].update.modifiedFiles` | integer | 是 | 最小值（含）：`0` |  |
| `$.anyOf[2].update.deletedFiles` | integer | 是 | 最小值（含）：`0` |  |
| `$.anyOf[2].update.fullSize` | integer | 是 | 最小值（含）：`0` |  |
| `$.anyOf[2].update.newDataSize` | integer | 是 | 最小值（含）：`0` |  |
| `$.anyOf[2].update.estimatedDownloadSize` | integer | 是 | 最小值（含）：`0` |  |
| `$.anyOf[2].update.casReusePercent` | number | 是 |  |  |
| `$.anyOf[2].update.fileCount` | integer | 是 | 最小值（含）：`0` |  |
| `$.anyOf[2].update.sourceSize` | integer | 是 | 最小值（含）：`0` |  |
| `$.anyOf[2].schemaVersion` | number | 是 | 可选值：`[2]` |  |
| `$.anyOf[2].clientId` | string (uuid) | 是 |  |  |
| `$.anyOf[3]` | object | 分支内适用 | 不接受额外字段 |  |
| `$.anyOf[3].format` | string | 是 | 可选值：`["mua-recipe-manifest"]` |  |
| `$.anyOf[3].formatVersion` | number | 是 | 可选值：`[2]` |  |
| `$.anyOf[3].release` | object | 是 | 不接受额外字段 |  |
| `$.anyOf[3].release.organizationId` | string (uuid) | 是 |  |  |
| `$.anyOf[3].release.clientId` | string (uuid) | 是 |  |  |
| `$.anyOf[3].release.releaseId` | string (uuid) | 是 |  |  |
| `$.anyOf[3].release.version` | string | 是 | 最短长度：`1`<br>最长长度：`200` |  |
| `$.anyOf[3].release.name` | string | 是 | 最短长度：`1`<br>最长长度：`200` |  |
| `$.anyOf[3].release.summary` | string | 是 | 最短长度：`1`<br>最长长度：`200` |  |
| `$.anyOf[3].release.description` | string | 是 | 最长长度：`20000` |  |
| `$.anyOf[3].release.sourceSha256` | string | 是 | 正则：`"^[0-9a-f]{64}$"` |  |
| `$.anyOf[3].release.contentRevision` | integer | 是 | 最小值（不含）：`0` |  |
| `$.anyOf[3].runtime` | object | 是 | 不接受额外字段 |  |
| `$.anyOf[3].runtime.minecraft` | string | 是 | 最短长度：`1`<br>最长长度：`200` |  |
| `$.anyOf[3].runtime.loader` | object / null | 是 | 不接受额外字段 |  |
| `$.anyOf[3].runtime.loader.type` | string | 是 | 可选值：`["fabric","quilt","forge","neoforge"]` |  |
| `$.anyOf[3].runtime.loader.version` | string | 是 | 最短长度：`1`<br>最长长度：`200` |  |
| `$.anyOf[3].runtime.java` | object | 是 | 不接受额外字段 |  |
| `$.anyOf[3].runtime.java.major` | integer | 是 | 最小值（含）：`7`<br>最大值（含）：`25` |  |
| `$.anyOf[3].runtime.java.vendor` | string | 是 | 可选值：`["adoptium"]` |  |
| `$.anyOf[3].runtime.java.imageType` | string | 是 | 可选值：`["jre","jdk"]` |  |
| `$.anyOf[3].runtime.resolverVersion` | string | 是 | 可选值：`["mua-runtime-resolver-1"]` |  |
| `$.anyOf[3].launch` | object | 是 | 不接受额外字段 |  |
| `$.anyOf[3].launch.jvmArgs` | array：string | 是 | 最多元素：`256` |  |
| `$.anyOf[3].launch.jvmArgs[]` | string | 每个元素 | 最长长度：`4000` |  |
| `$.anyOf[3].launch.gameArgs` | array：string | 是 | 最多元素：`256` |  |
| `$.anyOf[3].launch.gameArgs[]` | string | 每个元素 | 最长长度：`4000` |  |
| `$.anyOf[3].launch.memory` | object | 是 | 不接受额外字段 |  |
| `$.anyOf[3].launch.memory.mode` | string | 是 | 可选值：`["auto"]` |  |
| `$.anyOf[3].launch.memory.minimumMiB` | integer | 是 | 最小值（含）：`256`<br>最大值（含）：`1048576` |  |
| `$.anyOf[3].launch.memory.recommendedMiB` | integer | 是 | 最小值（含）：`256`<br>最大值（含）：`1048576` |  |
| `$.anyOf[3].launch.preLaunch` | array：oneOf（3 个分支） | 是 | 最多元素：`32` |  |
| `$.anyOf[3].launch.preLaunch[]` | oneOf（3 个分支） | 每个元素 |  |  |
| `$.anyOf[3].launch.preLaunch[].oneOf[1]` | object | 分支内适用 | 不接受额外字段 |  |
| `$.anyOf[3].launch.preLaunch[].oneOf[1].type` | string | 是 | 可选值：`["mkdir"]` |  |
| `$.anyOf[3].launch.preLaunch[].oneOf[1].path` | string | 是 | 最短长度：`1`<br>最长长度：`1000` |  |
| `$.anyOf[3].launch.preLaunch[].oneOf[2]` | object | 分支内适用 | 不接受额外字段 |  |
| `$.anyOf[3].launch.preLaunch[].oneOf[2].type` | string | 是 | 可选值：`["copy"]` |  |
| `$.anyOf[3].launch.preLaunch[].oneOf[2].from` | object | 是 | 不接受额外字段 |  |
| `$.anyOf[3].launch.preLaunch[].oneOf[2].from.root` | string | 是 | 可选值：`["instance"]` |  |
| `$.anyOf[3].launch.preLaunch[].oneOf[2].from.path` | string | 是 | 最短长度：`1`<br>最长长度：`1000` |  |
| `$.anyOf[3].launch.preLaunch[].oneOf[2].to` | string | 是 | 最短长度：`1`<br>最长长度：`1000` |  |
| `$.anyOf[3].launch.preLaunch[].oneOf[2].ifMissing` | boolean | 是 | 可选值：`[true]` |  |
| `$.anyOf[3].launch.preLaunch[].oneOf[3]` | object | 分支内适用 | 不接受额外字段 |  |
| `$.anyOf[3].launch.preLaunch[].oneOf[3].type` | string | 是 | 可选值：`["exec"]` |  |
| `$.anyOf[3].launch.preLaunch[].oneOf[3].executable` | object | 是 | 不接受额外字段 |  |
| `$.anyOf[3].launch.preLaunch[].oneOf[3].executable.root` | string | 是 | 可选值：`["instance"]` |  |
| `$.anyOf[3].launch.preLaunch[].oneOf[3].executable.path` | string | 是 | 最短长度：`1`<br>最长长度：`1000` |  |
| `$.anyOf[3].launch.preLaunch[].oneOf[3].args` | array：string | 是 | 最多元素：`256` |  |
| `$.anyOf[3].launch.preLaunch[].oneOf[3].args[]` | string | 每个元素 | 最长长度：`4000` |  |
| `$.anyOf[3].launch.preLaunch[].oneOf[3].workingDirectory` | string / null | 是 | 最短长度：`1`<br>最长长度：`1000` |  |
| `$.anyOf[3].launch.preLaunch[].oneOf[3].requiresConsent` | boolean | 是 | 可选值：`[true]` |  |
| `$.anyOf[3].launch.preLaunch[].oneOf[3].timeoutSeconds` | integer | 是 | 最小值（含）：`1`<br>最大值（含）：`300` |  |
| `$.anyOf[3].launch.preLaunch[].oneOf[3].onFailure` | string | 是 | 可选值：`["abort","continue"]` |  |
| `$.anyOf[3].files` | array：anyOf（2 个分支） | 是 | 最少元素：`1`<br>最多元素：`100000` |  |
| `$.anyOf[3].files[]` | anyOf（2 个分支） | 每个元素 |  |  |
| `$.anyOf[3].files[].anyOf[1]` | object | 分支内适用 | 不接受额外字段 |  |
| `$.anyOf[3].files[].anyOf[1].path` | string | 是 |  |  |
| `$.anyOf[3].files[].anyOf[1].size` | integer | 是 | 最小值（含）：`0`<br>最大值（含）：`2147483648` |  |
| `$.anyOf[3].files[].anyOf[1].policy` | string | 是 | 可选值：`["managed","preserve"]` |  |
| `$.anyOf[3].files[].anyOf[1].optional` | boolean | 是 |  |  |
| `$.anyOf[3].files[].anyOf[1].executable` | boolean | 是 |  |  |
| `$.anyOf[3].files[].anyOf[1].hashes` | object | 是 | 不接受额外字段 |  |
| `$.anyOf[3].files[].anyOf[1].hashes.sha256` | string | 是 | 正则：`"^[a-f0-9]{64}$"` |  |
| `$.anyOf[3].files[].anyOf[1].source` | object | 是 | 不接受额外字段 |  |
| `$.anyOf[3].files[].anyOf[1].source.type` | string | 是 | 可选值：`["local"]` |  |
| `$.anyOf[3].files[].anyOf[1].source.entry` | string | 是 |  |  |
| `$.anyOf[3].files[].anyOf[2]` | object | 分支内适用 | 不接受额外字段 |  |
| `$.anyOf[3].files[].anyOf[2].path` | string | 是 |  |  |
| `$.anyOf[3].files[].anyOf[2].size` | integer | 是 | 最小值（含）：`0`<br>最大值（含）：`2147483648` |  |
| `$.anyOf[3].files[].anyOf[2].policy` | string | 是 | 可选值：`["managed","preserve"]` |  |
| `$.anyOf[3].files[].anyOf[2].optional` | boolean | 是 |  |  |
| `$.anyOf[3].files[].anyOf[2].executable` | boolean | 是 |  |  |
| `$.anyOf[3].files[].anyOf[2].hashes` | object | 是 | 不接受额外字段 |  |
| `$.anyOf[3].files[].anyOf[2].hashes.sha1` | string | 是 | 正则：`"^[a-f0-9]{40}$"` |  |
| `$.anyOf[3].files[].anyOf[2].hashes.sha512` | string | 是 | 正则：`"^[a-f0-9]{128}$"` |  |
| `$.anyOf[3].files[].anyOf[2].hashes.sha256` | string | 否 | 正则：`"^[a-f0-9]{64}$"` |  |
| `$.anyOf[3].files[].anyOf[2].source` | object | 是 | 不接受额外字段 |  |
| `$.anyOf[3].files[].anyOf[2].source.type` | string | 是 | 可选值：`["remote"]` |  |
| `$.anyOf[3].files[].anyOf[2].source.downloads` | array：string | 是 | 最少元素：`1`<br>最多元素：`10` |  |
| `$.anyOf[3].files[].anyOf[2].source.downloads[]` | string | 每个元素 | 最长长度：`4000` |  |
| `$.anyOf[3].protocolRevision` | number | 是 | 可选值：`[2]` |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "anyOf": [
    {
      "type": "object",
      "properties": {
        "format": {
          "type": "string",
          "enum": [
            "mua-platform-manifest"
          ]
        },
        "formatVersion": {
          "type": "number",
          "enum": [
            1
          ]
        },
        "release": {
          "type": "object",
          "properties": {
            "organizationId": {
              "type": "string",
              "format": "uuid"
            },
            "clientId": {
              "type": "string",
              "format": "uuid"
            },
            "releaseId": {
              "type": "string",
              "format": "uuid"
            },
            "version": {
              "type": "string",
              "minLength": 1,
              "maxLength": 200
            },
            "name": {
              "type": "string",
              "minLength": 1,
              "maxLength": 200
            },
            "summary": {
              "type": "string",
              "minLength": 1,
              "maxLength": 200
            },
            "description": {
              "type": "string",
              "maxLength": 20000
            },
            "sourceSha256": {
              "type": "string",
              "pattern": "^[0-9a-f]{64}$"
            },
            "contentRevision": {
              "type": "integer",
              "minimum": 1,
              "maximum": 9007199254740991
            }
          },
          "required": [
            "organizationId",
            "clientId",
            "releaseId",
            "version",
            "name",
            "summary",
            "description",
            "sourceSha256",
            "contentRevision"
          ],
          "additionalProperties": false
        },
        "platform": {
          "type": "string",
          "enum": [
            "windows-amd64",
            "windows-aarch64",
            "linux-amd64",
            "linux-aarch64",
            "macos-amd64",
            "macos-aarch64"
          ]
        },
        "runtime": {
          "type": "object",
          "properties": {
            "minecraft": {
              "type": "string",
              "minLength": 1,
              "maxLength": 200
            },
            "loader": {
              "type": [
                "object",
                "null"
              ],
              "properties": {
                "type": {
                  "type": "string",
                  "enum": [
                    "fabric",
                    "quilt",
                    "forge",
                    "neoforge"
                  ]
                },
                "version": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 200
                }
              },
              "required": [
                "type",
                "version"
              ],
              "additionalProperties": false
            },
            "java": {
              "type": "object",
              "properties": {
                "major": {
                  "type": "integer",
                  "minimum": 7,
                  "maximum": 9007199254740991
                },
                "vendor": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 200
                },
                "version": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 200
                },
                "build": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 200
                },
                "imageType": {
                  "type": "string",
                  "enum": [
                    "jre",
                    "jdk"
                  ]
                },
                "manifestSha256": {
                  "type": "string",
                  "pattern": "^[0-9a-f]{64}$"
                },
                "executable": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 1000
                }
              },
              "required": [
                "major",
                "vendor",
                "version",
                "build",
                "imageType",
                "manifestSha256",
                "executable"
              ],
              "additionalProperties": false
            }
          },
          "required": [
            "minecraft",
            "loader",
            "java"
          ],
          "additionalProperties": false
        },
        "environments": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "kind": {
                "type": "string",
                "enum": [
                  "minecraft",
                  "loader",
                  "java"
                ]
              },
              "sha256": {
                "type": "string",
                "pattern": "^[0-9a-f]{64}$"
              }
            },
            "required": [
              "kind",
              "sha256"
            ],
            "additionalProperties": false
          },
          "minItems": 2,
          "maxItems": 3
        },
        "launch": {
          "type": "object",
          "properties": {
            "mainClass": {
              "type": "string",
              "pattern": "^[A-Za-z_$][A-Za-z0-9_$]*(?:\\.[A-Za-z_$][A-Za-z0-9_$]*)+$"
            },
            "classpath": {
              "type": "array",
              "items": {
                "type": "string",
                "minLength": 1,
                "maxLength": 1000
              },
              "minItems": 1,
              "maxItems": 10000
            },
            "jvmArgs": {
              "type": "array",
              "items": {
                "type": "string",
                "maxLength": 4000
              },
              "maxItems": 256
            },
            "gameArgs": {
              "type": "array",
              "items": {
                "type": "string",
                "maxLength": 4000
              },
              "maxItems": 256
            },
            "memory": {
              "type": "object",
              "properties": {
                "mode": {
                  "type": "string",
                  "enum": [
                    "auto"
                  ]
                },
                "minimumMiB": {
                  "type": "integer",
                  "minimum": 256,
                  "maximum": 1048576
                },
                "recommendedMiB": {
                  "type": "integer",
                  "minimum": 256,
                  "maximum": 1048576
                }
              },
              "required": [
                "mode",
                "minimumMiB",
                "recommendedMiB"
              ],
              "additionalProperties": false
            },
            "preLaunch": {
              "type": "array",
              "items": {
                "oneOf": [
                  {
                    "type": "object",
                    "properties": {
                      "type": {
                        "type": "string",
                        "enum": [
                          "mkdir"
                        ]
                      },
                      "path": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 1000
                      }
                    },
                    "required": [
                      "type",
                      "path"
                    ],
                    "additionalProperties": false
                  },
                  {
                    "type": "object",
                    "properties": {
                      "type": {
                        "type": "string",
                        "enum": [
                          "copy"
                        ]
                      },
                      "from": {
                        "type": "object",
                        "properties": {
                          "root": {
                            "type": "string",
                            "enum": [
                              "instance",
                              "java"
                            ]
                          },
                          "path": {
                            "type": "string",
                            "minLength": 1,
                            "maxLength": 1000
                          }
                        },
                        "required": [
                          "root",
                          "path"
                        ],
                        "additionalProperties": false
                      },
                      "to": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 1000
                      },
                      "ifMissing": {
                        "type": "boolean",
                        "enum": [
                          true
                        ]
                      }
                    },
                    "required": [
                      "type",
                      "from",
                      "to",
                      "ifMissing"
                    ],
                    "additionalProperties": false
                  },
                  {
                    "type": "object",
                    "properties": {
                      "type": {
                        "type": "string",
                        "enum": [
                          "exec"
                        ]
                      },
                      "executable": {
                        "type": "object",
                        "properties": {
                          "root": {
                            "type": "string",
                            "enum": [
                              "instance",
                              "java"
                            ]
                          },
                          "path": {
                            "type": "string",
                            "minLength": 1,
                            "maxLength": 1000
                          }
                        },
                        "required": [
                          "root",
                          "path"
                        ],
                        "additionalProperties": false
                      },
                      "args": {
                        "type": "array",
                        "items": {
                          "type": "string",
                          "maxLength": 4000
                        },
                        "maxItems": 256
                      },
                      "workingDirectory": {
                        "type": [
                          "string",
                          "null"
                        ],
                        "minLength": 1,
                        "maxLength": 1000
                      },
                      "requiresConsent": {
                        "type": "boolean",
                        "enum": [
                          true
                        ]
                      },
                      "timeoutSeconds": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": 300
                      },
                      "onFailure": {
                        "type": "string",
                        "enum": [
                          "abort",
                          "continue"
                        ]
                      }
                    },
                    "required": [
                      "type",
                      "executable",
                      "args",
                      "workingDirectory",
                      "requiresConsent",
                      "timeoutSeconds",
                      "onFailure"
                    ],
                    "additionalProperties": false
                  }
                ]
              },
              "maxItems": 32
            }
          },
          "required": [
            "mainClass",
            "classpath",
            "jvmArgs",
            "gameArgs",
            "memory",
            "preLaunch"
          ],
          "additionalProperties": false
        },
        "mods": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "path": {
                "type": "string",
                "minLength": 1,
                "maxLength": 1000
              },
              "name": {
                "type": [
                  "string",
                  "null"
                ],
                "minLength": 1,
                "maxLength": 200
              },
              "version": {
                "type": [
                  "string",
                  "null"
                ],
                "minLength": 1,
                "maxLength": 200
              },
              "optional": {
                "type": "boolean"
              }
            },
            "required": [
              "path",
              "name",
              "version"
            ],
            "additionalProperties": false
          },
          "maxItems": 2000
        },
        "files": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "root": {
                "type": "string",
                "enum": [
                  "instance",
                  "java"
                ]
              },
              "path": {
                "type": "string",
                "minLength": 1,
                "maxLength": 1000
              },
              "sha256": {
                "type": "string",
                "pattern": "^[0-9a-f]{64}$"
              },
              "size": {
                "type": "integer",
                "minimum": 0,
                "maximum": 2147483648
              },
              "policy": {
                "type": "string",
                "enum": [
                  "managed",
                  "preserve"
                ]
              },
              "executable": {
                "type": "boolean"
              },
              "optional": {
                "type": "boolean"
              }
            },
            "required": [
              "root",
              "path",
              "sha256",
              "size",
              "policy",
              "executable"
            ],
            "additionalProperties": false
          },
          "maxItems": 100000
        }
      },
      "required": [
        "format",
        "formatVersion",
        "release",
        "platform",
        "runtime",
        "environments",
        "launch",
        "mods",
        "files"
      ],
      "additionalProperties": false
    },
    {
      "type": "object",
      "properties": {
        "format": {
          "type": "string",
          "enum": [
            "mua-client-manifest"
          ]
        },
        "organizationId": {
          "type": "string",
          "format": "uuid"
        },
        "version": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "runtime": {
          "type": "object",
          "properties": {
            "minecraft": {
              "type": "string"
            },
            "java": {
              "type": "integer"
            }
          },
          "required": [
            "minecraft",
            "java"
          ],
          "additionalProperties": false
        },
        "mods": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "modDetails": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "path": {
                "type": "string"
              },
              "optional": {
                "type": "boolean"
              }
            },
            "required": [
              "path",
              "optional"
            ],
            "additionalProperties": false
          }
        },
        "summary": {
          "type": "string"
        },
        "description": {
          "type": "string"
        },
        "sourceSha256": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$"
        },
        "files": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "path": {
                "type": "string"
              },
              "sha256": {
                "type": "string",
                "pattern": "^[0-9a-f]{64}$"
              },
              "size": {
                "type": "integer",
                "minimum": 0
              },
              "policy": {
                "type": "string",
                "enum": [
                  "managed",
                  "preserve"
                ]
              },
              "optional": {
                "type": "boolean"
              }
            },
            "required": [
              "path",
              "sha256",
              "size",
              "policy"
            ],
            "additionalProperties": false
          }
        },
        "update": {
          "type": "object",
          "properties": {
            "previousVersion": {
              "type": [
                "string",
                "null"
              ]
            },
            "addedFiles": {
              "type": "integer",
              "minimum": 0
            },
            "modifiedFiles": {
              "type": "integer",
              "minimum": 0
            },
            "deletedFiles": {
              "type": "integer",
              "minimum": 0
            },
            "fullSize": {
              "type": "integer",
              "minimum": 0
            },
            "newDataSize": {
              "type": "integer",
              "minimum": 0
            },
            "estimatedDownloadSize": {
              "type": "integer",
              "minimum": 0
            },
            "casReusePercent": {
              "type": "number"
            },
            "fileCount": {
              "type": "integer",
              "minimum": 0
            },
            "sourceSize": {
              "type": "integer",
              "minimum": 0
            }
          },
          "required": [
            "previousVersion",
            "addedFiles",
            "modifiedFiles",
            "deletedFiles",
            "fullSize",
            "newDataSize",
            "estimatedDownloadSize",
            "casReusePercent",
            "fileCount",
            "sourceSize"
          ],
          "additionalProperties": false
        },
        "schemaVersion": {
          "type": "number",
          "enum": [
            2
          ]
        },
        "clientId": {
          "type": "string",
          "format": "uuid"
        }
      },
      "required": [
        "format",
        "organizationId",
        "version",
        "name",
        "runtime",
        "mods",
        "summary",
        "description",
        "sourceSha256",
        "files",
        "update",
        "schemaVersion",
        "clientId"
      ],
      "additionalProperties": false
    },
    {
      "type": "object",
      "properties": {
        "format": {
          "type": "string",
          "enum": [
            "mua-recipe-manifest"
          ]
        },
        "formatVersion": {
          "type": "number",
          "enum": [
            2
          ]
        },
        "release": {
          "type": "object",
          "properties": {
            "organizationId": {
              "type": "string",
              "format": "uuid"
            },
            "clientId": {
              "type": "string",
              "format": "uuid"
            },
            "releaseId": {
              "type": "string",
              "format": "uuid"
            },
            "version": {
              "type": "string",
              "minLength": 1,
              "maxLength": 200
            },
            "name": {
              "type": "string",
              "minLength": 1,
              "maxLength": 200
            },
            "summary": {
              "type": "string",
              "minLength": 1,
              "maxLength": 200
            },
            "description": {
              "type": "string",
              "maxLength": 20000
            },
            "sourceSha256": {
              "type": "string",
              "pattern": "^[0-9a-f]{64}$"
            },
            "contentRevision": {
              "type": "integer",
              "exclusiveMinimum": 0
            }
          },
          "required": [
            "organizationId",
            "clientId",
            "releaseId",
            "version",
            "name",
            "summary",
            "description",
            "sourceSha256",
            "contentRevision"
          ],
          "additionalProperties": false
        },
        "runtime": {
          "type": "object",
          "properties": {
            "minecraft": {
              "type": "string",
              "minLength": 1,
              "maxLength": 200
            },
            "loader": {
              "type": [
                "object",
                "null"
              ],
              "properties": {
                "type": {
                  "type": "string",
                  "enum": [
                    "fabric",
                    "quilt",
                    "forge",
                    "neoforge"
                  ]
                },
                "version": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 200
                }
              },
              "required": [
                "type",
                "version"
              ],
              "additionalProperties": false
            },
            "java": {
              "type": "object",
              "properties": {
                "major": {
                  "type": "integer",
                  "minimum": 7,
                  "maximum": 25
                },
                "vendor": {
                  "type": "string",
                  "enum": [
                    "adoptium"
                  ]
                },
                "imageType": {
                  "type": "string",
                  "enum": [
                    "jre",
                    "jdk"
                  ]
                }
              },
              "required": [
                "major",
                "vendor",
                "imageType"
              ],
              "additionalProperties": false
            },
            "resolverVersion": {
              "type": "string",
              "enum": [
                "mua-runtime-resolver-1"
              ]
            }
          },
          "required": [
            "minecraft",
            "loader",
            "java",
            "resolverVersion"
          ],
          "additionalProperties": false
        },
        "launch": {
          "type": "object",
          "properties": {
            "jvmArgs": {
              "type": "array",
              "items": {
                "type": "string",
                "maxLength": 4000
              },
              "maxItems": 256
            },
            "gameArgs": {
              "type": "array",
              "items": {
                "type": "string",
                "maxLength": 4000
              },
              "maxItems": 256
            },
            "memory": {
              "type": "object",
              "properties": {
                "mode": {
                  "type": "string",
                  "enum": [
                    "auto"
                  ]
                },
                "minimumMiB": {
                  "type": "integer",
                  "minimum": 256,
                  "maximum": 1048576
                },
                "recommendedMiB": {
                  "type": "integer",
                  "minimum": 256,
                  "maximum": 1048576
                }
              },
              "required": [
                "mode",
                "minimumMiB",
                "recommendedMiB"
              ],
              "additionalProperties": false
            },
            "preLaunch": {
              "type": "array",
              "items": {
                "oneOf": [
                  {
                    "type": "object",
                    "properties": {
                      "type": {
                        "type": "string",
                        "enum": [
                          "mkdir"
                        ]
                      },
                      "path": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 1000
                      }
                    },
                    "required": [
                      "type",
                      "path"
                    ],
                    "additionalProperties": false
                  },
                  {
                    "type": "object",
                    "properties": {
                      "type": {
                        "type": "string",
                        "enum": [
                          "copy"
                        ]
                      },
                      "from": {
                        "type": "object",
                        "properties": {
                          "root": {
                            "type": "string",
                            "enum": [
                              "instance"
                            ]
                          },
                          "path": {
                            "type": "string",
                            "minLength": 1,
                            "maxLength": 1000
                          }
                        },
                        "required": [
                          "root",
                          "path"
                        ],
                        "additionalProperties": false
                      },
                      "to": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 1000
                      },
                      "ifMissing": {
                        "type": "boolean",
                        "enum": [
                          true
                        ]
                      }
                    },
                    "required": [
                      "type",
                      "from",
                      "to",
                      "ifMissing"
                    ],
                    "additionalProperties": false
                  },
                  {
                    "type": "object",
                    "properties": {
                      "type": {
                        "type": "string",
                        "enum": [
                          "exec"
                        ]
                      },
                      "executable": {
                        "type": "object",
                        "properties": {
                          "root": {
                            "type": "string",
                            "enum": [
                              "instance"
                            ]
                          },
                          "path": {
                            "type": "string",
                            "minLength": 1,
                            "maxLength": 1000
                          }
                        },
                        "required": [
                          "root",
                          "path"
                        ],
                        "additionalProperties": false
                      },
                      "args": {
                        "type": "array",
                        "items": {
                          "type": "string",
                          "maxLength": 4000
                        },
                        "maxItems": 256
                      },
                      "workingDirectory": {
                        "type": [
                          "string",
                          "null"
                        ],
                        "minLength": 1,
                        "maxLength": 1000
                      },
                      "requiresConsent": {
                        "type": "boolean",
                        "enum": [
                          true
                        ]
                      },
                      "timeoutSeconds": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": 300
                      },
                      "onFailure": {
                        "type": "string",
                        "enum": [
                          "abort",
                          "continue"
                        ]
                      }
                    },
                    "required": [
                      "type",
                      "executable",
                      "args",
                      "workingDirectory",
                      "requiresConsent",
                      "timeoutSeconds",
                      "onFailure"
                    ],
                    "additionalProperties": false
                  }
                ]
              },
              "maxItems": 32
            }
          },
          "required": [
            "jvmArgs",
            "gameArgs",
            "memory",
            "preLaunch"
          ],
          "additionalProperties": false
        },
        "files": {
          "type": "array",
          "items": {
            "anyOf": [
              {
                "type": "object",
                "properties": {
                  "path": {
                    "type": "string"
                  },
                  "size": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 2147483648
                  },
                  "policy": {
                    "type": "string",
                    "enum": [
                      "managed",
                      "preserve"
                    ]
                  },
                  "optional": {
                    "type": "boolean"
                  },
                  "executable": {
                    "type": "boolean"
                  },
                  "hashes": {
                    "type": "object",
                    "properties": {
                      "sha256": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{64}$"
                      }
                    },
                    "required": [
                      "sha256"
                    ],
                    "additionalProperties": false
                  },
                  "source": {
                    "type": "object",
                    "properties": {
                      "type": {
                        "type": "string",
                        "enum": [
                          "local"
                        ]
                      },
                      "entry": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "type",
                      "entry"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "path",
                  "size",
                  "policy",
                  "optional",
                  "executable",
                  "hashes",
                  "source"
                ],
                "additionalProperties": false
              },
              {
                "type": "object",
                "properties": {
                  "path": {
                    "type": "string"
                  },
                  "size": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 2147483648
                  },
                  "policy": {
                    "type": "string",
                    "enum": [
                      "managed",
                      "preserve"
                    ]
                  },
                  "optional": {
                    "type": "boolean"
                  },
                  "executable": {
                    "type": "boolean"
                  },
                  "hashes": {
                    "type": "object",
                    "properties": {
                      "sha1": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{40}$"
                      },
                      "sha512": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{128}$"
                      },
                      "sha256": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{64}$"
                      }
                    },
                    "required": [
                      "sha1",
                      "sha512"
                    ],
                    "additionalProperties": false
                  },
                  "source": {
                    "type": "object",
                    "properties": {
                      "type": {
                        "type": "string",
                        "enum": [
                          "remote"
                        ]
                      },
                      "downloads": {
                        "type": "array",
                        "items": {
                          "type": "string",
                          "maxLength": 4000
                        },
                        "minItems": 1,
                        "maxItems": 10
                      }
                    },
                    "required": [
                      "type",
                      "downloads"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "path",
                  "size",
                  "policy",
                  "optional",
                  "executable",
                  "hashes",
                  "source"
                ],
                "additionalProperties": false
              }
            ]
          },
          "minItems": 1,
          "maxItems": 100000
        },
        "protocolRevision": {
          "type": "number",
          "enum": [
            2
          ]
        }
      },
      "required": [
        "format",
        "formatVersion",
        "release",
        "runtime",
        "launch",
        "files",
        "protocolRevision"
      ],
      "additionalProperties": false
    }
  ]
}
```

</details>

<a id="schema-inline-36"></a>

### reviewClientDraft 请求体

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `decision` | string | 是 | 可选值：`["approve","reject"]` |  |
| `note` | string | 是 | 最长长度：`5000` |  |
| `contentRevision` | integer | 是 | 最小值（不含）：`0` |  |
| `packageRevision` | integer | 是 | 最小值（不含）：`0` |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "decision": {
      "type": "string",
      "enum": [
        "approve",
        "reject"
      ]
    },
    "note": {
      "type": "string",
      "maxLength": 5000
    },
    "contentRevision": {
      "type": "integer",
      "exclusiveMinimum": 0
    },
    "packageRevision": {
      "type": "integer",
      "exclusiveMinimum": 0
    }
  },
  "required": [
    "decision",
    "note",
    "contentRevision",
    "packageRevision"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-37"></a>

### configureDraftPlatforms 请求体

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `platforms` | array：string | 是 | 最少元素：`1`<br>最多元素：`6` |  |
| `platforms[]` | string | 每个元素 | 可选值：`["windows-amd64","windows-aarch64","linux-amd64","linux-aarch64","macos-amd64","macos-aarch64"]` |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "platforms": {
      "type": "array",
      "items": {
        "type": "string",
        "enum": [
          "windows-amd64",
          "windows-aarch64",
          "linux-amd64",
          "linux-aarch64",
          "macos-amd64",
          "macos-aarch64"
        ]
      },
      "minItems": 1,
      "maxItems": 6
    }
  },
  "required": [
    "platforms"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-38"></a>

### archiveClientDraft 请求体

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `contentRevision` | integer | 是 | 最小值（不含）：`0` |  |
| `packageRevision` | integer | 是 | 最小值（不含）：`0` |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "contentRevision": {
      "type": "integer",
      "exclusiveMinimum": 0
    },
    "packageRevision": {
      "type": "integer",
      "exclusiveMinimum": 0
    }
  },
  "required": [
    "contentRevision",
    "packageRevision"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-39"></a>

### publishClientDraft 请求体

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `activate` | boolean | 是 |  |  |
| `replacesDraftId` | string / null (uuid) | 否 |  |  |
| `contentRevision` | integer | 是 | 最小值（不含）：`0` |  |
| `packageRevision` | integer | 是 | 最小值（不含）：`0` |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "activate": {
      "type": "boolean"
    },
    "replacesDraftId": {
      "type": [
        "string",
        "null"
      ],
      "format": "uuid"
    },
    "contentRevision": {
      "type": "integer",
      "exclusiveMinimum": 0
    },
    "packageRevision": {
      "type": "integer",
      "exclusiveMinimum": 0
    }
  },
  "required": [
    "activate",
    "contentRevision",
    "packageRevision"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-40"></a>

### activateClientRelease 请求体

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `publicationRevision` | integer | 是 | 最小值（含）：`0` |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "publicationRevision": {
      "type": "integer",
      "minimum": 0
    }
  },
  "required": [
    "publicationRevision"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-41"></a>

### getExecutionSettings 200 响应

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `mode` | string | 是 | 可选值：`["DOCKER_GVISOR","BARE"]` |  |
| `revision` | integer | 是 | 最小值（含）：`0` |  |
| `dockerAvailable` | boolean | 是 |  |  |
| `bareAvailable` | boolean | 是 |  |  |
| `workers` | array：object | 是 |  |  |
| `workers[]` | object | 每个元素 | 不接受额外字段 |  |
| `workers[].id` | string | 是 |  |  |
| `workers[].lastSeen` | string (date-time) | 是 |  |  |
| `workers[].fresh` | boolean | 是 |  |  |
| `workers[].status` | object / null | 是 | 不接受额外字段 |  |
| `workers[].status.sampledAt` | string (date-time) | 是 |  |  |
| `workers[].status.platform` | string | 是 |  |  |
| `workers[].status.architecture` | string | 是 |  |  |
| `workers[].status.docker` | object | 是 | 不接受额外字段 |  |
| `workers[].status.docker.installed` | boolean | 是 |  |  |
| `workers[].status.docker.connected` | boolean | 是 |  |  |
| `workers[].status.docker.version` | string / null | 是 |  |  |
| `workers[].status.docker.linux` | boolean | 是 |  |  |
| `workers[].status.gvisor` | object | 是 | 不接受额外字段 |  |
| `workers[].status.gvisor.registered` | boolean | 是 |  |  |
| `workers[].status.gvisor.verified` | boolean | 是 |  |  |
| `workers[].status.gvisor.imageConfigured` | boolean | 是 |  |  |
| `workers[].status.gvisor.ready` | boolean | 是 |  |  |
| `workers[].status.gvisor.reason` | string / null | 是 |  |  |
| `workers[].status.bare` | object | 是 | 不接受额外字段 |  |
| `workers[].status.bare.ready` | boolean | 是 |  |  |
| `workers[].status.bare.version` | string / null | 是 |  |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "mode": {
      "type": "string",
      "enum": [
        "DOCKER_GVISOR",
        "BARE"
      ]
    },
    "revision": {
      "type": "integer",
      "minimum": 0
    },
    "dockerAvailable": {
      "type": "boolean"
    },
    "bareAvailable": {
      "type": "boolean"
    },
    "workers": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "lastSeen": {
            "type": "string",
            "format": "date-time"
          },
          "fresh": {
            "type": "boolean"
          },
          "status": {
            "type": [
              "object",
              "null"
            ],
            "properties": {
              "sampledAt": {
                "type": "string",
                "format": "date-time"
              },
              "platform": {
                "type": "string"
              },
              "architecture": {
                "type": "string"
              },
              "docker": {
                "type": "object",
                "properties": {
                  "installed": {
                    "type": "boolean"
                  },
                  "connected": {
                    "type": "boolean"
                  },
                  "version": {
                    "type": [
                      "string",
                      "null"
                    ]
                  },
                  "linux": {
                    "type": "boolean"
                  }
                },
                "required": [
                  "installed",
                  "connected",
                  "version",
                  "linux"
                ],
                "additionalProperties": false
              },
              "gvisor": {
                "type": "object",
                "properties": {
                  "registered": {
                    "type": "boolean"
                  },
                  "verified": {
                    "type": "boolean"
                  },
                  "imageConfigured": {
                    "type": "boolean"
                  },
                  "ready": {
                    "type": "boolean"
                  },
                  "reason": {
                    "type": [
                      "string",
                      "null"
                    ]
                  }
                },
                "required": [
                  "registered",
                  "verified",
                  "imageConfigured",
                  "ready",
                  "reason"
                ],
                "additionalProperties": false
              },
              "bare": {
                "type": "object",
                "properties": {
                  "ready": {
                    "type": "boolean"
                  },
                  "version": {
                    "type": [
                      "string",
                      "null"
                    ]
                  }
                },
                "required": [
                  "ready",
                  "version"
                ],
                "additionalProperties": false
              }
            },
            "required": [
              "sampledAt",
              "platform",
              "architecture",
              "docker",
              "gvisor",
              "bare"
            ],
            "additionalProperties": false
          }
        },
        "required": [
          "id",
          "lastSeen",
          "fresh",
          "status"
        ],
        "additionalProperties": false
      }
    }
  },
  "required": [
    "mode",
    "revision",
    "dockerAvailable",
    "bareAvailable",
    "workers"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-42"></a>

### setExecutionSettings 请求体

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `mode` | string | 是 | 可选值：`["DOCKER_GVISOR","BARE"]` |  |
| `revision` | integer | 是 | 最小值（含）：`0` |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "mode": {
      "type": "string",
      "enum": [
        "DOCKER_GVISOR",
        "BARE"
      ]
    },
    "revision": {
      "type": "integer",
      "minimum": 0
    }
  },
  "required": [
    "mode",
    "revision"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-43"></a>

### getExecutionInstances 200 响应

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `runs` | array：object | 是 |  |  |
| `runs[]` | object | 每个元素 | 不接受额外字段 |  |
| `runs[].id` | string (uuid) | 是 |  |  |
| `runs[].workerId` | string | 是 |  |  |
| `runs[].daemonId` | string / null | 是 |  |  |
| `runs[].buildId` | string / null (uuid) | 是 |  |  |
| `runs[].mode` | string | 是 | 可选值：`["DOCKER_GVISOR","BARE"]` |  |
| `runs[].adapter` | string | 是 |  |  |
| `runs[].state` | string | 是 | 可选值：`["PREPARING","RUNNING","SUCCEEDED","FAILED","CANCELLED","INTERRUPTED","CLEANUP_FAILED"]` |  |
| `runs[].planSha256` | string | 是 |  |  |
| `runs[].image` | string | 是 |  |  |
| `runs[].architecture` | string | 是 |  |  |
| `runs[].limits` | object | 是 | 不接受额外字段 |  |
| `runs[].limits.cpus` | number / null | 是 |  |  |
| `runs[].limits.memoryMiB` | number / null | 是 |  |  |
| `runs[].limits.heapMiB` | number | 是 |  |  |
| `runs[].limits.workspaceMiB` | number / null | 是 |  |  |
| `runs[].limits.tmpMiB` | number / null | 是 |  |  |
| `runs[].limits.pids` | number / null | 是 |  |  |
| `runs[].limits.deadlineSeconds` | number | 是 |  |  |
| `runs[].limits.network` | string | 是 | 可选值：`["none","host"]` |  |
| `runs[].limits.readOnlyRoot` | boolean | 是 |  |  |
| `runs[].limits.runtime` | string | 是 | 可选值：`["runsc","host"]` |  |
| `runs[].containers` | array：object | 是 |  |  |
| `runs[].containers[]` | object | 每个元素 | 不接受额外字段 |  |
| `runs[].containers[].id` | string | 是 |  |  |
| `runs[].containers[].name` | string | 是 |  |  |
| `runs[].containers[].role` | string | 是 | 可选值：`["executor","input"]` |  |
| `runs[].containers[].state` | string | 是 | 可选值：`["CREATED","RUNNING","EXITED","REMOVED","UNKNOWN"]` |  |
| `runs[].containers[].createdAt` | string (date-time) | 是 |  |  |
| `runs[].error` | string / null | 是 |  |  |
| `runs[].startedAt` | string (date-time) | 是 |  |  |
| `runs[].updatedAt` | string (date-time) | 是 |  |  |
| `runs[].finishedAt` | string / null (date-time) | 是 |  |  |
| `limit` | number | 是 | 可选值：`[100]` |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "runs": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "workerId": {
            "type": "string"
          },
          "daemonId": {
            "type": [
              "string",
              "null"
            ]
          },
          "buildId": {
            "type": [
              "string",
              "null"
            ],
            "format": "uuid"
          },
          "mode": {
            "type": "string",
            "enum": [
              "DOCKER_GVISOR",
              "BARE"
            ]
          },
          "adapter": {
            "type": "string"
          },
          "state": {
            "type": "string",
            "enum": [
              "PREPARING",
              "RUNNING",
              "SUCCEEDED",
              "FAILED",
              "CANCELLED",
              "INTERRUPTED",
              "CLEANUP_FAILED"
            ]
          },
          "planSha256": {
            "type": "string"
          },
          "image": {
            "type": "string"
          },
          "architecture": {
            "type": "string"
          },
          "limits": {
            "type": "object",
            "properties": {
              "cpus": {
                "type": [
                  "number",
                  "null"
                ]
              },
              "memoryMiB": {
                "type": [
                  "number",
                  "null"
                ]
              },
              "heapMiB": {
                "type": "number"
              },
              "workspaceMiB": {
                "type": [
                  "number",
                  "null"
                ]
              },
              "tmpMiB": {
                "type": [
                  "number",
                  "null"
                ]
              },
              "pids": {
                "type": [
                  "number",
                  "null"
                ]
              },
              "deadlineSeconds": {
                "type": "number"
              },
              "network": {
                "type": "string",
                "enum": [
                  "none",
                  "host"
                ]
              },
              "readOnlyRoot": {
                "type": "boolean"
              },
              "runtime": {
                "type": "string",
                "enum": [
                  "runsc",
                  "host"
                ]
              }
            },
            "required": [
              "cpus",
              "memoryMiB",
              "heapMiB",
              "workspaceMiB",
              "tmpMiB",
              "pids",
              "deadlineSeconds",
              "network",
              "readOnlyRoot",
              "runtime"
            ],
            "additionalProperties": false
          },
          "containers": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "id": {
                  "type": "string"
                },
                "name": {
                  "type": "string"
                },
                "role": {
                  "type": "string",
                  "enum": [
                    "executor",
                    "input"
                  ]
                },
                "state": {
                  "type": "string",
                  "enum": [
                    "CREATED",
                    "RUNNING",
                    "EXITED",
                    "REMOVED",
                    "UNKNOWN"
                  ]
                },
                "createdAt": {
                  "type": "string",
                  "format": "date-time"
                }
              },
              "required": [
                "id",
                "name",
                "role",
                "state",
                "createdAt"
              ],
              "additionalProperties": false
            }
          },
          "error": {
            "type": [
              "string",
              "null"
            ]
          },
          "startedAt": {
            "type": "string",
            "format": "date-time"
          },
          "updatedAt": {
            "type": "string",
            "format": "date-time"
          },
          "finishedAt": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          }
        },
        "required": [
          "id",
          "workerId",
          "daemonId",
          "buildId",
          "mode",
          "adapter",
          "state",
          "planSha256",
          "image",
          "architecture",
          "limits",
          "containers",
          "error",
          "startedAt",
          "updatedAt",
          "finishedAt"
        ],
        "additionalProperties": false
      }
    },
    "limit": {
      "type": "number",
      "enum": [
        100
      ]
    }
  },
  "required": [
    "runs",
    "limit"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-44"></a>

### getStorageTelemetry 200 响应

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `provider` | string | 是 | 可选值：`["minio","aws","s3","ali","tencent","huawei"]` |  |
| `status` | string | 是 | 可选值：`["WAITING","READY","STALE","ERROR","DISABLED"]` |  |
| `collectedAt` | string / null (date-time) | 是 |  |  |
| `issue` | anyOf（2 个分支） | 是 |  |  |
| `issue.anyOf[1]` | string | 分支内适用 | 可选值：`["COLLECTION_FAILED","METRICS_UNAVAILABLE"]` |  |
| `issue.anyOf[2]` | null | 分支内适用 |  |  |
| `buckets` | array：object | 是 |  |  |
| `buckets[]` | object | 每个元素 | 不接受额外字段 |  |
| `buckets[].bucket` | string | 是 |  |  |
| `buckets[].roles` | array：string | 是 |  |  |
| `buckets[].roles[]` | string | 每个元素 | 可选值：`["PACKAGES","CAS","ENVIRONMENTS"]` |  |
| `buckets[].bytes` | string / null | 是 | 正则：`"^\\d+$"` |  |
| `buckets[].objects` | string / null | 是 | 正则：`"^\\d+$"` |  |
| `buckets[].observedAt` | string / null (date-time) | 是 |  |  |
| `buckets[].method` | string | 是 | 可选值：`["MINIO_METRICS","OBJECT_LIST"]` |  |
| `buckets[].status` | string | 是 | 可选值：`["READY","ERROR"]` |  |
| `capacityBytes` | string / null | 是 | 正则：`"^\\d+$"` |  |
| `objectCount` | string / null | 是 | 正则：`"^\\d+$"` |  |
| `traffic` | object | 是 | 不接受额外字段 |  |
| `traffic.supported` | boolean | 是 |  |  |
| `traffic.sentBytes` | string / null | 是 | 正则：`"^\\d+$"` |  |
| `traffic.receivedBytes` | string / null | 是 | 正则：`"^\\d+$"` |  |
| `traffic.startsAt` | string / null (date-time) | 是 |  |  |
| `traffic.endsAt` | string / null (date-time) | 是 |  |  |
| `traffic.samples` | integer | 是 | 最小值（含）：`0` |  |
| `traffic.hasGaps` | boolean | 是 |  |  |
| `history` | array：object | 是 |  |  |
| `history[]` | object | 每个元素 | 不接受额外字段 |  |
| `history[].hour` | string (date-time) | 是 |  |  |
| `history[].sentBytes` | string / null | 是 | 正则：`"^\\d+$"` |  |
| `history[].receivedBytes` | string / null | 是 | 正则：`"^\\d+$"` |  |
| `cdn` | string | 是 | 可选值：`["NOT_CONNECTED"]` |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "provider": {
      "type": "string",
      "enum": [
        "minio",
        "aws",
        "s3",
        "ali",
        "tencent",
        "huawei"
      ]
    },
    "status": {
      "type": "string",
      "enum": [
        "WAITING",
        "READY",
        "STALE",
        "ERROR",
        "DISABLED"
      ]
    },
    "collectedAt": {
      "type": [
        "string",
        "null"
      ],
      "format": "date-time"
    },
    "issue": {
      "anyOf": [
        {
          "type": "string",
          "enum": [
            "COLLECTION_FAILED",
            "METRICS_UNAVAILABLE"
          ]
        },
        {
          "type": "null"
        }
      ]
    },
    "buckets": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "bucket": {
            "type": "string"
          },
          "roles": {
            "type": "array",
            "items": {
              "type": "string",
              "enum": [
                "PACKAGES",
                "CAS",
                "ENVIRONMENTS"
              ]
            }
          },
          "bytes": {
            "type": [
              "string",
              "null"
            ],
            "pattern": "^\\d+$"
          },
          "objects": {
            "type": [
              "string",
              "null"
            ],
            "pattern": "^\\d+$"
          },
          "observedAt": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          },
          "method": {
            "type": "string",
            "enum": [
              "MINIO_METRICS",
              "OBJECT_LIST"
            ]
          },
          "status": {
            "type": "string",
            "enum": [
              "READY",
              "ERROR"
            ]
          }
        },
        "required": [
          "bucket",
          "roles",
          "bytes",
          "objects",
          "observedAt",
          "method",
          "status"
        ],
        "additionalProperties": false
      }
    },
    "capacityBytes": {
      "type": [
        "string",
        "null"
      ],
      "pattern": "^\\d+$"
    },
    "objectCount": {
      "type": [
        "string",
        "null"
      ],
      "pattern": "^\\d+$"
    },
    "traffic": {
      "type": "object",
      "properties": {
        "supported": {
          "type": "boolean"
        },
        "sentBytes": {
          "type": [
            "string",
            "null"
          ],
          "pattern": "^\\d+$"
        },
        "receivedBytes": {
          "type": [
            "string",
            "null"
          ],
          "pattern": "^\\d+$"
        },
        "startsAt": {
          "type": [
            "string",
            "null"
          ],
          "format": "date-time"
        },
        "endsAt": {
          "type": [
            "string",
            "null"
          ],
          "format": "date-time"
        },
        "samples": {
          "type": "integer",
          "minimum": 0
        },
        "hasGaps": {
          "type": "boolean"
        }
      },
      "required": [
        "supported",
        "sentBytes",
        "receivedBytes",
        "startsAt",
        "endsAt",
        "samples",
        "hasGaps"
      ],
      "additionalProperties": false
    },
    "history": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "hour": {
            "type": "string",
            "format": "date-time"
          },
          "sentBytes": {
            "type": [
              "string",
              "null"
            ],
            "pattern": "^\\d+$"
          },
          "receivedBytes": {
            "type": [
              "string",
              "null"
            ],
            "pattern": "^\\d+$"
          }
        },
        "required": [
          "hour",
          "sentBytes",
          "receivedBytes"
        ],
        "additionalProperties": false
      }
    },
    "cdn": {
      "type": "string",
      "enum": [
        "NOT_CONNECTED"
      ]
    }
  },
  "required": [
    "provider",
    "status",
    "collectedAt",
    "issue",
    "buckets",
    "capacityBytes",
    "objectCount",
    "traffic",
    "history",
    "cdn"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-45"></a>

### searchOrganizationAccounts 200 响应

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | array：object | — |  |  |
| `$[]` | object | 每个元素 | 不接受额外字段 |  |
| `$[].id` | string (uuid) | 是 |  |  |
| `$[].displayName` | string | 是 |  |  |
| `$[].status` | string | 是 | 可选值：`["ACTIVE","DISABLED"]` |  |
| `$[].isSuperAdmin` | boolean | 是 |  |  |
| `$[].username` | string | 是 |  |  |
| `$[].unionSubject` | string | 否 |  |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "array",
  "items": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "format": "uuid"
      },
      "displayName": {
        "type": "string"
      },
      "status": {
        "type": "string",
        "enum": [
          "ACTIVE",
          "DISABLED"
        ]
      },
      "isSuperAdmin": {
        "type": "boolean"
      },
      "username": {
        "type": "string"
      },
      "unionSubject": {
        "type": "string"
      }
    },
    "required": [
      "id",
      "displayName",
      "status",
      "isSuperAdmin",
      "username"
    ],
    "additionalProperties": false
  }
}
```

</details>

<a id="schema-inline-46"></a>

### listApiTokens 200 响应

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | array：object | — |  |  |
| `$[]` | object | 每个元素 | 不接受额外字段 |  |
| `$[].id` | string (uuid) | 是 |  |  |
| `$[].name` | string | 是 |  |  |
| `$[].permissions` | array：string | 是 |  |  |
| `$[].permissions[]` | string | 每个元素 | 可选值：`["SERVER_READ","SERVER_EDIT","DRAFT_READ","DRAFT_CREATE","DRAFT_EDIT","DRAFT_SUBMIT","DRAFT_ARCHIVE","RELEASE_READ","ORG_EDIT","ORG_MEMBERS_READ","ORG_MEMBERS_MANAGE","CLIENT_ARCHIVE","CLIENT_DELETE","CLIENT_BIND","DRAFT_REVIEW","RELEASE_PUBLISH","RELEASE_ACTIVATE"]` |  |
| `$[].serverIds` | array：string | 是 |  |  |
| `$[].serverIds[]` | string | 每个元素 | 正则：`"^[A-Za-z]{3,5}$"` |  |
| `$[].expiresAt` | string (date-time) | 是 |  |  |
| `$[].revokedAt` | string / null (date-time) | 是 |  |  |
| `$[].createdAt` | string (date-time) | 是 |  |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "array",
  "items": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "format": "uuid"
      },
      "name": {
        "type": "string"
      },
      "permissions": {
        "type": "array",
        "items": {
          "type": "string",
          "enum": [
            "SERVER_READ",
            "SERVER_EDIT",
            "DRAFT_READ",
            "DRAFT_CREATE",
            "DRAFT_EDIT",
            "DRAFT_SUBMIT",
            "DRAFT_ARCHIVE",
            "RELEASE_READ",
            "ORG_EDIT",
            "ORG_MEMBERS_READ",
            "ORG_MEMBERS_MANAGE",
            "CLIENT_ARCHIVE",
            "CLIENT_DELETE",
            "CLIENT_BIND",
            "DRAFT_REVIEW",
            "RELEASE_PUBLISH",
            "RELEASE_ACTIVATE"
          ]
        }
      },
      "serverIds": {
        "type": "array",
        "items": {
          "type": "string",
          "pattern": "^[A-Za-z]{3,5}$"
        }
      },
      "expiresAt": {
        "type": "string",
        "format": "date-time"
      },
      "revokedAt": {
        "type": [
          "string",
          "null"
        ],
        "format": "date-time"
      },
      "createdAt": {
        "type": "string",
        "format": "date-time"
      }
    },
    "required": [
      "id",
      "name",
      "permissions",
      "serverIds",
      "expiresAt",
      "revokedAt",
      "createdAt"
    ],
    "additionalProperties": false
  }
}
```

</details>

<a id="schema-inline-47"></a>

### createApiToken 请求体

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `name` | string | 是 | 最短长度：`1`<br>最长长度：`100` |  |
| `serverIds` | array：string | 是 | 最少元素：`1`<br>最多元素：`100` |  |
| `serverIds[]` | string | 每个元素 | 正则：`"^[A-Za-z]{3,5}$"` |  |
| `permissions` | array：string | 是 | 最少元素：`1`<br>最多元素：`20` |  |
| `permissions[]` | string | 每个元素 |  |  |
| `expiresInDays` | integer | 是 | 最小值（含）：`1`<br>最大值（含）：`90` |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "minLength": 1,
      "maxLength": 100
    },
    "serverIds": {
      "type": "array",
      "items": {
        "type": "string",
        "pattern": "^[A-Za-z]{3,5}$"
      },
      "minItems": 1,
      "maxItems": 100
    },
    "permissions": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "minItems": 1,
      "maxItems": 20
    },
    "expiresInDays": {
      "type": "integer",
      "minimum": 1,
      "maximum": 90
    }
  },
  "required": [
    "name",
    "serverIds",
    "permissions",
    "expiresInDays"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-48"></a>

### createOrganization 请求体

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `displayName` | string | 是 | 最短长度：`1`<br>最长长度：`200` |  |
| `description` | string | 否 | 最短长度：`0`<br>最长长度：`5000` |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "displayName": {
      "type": "string",
      "minLength": 1,
      "maxLength": 200
    },
    "description": {
      "type": "string",
      "minLength": 0,
      "maxLength": 5000
    }
  },
  "required": [
    "displayName"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-49"></a>

### createOrganization 201 响应

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `id` | string (uuid) | 是 |  |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "uuid"
    }
  },
  "required": [
    "id"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-50"></a>

### updateOrganization 请求体

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `displayName` | string | 否 | 最短长度：`1`<br>最长长度：`200` |  |
| `description` | string | 否 | 最短长度：`0`<br>最长长度：`5000` |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "displayName": {
      "type": "string",
      "minLength": 1,
      "maxLength": 200
    },
    "description": {
      "type": "string",
      "minLength": 0,
      "maxLength": 5000
    }
  },
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-51"></a>

### createServer 请求体

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `organizationId` | string (uuid) | 是 |  |  |
| `serverId` | string | 是 | 正则：`"^[A-Za-z]{3,5}$"` |  |
| `displayName` | string | 是 | 最短长度：`1`<br>最长长度：`200` |  |
| `description` | string | 否 | 最短长度：`0`<br>最长长度：`5000` |  |
| `gameAddress` | anyOf（3 个分支） | 否 |  |  |
| `gameAddress.anyOf[1]` | string | 分支内适用 | 最短长度：`1`<br>最长长度：`255` |  |
| `gameAddress.anyOf[2]` | string | 分支内适用 | 可选值：`[""]` |  |
| `gameAddress.anyOf[3]` | null | 分支内适用 |  |  |
| `displayMode` | string | 否 | 可选值：`["PERMANENT","RANGE"]` |  |
| `displayStartsAt` | string / null (date-time) | 否 |  |  |
| `displayEndsAt` | string / null (date-time) | 否 |  |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "organizationId": {
      "type": "string",
      "format": "uuid"
    },
    "serverId": {
      "type": "string",
      "pattern": "^[A-Za-z]{3,5}$"
    },
    "displayName": {
      "type": "string",
      "minLength": 1,
      "maxLength": 200
    },
    "description": {
      "type": "string",
      "minLength": 0,
      "maxLength": 5000
    },
    "gameAddress": {
      "anyOf": [
        {
          "type": "string",
          "minLength": 1,
          "maxLength": 255
        },
        {
          "type": "string",
          "enum": [
            ""
          ]
        },
        {
          "type": "null"
        }
      ]
    },
    "displayMode": {
      "type": "string",
      "enum": [
        "PERMANENT",
        "RANGE"
      ]
    },
    "displayStartsAt": {
      "type": [
        "string",
        "null"
      ],
      "format": "date-time"
    },
    "displayEndsAt": {
      "type": [
        "string",
        "null"
      ],
      "format": "date-time"
    }
  },
  "required": [
    "organizationId",
    "serverId",
    "displayName"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-52"></a>

### createServer 201 响应

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `serverId` | string | 是 | 正则：`"^[A-Za-z]{3,5}$"` |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "serverId": {
      "type": "string",
      "pattern": "^[A-Za-z]{3,5}$"
    }
  },
  "required": [
    "serverId"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-53"></a>

### updateServer 请求体

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `displayName` | string | 否 | 最短长度：`1`<br>最长长度：`200` |  |
| `description` | string | 否 | 最短长度：`0`<br>最长长度：`5000` |  |
| `gameAddress` | anyOf（3 个分支） | 否 |  |  |
| `gameAddress.anyOf[1]` | string | 分支内适用 | 最短长度：`1`<br>最长长度：`255` |  |
| `gameAddress.anyOf[2]` | string | 分支内适用 | 可选值：`[""]` |  |
| `gameAddress.anyOf[3]` | null | 分支内适用 |  |  |
| `sortOrder` | integer | 否 | 最小值（含）：`-2147483647`<br>最大值（含）：`2147483647` |  |
| `themeColor` | anyOf（3 个分支） | 否 |  |  |
| `themeColor.anyOf[1]` | string | 分支内适用 | 正则：`"^#[0-9a-f]{6}$"` |  |
| `themeColor.anyOf[2]` | string | 分支内适用 | 可选值：`[""]` |  |
| `themeColor.anyOf[3]` | null | 分支内适用 |  |  |
| `isListed` | boolean | 否 |  |  |
| `displayMode` | string | 否 | 可选值：`["PERMANENT","RANGE"]` |  |
| `displayStartsAt` | string / null (date-time) | 否 |  |  |
| `displayEndsAt` | string / null (date-time) | 否 |  |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "displayName": {
      "type": "string",
      "minLength": 1,
      "maxLength": 200
    },
    "description": {
      "type": "string",
      "minLength": 0,
      "maxLength": 5000
    },
    "gameAddress": {
      "anyOf": [
        {
          "type": "string",
          "minLength": 1,
          "maxLength": 255
        },
        {
          "type": "string",
          "enum": [
            ""
          ]
        },
        {
          "type": "null"
        }
      ]
    },
    "sortOrder": {
      "type": "integer",
      "minimum": -2147483647,
      "maximum": 2147483647
    },
    "themeColor": {
      "anyOf": [
        {
          "type": "string",
          "pattern": "^#[0-9a-f]{6}$"
        },
        {
          "type": "string",
          "enum": [
            ""
          ]
        },
        {
          "type": "null"
        }
      ]
    },
    "isListed": {
      "type": "boolean"
    },
    "displayMode": {
      "type": "string",
      "enum": [
        "PERMANENT",
        "RANGE"
      ]
    },
    "displayStartsAt": {
      "type": [
        "string",
        "null"
      ],
      "format": "date-time"
    },
    "displayEndsAt": {
      "type": [
        "string",
        "null"
      ],
      "format": "date-time"
    }
  },
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-54"></a>

### setOrganizationMember 请求体

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `roles` | array：string | 是 |  |  |
| `roles[]` | string | 每个元素 | 可选值：`["PLAYER","ORG_ADMIN","SERVER_ADMIN","CLIENT_EDITOR","SERVER_EDITOR","REVIEWER","PUBLISHER","RELEASE_OPERATOR","READ_ONLY"]` |  |
| `status` | string | 是 | 可选值：`["ACTIVE","DISABLED"]` |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "roles": {
      "type": "array",
      "items": {
        "type": "string",
        "enum": [
          "PLAYER",
          "ORG_ADMIN",
          "SERVER_ADMIN",
          "CLIENT_EDITOR",
          "SERVER_EDITOR",
          "REVIEWER",
          "PUBLISHER",
          "RELEASE_OPERATOR",
          "READ_ONLY"
        ]
      }
    },
    "status": {
      "type": "string",
      "enum": [
        "ACTIVE",
        "DISABLED"
      ]
    }
  },
  "required": [
    "roles",
    "status"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-55"></a>

### setServerGrant 请求体

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `roles` | array：string | 是 |  |  |
| `roles[]` | string | 每个元素 | 可选值：`["SERVER_ADMIN","CLIENT_EDITOR","SERVER_EDITOR","REVIEWER","PUBLISHER","RELEASE_OPERATOR","READ_ONLY"]` |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "roles": {
      "type": "array",
      "items": {
        "type": "string",
        "enum": [
          "SERVER_ADMIN",
          "CLIENT_EDITOR",
          "SERVER_EDITOR",
          "REVIEWER",
          "PUBLISHER",
          "RELEASE_OPERATOR",
          "READ_ONLY"
        ]
      }
    }
  },
  "required": [
    "roles"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-56"></a>

### createAccount 请求体

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `displayName` | string | 是 | 最短长度：`1`<br>最长长度：`200` |  |
| `username` | string | 是 | 最短长度：`3`<br>最长长度：`64`<br>正则：`"^[a-z0-9_.-]{3,64}$"` |  |
| `password` | string (password) | 是 | 最短长度：`12`<br>最长长度：`128`<br>只写：`true` |  |
| `isSuperAdmin` | boolean | 否 |  |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "displayName": {
      "type": "string",
      "minLength": 1,
      "maxLength": 200
    },
    "username": {
      "type": "string",
      "minLength": 3,
      "maxLength": 64,
      "pattern": "^[a-z0-9_.-]{3,64}$"
    },
    "password": {
      "type": "string",
      "minLength": 12,
      "maxLength": 128,
      "format": "password",
      "writeOnly": true
    },
    "isSuperAdmin": {
      "type": "boolean"
    }
  },
  "required": [
    "displayName",
    "username",
    "password"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-57"></a>

### updateAccount 请求体

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `displayName` | string | 否 | 最短长度：`1`<br>最长长度：`200` |  |
| `status` | string | 否 | 可选值：`["ACTIVE","DISABLED"]` |  |
| `isSuperAdmin` | boolean | 否 |  |  |
| `password` | string (password) | 否 | 最短长度：`12`<br>最长长度：`128`<br>只写：`true` |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "displayName": {
      "type": "string",
      "minLength": 1,
      "maxLength": 200
    },
    "status": {
      "type": "string",
      "enum": [
        "ACTIVE",
        "DISABLED"
      ]
    },
    "isSuperAdmin": {
      "type": "boolean"
    },
    "password": {
      "type": "string",
      "minLength": 12,
      "maxLength": 128,
      "format": "password",
      "writeOnly": true
    }
  },
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-58"></a>

### revokeAccountCredentials 请求体

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-59"></a>

### revokeAccountCredentials 200 响应

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `ok` | boolean | 是 | 可选值：`[true]` |  |
| `sessions` | integer | 是 | 最小值（含）：`0` |  |
| `apiTokens` | integer | 是 | 最小值（含）：`0` |  |
| `launcherApprovals` | integer | 是 | 最小值（含）：`0` |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "ok": {
      "type": "boolean",
      "enum": [
        true
      ]
    },
    "sessions": {
      "type": "integer",
      "minimum": 0
    },
    "apiTokens": {
      "type": "integer",
      "minimum": 0
    },
    "launcherApprovals": {
      "type": "integer",
      "minimum": 0
    }
  },
  "required": [
    "ok",
    "sessions",
    "apiTokens",
    "launcherApprovals"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-60"></a>

### getRecycleSettings 200 响应

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `recycleRetentionDays` | integer | 是 | 最小值（含）：`1`<br>最大值（含）：`365` |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "recycleRetentionDays": {
      "type": "integer",
      "minimum": 1,
      "maximum": 365
    }
  },
  "required": [
    "recycleRetentionDays"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-61"></a>

### getUploadSizeSettings 200 响应

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `maxUploadSizeMb` | integer | 是 | 最小值（含）：`1`<br>最大值（含）：`20480` |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "maxUploadSizeMb": {
      "type": "integer",
      "minimum": 1,
      "maximum": 20480
    }
  },
  "required": [
    "maxUploadSizeMb"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-62"></a>

### getPackageFormatSettings 200 响应

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `enabledPackageFormats` | array：anyOf（2 个分支） | 是 | 最少元素：`1`<br>最多元素：`2` |  |
| `enabledPackageFormats[]` | anyOf（2 个分支） | 每个元素 |  |  |
| `enabledPackageFormats[].anyOf[1]` | number | 分支内适用 | 可选值：`[1]` |  |
| `enabledPackageFormats[].anyOf[2]` | number | 分支内适用 | 可选值：`[2]` |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "enabledPackageFormats": {
      "type": "array",
      "items": {
        "anyOf": [
          {
            "type": "number",
            "enum": [
              1
            ]
          },
          {
            "type": "number",
            "enum": [
              2
            ]
          }
        ]
      },
      "minItems": 1,
      "maxItems": 2
    }
  },
  "required": [
    "enabledPackageFormats"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-63"></a>

### getDownloadSettings 200 响应

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `remoteSourceWhitelistEnabled` | boolean | 是 |  |  |
| `remoteSourceHosts` | array：string | 是 | 最多元素：`100` |  |
| `remoteSourceHosts[]` | string | 每个元素 | 最长长度：`253`<br>正则：`"^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$"` |  |
| `downloadProxyEnabled` | boolean | 是 |  |  |
| `downloadProxyUrl` | string | 是 | 最长长度：`2000` |  |
| `minecraftDownloadSources` | array：string | 是 | 最多元素：`3` |  |
| `minecraftDownloadSources[]` | string | 每个元素 | 可选值：`["bmclapi","ustc","nju"]` |  |
| `javaDownloadSources` | array：string | 是 | 最多元素：`1` |  |
| `javaDownloadSources[]` | string | 每个元素 | 可选值：`["tuna"]` |  |
| `mirrorProxyEnabled` | boolean | 是 |  |  |
| `javaImageType` | string | 是 | 可选值：`["jre","jdk"]` |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "remoteSourceWhitelistEnabled": {
      "type": "boolean"
    },
    "remoteSourceHosts": {
      "type": "array",
      "items": {
        "type": "string",
        "maxLength": 253,
        "pattern": "^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$"
      },
      "maxItems": 100
    },
    "downloadProxyEnabled": {
      "type": "boolean"
    },
    "downloadProxyUrl": {
      "type": "string",
      "maxLength": 2000
    },
    "minecraftDownloadSources": {
      "type": "array",
      "items": {
        "type": "string",
        "enum": [
          "bmclapi",
          "ustc",
          "nju"
        ]
      },
      "maxItems": 3
    },
    "javaDownloadSources": {
      "type": "array",
      "items": {
        "type": "string",
        "enum": [
          "tuna"
        ]
      },
      "maxItems": 1
    },
    "mirrorProxyEnabled": {
      "type": "boolean"
    },
    "javaImageType": {
      "type": "string",
      "enum": [
        "jre",
        "jdk"
      ]
    }
  },
  "required": [
    "remoteSourceWhitelistEnabled",
    "remoteSourceHosts",
    "downloadProxyEnabled",
    "downloadProxyUrl",
    "minecraftDownloadSources",
    "javaDownloadSources",
    "mirrorProxyEnabled",
    "javaImageType"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-64"></a>

### setDownloadSettings 请求体

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `remoteSourceWhitelistEnabled` | boolean | 是 |  |  |
| `remoteSourceHosts` | array：string | 是 | 最多元素：`100` |  |
| `remoteSourceHosts[]` | string | 每个元素 | 最长长度：`253`<br>正则：`"^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$"` |  |
| `downloadProxyEnabled` | boolean | 是 |  |  |
| `downloadProxyUrl` | string | 是 | 最长长度：`2000` |  |
| `minecraftDownloadSources` | array：string | 否 | 最多元素：`3` |  |
| `minecraftDownloadSources[]` | string | 每个元素 | 可选值：`["bmclapi","ustc","nju"]` |  |
| `javaDownloadSources` | array：string | 否 | 最多元素：`1` |  |
| `javaDownloadSources[]` | string | 每个元素 | 可选值：`["tuna"]` |  |
| `mirrorProxyEnabled` | boolean | 否 |  |  |
| `javaImageType` | string | 否 | 可选值：`["jre","jdk"]` |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "remoteSourceWhitelistEnabled": {
      "type": "boolean"
    },
    "remoteSourceHosts": {
      "type": "array",
      "items": {
        "type": "string",
        "maxLength": 253,
        "pattern": "^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$"
      },
      "maxItems": 100
    },
    "downloadProxyEnabled": {
      "type": "boolean"
    },
    "downloadProxyUrl": {
      "type": "string",
      "maxLength": 2000
    },
    "minecraftDownloadSources": {
      "type": "array",
      "items": {
        "type": "string",
        "enum": [
          "bmclapi",
          "ustc",
          "nju"
        ]
      },
      "maxItems": 3
    },
    "javaDownloadSources": {
      "type": "array",
      "items": {
        "type": "string",
        "enum": [
          "tuna"
        ]
      },
      "maxItems": 1
    },
    "mirrorProxyEnabled": {
      "type": "boolean"
    },
    "javaImageType": {
      "type": "string",
      "enum": [
        "jre",
        "jdk"
      ]
    }
  },
  "required": [
    "remoteSourceWhitelistEnabled",
    "remoteSourceHosts",
    "downloadProxyEnabled",
    "downloadProxyUrl"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-65"></a>

### getServerMotto 200 响应

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | string (binary) | — |  |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "string",
  "format": "binary"
}
```

</details>

<a id="schema-inline-66"></a>

### uploadServerMotto 请求体

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `source` | string (binary) | 否 |  |  |
| `crop` | string | 是 | 规范示例：`"{\"left\":0,\"top\":0,\"width\":1,\"height\":0.648936170212766}"` | JSON 编码选区文本：left、top、width、height 为 0–1 的比例，宽高必须大于 0。 |
| `expectedIconObjectKey` | string | 是 | 规范示例：`"null"` | JSON 编码的当前对象键，首次上传填写文本 null。 |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "source": {
      "type": "string",
      "format": "binary"
    },
    "crop": {
      "type": "string",
      "description": "JSON 编码选区文本：left、top、width、height 为 0–1 的比例，宽高必须大于 0。",
      "example": "{\"left\":0,\"top\":0,\"width\":1,\"height\":0.648936170212766}"
    },
    "expectedIconObjectKey": {
      "type": "string",
      "description": "JSON 编码的当前对象键，首次上传填写文本 null。",
      "example": "null"
    }
  },
  "required": [
    "crop",
    "expectedIconObjectKey"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-67"></a>

### uploadServerMotto 200 响应

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `ok` | boolean | 是 | 可选值：`[true]` |  |
| `iconObjectKey` | string / null | 是 |  |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "ok": {
      "type": "boolean",
      "enum": [
        true
      ]
    },
    "iconObjectKey": {
      "type": [
        "string",
        "null"
      ]
    }
  },
  "required": [
    "ok",
    "iconObjectKey"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-68"></a>

### removeServerMotto 请求体

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `expectedIconObjectKey` | string / null | 是 | 最长长度：`500` |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "expectedIconObjectKey": {
      "type": [
        "string",
        "null"
      ],
      "maxLength": 500
    }
  },
  "required": [
    "expectedIconObjectKey"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-69"></a>

### listLauncherProvidersAdmin 200 响应

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | array：object | — |  |  |
| `$[]` | object | 每个元素 | 不接受额外字段 |  |
| `$[].id` | string (uuid) | 是 |  |  |
| `$[].siteCode` | string | 是 |  |  |
| `$[].displayName` | string | 是 |  |  |
| `$[].bsRoot` | string (uri) | 是 |  |  |
| `$[].authApiRoot` | string (uri) | 是 |  |  |
| `$[].revision` | integer | 是 |  |  |
| `$[].siteRevision` | integer | 是 |  |  |
| `$[].enabled` | boolean | 是 |  |  |
| `$[].adapter` | string | 是 | 可选值：`["MUA_YGGC_ONLINE_V1"]` |  |
| `$[].verificationNote` | string | 是 |  |  |
| `$[].verifiedById` | string (uuid) | 是 |  |  |
| `$[].verifiedAt` | string (date-time) | 是 |  |  |
| `$[].updatedAt` | string (date-time) | 是 |  |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "array",
  "items": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "format": "uuid"
      },
      "siteCode": {
        "type": "string"
      },
      "displayName": {
        "type": "string"
      },
      "bsRoot": {
        "type": "string",
        "format": "uri"
      },
      "authApiRoot": {
        "type": "string",
        "format": "uri"
      },
      "revision": {
        "type": "integer"
      },
      "siteRevision": {
        "type": "integer"
      },
      "enabled": {
        "type": "boolean"
      },
      "adapter": {
        "type": "string",
        "enum": [
          "MUA_YGGC_ONLINE_V1"
        ]
      },
      "verificationNote": {
        "type": "string"
      },
      "verifiedById": {
        "type": "string",
        "format": "uuid"
      },
      "verifiedAt": {
        "type": "string",
        "format": "date-time"
      },
      "updatedAt": {
        "type": "string",
        "format": "date-time"
      }
    },
    "required": [
      "id",
      "siteCode",
      "displayName",
      "bsRoot",
      "authApiRoot",
      "revision",
      "siteRevision",
      "enabled",
      "adapter",
      "verificationNote",
      "verifiedById",
      "verifiedAt",
      "updatedAt"
    ],
    "additionalProperties": false
  }
}
```

</details>

<a id="schema-inline-70"></a>

### saveLauncherProvider 请求体

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `id` | string (uuid) | 是 |  |  |
| `revision` | integer | 是 | 最小值（含）：`0` |  |
| `siteCode` | string | 是 | 正则：`"^[A-Z][A-Z0-9]{0,5}$"` |  |
| `displayName` | string | 是 | 最短长度：`1`<br>最长长度：`100` |  |
| `bsRoot` | string (uri) | 是 | 最长长度：`2048` |  |
| `enabled` | boolean | 是 |  |  |
| `adapter` | string | 是 | 可选值：`["MUA_YGGC_ONLINE_V1"]` |  |
| `verificationNote` | string | 是 | 最短长度：`10`<br>最长长度：`1000` |  |
| `confirmUidMapping` | boolean | 是 | 可选值：`[true]` |  |
| `confirmCredentialLogRedaction` | boolean | 是 | 可选值：`[true]` |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "uuid"
    },
    "revision": {
      "type": "integer",
      "minimum": 0
    },
    "siteCode": {
      "type": "string",
      "pattern": "^[A-Z][A-Z0-9]{0,5}$"
    },
    "displayName": {
      "type": "string",
      "minLength": 1,
      "maxLength": 100
    },
    "bsRoot": {
      "type": "string",
      "maxLength": 2048,
      "format": "uri"
    },
    "enabled": {
      "type": "boolean"
    },
    "adapter": {
      "type": "string",
      "enum": [
        "MUA_YGGC_ONLINE_V1"
      ]
    },
    "verificationNote": {
      "type": "string",
      "minLength": 10,
      "maxLength": 1000
    },
    "confirmUidMapping": {
      "type": "boolean",
      "enum": [
        true
      ]
    },
    "confirmCredentialLogRedaction": {
      "type": "boolean",
      "enum": [
        true
      ]
    }
  },
  "required": [
    "id",
    "revision",
    "siteCode",
    "displayName",
    "bsRoot",
    "enabled",
    "adapter",
    "verificationNote",
    "confirmUidMapping",
    "confirmCredentialLogRedaction"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-71"></a>

### saveLauncherProvider 200 响应

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `id` | string (uuid) | 是 |  |  |
| `siteCode` | string | 是 |  |  |
| `displayName` | string | 是 |  |  |
| `bsRoot` | string (uri) | 是 |  |  |
| `authApiRoot` | string (uri) | 是 |  |  |
| `revision` | integer | 是 |  |  |
| `siteRevision` | integer | 是 |  |  |
| `enabled` | boolean | 是 |  |  |
| `adapter` | string | 是 | 可选值：`["MUA_YGGC_ONLINE_V1"]` |  |
| `verificationNote` | string | 是 |  |  |
| `verifiedById` | string (uuid) | 是 |  |  |
| `verifiedAt` | string (date-time) | 是 |  |  |
| `updatedAt` | string (date-time) | 是 |  |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "uuid"
    },
    "siteCode": {
      "type": "string"
    },
    "displayName": {
      "type": "string"
    },
    "bsRoot": {
      "type": "string",
      "format": "uri"
    },
    "authApiRoot": {
      "type": "string",
      "format": "uri"
    },
    "revision": {
      "type": "integer"
    },
    "siteRevision": {
      "type": "integer"
    },
    "enabled": {
      "type": "boolean"
    },
    "adapter": {
      "type": "string",
      "enum": [
        "MUA_YGGC_ONLINE_V1"
      ]
    },
    "verificationNote": {
      "type": "string"
    },
    "verifiedById": {
      "type": "string",
      "format": "uuid"
    },
    "verifiedAt": {
      "type": "string",
      "format": "date-time"
    },
    "updatedAt": {
      "type": "string",
      "format": "date-time"
    }
  },
  "required": [
    "id",
    "siteCode",
    "displayName",
    "bsRoot",
    "authApiRoot",
    "revision",
    "siteRevision",
    "enabled",
    "adapter",
    "verificationNote",
    "verifiedById",
    "verifiedAt",
    "updatedAt"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-72"></a>

### getUnionSync 200 响应

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `status` | string | 是 | 可选值：`["WAITING","RUNNING","SYNCED","PARTIAL","ERROR","STALE"]` |  |
| `endpoint` | string | 是 | 可选值：`["https://skin.mualliance.ltd/api/union"]` |  |
| `intervalSeconds` | number | 是 | 可选值：`[60]` |  |
| `attemptedAt` | string / null | 是 |  |  |
| `syncedAt` | string / null | 是 |  |  |
| `nextSyncAt` | string / null | 是 |  |  |
| `upstreamVersion` | string / null | 是 |  |  |
| `receivedCount` | integer | 是 |  |  |
| `syncedCount` | integer | 是 |  |  |
| `createdCount` | integer | 是 |  |  |
| `error` | string / null | 是 |  |  |
| `issues` | array：object | 是 |  |  |
| `issues[]` | object | 每个元素 | 不接受额外字段 |  |
| `issues[].code` | string | 是 |  |  |
| `issues[].issue` | string | 是 |  |  |
| `avatars` | object | 是 | 不接受额外字段 |  |
| `avatars.imported` | integer | 是 |  |  |
| `avatars.pending` | integer | 是 |  |  |
| `avatars.failed` | integer | 是 |  |  |
| `avatars.manual` | integer | 是 |  |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string",
      "enum": [
        "WAITING",
        "RUNNING",
        "SYNCED",
        "PARTIAL",
        "ERROR",
        "STALE"
      ]
    },
    "endpoint": {
      "type": "string",
      "enum": [
        "https://skin.mualliance.ltd/api/union"
      ]
    },
    "intervalSeconds": {
      "type": "number",
      "enum": [
        60
      ]
    },
    "attemptedAt": {
      "type": [
        "string",
        "null"
      ]
    },
    "syncedAt": {
      "type": [
        "string",
        "null"
      ]
    },
    "nextSyncAt": {
      "type": [
        "string",
        "null"
      ]
    },
    "upstreamVersion": {
      "type": [
        "string",
        "null"
      ]
    },
    "receivedCount": {
      "type": "integer"
    },
    "syncedCount": {
      "type": "integer"
    },
    "createdCount": {
      "type": "integer"
    },
    "error": {
      "type": [
        "string",
        "null"
      ]
    },
    "issues": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "code": {
            "type": "string"
          },
          "issue": {
            "type": "string"
          }
        },
        "required": [
          "code",
          "issue"
        ],
        "additionalProperties": false
      }
    },
    "avatars": {
      "type": "object",
      "properties": {
        "imported": {
          "type": "integer"
        },
        "pending": {
          "type": "integer"
        },
        "failed": {
          "type": "integer"
        },
        "manual": {
          "type": "integer"
        }
      },
      "required": [
        "imported",
        "pending",
        "failed",
        "manual"
      ],
      "additionalProperties": false
    }
  },
  "required": [
    "status",
    "endpoint",
    "intervalSeconds",
    "attemptedAt",
    "syncedAt",
    "nextSyncAt",
    "upstreamVersion",
    "receivedCount",
    "syncedCount",
    "createdCount",
    "error",
    "issues",
    "avatars"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-73"></a>

### requestUnionSync 200 响应

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — |  |  |
| `ok` | boolean | 是 | 可选值：`[true]` |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "ok": {
      "type": "boolean",
      "enum": [
        true
      ]
    }
  },
  "required": [
    "ok"
  ]
}
```

</details>

<a id="schema-inline-74"></a>

### getOrganizationAvatar 200 响应

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `revision` | integer | 是 | 最小值（含）：`0` |  |
| `mode` | string | 是 | 可选值：`["AUTO","MANUAL"]` |  |
| `metadata` | object / null | 是 | 不接受额外字段 |  |
| `metadata.version` | number | 是 | 可选值：`[1]` |  |
| `metadata.width` | integer | 是 | 最小值（不含）：`0` |  |
| `metadata.height` | integer | 是 | 最小值（不含）：`0` |  |
| `metadata.crop` | object | 是 | 不接受额外字段 |  |
| `metadata.crop.left` | number | 是 | 最小值（含）：`0`<br>最大值（含）：`1` |  |
| `metadata.crop.top` | number | 是 | 最小值（含）：`0`<br>最大值（含）：`1` |  |
| `metadata.crop.width` | number | 是 | 最大值（含）：`1`<br>最小值（不含）：`0` |  |
| `metadata.crop.height` | number | 是 | 最大值（含）：`1`<br>最小值（不含）：`0` |  |
| `metadata.sourceSha256` | string | 是 | 正则：`"^[a-f0-9]{64}$"` |  |
| `metadata.imageSha256` | string | 是 | 正则：`"^[a-f0-9]{64}$"` |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "revision": {
      "type": "integer",
      "minimum": 0
    },
    "mode": {
      "type": "string",
      "enum": [
        "AUTO",
        "MANUAL"
      ]
    },
    "metadata": {
      "type": [
        "object",
        "null"
      ],
      "properties": {
        "version": {
          "type": "number",
          "enum": [
            1
          ]
        },
        "width": {
          "type": "integer",
          "exclusiveMinimum": 0
        },
        "height": {
          "type": "integer",
          "exclusiveMinimum": 0
        },
        "crop": {
          "type": "object",
          "properties": {
            "left": {
              "type": "number",
              "minimum": 0,
              "maximum": 1
            },
            "top": {
              "type": "number",
              "minimum": 0,
              "maximum": 1
            },
            "width": {
              "type": "number",
              "exclusiveMinimum": 0,
              "maximum": 1
            },
            "height": {
              "type": "number",
              "exclusiveMinimum": 0,
              "maximum": 1
            }
          },
          "required": [
            "left",
            "top",
            "width",
            "height"
          ],
          "additionalProperties": false
        },
        "sourceSha256": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        },
        "imageSha256": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        }
      },
      "required": [
        "version",
        "width",
        "height",
        "crop",
        "sourceSha256",
        "imageSha256"
      ],
      "additionalProperties": false
    }
  },
  "required": [
    "revision",
    "mode",
    "metadata"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-75"></a>

### uploadOrganizationAvatar 请求体

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `source` | string (binary) | 否 |  |  |
| `crop` | string | 是 |  |  |
| `expectedRevision` | string | 是 | 正则：`"^\\d+$"` |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "source": {
      "type": "string",
      "format": "binary"
    },
    "crop": {
      "type": "string"
    },
    "expectedRevision": {
      "type": "string",
      "pattern": "^\\d+$"
    }
  },
  "required": [
    "crop",
    "expectedRevision"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-76"></a>

### uploadOrganizationAvatar 200 响应

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `ok` | boolean | 是 | 可选值：`[true]` |  |
| `revision` | integer | 是 |  |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "ok": {
      "type": "boolean",
      "enum": [
        true
      ]
    },
    "revision": {
      "type": "integer"
    }
  },
  "required": [
    "ok",
    "revision"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-77"></a>

### removeOrganizationAvatar 请求体

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `expectedRevision` | integer | 是 | 最小值（含）：`0` |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "expectedRevision": {
      "type": "integer",
      "minimum": 0
    }
  },
  "required": [
    "expectedRevision"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-78"></a>

### listUnionSites 200 响应

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | array：object | — |  |  |
| `$[]` | object | 每个元素 | 不接受额外字段 |  |
| `$[].code` | string | 是 | 正则：`"^[A-Z][A-Z0-9]{0,5}$"` |  |
| `$[].organizationId` | string (uuid) | 是 |  |  |
| `$[].bsRoot` | string (uri) | 是 |  |  |
| `$[].enabled` | boolean | 是 |  |  |
| `$[].revision` | integer | 是 |  |  |
| `$[].updatedAt` | string (date-time) | 是 |  |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "array",
  "items": {
    "type": "object",
    "properties": {
      "code": {
        "type": "string",
        "pattern": "^[A-Z][A-Z0-9]{0,5}$"
      },
      "organizationId": {
        "type": "string",
        "format": "uuid"
      },
      "bsRoot": {
        "type": "string",
        "format": "uri"
      },
      "enabled": {
        "type": "boolean"
      },
      "revision": {
        "type": "integer"
      },
      "updatedAt": {
        "type": "string",
        "format": "date-time"
      }
    },
    "required": [
      "code",
      "organizationId",
      "bsRoot",
      "enabled",
      "revision",
      "updatedAt"
    ],
    "additionalProperties": false
  }
}
```

</details>

<a id="schema-inline-79"></a>

### saveUnionSite 请求体

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `code` | string | 是 | 正则：`"^[A-Z][A-Z0-9]{0,5}$"` |  |
| `organizationId` | string (uuid) | 是 |  |  |
| `bsRoot` | string (uri) | 是 |  |  |
| `enabled` | boolean | 是 |  |  |
| `revision` | integer | 是 | 最小值（含）：`0` |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "code": {
      "type": "string",
      "pattern": "^[A-Z][A-Z0-9]{0,5}$"
    },
    "organizationId": {
      "type": "string",
      "format": "uuid"
    },
    "bsRoot": {
      "type": "string",
      "format": "uri"
    },
    "enabled": {
      "type": "boolean"
    },
    "revision": {
      "type": "integer",
      "minimum": 0
    }
  },
  "required": [
    "code",
    "organizationId",
    "bsRoot",
    "enabled",
    "revision"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-80"></a>

### saveUnionSite 200 响应

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `code` | string | 是 | 正则：`"^[A-Z][A-Z0-9]{0,5}$"` |  |
| `organizationId` | string (uuid) | 是 |  |  |
| `bsRoot` | string (uri) | 是 |  |  |
| `enabled` | boolean | 是 |  |  |
| `revision` | integer | 是 | 最小值（含）：`0` |  |
| `updatedAt` | string (date-time) | 是 |  |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "code": {
      "type": "string",
      "pattern": "^[A-Z][A-Z0-9]{0,5}$"
    },
    "organizationId": {
      "type": "string",
      "format": "uuid"
    },
    "bsRoot": {
      "type": "string",
      "format": "uri"
    },
    "enabled": {
      "type": "boolean"
    },
    "revision": {
      "type": "integer",
      "minimum": 0
    },
    "updatedAt": {
      "type": "string",
      "format": "date-time"
    }
  },
  "required": [
    "code",
    "organizationId",
    "bsRoot",
    "enabled",
    "revision",
    "updatedAt"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-81"></a>

### getAccessCandidates 200 响应

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | anyOf（2 个分支） | — |  |  |
| `$.anyOf[1]` | array：object | 分支内适用 |  |  |
| `$.anyOf[1][]` | object | 每个元素 | 不接受额外字段 |  |
| `$.anyOf[1][].id` | string (uuid) | 是 |  |  |
| `$.anyOf[1][].displayName` | string | 是 |  |  |
| `$.anyOf[2]` | array：anyOf（2 个分支） | 分支内适用 |  |  |
| `$.anyOf[2][]` | anyOf（2 个分支） | 每个元素 |  |  |
| `$.anyOf[2][].anyOf[1]` | object | 分支内适用 | 不接受额外字段 |  |
| `$.anyOf[2][].anyOf[1].serverId` | string | 是 | 正则：`"^[A-Za-z]{3,5}$"` |  |
| `$.anyOf[2][].anyOf[1].displayName` | string | 是 |  |  |
| `$.anyOf[2][].anyOf[1].description` | string | 是 |  |  |
| `$.anyOf[2][].anyOf[1].gameAddress` | string / null | 是 |  |  |
| `$.anyOf[2][].anyOf[1].themeColor` | string / null | 是 |  |  |
| `$.anyOf[2][].anyOf[1].sortOrder` | integer | 是 |  |  |
| `$.anyOf[2][].anyOf[1].organization` | object | 是 | 不接受额外字段 |  |
| `$.anyOf[2][].anyOf[1].organization.id` | string (uuid) | 是 |  |  |
| `$.anyOf[2][].anyOf[1].organization.displayName` | string | 是 |  |  |
| `$.anyOf[2][].anyOf[1].publicationRevision` | integer | 是 | 最小值（含）：`0` |  |
| `$.anyOf[2][].anyOf[1].currentRelease` | object | 是 | 不接受额外字段 |  |
| `$.anyOf[2][].anyOf[1].currentRelease.id` | string (uuid) | 是 |  |  |
| `$.anyOf[2][].anyOf[1].currentRelease.clientId` | string (uuid) | 是 |  |  |
| `$.anyOf[2][].anyOf[1].currentRelease.versionLabel` | string | 是 |  |  |
| `$.anyOf[2][].anyOf[1].currentRelease.name` | string | 是 |  |  |
| `$.anyOf[2][].anyOf[1].currentRelease.manifestSha256` | string | 是 | 正则：`"^[0-9a-f]{64}$"` |  |
| `$.anyOf[2][].anyOf[1].currentRelease.packageFormatVersion` | anyOf（2 个分支） | 是 |  |  |
| `$.anyOf[2][].anyOf[1].currentRelease.packageFormatVersion.anyOf[1]` | number | 分支内适用 | 可选值：`[1]` |  |
| `$.anyOf[2][].anyOf[1].currentRelease.packageFormatVersion.anyOf[2]` | number | 分支内适用 | 可选值：`[2]` |  |
| `$.anyOf[2][].anyOf[1].currentRelease.manifestUrl` | string | 是 |  |  |
| `$.anyOf[2][].anyOf[1].currentRelease.packagesUrl` | string | 是 |  |  |
| `$.anyOf[2][].anyOf[1].displayMode` | string | 是 | 可选值：`["PERMANENT"]` |  |
| `$.anyOf[2][].anyOf[1].displayStartsAt` | null | 是 |  |  |
| `$.anyOf[2][].anyOf[1].displayEndsAt` | null | 是 |  |  |
| `$.anyOf[2][].anyOf[2]` | object | 分支内适用 | 不接受额外字段 |  |
| `$.anyOf[2][].anyOf[2].serverId` | string | 是 | 正则：`"^[A-Za-z]{3,5}$"` |  |
| `$.anyOf[2][].anyOf[2].displayName` | string | 是 |  |  |
| `$.anyOf[2][].anyOf[2].description` | string | 是 |  |  |
| `$.anyOf[2][].anyOf[2].gameAddress` | string / null | 是 |  |  |
| `$.anyOf[2][].anyOf[2].themeColor` | string / null | 是 |  |  |
| `$.anyOf[2][].anyOf[2].sortOrder` | integer | 是 |  |  |
| `$.anyOf[2][].anyOf[2].organization` | object | 是 | 不接受额外字段 |  |
| `$.anyOf[2][].anyOf[2].organization.id` | string (uuid) | 是 |  |  |
| `$.anyOf[2][].anyOf[2].organization.displayName` | string | 是 |  |  |
| `$.anyOf[2][].anyOf[2].publicationRevision` | integer | 是 | 最小值（含）：`0` |  |
| `$.anyOf[2][].anyOf[2].currentRelease` | object | 是 | 不接受额外字段 |  |
| `$.anyOf[2][].anyOf[2].currentRelease.id` | string (uuid) | 是 |  |  |
| `$.anyOf[2][].anyOf[2].currentRelease.clientId` | string (uuid) | 是 |  |  |
| `$.anyOf[2][].anyOf[2].currentRelease.versionLabel` | string | 是 |  |  |
| `$.anyOf[2][].anyOf[2].currentRelease.name` | string | 是 |  |  |
| `$.anyOf[2][].anyOf[2].currentRelease.manifestSha256` | string | 是 | 正则：`"^[0-9a-f]{64}$"` |  |
| `$.anyOf[2][].anyOf[2].currentRelease.packageFormatVersion` | anyOf（2 个分支） | 是 |  |  |
| `$.anyOf[2][].anyOf[2].currentRelease.packageFormatVersion.anyOf[1]` | number | 分支内适用 | 可选值：`[1]` |  |
| `$.anyOf[2][].anyOf[2].currentRelease.packageFormatVersion.anyOf[2]` | number | 分支内适用 | 可选值：`[2]` |  |
| `$.anyOf[2][].anyOf[2].currentRelease.manifestUrl` | string | 是 |  |  |
| `$.anyOf[2][].anyOf[2].currentRelease.packagesUrl` | string | 是 |  |  |
| `$.anyOf[2][].anyOf[2].displayMode` | string | 是 | 可选值：`["RANGE"]` |  |
| `$.anyOf[2][].anyOf[2].displayStartsAt` | string (date-time) | 是 |  |  |
| `$.anyOf[2][].anyOf[2].displayEndsAt` | string (date-time) | 是 |  |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "anyOf": [
    {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "displayName": {
            "type": "string"
          }
        },
        "required": [
          "id",
          "displayName"
        ],
        "additionalProperties": false
      }
    },
    {
      "type": "array",
      "items": {
        "anyOf": [
          {
            "type": "object",
            "properties": {
              "serverId": {
                "type": "string",
                "pattern": "^[A-Za-z]{3,5}$"
              },
              "displayName": {
                "type": "string"
              },
              "description": {
                "type": "string"
              },
              "gameAddress": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "themeColor": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "sortOrder": {
                "type": "integer"
              },
              "organization": {
                "type": "object",
                "properties": {
                  "id": {
                    "type": "string",
                    "format": "uuid"
                  },
                  "displayName": {
                    "type": "string"
                  }
                },
                "required": [
                  "id",
                  "displayName"
                ],
                "additionalProperties": false
              },
              "publicationRevision": {
                "type": "integer",
                "minimum": 0
              },
              "currentRelease": {
                "type": "object",
                "properties": {
                  "id": {
                    "type": "string",
                    "format": "uuid"
                  },
                  "clientId": {
                    "type": "string",
                    "format": "uuid"
                  },
                  "versionLabel": {
                    "type": "string"
                  },
                  "name": {
                    "type": "string"
                  },
                  "manifestSha256": {
                    "type": "string",
                    "pattern": "^[0-9a-f]{64}$"
                  },
                  "packageFormatVersion": {
                    "anyOf": [
                      {
                        "type": "number",
                        "enum": [
                          1
                        ]
                      },
                      {
                        "type": "number",
                        "enum": [
                          2
                        ]
                      }
                    ]
                  },
                  "manifestUrl": {
                    "type": "string"
                  },
                  "packagesUrl": {
                    "type": "string"
                  }
                },
                "required": [
                  "id",
                  "clientId",
                  "versionLabel",
                  "name",
                  "manifestSha256",
                  "packageFormatVersion",
                  "manifestUrl",
                  "packagesUrl"
                ],
                "additionalProperties": false
              },
              "displayMode": {
                "type": "string",
                "enum": [
                  "PERMANENT"
                ]
              },
              "displayStartsAt": {
                "type": "null"
              },
              "displayEndsAt": {
                "type": "null"
              }
            },
            "required": [
              "serverId",
              "displayName",
              "description",
              "gameAddress",
              "themeColor",
              "sortOrder",
              "organization",
              "publicationRevision",
              "currentRelease",
              "displayMode",
              "displayStartsAt",
              "displayEndsAt"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "serverId": {
                "type": "string",
                "pattern": "^[A-Za-z]{3,5}$"
              },
              "displayName": {
                "type": "string"
              },
              "description": {
                "type": "string"
              },
              "gameAddress": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "themeColor": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "sortOrder": {
                "type": "integer"
              },
              "organization": {
                "type": "object",
                "properties": {
                  "id": {
                    "type": "string",
                    "format": "uuid"
                  },
                  "displayName": {
                    "type": "string"
                  }
                },
                "required": [
                  "id",
                  "displayName"
                ],
                "additionalProperties": false
              },
              "publicationRevision": {
                "type": "integer",
                "minimum": 0
              },
              "currentRelease": {
                "type": "object",
                "properties": {
                  "id": {
                    "type": "string",
                    "format": "uuid"
                  },
                  "clientId": {
                    "type": "string",
                    "format": "uuid"
                  },
                  "versionLabel": {
                    "type": "string"
                  },
                  "name": {
                    "type": "string"
                  },
                  "manifestSha256": {
                    "type": "string",
                    "pattern": "^[0-9a-f]{64}$"
                  },
                  "packageFormatVersion": {
                    "anyOf": [
                      {
                        "type": "number",
                        "enum": [
                          1
                        ]
                      },
                      {
                        "type": "number",
                        "enum": [
                          2
                        ]
                      }
                    ]
                  },
                  "manifestUrl": {
                    "type": "string"
                  },
                  "packagesUrl": {
                    "type": "string"
                  }
                },
                "required": [
                  "id",
                  "clientId",
                  "versionLabel",
                  "name",
                  "manifestSha256",
                  "packageFormatVersion",
                  "manifestUrl",
                  "packagesUrl"
                ],
                "additionalProperties": false
              },
              "displayMode": {
                "type": "string",
                "enum": [
                  "RANGE"
                ]
              },
              "displayStartsAt": {
                "type": "string",
                "format": "date-time"
              },
              "displayEndsAt": {
                "type": "string",
                "format": "date-time"
              }
            },
            "required": [
              "serverId",
              "displayName",
              "description",
              "gameAddress",
              "themeColor",
              "sortOrder",
              "organization",
              "publicationRevision",
              "currentRelease",
              "displayMode",
              "displayStartsAt",
              "displayEndsAt"
            ],
            "additionalProperties": false
          }
        ]
      }
    }
  ]
}
```

</details>

<a id="schema-inline-82"></a>

### listAccessRequests 200 响应

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `requests` | array：object | 是 |  |  |
| `requests[]` | object | 每个元素 | 不接受额外字段 |  |
| `requests[].id` | string (uuid) | 是 |  |  |
| `requests[].sourceOrganizationId` | string (uuid) | 是 |  |  |
| `requests[].targetOrganizationId` | string (uuid) | 是 |  |  |
| `requests[].accountId` | string (uuid) | 是 |  |  |
| `requests[].createdById` | string (uuid) | 是 |  |  |
| `requests[].serverIds` | array：string | 是 |  |  |
| `requests[].serverIds[]` | string | 每个元素 |  |  |
| `requests[].autoIncludeNewServers` | boolean | 是 |  |  |
| `requests[].reason` | string | 是 |  |  |
| `requests[].status` | string | 是 | 可选值：`["PENDING","APPROVED","REJECTED","CANCELLED"]` |  |
| `requests[].revision` | integer | 是 |  |  |
| `requests[].reviewedById` | string / null (uuid) | 是 |  |  |
| `requests[].reviewedAt` | string / null (date-time) | 是 |  |  |
| `requests[].note` | string | 是 |  |  |
| `requests[].createdAt` | string (date-time) | 是 |  |  |
| `requests[].sourceName` | string | 是 |  |  |
| `requests[].targetName` | string | 是 |  |  |
| `requests[].memberName` | string | 是 |  |  |
| `grants` | array：object | 是 |  |  |
| `grants[]` | object | 每个元素 | 不接受额外字段 |  |
| `grants[].id` | string (uuid) | 是 |  |  |
| `grants[].requestId` | string (uuid) | 是 |  |  |
| `grants[].sourceOrganizationId` | string (uuid) | 是 |  |  |
| `grants[].targetOrganizationId` | string (uuid) | 是 |  |  |
| `grants[].accountId` | string (uuid) | 是 |  |  |
| `grants[].serverIds` | array：string | 是 |  |  |
| `grants[].serverIds[]` | string | 每个元素 |  |  |
| `grants[].autoIncludeNewServers` | boolean | 是 |  |  |
| `grants[].approvedAt` | string (date-time) | 是 |  |  |
| `grants[].revokedAt` | string / null (date-time) | 是 |  |  |
| `grants[].revokedById` | string / null (uuid) | 是 |  |  |
| `grants[].revokeReason` | string / null | 是 |  |  |
| `grants[].sourceName` | string | 是 |  |  |
| `grants[].targetName` | string | 是 |  |  |
| `grants[].memberName` | string | 是 |  |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "requests": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "sourceOrganizationId": {
            "type": "string",
            "format": "uuid"
          },
          "targetOrganizationId": {
            "type": "string",
            "format": "uuid"
          },
          "accountId": {
            "type": "string",
            "format": "uuid"
          },
          "createdById": {
            "type": "string",
            "format": "uuid"
          },
          "serverIds": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "autoIncludeNewServers": {
            "type": "boolean"
          },
          "reason": {
            "type": "string"
          },
          "status": {
            "type": "string",
            "enum": [
              "PENDING",
              "APPROVED",
              "REJECTED",
              "CANCELLED"
            ]
          },
          "revision": {
            "type": "integer"
          },
          "reviewedById": {
            "type": [
              "string",
              "null"
            ],
            "format": "uuid"
          },
          "reviewedAt": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          },
          "note": {
            "type": "string"
          },
          "createdAt": {
            "type": "string",
            "format": "date-time"
          },
          "sourceName": {
            "type": "string"
          },
          "targetName": {
            "type": "string"
          },
          "memberName": {
            "type": "string"
          }
        },
        "required": [
          "id",
          "sourceOrganizationId",
          "targetOrganizationId",
          "accountId",
          "createdById",
          "serverIds",
          "autoIncludeNewServers",
          "reason",
          "status",
          "revision",
          "reviewedById",
          "reviewedAt",
          "note",
          "createdAt",
          "sourceName",
          "targetName",
          "memberName"
        ],
        "additionalProperties": false
      }
    },
    "grants": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "requestId": {
            "type": "string",
            "format": "uuid"
          },
          "sourceOrganizationId": {
            "type": "string",
            "format": "uuid"
          },
          "targetOrganizationId": {
            "type": "string",
            "format": "uuid"
          },
          "accountId": {
            "type": "string",
            "format": "uuid"
          },
          "serverIds": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "autoIncludeNewServers": {
            "type": "boolean"
          },
          "approvedAt": {
            "type": "string",
            "format": "date-time"
          },
          "revokedAt": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          },
          "revokedById": {
            "type": [
              "string",
              "null"
            ],
            "format": "uuid"
          },
          "revokeReason": {
            "type": [
              "string",
              "null"
            ]
          },
          "sourceName": {
            "type": "string"
          },
          "targetName": {
            "type": "string"
          },
          "memberName": {
            "type": "string"
          }
        },
        "required": [
          "id",
          "requestId",
          "sourceOrganizationId",
          "targetOrganizationId",
          "accountId",
          "serverIds",
          "autoIncludeNewServers",
          "approvedAt",
          "revokedAt",
          "revokedById",
          "revokeReason",
          "sourceName",
          "targetName",
          "memberName"
        ],
        "additionalProperties": false
      }
    }
  },
  "required": [
    "requests",
    "grants"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-83"></a>

### submitAccessRequest 请求体

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `sourceOrganizationId` | string (uuid) | 是 |  |  |
| `targetOrganizationId` | string (uuid) | 是 |  |  |
| `accountId` | string (uuid) | 是 |  |  |
| `serverIds` | array：string | 是 | 最少元素：`1`<br>最多元素：`1000` |  |
| `serverIds[]` | string | 每个元素 | 正则：`"^[A-Za-z]{3,5}$"` |  |
| `autoIncludeNewServers` | boolean | 是 |  |  |
| `reason` | string | 是 | 最短长度：`1`<br>最长长度：`1000` |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "sourceOrganizationId": {
      "type": "string",
      "format": "uuid"
    },
    "targetOrganizationId": {
      "type": "string",
      "format": "uuid"
    },
    "accountId": {
      "type": "string",
      "format": "uuid"
    },
    "serverIds": {
      "type": "array",
      "items": {
        "type": "string",
        "pattern": "^[A-Za-z]{3,5}$"
      },
      "minItems": 1,
      "maxItems": 1000
    },
    "autoIncludeNewServers": {
      "type": "boolean"
    },
    "reason": {
      "type": "string",
      "minLength": 1,
      "maxLength": 1000
    }
  },
  "required": [
    "sourceOrganizationId",
    "targetOrganizationId",
    "accountId",
    "serverIds",
    "autoIncludeNewServers",
    "reason"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-84"></a>

### decideAccessRequest 请求体

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `revision` | integer | 是 | 最小值（不含）：`0` |  |
| `decision` | string | 是 | 可选值：`["APPROVED","REJECTED","CANCELLED"]` |  |
| `note` | string | 是 | 最长长度：`1000` |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "revision": {
      "type": "integer",
      "exclusiveMinimum": 0
    },
    "decision": {
      "type": "string",
      "enum": [
        "APPROVED",
        "REJECTED",
        "CANCELLED"
      ]
    },
    "note": {
      "type": "string",
      "maxLength": 1000
    }
  },
  "required": [
    "revision",
    "decision",
    "note"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-85"></a>

### revokeAccessGrant 请求体

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `reason` | string | 是 | 最短长度：`1`<br>最长长度：`1000` |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "reason": {
      "type": "string",
      "minLength": 1,
      "maxLength": 1000
    }
  },
  "required": [
    "reason"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-86"></a>

### listLauncherProviders 200 响应

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | array：object | — |  |  |
| `$[]` | object | 每个元素 | 不接受额外字段 |  |
| `$[].id` | string (uuid) | 是 |  |  |
| `$[].siteCode` | string | 是 |  |  |
| `$[].displayName` | string | 是 |  |  |
| `$[].bsRoot` | string (uri) | 是 |  |  |
| `$[].authApiRoot` | string (uri) | 是 |  |  |
| `$[].revision` | integer | 是 |  |  |
| `$[].directExchange` | boolean | 是 | 可选值：`[true]` |  |
| `$[].browserLogin` | boolean | 是 | 可选值：`[true]` |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "array",
  "items": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "format": "uuid"
      },
      "siteCode": {
        "type": "string"
      },
      "displayName": {
        "type": "string"
      },
      "bsRoot": {
        "type": "string",
        "format": "uri"
      },
      "authApiRoot": {
        "type": "string",
        "format": "uri"
      },
      "revision": {
        "type": "integer"
      },
      "directExchange": {
        "type": "boolean",
        "enum": [
          true
        ]
      },
      "browserLogin": {
        "type": "boolean",
        "enum": [
          true
        ]
      }
    },
    "required": [
      "id",
      "siteCode",
      "displayName",
      "bsRoot",
      "authApiRoot",
      "revision",
      "directExchange",
      "browserLogin"
    ],
    "additionalProperties": false
  }
}
```

</details>

<a id="schema-inline-87"></a>

### listLauncherProviders 400 响应

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `error` | string | 是 |  |  |
| `code` | string | 是 |  |  |
| `params` | object | 是 | 动态字段值：anyOf（2 个分支） |  |
| `params{key}` | anyOf（2 个分支） | 动态字段 |  |  |
| `params{key}.anyOf[1]` | string | 分支内适用 |  |  |
| `params{key}.anyOf[2]` | number | 分支内适用 |  |  |
| `requestId` | string (uuid) | 是 |  |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "error": {
      "type": "string"
    },
    "code": {
      "type": "string"
    },
    "params": {
      "type": "object",
      "additionalProperties": {
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "number"
          }
        ]
      }
    },
    "requestId": {
      "type": "string",
      "format": "uuid"
    }
  },
  "required": [
    "error",
    "code",
    "params",
    "requestId"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-88"></a>

### startLauncherGameLogin 请求体

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `providerId` | string (uuid) | 是 |  |  |
| `codeChallenge` | string | 是 | 正则：`"^[A-Za-z0-9_-]{43}$"` |  |
| `codeChallengeMethod` | string | 是 | 可选值：`["S256"]` |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "providerId": {
      "type": "string",
      "format": "uuid"
    },
    "codeChallenge": {
      "type": "string",
      "pattern": "^[A-Za-z0-9_-]{43}$"
    },
    "codeChallengeMethod": {
      "type": "string",
      "enum": [
        "S256"
      ]
    }
  },
  "required": [
    "providerId",
    "codeChallenge",
    "codeChallengeMethod"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-89"></a>

### startLauncherGameLogin 201 响应

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `attemptId` | string (uuid) | 是 |  |  |
| `nonce` | string | 是 |  |  |
| `expiresIn` | number | 是 | 可选值：`[120]` |  |
| `providerId` | string (uuid) | 是 |  |  |
| `providerRevision` | integer | 是 |  |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "attemptId": {
      "type": "string",
      "format": "uuid"
    },
    "nonce": {
      "type": "string"
    },
    "expiresIn": {
      "type": "number",
      "enum": [
        120
      ]
    },
    "providerId": {
      "type": "string",
      "format": "uuid"
    },
    "providerRevision": {
      "type": "integer"
    }
  },
  "required": [
    "attemptId",
    "nonce",
    "expiresIn",
    "providerId",
    "providerRevision"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-90"></a>

### exchangeLauncherGameLogin 请求体

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `attemptId` | string (uuid) | 是 |  |  |
| `nonce` | string | 是 | 正则：`"^[A-Za-z0-9_-]{43}$"` |  |
| `codeVerifier` | string | 是 | 正则：`"^[A-Za-z0-9_-]{43}$"` |  |
| `gameAccessToken` | string | 是 | 最短长度：`1`<br>最长长度：`16384` |  |
| `gameClientToken` | string | 否 | 最短长度：`1`<br>最长长度：`256` |  |
| `gameProfile` | object | 是 | 不接受额外字段 |  |
| `gameProfile.id` | string | 是 | 正则：`"^(?:[a-fA-F0-9]{32}&#124;[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12})$"` |  |
| `gameProfile.name` | string | 否 | 最短长度：`1`<br>最长长度：`64`<br>正则：`"^[^\\x00-\\x1f\\x7f]+$"` |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "attemptId": {
      "type": "string",
      "format": "uuid"
    },
    "nonce": {
      "type": "string",
      "pattern": "^[A-Za-z0-9_-]{43}$"
    },
    "codeVerifier": {
      "type": "string",
      "pattern": "^[A-Za-z0-9_-]{43}$"
    },
    "gameAccessToken": {
      "type": "string",
      "minLength": 1,
      "maxLength": 16384
    },
    "gameClientToken": {
      "type": "string",
      "minLength": 1,
      "maxLength": 256
    },
    "gameProfile": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "pattern": "^(?:[a-fA-F0-9]{32}|[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12})$"
        },
        "name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[^\\x00-\\x1f\\x7f]+$"
        }
      },
      "required": [
        "id"
      ],
      "additionalProperties": false
    }
  },
  "required": [
    "attemptId",
    "nonce",
    "codeVerifier",
    "gameAccessToken",
    "gameProfile"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-91"></a>

### exchangeLauncherGameLogin 200 响应

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `tokenType` | string | 是 | 可选值：`["Bearer"]` |  |
| `token` | string | 是 | 正则：`"^mul_[a-f0-9]{64}$"` |  |
| `expiresAt` | string (date-time) | 是 |  |  |
| `expiresIn` | integer | 是 | 最大值（含）：`900`<br>最小值（不含）：`0` |  |
| `account` | object | 是 | 不接受额外字段 |  |
| `account.id` | string (uuid) | 是 |  |  |
| `account.unionSubject` | string | 是 |  |  |
| `gameProfile` | object | 是 | 不接受额外字段 |  |
| `gameProfile.id` | string | 是 | 正则：`"^[a-f0-9]{32}$"` |  |
| `gameProfile.name` | string | 是 | 最短长度：`1`<br>最长长度：`64`<br>正则：`"^[^\\x00-\\x1f\\x7f]+$"` |  |
| `providerId` | string (uuid) | 是 |  |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "tokenType": {
      "type": "string",
      "enum": [
        "Bearer"
      ]
    },
    "token": {
      "type": "string",
      "pattern": "^mul_[a-f0-9]{64}$"
    },
    "expiresAt": {
      "type": "string",
      "format": "date-time"
    },
    "expiresIn": {
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 900
    },
    "account": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "format": "uuid"
        },
        "unionSubject": {
          "type": "string"
        }
      },
      "required": [
        "id",
        "unionSubject"
      ],
      "additionalProperties": false
    },
    "gameProfile": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "pattern": "^[a-f0-9]{32}$"
        },
        "name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "pattern": "^[^\\x00-\\x1f\\x7f]+$"
        }
      },
      "required": [
        "id",
        "name"
      ],
      "additionalProperties": false
    },
    "providerId": {
      "type": "string",
      "format": "uuid"
    }
  },
  "required": [
    "tokenType",
    "token",
    "expiresAt",
    "expiresIn",
    "account",
    "gameProfile",
    "providerId"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-92"></a>

### startLauncherLogin 请求体

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `challenge` | string | 是 | 正则：`"^[A-Za-z0-9_-]{43}$"` |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "challenge": {
      "type": "string",
      "pattern": "^[A-Za-z0-9_-]{43}$"
    }
  },
  "required": [
    "challenge"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-93"></a>

### startLauncherLogin 201 响应

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `id` | string (uuid) | 是 |  |  |
| `loginUrl` | string (uri) | 是 |  |  |
| `expiresAt` | string (date-time) | 是 |  |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "uuid"
    },
    "loginUrl": {
      "type": "string",
      "format": "uri"
    },
    "expiresAt": {
      "type": "string",
      "format": "date-time"
    }
  },
  "required": [
    "id",
    "loginUrl",
    "expiresAt"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-94"></a>

### claimLauncherLogin 请求体

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `id` | string (uuid) | 是 |  |  |
| `verifier` | string | 是 | 正则：`"^[A-Za-z0-9_-]{43,128}$"` |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "uuid"
    },
    "verifier": {
      "type": "string",
      "pattern": "^[A-Za-z0-9_-]{43,128}$"
    }
  },
  "required": [
    "id",
    "verifier"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-95"></a>

### claimLauncherLogin 200 响应

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | anyOf（2 个分支） | — |  |  |
| `$.anyOf[1]` | object | 分支内适用 | 不接受额外字段 |  |
| `$.anyOf[1].pending` | boolean | 是 | 可选值：`[true]` |  |
| `$.anyOf[2]` | object | 分支内适用 | 不接受额外字段 |  |
| `$.anyOf[2].pending` | boolean | 是 | 可选值：`[false]` |  |
| `$.anyOf[2].token` | string | 是 | 正则：`"^mul_[a-f0-9]{64}$"` |  |
| `$.anyOf[2].expiresAt` | string (date-time) | 是 |  |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "anyOf": [
    {
      "type": "object",
      "properties": {
        "pending": {
          "type": "boolean",
          "enum": [
            true
          ]
        }
      },
      "required": [
        "pending"
      ],
      "additionalProperties": false
    },
    {
      "type": "object",
      "properties": {
        "pending": {
          "type": "boolean",
          "enum": [
            false
          ]
        },
        "token": {
          "type": "string",
          "pattern": "^mul_[a-f0-9]{64}$"
        },
        "expiresAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "pending",
        "token",
        "expiresAt"
      ],
      "additionalProperties": false
    }
  ]
}
```

</details>

<a id="schema-inline-96"></a>

### getMemberDirectory 200 响应

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `actor` | object | 是 | 不接受额外字段 |  |
| `actor.id` | string (uuid) | 是 |  |  |
| `actor.displayName` | string | 是 |  |  |
| `actor.canManage` | boolean | 是 |  |  |
| `organizations` | array：object | 是 |  |  |
| `organizations[]` | object | 每个元素 | 不接受额外字段 |  |
| `organizations[].id` | string (uuid) | 是 |  |  |
| `organizations[].displayName` | string | 是 |  |  |
| `servers` | array：anyOf（2 个分支） | 是 |  |  |
| `servers[]` | anyOf（2 个分支） | 每个元素 |  |  |
| `servers[].anyOf[1]` | object | 分支内适用 | 不接受额外字段 |  |
| `servers[].anyOf[1].serverId` | string | 是 | 正则：`"^[A-Za-z]{3,5}$"` |  |
| `servers[].anyOf[1].displayName` | string | 是 |  |  |
| `servers[].anyOf[1].description` | string | 是 |  |  |
| `servers[].anyOf[1].gameAddress` | string / null | 是 |  |  |
| `servers[].anyOf[1].themeColor` | string / null | 是 |  |  |
| `servers[].anyOf[1].sortOrder` | integer | 是 |  |  |
| `servers[].anyOf[1].organization` | object | 是 | 不接受额外字段 |  |
| `servers[].anyOf[1].organization.id` | string (uuid) | 是 |  |  |
| `servers[].anyOf[1].organization.displayName` | string | 是 |  |  |
| `servers[].anyOf[1].publicationRevision` | integer | 是 | 最小值（含）：`0` |  |
| `servers[].anyOf[1].currentRelease` | object | 是 | 不接受额外字段 |  |
| `servers[].anyOf[1].currentRelease.id` | string (uuid) | 是 |  |  |
| `servers[].anyOf[1].currentRelease.clientId` | string (uuid) | 是 |  |  |
| `servers[].anyOf[1].currentRelease.versionLabel` | string | 是 |  |  |
| `servers[].anyOf[1].currentRelease.name` | string | 是 |  |  |
| `servers[].anyOf[1].currentRelease.manifestSha256` | string | 是 | 正则：`"^[0-9a-f]{64}$"` |  |
| `servers[].anyOf[1].currentRelease.packageFormatVersion` | anyOf（2 个分支） | 是 |  |  |
| `servers[].anyOf[1].currentRelease.packageFormatVersion.anyOf[1]` | number | 分支内适用 | 可选值：`[1]` |  |
| `servers[].anyOf[1].currentRelease.packageFormatVersion.anyOf[2]` | number | 分支内适用 | 可选值：`[2]` |  |
| `servers[].anyOf[1].currentRelease.manifestUrl` | string | 是 |  |  |
| `servers[].anyOf[1].currentRelease.packagesUrl` | string | 是 |  |  |
| `servers[].anyOf[1].displayMode` | string | 是 | 可选值：`["PERMANENT"]` |  |
| `servers[].anyOf[1].displayStartsAt` | null | 是 |  |  |
| `servers[].anyOf[1].displayEndsAt` | null | 是 |  |  |
| `servers[].anyOf[2]` | object | 分支内适用 | 不接受额外字段 |  |
| `servers[].anyOf[2].serverId` | string | 是 | 正则：`"^[A-Za-z]{3,5}$"` |  |
| `servers[].anyOf[2].displayName` | string | 是 |  |  |
| `servers[].anyOf[2].description` | string | 是 |  |  |
| `servers[].anyOf[2].gameAddress` | string / null | 是 |  |  |
| `servers[].anyOf[2].themeColor` | string / null | 是 |  |  |
| `servers[].anyOf[2].sortOrder` | integer | 是 |  |  |
| `servers[].anyOf[2].organization` | object | 是 | 不接受额外字段 |  |
| `servers[].anyOf[2].organization.id` | string (uuid) | 是 |  |  |
| `servers[].anyOf[2].organization.displayName` | string | 是 |  |  |
| `servers[].anyOf[2].publicationRevision` | integer | 是 | 最小值（含）：`0` |  |
| `servers[].anyOf[2].currentRelease` | object | 是 | 不接受额外字段 |  |
| `servers[].anyOf[2].currentRelease.id` | string (uuid) | 是 |  |  |
| `servers[].anyOf[2].currentRelease.clientId` | string (uuid) | 是 |  |  |
| `servers[].anyOf[2].currentRelease.versionLabel` | string | 是 |  |  |
| `servers[].anyOf[2].currentRelease.name` | string | 是 |  |  |
| `servers[].anyOf[2].currentRelease.manifestSha256` | string | 是 | 正则：`"^[0-9a-f]{64}$"` |  |
| `servers[].anyOf[2].currentRelease.packageFormatVersion` | anyOf（2 个分支） | 是 |  |  |
| `servers[].anyOf[2].currentRelease.packageFormatVersion.anyOf[1]` | number | 分支内适用 | 可选值：`[1]` |  |
| `servers[].anyOf[2].currentRelease.packageFormatVersion.anyOf[2]` | number | 分支内适用 | 可选值：`[2]` |  |
| `servers[].anyOf[2].currentRelease.manifestUrl` | string | 是 |  |  |
| `servers[].anyOf[2].currentRelease.packagesUrl` | string | 是 |  |  |
| `servers[].anyOf[2].displayMode` | string | 是 | 可选值：`["RANGE"]` |  |
| `servers[].anyOf[2].displayStartsAt` | string (date-time) | 是 |  |  |
| `servers[].anyOf[2].displayEndsAt` | string (date-time) | 是 |  |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "actor": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "format": "uuid"
        },
        "displayName": {
          "type": "string"
        },
        "canManage": {
          "type": "boolean"
        }
      },
      "required": [
        "id",
        "displayName",
        "canManage"
      ],
      "additionalProperties": false
    },
    "organizations": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "format": "uuid"
          },
          "displayName": {
            "type": "string"
          }
        },
        "required": [
          "id",
          "displayName"
        ],
        "additionalProperties": false
      }
    },
    "servers": {
      "type": "array",
      "items": {
        "anyOf": [
          {
            "type": "object",
            "properties": {
              "serverId": {
                "type": "string",
                "pattern": "^[A-Za-z]{3,5}$"
              },
              "displayName": {
                "type": "string"
              },
              "description": {
                "type": "string"
              },
              "gameAddress": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "themeColor": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "sortOrder": {
                "type": "integer"
              },
              "organization": {
                "type": "object",
                "properties": {
                  "id": {
                    "type": "string",
                    "format": "uuid"
                  },
                  "displayName": {
                    "type": "string"
                  }
                },
                "required": [
                  "id",
                  "displayName"
                ],
                "additionalProperties": false
              },
              "publicationRevision": {
                "type": "integer",
                "minimum": 0
              },
              "currentRelease": {
                "type": "object",
                "properties": {
                  "id": {
                    "type": "string",
                    "format": "uuid"
                  },
                  "clientId": {
                    "type": "string",
                    "format": "uuid"
                  },
                  "versionLabel": {
                    "type": "string"
                  },
                  "name": {
                    "type": "string"
                  },
                  "manifestSha256": {
                    "type": "string",
                    "pattern": "^[0-9a-f]{64}$"
                  },
                  "packageFormatVersion": {
                    "anyOf": [
                      {
                        "type": "number",
                        "enum": [
                          1
                        ]
                      },
                      {
                        "type": "number",
                        "enum": [
                          2
                        ]
                      }
                    ]
                  },
                  "manifestUrl": {
                    "type": "string"
                  },
                  "packagesUrl": {
                    "type": "string"
                  }
                },
                "required": [
                  "id",
                  "clientId",
                  "versionLabel",
                  "name",
                  "manifestSha256",
                  "packageFormatVersion",
                  "manifestUrl",
                  "packagesUrl"
                ],
                "additionalProperties": false
              },
              "displayMode": {
                "type": "string",
                "enum": [
                  "PERMANENT"
                ]
              },
              "displayStartsAt": {
                "type": "null"
              },
              "displayEndsAt": {
                "type": "null"
              }
            },
            "required": [
              "serverId",
              "displayName",
              "description",
              "gameAddress",
              "themeColor",
              "sortOrder",
              "organization",
              "publicationRevision",
              "currentRelease",
              "displayMode",
              "displayStartsAt",
              "displayEndsAt"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "serverId": {
                "type": "string",
                "pattern": "^[A-Za-z]{3,5}$"
              },
              "displayName": {
                "type": "string"
              },
              "description": {
                "type": "string"
              },
              "gameAddress": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "themeColor": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "sortOrder": {
                "type": "integer"
              },
              "organization": {
                "type": "object",
                "properties": {
                  "id": {
                    "type": "string",
                    "format": "uuid"
                  },
                  "displayName": {
                    "type": "string"
                  }
                },
                "required": [
                  "id",
                  "displayName"
                ],
                "additionalProperties": false
              },
              "publicationRevision": {
                "type": "integer",
                "minimum": 0
              },
              "currentRelease": {
                "type": "object",
                "properties": {
                  "id": {
                    "type": "string",
                    "format": "uuid"
                  },
                  "clientId": {
                    "type": "string",
                    "format": "uuid"
                  },
                  "versionLabel": {
                    "type": "string"
                  },
                  "name": {
                    "type": "string"
                  },
                  "manifestSha256": {
                    "type": "string",
                    "pattern": "^[0-9a-f]{64}$"
                  },
                  "packageFormatVersion": {
                    "anyOf": [
                      {
                        "type": "number",
                        "enum": [
                          1
                        ]
                      },
                      {
                        "type": "number",
                        "enum": [
                          2
                        ]
                      }
                    ]
                  },
                  "manifestUrl": {
                    "type": "string"
                  },
                  "packagesUrl": {
                    "type": "string"
                  }
                },
                "required": [
                  "id",
                  "clientId",
                  "versionLabel",
                  "name",
                  "manifestSha256",
                  "packageFormatVersion",
                  "manifestUrl",
                  "packagesUrl"
                ],
                "additionalProperties": false
              },
              "displayMode": {
                "type": "string",
                "enum": [
                  "RANGE"
                ]
              },
              "displayStartsAt": {
                "type": "string",
                "format": "date-time"
              },
              "displayEndsAt": {
                "type": "string",
                "format": "date-time"
              }
            },
            "required": [
              "serverId",
              "displayName",
              "description",
              "gameAddress",
              "themeColor",
              "sortOrder",
              "organization",
              "publicationRevision",
              "currentRelease",
              "displayMode",
              "displayStartsAt",
              "displayEndsAt"
            ],
            "additionalProperties": false
          }
        ]
      }
    }
  },
  "required": [
    "actor",
    "organizations",
    "servers"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-97"></a>

### login 请求体

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `username` | string | 是 | 最短长度：`3`<br>最长长度：`64`<br>正则：`"^[a-z0-9_.-]{3,64}$"` |  |
| `password` | string (password) | 是 | 最短长度：`1`<br>最长长度：`128`<br>只写：`true` |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "username": {
      "type": "string",
      "minLength": 3,
      "maxLength": 64,
      "pattern": "^[a-z0-9_.-]{3,64}$"
    },
    "password": {
      "type": "string",
      "minLength": 1,
      "maxLength": 128,
      "format": "password",
      "writeOnly": true
    }
  },
  "required": [
    "username",
    "password"
  ],
  "additionalProperties": false
}
```

</details>

<a id="schema-inline-98"></a>

### changePassword 请求体

| 字段 | 类型 / 模型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `$` | object | — | 不接受额外字段 |  |
| `currentPassword` | string (password) | 是 | 最长长度：`128`<br>只写：`true` |  |
| `newPassword` | string (password) | 是 | 最短长度：`12`<br>最长长度：`128`<br>只写：`true` |  |

<details>
<summary>完整 JSON Schema</summary>

```json
{
  "type": "object",
  "properties": {
    "currentPassword": {
      "type": "string",
      "maxLength": 128,
      "format": "password",
      "writeOnly": true
    },
    "newPassword": {
      "type": "string",
      "minLength": 12,
      "maxLength": 128,
      "format": "password",
      "writeOnly": true
    }
  },
  "required": [
    "currentPassword",
    "newPassword"
  ],
  "additionalProperties": false
}
```

</details>

---

本文由完整 OpenAPI JSON 转换生成。接口变更后需先更新并校验 OpenAPI，再重新生成 Markdown。
