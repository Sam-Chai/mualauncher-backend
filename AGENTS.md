<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## MUA Launcher 项目约定

- 2026-10-23 安全：所有已支持导入共用敏感路径过滤，在下载/CAS 前排除账号、凭据及启动器私有目录；提交、批准、组包和发布再次拒绝敏感路径，历史签名不重写。本人（含 PLAYER）及超管可通过 Cookie+同源接口撤销账号全部 WEB/LAUNCHER 会话、API Token 和待领取 Launcher 授权；改密、重置、停用和超管标志变化同步撤销，重新启用不恢复 Token。上游游戏 Token/密码须另行撤销或修改。迁移 `202610230001_account_credential_revocation`，无新增表，OpenAPI 5.1.0 完整 90／公开 11。见 [过滤与撤销](docs/credential-revocation-and-pack-privacy.md)。Forge 隔离另行实施。

- 2026-10-23 登录与上传安全修复：密码登录按可信代理客户端 IP／无代理时的独立 HttpOnly 浏览器标识隔离配额，不使用全站共享尝试次数；AUTH_CLIENT_IP_HEADER 仅允许强制代理覆盖的单 IP 头，无代理退路需入口抗机器人限流。昂贵校验最多进程内并发两次。上传 PUT 签入由保存记录计算的精确 Content-Length，四类 SDK 均覆盖，OBS 仅上传 URL 显式使用 V4；已有旧 URL 最长十分钟过渡，云端需 storage:verify。Next.js／eslint-config-next 为 16.4.1；本阶段无需迁移，后续敏感文件和撤销功能的迁移与规范版本见上一条。Forge 隔离尚未实施。见 [登录安全](docs/login-form-security.md)、[上传限制](docs/upload-size-settings.md)。

- 2026-10-22 界面国际化采用 next-intl、稳定语义键及独立的 `src/lib/locales/zh-CN.json`／`en-US.json`。修改文案只改词典值，保持键及 ICU 变量一致。API 错误返回英文 error＋code＋params；Worker 警告／失败／进度与探测提示返回英文 message 的结构化诊断，前端按 code 翻译，不匹配中文／英文原句。诊断序列化存现有文本字段；无新增表，默认进度迁移 `202610220004_english_diagnostic_default`。`useI18n` 保留 Cookie、路由与主题；业务名称／简介不翻译。OpenAPI 5.0.0，完整 88／公开 11。见 [界面偏好](docs/interface-preferences.md)。

- 2026-10-22 Union 组织简介：授权页别名来自各站 `/api/yggdrasil` 的 `meta.serverName`，目录 Worker 每分钟将其同步到 `description`，不改本地组织别名或 CODE。`descriptionMode=AUTO/MANUAL`；已有非空或有简介编辑审计的资料保留，手动修改／清空后数据库永久锁定 MANUAL，原样保存或只改别名不停止同步。站点失败保留原值，停用／归档及抓取期间人工修改均受保护。迁移 `202610220003_union_site_descriptions`，无新增表／接口字段，OpenAPI 仍 4.0.0、完整 88／公开 11。见 [目录同步](docs/union-directory-sync.md)。

- 2026-10-22 Launcher 换票后端：玩家手动选站，固定核准来源在线验游戏 Token，再按 CODE:UID 关联账号并检查 selectedProfile 归属。新增 providers/start/exchange 和超管来源 GET/PUT；只读 mul_ 最长 15 分钟且早于上游 exp 30 秒，游戏 Token 不落库/日志，不凭 UUID/名字登录。来源默认不启用，目录或来源修订/停用使直接换票会话失效；旧版/Janus 未支持时走浏览器桥接。本地密码/OAuth 保留，真实上游及 Fabric 接入未验收。迁移 202610220001/002，33 张 FORCE RLS 表，OpenAPI 4.0.0 完整 88／公开 11。见 [实施说明](docs/launcher-game-token-exchange.md)。

- 2026-10-21 表单安全：共享 SchemaForm 必须明确 POST，hydration 前禁用 fieldset；登录原生 action 固定 `/api/auth/login`，正常仍走 JSON POST。禁止凭据进入查询参数；原生 URL-encoded 请求由 JSON-only API 拒绝，不作为备用认证。回归 `test:auth:browser`，见 [密码链接修复](docs/login-form-security.md)。

