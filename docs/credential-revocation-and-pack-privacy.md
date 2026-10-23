# 敏感文件过滤与凭据撤销

2026-10-23。Forge 处理器仍按现有执行方式运行，执行隔离另行实施。

## 导入与发布边界

`.minecraft` ZIP、mrpack v1/v2 和已支持的 PCL 内包共用 `pack-file-policy.ts`。先规范化路径，再按 NFC、忽略大小写匹配；在远程下载、CAS 写入及导入文件列表生成前过滤。mrpack 的远程声明、overrides 与 client-overrides 均适用。

| 规则 | 过滤内容 |
| --- | --- |
| 任意目录层级 | `.mua`、`.unionlink`、`.launcher`、`.hmcl`、`PCL`、`.git`、`.svn`、`.hg`、`.ssh`、`.aws`、`.azure`、`.gnupg` |
| 任意文件层级 | `accounts.json`、`user-accounts.json`、`account-private-data.json`、`user-account-private-data.json`、`launcher_accounts.json`、`launcher_profiles.json`、Microsoft Store 对应账号/配置 JSON、`hmcl_accounts.json`、`hmcl.json`、`usercache.json`、`usernamecache.json`、`launcher_msa_credentials.bin` |
| 常见凭据文件 | `.env`、`.npmrc`、`.pypirc`、`.netrc`、`_netrc`、`id_rsa`、`id_dsa`、`id_ecdsa`、`id_ed25519` |
| 备份 | 上述文件后紧接 `. / ~ / _ / -` 中任一字符的后缀；`.env.production` 等也过滤 |

目录规则按完整路径段匹配，`versions/<实例名>/` 的实例名不参与目录规则（例如名为 pcl 的实例仍保留）；文件规则按完整文件名及上述后缀匹配。保留一般模组配置、模组 JAR、资源包及玩家设置的既有 managed/preserve 语义。原有日志、崩溃报告、截图及 webcache 排除规则继续适用。

Worker 以结构化 `diagnostics.packPolicy.filtered` 警告报告过滤条目数，不写敏感文件内容或 URL。提交、审核批准、组包及正式发布也检查路径；旧导入或旧草稿含敏感路径时须清理后重新上传。已签名历史包的读取、下载和验签规则不变，不改写历史签名，也不自动下架旧发布。已发布泄漏应由管理员下架受影响版本、上传清理后的新版本并撤销相关凭据。

此功能按路径过滤，不扫描任意配置内容，无法发现普通模组配置或 JAR 中嵌入的秘密。私有 OSS 的原始上传 ZIP 仍保留原始内容，沿用访问权限和回收策略；过滤不等于从源包、历史 CAS 或备份中擦除秘密。

HMCL 账号元数据和私有数据文件名核对自其 [SettingsManager 源码](https://github.com/HMCL-dev/HMCL/blob/main/HMCL/src/main/java/org/jackhuang/hmcl/setting/SettingsManager.java)，同时保留对旧版 hmcl.json 的过滤。

## 凭据撤销契约

迁移 `202610230001_account_credential_revocation` 新增受限的 SECURITY DEFINER 函数，无新增表。函数固定 search_path、由 `mua_owner` 持有，仅 `mua_web` 可执行；事务内再次检查有效浏览器身份及本人/超管边界，并与登录签发共用 advisory lock。

| 接口 | 授权 | 请求/响应 |
| --- | --- | --- |
| `POST /api/auth/revoke-credentials` | 本人浏览器 Cookie，包含 PLAYER 和 OAuth 账号 | 严格 JSON `{}`；清除当前 Session Cookie |
| `POST /api/admin/accounts/{accountId}/revoke-credentials` | MUA 超管浏览器 Cookie | 严格 JSON `{}`；可操作其他账号 |

两者要求同源 Origin，不接受 Bearer 代替 Cookie。响应均为 `{ ok: true, sessions, apiTokens, launcherApprovals }`，数量为本次实际影响的记录数，不含原始凭据。重复调用不会恢复任何凭据。普通组织/服务器管理员不能撤销其他账号；Launcher Cookie 和 API Token 不能执行撤销。

同一事务删除该账号所有 WEB/LAUNCHER Session（包括直接换票会话），为全部未撤销 API Token 设置 revokedAt，并删除已关联账号但尚未领取的 LauncherLoginAttempt，随后记录审计。失败整体回滚。尚未绑定账号的 OAuth/换票尝试不能按账号定位，皮肤站签发的游戏 Token 及本地密码不在撤销范围；持有仍有效密码或上游 Token 的人仍可重新登录。怀疑密码或上游凭据泄漏时还须分别修改密码或在皮肤站撤销。

本人改密、超管重置密码、停用账号或修改超管标志同步执行全部凭据撤销。重新启用账号不会复活旧 Token。UI 在 Settings、成员目录及超管账号列表提供确认按钮；撤销本人凭据后跳转登录页。

## 验收范围

- 五种导入组合：敏感本地文件不进入 CAS，敏感远程声明不下载、不保留 URL；一般配置保留。
- 真实 PostgreSQL 运行角色：本人 PLAYER 撤销、超管跨账号撤销、普通管理员/Launcher/Bearer 拒绝、SQL 直接越权拒绝、改密/停用/降权撤销及重新启用不恢复。
- 本地生产 HTTP/浏览器：同源、Cookie 清除、严格空请求、旧会话失效、成员界面双语确认及退出流程。

OpenAPI 5.1.0：完整 90、公开 11 操作。相对 5.0.0 只新增两个后台/浏览器操作，无既有请求响应结构变更；密码重置与停用的撤销范围扩大属于安全行为变化，调用方需重新创建后台 API Token。

本轮本地验证：设置 `MUA_HTTP_TEST_DIST=.next` 的完整 `npm test` 为 305 通过、0 失败，2 项外部 PCL/HMCL 真实样本测试因未提供样本而跳过；包含真实 PostgreSQL 角色/RLS、MinIO、生产 HTTP 上传发布与 Launcher 契约。额外隔离生产 HTTP 专项 27 项通过，登录浏览器 8 项、OpenAPI 浏览器 2 项及成员双语撤销流程通过。TypeScript、ESLint、生产构建和 90/90 OpenAPI 校验通过。

新迁移仅在隔离测试 schema 验证，尚未应用到当前应用数据库；部署时先运行数据库迁移。真实皮肤站、原生 Launcher 游戏启动及真实云对象存储未在本轮验收。
