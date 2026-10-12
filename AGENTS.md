<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## MUA Launcher 项目约定

- 管理界面与登录页支持 zh-CN／en-US 及白色／黑色主题，顶部切换、浏览器持久化，默认中文／白色。语言通过请求 Cookie 和 React Context，主题采用 next-themes／html.dark；保留 /admin 路由和原认证重定向。仅翻译界面文案及已知系统提示，不改业务名称、说明、地址、版本／权限标识。新文案加入 src/lib/locales，详见 [docs/interface-preferences.md](docs/interface-preferences.md)。

- muapack 最大源包上传大小由 Settings 管理，默认 1024 MB（1 GB），1 MB=1024² 字节，整数范围 1–20480 MB；仅 MUA 超管面板会话可修改并审计，普通后台账号可读取当前上限。网页、标准 API 和 Actions 新建 v1／v2 上传共用实时上限，超出配置返回 413；调整不取消已有上传／组包／审核／发布，不限制生成产物、不改历史和签名。见 [docs/upload-size-settings.md](docs/upload-size-settings.md)。

- 更新上传默认采用首次发布的 muapack 格式（没有发布历史沿用最近草稿），上传前可手动改选。Settings 的 enabledPackageFormats 默认 [1,2]，至少保留一种，只允许超管面板会话修改并审计；所有后台账号可读取开放选项。关闭格式隐藏新上传选项并在标准上传创建 API 返回 409，不取消已有上传／组包／审核／发布，不下架历史、不改签名；Actions 沿用同一门槛。恢复已有上传保留锁定格式。详见 [docs/package-format-settings.md](docs/package-format-settings.md)。

- 管理界面采用 shadcn/ui dashboard-01 基础，保留用户指定的七个分组菜单与 `/admin` 路由；参见 [docs/admin-ui.md](docs/admin-ui.md)。Tailwind CSS、Lucide、TanStack Table、React Hook Form + Zod 为统一组件体系，Tremor Raw 仅用于图表。
- 页面不得使用模板模拟业务指标。Storage、Worker、签名显示真实运行状态，未接入的内容与 CDN 显示明确待接入状态；审计曲线仅超管可读，按完整时间窗口聚合。共享角色定义在 `src/lib/roles.ts`，服务端仍在每次请求中检查 RBAC。
- 服务器的 Server、Listing、状态已合并为 `/admin/servers`“服务器管理”，统一编辑／详情窗口；旧 `/admin/listings` 与 `/admin/servers/status` 跳转到该入口。SERVER_READ 可查看，SERVER_EDIT 可修改资料；排序／颜色／上架和服务器归档／恢复仍仅超管可控制，服务端范围及字段校验保留。
- 服务器“图标对象键”界面改为“服务器箴言”真实图片上传／编辑，推荐比例 61:23，默认固定比例三分网格裁剪；保留原图可重裁剪。列表最左侧显示图片，在横向 61.8034% 起向右淡出到白色。沿用 iconObjectKey，图片／原图／选区存私有 OSS，SERVER_EDIT 写、SERVER_READ 读，写入时重新校验范围和修订；不改发布签名。旧图片保留，自动回收及玩家公开图片尚未接入，见 [docs/server-motto-images.md](docs/server-motto-images.md)。
- 服务器连接状态灯已接入：后端按已保存 gameAddress 直接探测 MC Java 状态协议和 Ping，确认 MC 且低延迟绿灯，默认 ≥300ms 黄灯，连接失败／无有效 MC 状态红灯；未配置、探测中、归档及探测服务错误灰灯，悬停显示时延或原因。SERVER_READ 逐请求及返回前校验范围，只连接 DNS 固定后的公网 IP，SRV／超时／缓存／并发保护保留；每分钟前端刷新，不改变目录上架、发布或签名，详见 [docs/server-probe.md](docs/server-probe.md)。