- 2026-10-21 PLAYER／Union 身份：Union 成员默认 PLAYER（玩家），管理权限集合为空，不能用角色数组非空判断后台准入；只有实际管理权限才可进入后台。空组织角色回填／保存归一化为 PLAYER，单服授权排除此角色；不改变停用或已有特权。成员／账号／搜索显示 `Union · CODE:ID`，本地用户名继续独立。迁移 005／006，OpenAPI 3.2.0／83 操作，仍 31 张 FORCE RLS 表。见 [成员访问](docs/union-oauth-member-access.md)。

- 2026-10-21 YITUEM 已确认合并：`skin.yitmc.cn`／`skin.uemcraft.cn` 对应同一组织和 CODE，保存主地址及 bsRootAliases，列表分别显示两个域名按钮。只对此确切组合放行，其他重复 CODE 仍报告冲突；账号仍用完整 sub，不合并本地账号或授予角色。迁移 `202610210004_yituem_skin_site_aliases`，仍 31 张 FORCE RLS 表，OpenAPI 当前 3.1.0／83 操作。见 [目录同步](docs/union-directory-sync.md)。

- 2026-10-21 后续：Union 固定目录 API 每分钟由 Worker 租约同步，按 CODE 自动创建／关联组织，不授予角色；冲突 CODE 跳过并报告，不转移既有映射、不恢复人工停用或归档。组织头像支持私有 OSS 原图、1:1 网格裁剪和 512×512 WebP；网站 favicon 自动导入、每日检查、失败小时重试，人工上传／裁剪／移除后禁止覆盖。Settings 同步板块与接口仅超管 Cookie 可读／安排任务。迁移 `202610210002_union_directory_avatars` 后 31 张 FORCE RLS 表，OpenAPI 3.0.0 完整 83 操作；组织资料 JSON 不再接受裸 avatarObjectKey。见 [目录与头像](docs/union-directory-sync.md)。本条优先于下方旧数量及手工映射说明。

- 2026-10-21 Union OAuth 与成员访问：保留本地密码登录和现有 Session，oauth4webapi＋独立五分钟 Lax Cookie＋一次性 state＋S256 PKCE；按来源 CODE 自动普通入组，成员读取不授予 READ_ONLY 或管理角色。外部访问由源 ORG_ADMIN 申请、目标 ORG_ADMIN 审批，保存具体服务器集合及单独自动新增选项。Launcher 四 GET 必须登录，专用 mul_ Token 只读，后台自动化 mua_ Token 不用于成员分发；后台完整规范只允许有管理权限的 Cookie。迁移 `202610210001_union_member_access` 后 30 张业务表 FORCE RLS，OpenAPI 2.0.0 共 78 操作。真实 Union 凭据／上游 PKCE 执行与实际 Launcher 接入未验收。见 [实施说明](docs/union-oauth-member-access.md) 和 [方案](docs/union-oauth-member-access-plan.md)。本条优先于下方白名单／匿名 Launcher 与旧数量说明。

- 2026-10-18 存储遥测已接入超管主页／Storage，Cookie 超管只读 API `/api/admin/storage-telemetry`；Worker 租约采集，新增迁移 `202610180001_storage_telemetry`，当前 23 张业务表 FORCE RLS。当前 MinIO 取桶级指标和进程启动时间，其他供应商通过统一对象列表提供容量，云监控流量和 CDN 尚未接入。未测值为 null，已采集流量含 Worker／后台访问，不代表玩家完成下载或账单；不改变签名链接和发布。OpenAPI 1.1.0 共 64 操作，公开仍四 GET。见 [存储遥测](docs/storage-telemetry.md)。本条补充首发后新增迁移与操作，优先于下文首发时的数量记录。

- 2026-10-14 对象存储可通过 OSS_PROVIDER=minio／aws／s3／ali／tencent／huawei 选择；MinIO／AWS 使用 S3 SDK，三家云使用 ali-oss、cos-nodejs-sdk-v5、esdk-obs-nodejs 原生适配。业务只调用统一 ObjectStorage 接口。原生云桶禁止启用／暂停版本控制，不支持原子禁止覆盖时拒绝正式不可变写入；复制按厂商单次上限分片并固定源 ETag。Web／Worker 共用配置，旧 S3_* 在 MinIO／S3 场景继续有效；配置不自动迁移旧对象、不改发布签名。部署须运行 storage:verify 并检查 CORS，本地 SDK fixture 与 MinIO 验证不代表真实云验收。见 [对象存储配置](docs/object-storage.md)。

- 2026-10-14 首发清理：旧页面、五个旧后台 API 与公开 CAS 单文件入口已删除；客户端 ID 统一 UUID。上传必填 packageFormatVersion，公开分发必填 acceptedFormatVersions，审核／发布必填双修订。v2 只保留 protocolRevision:2，移除历史平台列、旧协议及 WAITING_PROCESSOR；v1 环境包保留。仅有初始迁移 202610140001_initial_release，OpenAPI 首发基线 1.0.0。详见 [首发清理](docs/first-release-cleanup.md)，本条替代下文历史兼容描述。

- 项目及网站唯一名称为 Union Link。OpenAPI 第 1–7 步已接入：左侧 `API` 内嵌 Scalar，继承后台登录、语言与主题，默认 63 操作完整规范，可切换 4 个 Launcher GET；`/openapi.json` 只公开 Launcher，`/api/admin/openapi` 逐请求检查 Cookie。客户端自动化支持 Cookie 或 Bearer，后台仅 Cookie，文档不授予权限。接口变更必须同步定义／生成产物，执行 openapi:check、关键契约与浏览器检查，记录兼容性后审查新基线；CI 仅发布公开 JSON artifact，不公开内部规范。见 [接入与校验](docs/openapi.md)、[完整流程](docs/api-workflows.md)、[兼容性](docs/openapi-changelog.md)。Scalar Registry／云端站点未接入。

- 2026-10-12 平台无关修订：新 muapack v2 的 target-manifest 与 mua-pack.json 均使用 protocolRevision:2，不含 supportedPlatforms／platformsChanged，不按平台限制完整包或更新包；环境兼容性由 Launcher 判断。universal 仅是后台任务标识。首发仅保留平台无关修订，旧平台结构已清理。数据库迁移为 202610140001_initial_release，v1 平台机制保留。此说明优先于下文历史六平台／平台修改描述。

- 管理界面与登录页支持 zh-CN／en-US 及白色／黑色主题，顶部切换、浏览器持久化，默认中文／白色。语言通过请求 Cookie 和 React Context，主题采用 next-themes／html.dark；保留 /admin 路由和原认证重定向。仅翻译界面文案及已知系统提示，不改业务名称、说明、地址、版本／权限标识。新文案加入 src/lib/locales，详见 [docs/interface-preferences.md](docs/interface-preferences.md)。

- muapack 最大源包上传大小由 Settings 管理，默认 1024 MB（1 GB），1 MB=1024² 字节，整数范围 1–20480 MB；仅 MUA 超管面板会话可修改并审计，普通后台账号可读取当前上限。网页、标准 API 和 Actions 新建 v1／v2 上传共用实时上限，超出配置返回 413；调整不取消已有上传／组包／审核／发布，不限制生成产物、不改历史和签名。见 [docs/upload-size-settings.md](docs/upload-size-settings.md)。

- 更新上传默认采用首次发布的 muapack 格式（没有发布历史沿用最近草稿），上传前可手动改选。Settings 的 enabledPackageFormats 默认 [1,2]，至少保留一种，只允许超管面板会话修改并审计；所有后台账号可读取开放选项。关闭格式隐藏新上传选项并在标准上传创建 API 返回 409，不取消已有上传／组包／审核／发布，不下架历史、不改签名；Actions 沿用同一门槛。恢复已有上传保留锁定格式。详见 [docs/package-format-settings.md](docs/package-format-settings.md)。