- 产品需求和启动器代码观察记录见 [docs/mua-backend-requirements.md](docs/mua-backend-requirements.md)。后续设计或实现前先阅读该文档，区分确定需求、设计建议和待确定事项。
- muapack v2 第 1–5 步已完成：[协议基线](docs/muapack-v2.md)、[离线样例](docs/examples/muapack-v2/README.md)、上传选择／模型／API、共享导入及完整组包／审核／签名／发布，见 [docs/muapack-v2-design.md](docs/muapack-v2-design.md)。packageFormatVersion 创建后锁定，历史和旧 API 默认 1，不改写签名；新 UI 上传前明确选择，Actions 两种格式均提交原审核 API。v2 只校验本地 overrides／CAS，远程全哈希／大小／URL／optional 与环境要求只保存声明（DECLARED）。PCL 私有配置先按共享规则过滤，再校验保留路径；真实环境覆盖仍拒绝。内部 mua-import-recipe 与 mua-recipe-content 不混用旧 Manifest；草稿平台声明独立保存，生成最终 mua-recipe-manifest。2026-10-11 起新 v2 不选择架构，统一六个规范目标与单一 universal 任务，平台配置 API 拒绝 v2；历史修订／受限平台／READY 字节及签名保留。审核后组包，v2 独立签名域及 ZIP／索引／SHA-256 校验、OSS 保存完成才为 PackageBuild READY，发布指向该目标。Upload READY 仅导入完成。管理完整下载与公开 acceptedFormatVersions=2或1,2 已接入，旧端默认仅 1、当前 v2 返回 415。v2 自动更新包已接入，以上传时固定的已发布 v2 为基准，携带完整基准／目标与所有差异，仅放变化所需本地载荷；full／update 都验签保存后任务 READY。产物记录绑定 baseReleaseId 与 baseManifestSha256；公开 packages 核对基准及平台，摘要参数可选但建议传入，不匹配回退 full。没有已发布基准、跨格式或无共享平台只生成 full；损坏基准明确失败。removalPolicy=retain，不自动删除 preserve／玩家文件。旧 READY 与签名不补写，Launcher 安装尚未接入。v1 保留；v2 分发本地模组 JAR 与覆盖文件，远程模组及环境交给 Launcher，Worker 不下载其二进制，沿用同一套客户端／发布系统。
- 数据库模型与权限矩阵见 [docs/minimal-data-model.md](docs/minimal-data-model.md) 和 [docs/permission-matrix.md](docs/permission-matrix.md)；具体完成范围见 [docs/implementation-status.md](docs/implementation-status.md)，不要把完整发布流程的设计当作已实现功能。
- 当前阶段（2026-10-11）：已实现 .minecraft ZIP、Modrinth mrpack／已验证 PCL 封装上传／更新、本地 MinIO、独立 Worker、文件校验／CAS、审核／签名／发布与当前版本切换，以及 muapack 平台组包／环境缓存／进度／发布门槛、国内镜像优先与官方回退。旧客户端四个入口已合并为“客户端管理”。标准 API 与自动化脚本共用 ClientDraft／ClientRelease，参见 [docs/client-upload-api.md](docs/client-upload-api.md)。CurseForge／MultiMC、Launcher 增量安装、Redis 调度后续接入；RLS 已接入；旧 v1/v2 Manifest 兼容接口保留，muapack 安装使用包内完整平台清单和启动描述，Launcher 协议仍需联调。
- 启动器源码位于 `G:\Projects\Minecraft\BotWMCS\launcher-template-26.1`。它是基于 Fabric 的 Minecraft 客户端；后端对外提供 REST API，不能把现有占位界面视为已完成后端接入。
- 联合服以既有的 3–5 位纯英文字母 MUA server ID 作为底层标识；展示名称采用别名。不要另造 server ID 体系，大小写规范仍待确定。
- 用户已要求增加 Organization：内部 ID、别名、头像、简介，以及 members、servers、clients。组织管理员统一管理本组织全部服务器和专用客户端，包括正式服、测试服及后续新增资源；普通成员可按单服务器细分授权，不能越权到其他组织。
- 用户最新要求允许组织上传多个独立客户端，每个服务器同时至多绑定一个客户端。当前按每个客户端同时至多绑定一个服务器实现；可解绑后改绑同组织服务器，不同时跨服共享、不跨组织绑定。客户端使用独立 ID，新记录 UUID，旧 ID 保留。名称在组织内 NFKC／忽略大小写查重，归档不释放；同名必须使用更新。CLIENT_BIND 检查双方 RBAC，替换原绑定须确认；新客户端待审核发布并启用后按已确认 revision 替换，期间旧客户端继续可用。
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

- 2026-10-11 已接入固定 releaseId 的公开下载刷新（/api/v1/servers/:serverId/releases/:releaseId/packages），只允许当前在线绑定客户端的未归档发布；响应含 refreshUrl、expiresAt、S3 原始 etag，packageSha256 防止续传替换文件，GET SigV4 支持 Range／If-Match。v1 分发与 v2 对齐，核对基准身份／平台／摘要与 full／所选 update 的 OSS 大小／摘要，新 v1 保存 baseManifestSha256，旧 READY 推导兼容但不改写。v1 基准摘要为包内平台清单，不能使用旧 Manifest 摘要代替。见 [下载契约](docs/launcher-download-api.md)。