- 管理界面采用 shadcn/ui dashboard-01 基础，使用总览／API、联盟管理、服务器、客户端、发布和系统菜单与 `/admin` 路由；参见 [docs/admin-ui.md](docs/admin-ui.md)。Tailwind CSS、Lucide、TanStack Table、React Hook Form + Zod 为统一组件体系，Tremor Raw 仅用于图表。
- 页面不得使用模板模拟业务指标。Storage、Worker、签名显示真实运行状态，未接入的内容与 CDN 显示明确待接入状态；审计曲线仅超管可读，按完整时间窗口聚合。共享角色定义在 `src/lib/roles.ts`，服务端仍在每次请求中检查 RBAC。
- 服务器的 Server、Listing、状态已合并为 `/admin/servers`“服务器管理”，统一编辑／详情窗口；旧分散管理路径已移除。SERVER_READ 可查看，SERVER_EDIT 可修改资料；SERVER_EDIT 角色可修改展示颜色、永久／区间模式与时间；排序／上架和服务器归档／恢复仍仅超管可控制，超管登记时即可配置永久或区间展示，服务端范围及字段校验保留。
- 服务器“图标对象键”界面改为“服务器箴言”真实图片上传／编辑，固定比例 2.35:1，默认三分网格裁剪；保留原图可重裁剪。列表图片铺满最左侧单元格，以表格为外框，在横向 61.8034% 起向右渐隐到当前主题的表格背景；编辑页完整显示图片且无渐隐。旧图保持原样，重新裁剪时适配新比例。沿用 iconObjectKey，图片／原图／选区存私有 OSS，SERVER_EDIT 写、SERVER_READ 读，写入时重新校验范围和修订；不改发布签名。旧图片保留，自动回收及玩家公开图片尚未接入，见 [docs/server-motto-images.md](docs/server-motto-images.md)。
- 服务器连接状态灯已接入：后端按已保存 gameAddress 直接探测 MC Java 状态协议和 Ping，确认 MC 且低延迟绿灯，默认 ≥300ms 黄灯，连接失败／无有效 MC 状态红灯；未配置、探测中、归档及探测服务错误灰灯，悬停显示时延或原因。SERVER_READ 逐请求及返回前校验范围，只连接 DNS 固定后的公网 IP，SRV／超时／缓存／并发保护保留；每分钟前端刷新，不改变目录上架、发布或签名，详见 [docs/server-probe.md](docs/server-probe.md)。

- 产品需求和启动器代码观察记录见 [docs/mua-backend-requirements.md](docs/mua-backend-requirements.md)。后续设计或实现前先阅读该文档，区分确定需求、设计建议和待确定事项。
- muapack v2 第 1–6 步已完成，新增只读分发统计和差异展示，见 [docs/v2-distribution-statistics.md](docs/v2-distribution-statistics.md)。[协议基线](docs/muapack-v2.md)、[离线样例](docs/examples/muapack-v2/README.md)、上传选择／模型／API、共享导入及完整组包／审核／签名／发布，见 [docs/muapack-v2-design.md](docs/muapack-v2-design.md)。packageFormatVersion 创建后锁定，API 必须明确声明格式，不改写签名；新 UI 上传前明确选择，Actions 两种格式均提交原审核 API。v2 只校验本地 overrides／CAS，远程全哈希／大小／URL／optional 与环境要求只保存声明（DECLARED）。PCL 私有配置先按共享规则过滤，再校验保留路径；真实环境覆盖仍拒绝。内部 mua-import-recipe 与 mua-recipe-content 不混用旧 Manifest；v2 清单不含平台限制，生成最终 mua-recipe-manifest。新 v2 不选择架构，使用单一 universal 任务，平台配置 API 拒绝 v2；仅接受当前平台无关修订。审核后组包，v2 独立签名域及 ZIP／索引／SHA-256 校验、OSS 保存完成才为 PackageBuild READY，发布指向该目标。Upload READY 仅导入完成。管理完整下载与公开 acceptedFormatVersions=2或1,2 已接入，缺少接受格式返回 400，不支持当前格式返回 415。v2 自动更新包已接入，以上传时固定的已发布 v2 为基准，携带完整基准／目标与所有差异，仅放变化所需本地载荷；full／update 都验签保存后任务 READY。产物记录绑定 baseReleaseId 与 baseManifestSha256；公开 packages 核对基准及平台，摘要参数可选但建议传入，不匹配回退 full。没有已发布基准或跨格式只生成 full；损坏基准明确失败。removalPolicy=retain，不自动删除 preserve／玩家文件。旧 READY 与签名不补写，Launcher 安装尚未接入。v1 保留；v2 分发本地模组 JAR 与覆盖文件，远程模组及环境交给 Launcher，Worker 不下载其二进制，沿用同一套客户端／发布系统。
- 数据库模型与权限矩阵见 [docs/minimal-data-model.md](docs/minimal-data-model.md) 和 [docs/permission-matrix.md](docs/permission-matrix.md)；具体完成范围见 [docs/implementation-status.md](docs/implementation-status.md)，不要把完整发布流程的设计当作已实现功能。
- 当前阶段（2026-10-11）：已实现 .minecraft ZIP、Modrinth mrpack／已验证 PCL 封装上传／更新、本地 MinIO、独立 Worker、文件校验／CAS、审核／签名／发布与当前版本切换，以及 muapack 平台组包／环境缓存／进度／发布门槛、国内镜像优先与官方回退。旧客户端四个入口已合并为“客户端管理”。标准 API 与自动化脚本共用 ClientDraft／ClientRelease，参见 [docs/client-upload-api.md](docs/client-upload-api.md)。CurseForge／MultiMC、Launcher 增量安装、Redis 调度后续接入；RLS 已接入；当前 v1/v2 Manifest 接口保留，muapack 安装使用包内完整平台清单和启动描述，Launcher 协议仍需联调。
- 启动器源码位于 `G:\Projects\Minecraft\BotWMCS\launcher-template-26.1`。它是基于 Fabric 的 Minecraft 客户端；后端对外提供 REST API，不能把现有占位界面视为已完成后端接入。
- 联合服以既有的 3–5 位纯英文字母 MUA server ID 作为底层标识；展示名称采用别名。不要另造 server ID 体系，大小写规范仍待确定。
- 用户已要求增加 Organization：内部 ID、别名、头像、简介，以及 members、servers、clients。组织管理员统一管理本组织全部服务器和专用客户端，包括正式服、测试服及后续新增资源；普通成员可按单服务器细分授权，不能越权到其他组织。
- 用户最新要求允许组织上传多个独立客户端，每个服务器同时至多绑定一个客户端。当前按每个客户端同时至多绑定一个服务器实现；可解绑后改绑同组织服务器，不同时跨服共享、不跨组织绑定。客户端使用独立 ID，客户端 ID 统一 UUID。名称在组织内 NFKC／忽略大小写查重，归档不释放；同名必须使用更新。CLIENT_BIND 检查双方 RBAC，替换原绑定须确认；新客户端待审核发布并启用后按已确认 revision 替换，期间旧客户端继续可用。
- 账号采用白名单，权限按组织范围或单服务器范围及操作划分；MUA 超管可管理全部组织、服务器、发布、展示排序和颜色。
- 用户已确定先实现应用层 RBAC，后续再增加 PostgreSQL RLS 作为第二层保护。最小模型提案使用组织/服务器范围的预置角色及统一角色—权限映射；RLS 已接入，见 [docs/postgresql-rls.md](docs/postgresql-rls.md)；必须保留当前服务端范围校验。运行使用 mua_web／mua_auth／mua_public／mua_worker 分离连接，迁移使用独立 mua_migrator，不得回退 postgres／BYPASSRLS 连接；身份必须在同一事务局部设置。MUA 超管角色不等于数据库超级用户。
- 用户已确认支持独立 MUA 审核角色，模型提案可按组织或单服务器授权审核；审核、发布、切换权限分开，默认审核员只审核，额外能力需显式授予。
- 组织、服务器、草稿和发布采用归档，账号／成员停用，授权撤销保留记录。2026-10-10 最新要求：已归档下架且无实际／待绑定服务器的客户端允许删除，无论是否曾发布；客户端 lifecycleStatus 以 ARCHIVED 优先于 PUBLISHED／UNPUBLISHED，发布记录是不可变历史，不阻止删除。CLIENT_DELETE 默认授予组织／服务器管理员，仍检查真实范围和活动 Worker 任务。删除保留不可恢复标记、发布历史及审计，隐藏记录、释放名称；文件由 Worker 回收，默认保留 7 天，仅超管面板会话可改。共享 CAS 按引用保护，命中回收文件须 SHA-256 校验后取回复用。参见 [docs/client-recycle.md](docs/client-recycle.md)。归档自身不移动 OSS 对象，恢复不自动重新分发。
- 已发布版本不可原地修改，内容变更必须创建新版本；CAS 可复用相同文件字节，但不因此合并客户端身份或发布历史。解绑保留客户端当前版本、所有历史及存储对象；单服权限按当前绑定服务器或解绑后的固定 scopeServerId 校验。
- 未发布上传支持明确的 comparisonDraftId／replacesDraftId，草稿差异与已发布基准的玩家更新量分别保存。成功发布仅归档显式替代链的未发布祖先，失败不归档；手动撤回／归档检查 DRAFT_ARCHIVE，取消活动组包租约但保留 READY 产物与引用。标准标签按 SemVer 比较，自定义标签按内部 versionSequence；不按版本号批量归档或推断旧记录关系。见 [docs/draft-lifecycle.md](docs/draft-lifecycle.md)。
- .minecraft ZIP 先识别客户端信息，再进入 CAS。Worker 通过 processingPhase 和 detectedInfo 反馈识别状态并提前填充 MC／Java；支持 PCL clientVersion、HMCL patches、标准版本继承及游戏 JAR 内 version.json。多实例先等待 select-instance，不能直接选第一个；冲突／缺失信息提示手动确认，客户端发布版本始终由管理员填写。Java 对照在 src/data/minecraft-runtimes.json，npm run runtime:sync 从官方目录更新；快照可加 --snapshots，不猜未知未来版本。
- 模组列表使用统一只读 TanStack 表格，从目标实例的 mods 文件夹（含子目录）自动列出 JAR 文件名与路径，兼容根目录和 versions/<实例>/mods；不能通过手填 API mods 覆盖 Worker 结果。识别后提前替换列表，完整校验前不能提交；审核／历史复用表格。格式识别、根目录定位、运行环境和模组发现统一在 src/lib/pack-inspection.ts 的适配器注册表；通用 ZIP／CAS 处理在 pack-parser。游戏 JAR 元数据读取仅用于运行环境，当前不解析模组 JAR 内名称／版本或依赖。
- 上传整合包由 Worker 归一化，按文件计算 SHA-256 并进入 CAS，生成 Release Manifest，经过 MUA 审核、签名和发布后供 Launcher 增量安装。
- 文件策略：`managed` 在缺失或哈希不一致时安装目标文件；`preserve` 只在不存在时创建，存在时不覆盖。旧文件清理行为尚未确定，不要把 `preserve` 文件视为可自动删除的文件。
- 用户最新分发方案使用 `.muapack v1` 整包／更新包；发布页面支持 Windows／Linux／macOS 的 amd64／aarch64 六种组合，最新默认排除 linux-aarch64，其余五项全选；Linux ARM 选项灰色禁用并提示“Minecraft 目前暂未支持 ARM 版 Linux 系统”，既有草稿仍可取消该选择。API 省略 platforms 同样默认五项，保留六平台协议和显式选择兼容。Worker 发布前后台组包保存 OSS，关闭页面继续执行；客户端表格显示真实进度，必需产物未完成时服务端禁止发布。环境 bucket 缓存游戏／加载器／Java，变化清单与目标完整清单共用发布事实来源。协议模型、差异生成、独立签名及只读 ZIP 校验已实现，见 [docs/muapack-v1.md](docs/muapack-v1.md)；Worker 环境下载／缓存、持久组包、平台 UI、真实进度和发布门槛已接入，见 [docs/muapack-worker.md](docs/muapack-worker.md)。该方案替代下载时现场组包作为主要路径。
- 客户端管理提供完整 muapack 下载按钮，选择 READY 的版本和平台；草稿检查 DRAFT_READ，发布检查 RELEASE_READ，服务端校验归属及 OSS 大小／摘要后签发五分钟链接，始终返回完整包。未完成不可下载；后台有权限的读取不依赖服务器上架，不改变玩家公开分发规则。
- 开发使用 MinIO；生产供应商、Launcher 安装和 CDN 鉴权仍待接入；环境解析支持原版／Fabric／Quilt 与已适配 spec 0／1 安装描述的 Forge／NeoForge。宿主 Java 执行已校验官方客户端处理器，未知任务／旧式格式及 NeoForge 1.20.1 历史坐标明确失败；支持边界与进程配置见 [docs/forge-environments.md](docs/forge-environments.md)。Modrinth mrpack 和本次 PCL 内包封装已接入输入适配，详见 docs/modrinth-import.md；完整组包校验不等于游戏启动验收。muapack 的独立签名绑定确定编码的元数据及清单摘要，不能改写现有已签名发布。生产密钥、公钥信任及回收引用策略须沿用已有保护。
- Modrinth optional 由 Worker 的索引事实产生，客户端支持的 optional 文件全部下载／CAS／组包；不在后台删减。文件与模组清单保留 optional，packages API 明确返回布尔值，Launcher 选择／记忆／启用尚未实现。optional 与 managed/preserve 独立，改变 optional 也创建新发布并记录差异，不改旧签名。client unsupported 和 server-overrides 不进入客户端。
- 整合包远程来源由超管 Settings／download-settings API 管理，域名白名单默认关闭；关闭也保留 HTTPS、公开地址、DNS 固定、逐跳重定向与哈希保护。HTTP(S) CONNECT 总代理控制 mrpack 远程文件和官方环境下载；镜像下载另由 mirrorProxyEnabled 控制，默认关闭且须同时开启总代理才生效。MinIO 不经过该代理；mrpack 白名单不作用于内置环境源。并发 4 个文件，不采用 dl CLI／Range 分段。普通账号和 API Token 无权修改下载设置。
- 新增客户端允许在首次提交前确认包内识别名称，组织内重名提示更新；须没有任何历史草稿／发布且唯一活动上传已 READY，应用层和数据库都检查。已建立版本的客户端名称及 ID／组织／授权来源保持不可变；扩展触发器时必须保留删除不可恢复、先归档、无绑定及活动任务保护，允许归档后的已发布客户端删除，发布内容仍不可修改。

- 环境与 Java 下载源见 [docs/environment-download-sources.md](docs/environment-download-sources.md)。默认 BMCLAPI／中科大／南大及清华 Adoptium 优先，失败回退官方；中科大／南大仅映射静态 Maven，Java 元数据仍使用官方 API。默认集成 JRE，缺少 JRE 明确失败，不静默改用 JDK；仅超管可选择 JDK。缓存身份包含 imageType，镜像偏好不改变内容身份，旧发布与签名保持不变。镜像／代理／JRE 验证不代表六平台游戏启动已验收。

- 2026-10-11 已接入固定 releaseId 的公开下载刷新（/api/v1/servers/:serverId/releases/:releaseId/packages），只允许当前在线绑定客户端的未归档发布；响应含 refreshUrl、expiresAt、S3 原始 etag，packageSha256 防止续传替换文件，GET SigV4 支持 Range／If-Match。v1 分发与 v2 对齐，核对基准身份／平台／摘要与 full／所选 update 的 OSS 大小／摘要，v1／v2 更新产物均必填 baseManifestSha256，缺少基准摘要的更新产物拒绝分发。v1 基准摘要为包内平台清单，不能使用旧 Manifest 摘要代替。见 [下载契约](docs/launcher-download-api.md)。

- 服务器永久／区间展示已接入，配置归属 Server；具备对应 SERVER_EDIT 的账号在服务器管理填写北京时间，目录查询采用开始包含、结束排除。displayMode／displayStartsAt／displayEndsAt 仅影响目录可见性，到期不修改 isListed，不下架客户端、不改绑定和下载。后台客户端状态下显示区间小字；Launcher 布局未改。见 [docs/server-display-schedule.md](docs/server-display-schedule.md)。
