# 实施进度

2026-10-12：服务器永久／区间展示已接入：超管网页配置北京时间、数据库约束及权限、公开目录按当前时间过滤、客户端状态区间小字。过期保留上架开关、绑定和下载；Launcher UI 布局未改。迁移 202610120005_server_display_schedule，见 [服务器展示时间](server-display-schedule.md)。

更新时间：2026-10-12。当前阶段已完成 .minecraft ZIP、Modrinth mrpack 和 PCL 封装的上传／更新，及审核发布、muapack 组包、环境镜像下载与 PostgreSQL RLS。本文区分实际运行功能与后续工作；详细协议见[客户端上传文档](client-upload-api.md)、[Modrinth 导入](modrinth-import.md)、[环境下载源](environment-download-sources.md)、[Launcher 下载与刷新](launcher-download-api.md)。

## 已实现

- 2026-10-12：PostgreSQL RLS 已接入并部署本地数据库，21 张业务表强制行策略，web／auth／public／worker 独立受限账号与事务局部身份；原有应用 RBAC、完整性与签名保护保留。数据库备份位于被忽略的 `.local/mua-before-rls.dump`，四连接检查和 3001 HTTP 检查通过，前端／Worker 已在外置 PowerShell 窗口重启。实际受限角色、测试、生产部署与恢复边界见[行级保护](postgresql-rls.md)。

- 2026-10-12：登录与管理界面支持简体中文／英文、白色／黑色主题；顶部可切换，Cookie／localStorage 恢复偏好，菜单、表单、表格、上传／审核／图片／设置及探测提示已适配。业务内容和协议标识保留，原认证、权限及路由不变，见[界面偏好](interface-preferences.md)。

- 2026-10-12：Settings 新增仅 MUA 超管面板会话可管理的 muapack 最大上传大小，默认 1024 MB，整数范围 1–20480 MB，保存并审计。网页／标准 API／Actions 的 v1／v2 新建源包上传共用实时校验，超出配置返回 413，已有上传及历史继续可用；不限制生成产物大小，见[上传大小设置](upload-size-settings.md)。

- 2026-10-12：服务器管理／详情／总览目录的真实 MC Java 探测灯已接入，绿／黄／红表示有效在线、默认 ≥300ms 和连接／协议失败，灰表示未配置／探测中／归档／探测服务故障。后台按保存地址发送状态握手与匹配 Pong，悬停显示时延、失败原因等；缓存、四路并发、总超时、SRV、公网 DNS 固定与逐请求／返回前 RBAC 已实现。无需数据库迁移，不改变上架或发布；历史监控和 Bedrock 尚未接入，见[服务器探测](server-probe.md)。

- 2026-10-12：服务器“图标对象键”替换为“服务器箴言”真实图片上传／编辑，61:23 默认比例三分网格裁剪、保留原图重裁剪及最左侧图片列／61.8034% 起向白色淡出。私有 MinIO 存储、服务端解码及摘要校验、SERVER_READ／SERVER_EDIT、同源与修订冲突保护已接入；无数据库迁移，旧发布内容不变。详见[服务器箴言图片](server-motto-images.md)。

- 2026-10-12：Server／Listing／状态入口合并为“服务器管理”，同一表格和编辑／详情窗口展示服务器资料、排序／颜色、上架及客户端绑定状态。SERVER_EDIT 控制资料编辑，超管控制展示及归档／恢复，只读角色可查看；旧入口跳转 /admin/servers。沿用既有 API 和逐请求 RBAC，无模型或发布内容变更；后续已接入独立 MC Java 连接探测灯。

- 更新默认选首次发布格式，仍可手动跨格式；超管 Settings 管理开放格式（默认 v1／v2、至少一种），上传界面隐藏关闭的格式，REST／Actions 创建上传同步校验。已有任务／历史发布不受关闭影响，首次发布格式由真实发布历史提供。设置审计、数据库约束及 RBAC／HTTP／继续组包回归已验证，见[开放格式设置](package-format-settings.md)。
- 开发日志修复：跳转首页与后台认证入口显式关闭该段 instant 校验，保留每次请求的认证／RBAC；Tremor 图表使用不同组件 key 和独立系列渐变 ID，支持中文系列名称；Prisma 的 pg 连接显式开启 pipeline，并验证查询失败后事务仍中止／回滚。独立 PowerShell 启动脚本使用 UTF-8，并只在该窗口移除不受当前 npm 支持的继承配置。`/api/session` 不是现有后台接口或源码调用；排查重复 404 时应检查浏览器 Network 的 Initiator，不新增伪造会话接口。
- 新 v2 使用 protocolRevision:2，清单移除 supportedPlatforms，差异移除 platformsChanged，发布与更新不检查平台；单一 universal 后台任务。旧 API 平台输入不限制新修订，配置 API 仍拒绝 v2，历史审核目标／清单／签名保持，v1 继续按平台组包。
- 固定 releaseId 的 S3 预签名 GET 链接刷新、etag／expiresAt／refreshUrl、packageSha256 续传身份保护；同一当前绑定客户端的历史发布可刷新，归档／删除／解绑／下架仍拒绝。v1/v2 分发校验对齐：已发布清单、基准身份／平台／摘要、完整包及所选更新包的 OSS 大小／摘要。新 v1 记录基准摘要，旧 READY 推导兼容。实际 SHA-256 与签名仍须下载端验收。

- Next.js App Router、shadcn/ui dashboard-01、TanStack Table、React Hook Form／Zod 与 Tremor Raw 图表；导航按真实权限隐藏入口和空分组。
- 21 个 Prisma 模型、4 个枚举、16 份迁移。账号、组织、成员、单服授权、独立客户端／可变服务器绑定、草稿、不可变 Release、当前发布引用、审计、本地认证、ClientUpload、ApiToken、WorkerHeartbeat，以及 PackageBuild／CAS 引用与回收／下载及开放格式设置。
- 白名单用户名／密码登录、scrypt、数据库会话和限流；来源校验、Cookie 保护、成员撤权及停用立即生效。MUA OIDC／YGG 尚未接入。
- 组织与服务器资料、成员管理、展示排序／颜色／上架、归档／恢复和审计。组织／服务器登记与全局展示仍由超管控制。客户端归档要求 CLIENT_ARCHIVE，默认授予组织管理员和服务器管理员。
- 同组织允许多个独立客户端；组织内名称归一化查重，同名提示更新。每服同时至多绑定一个客户端，每客户端同时至多绑定一个服务器。新增绑定／解绑与替换确认；解绑保留客户端当前发布及历史，待绑定新客户端在审核发布并启用后替换。新 Manifest v2 使用 clientId，旧 v1 保留字节与签名、限制原服使用。
- 单一“客户端管理”表格，添加／更新上传窗口、拖拽和点击选择、分片进度、Java 7–25、版本资料、自动识别的只读模组表格（搜索／排序／分页）、Summary 与 Markdown Description。更新预填旧资料，必须上传完整 ZIP 并填写新版本号。
- 浏览器直传私有 MinIO 分片对象；服务端检查分片大小、数量与 ETag 后排队。大对象合并不持有数据库业务写锁。上传任务支持取消、失败重试和过期分片回收。
- 格式、游戏根目录、运行环境与模组发现统一在 pack-inspection 格式适配器注册表。支持 .minecraft ZIP 的 PCL clientVersion、HMCL patches、标准 JSON／继承与游戏 JAR 内 version.json；MC、Java、加载器及来源可识别。Worker 先持久化 detectedInfo／detectedMods，再开始 CAS，前端显示“正在识别客户端信息”并提前回填，之后显示校验／去重。客户端发布版本手工填写；缺失或冲突可确认，回填不覆盖后续手工调整。
- 多独立实例暂停等待选择，选择接口检查上传所有者、RBAC 与基准，再由 Worker 重新识别。支持版本隔离 mods，保留真实路径并忽略其他版本目录；隔离个人设置使用 preserve，私有 PCL／HMCL 设置不分发。detectedMods 为提交事实来源，API／自动化可省略 mods 与已识别的 MC／Java。模组 JAR 内名称、版本和依赖解析仍未实现。
- 官方正式版 Java 对照已生成 103 条记录，runtime:sync 按官方 SHA-1 校验更新，可选加入快照。旧版无 Java 声明时标注推荐值，未知未来版本不猜测；Worker 正常导入无需外网。元数据仅安全读取，不执行上传代码或访问包内下载 URL。
- 独立 Worker 使用 PostgreSQL 持久任务、租约、心跳、中断恢复。ZIP64／压缩 ZIP／UTF-8 路径、路径校验、CRC32／SHA-256、安全流式处理；不会直接将用户路径解压到文件系统。
- 文件策略 managed／preserve、SHA-256 CAS 去重、与当前 Release 对比、新增／修改／删除数量、客户端大小、新增 CAS 数据、玩家预计下载量和 CAS 文件复用率。指标是实际解析结果，预计下载量不包含玩家本地缓存和网络开销。
- 提交即冻结候选内容；审核绑定修订和 Manifest 摘要，审核通过后生成不可变 Ed25519 签名 Release。发布与启用分别检查权限；审核期间旧版本继续使用，批准发布切换才更新绑定。发布基准发生变化返回冲突。
- Cookie 与受服务器／权限限制的 API Token 使用相同客户端标准 REST 接口。Token 权限与账号当前 RBAC 取交集；没有独立 GitHub Release 系统。client:upload 脚本上传并提交审核，不自动审核或发布。
- 对外服务器目录只包含未归档、已上架且有当前可用 Release 的服务器。当前 Manifest 提供精确字节、摘要与签名；文件下载检查属于当前清单后返回短期 CAS URL。原始 ZIP 私有，未提供公开原包下载。
- Worker／Storage／Signing Keys 页面显示真实运行状态；Settings 支持 Token 创建、撤销和自助改密。
- 超管 Settings／download-settings API 管理 Minecraft／Java 镜像、镜像代理与 JRE／JDK。默认国内镜像优先、官方回退、JRE、镜像代理关闭；大学镜像仅用于静态 Maven，Java 元数据使用官方 API。总代理覆盖 mrpack 和官方环境，MinIO 不走代理；失败回退、哈希／大小校验、超时和故障源退避已实现。缓存身份区分 JRE／JDK 且不包含镜像偏好，旧签名发布不重构。
- 客户端条件删除与 OSS 回收站：已归档下架、无实际／待绑定服务器且 Worker 未处理中即可删除，无论是否曾发布；归档是优先的客户端生命周期状态，发布记录是历史。删除退出列表、释放名称，保留不可恢复标记、不可变发布／签名历史和审计。Worker 回收原包、清单及整包／更新包；CAS 按引用保留共享文件，环境缓存独立保留，回收文件校验后可取回复用。默认保留 7 天，仅超管可在 Settings 修改；Worker 每分钟后台维护。详见[回收站](client-recycle.md)。
- muapack v1 协议基础：六平台模型、整包／更新包、目标／基准完整清单、环境身份、启动配置、文件权限／策略差异、确定编码和独立 Ed25519 签名。只读 ZIP 校验命令逐对象检查 CRC／SHA-256／大小及环境引用；真实 ZIP 与 CLI 测试使用合成内容，不代表游戏启动验证。见[协议](muapack-v1.md)。现有上传／发布 API 已使用持久化 PackageBuild 连接该模型；环境准备与审核并行，审核通过后签名组包，所有必需产物 READY 才允许发布。详见[后台组包](muapack-worker.md)。

## 数据库与安全边界

muapack v2 第 1–5 步已接入：上传选择、共享识别、本地 CAS、平台无关配方、原审核／签名／发布／下载。新目标和包 metadata 均绑定 protocolRevision:2；数据库 supportedPlatforms 仅供历史兼容，新草稿为空。历史非空草稿按原结构生成，READY 字节和签名不补写。迁移 202610120004_v2_platform_independent 开放空集合，不改现有行或 RLS／审核锁。自动更新和固定下载刷新已接入，Launcher 安装待实施。

服务器稳定 ID 为 3–5 位 ASCII 字母，大小写无关唯一，归档不释放。未删除客户端名称组织内唯一、同组织绑定、每服与每客户端至多一个绑定、当前版本同客户端外键及绑定同步、版本唯一性、审批修订匹配和发布内容不可变由数据库约束保护。业务记录禁止硬删除；客户端条件删除采用不可恢复标记，审计仅追加。

ClientUpload 的来源、所有者、基准与准备完成的内容不可修改；状态迁移和草稿绑定受触发器约束。业务写入、发布切换与授权撤销在事务中重新认证。Worker 处理文件期间使用租约，提交结果前重新验证任务所有者当前权限和资源状态。源码包与 CAS bucket 私有，公开下载不接受任意对象键。

本机部署使用十九份迁移、初始化开发 MinIO 的源包／产物、CAS、环境三个私有 bucket 和 Ed25519 密钥。开发密钥只在不存在时生成，保存在 Git 忽略的 .local 中。数据库已启用 PostgreSQL RLS，运行连接为 web／auth／public／worker 独立受限角色（容器映射 127.0.0.1:15432）。生产秘密分离及可信公钥分发需部署时配置，见[部署说明](postgresql-rls.md)。

## 尚待实施

| 工作 | 当前状态 |
| --- | --- |
| muapack v2：分发统计与 Launcher 安装 | 第 1–5 步完成，full／自动 update、审核／签名／发布和基准匹配下载已接入；剩余差异展示、玩家网络量统计和 Launcher 安装待实施；v1 保留 |
| Modrinth／PCL 导入 | 已支持索引、依赖与 Java、覆盖层、远程下载双哈希／大小验证、来源白名单（默认关闭）、HTTP(S) CONNECT 代理、表格字节进度和 optional 全量打包；Launcher 选择尚未实施，见 [导入说明](modrinth-import.md) |
| CurseForge／MultiMC 自动识别与元数据填充 | 当前明确拒绝，尚未接入 |
| .muapack 六平台后台组包、环境缓存与发布门槛 | 已接入持久任务、原版／Fabric／Quilt／已适配 Forge／NeoForge 环境下载和缓存、审核后签名、整包／更新包、平台选择、真实进度、重试、API／数据库发布门槛与公开下载描述；缺少所需环境的平台失败，见 [实施说明](muapack-worker.md) |
| Launcher Manifest 验签和增量安装 | 后端分发 API 已有，未修改 Launcher 源码 |
| Redis 队列 | 当前使用 PostgreSQL 持久任务，不依赖 Redis |
| 任意孤儿对象扫描、未删除客户端源码包清理 | 未实现；只清理过期分片和已追踪的删除回收对象，归档本身保留对象 |
| 草稿跨服复制、撤回审核、Release 归档／恢复及撤销流程 | 当前管理上传、审核、发布和历史版本切换；这些额外流程尚未开放 |
| 图片上传／分发、资讯、活动与 Launcher UI 编辑 | 服务器箴言图片上传／裁剪／后台预览已实现；组织头像、玩家公开图片、资讯、活动与 Launcher UI 编辑尚未接入 |
| CDN 流量、在线检测与容量计费指标 | MC Java 在线／延迟状态灯已接入；历史在线监控、CDN 流量与容量计费尚未接入，不显示模拟数字 |
| PostgreSQL RLS | 已接入 21 张业务表、分离角色／连接及事务身份；应用 RBAC 保留，见[部署与验证](postgresql-rls.md) |
| MUA OIDC／YGG | 后续阶段 |

## 验证与本机运行

### 服务器连接探测（2026-10-12）

TypeScript、修改文件 ESLint、8 项探测协议／地址／缓存检查、7 项服务器管理组件检查及 4 项隔离图片／探测 HTTP 集成检查通过，本机 3001 HTTP 检查通过。真实本地 TCP 测试覆盖匹配 Pong／高延迟、分片、非 MC 服务、无 Pong、整体截止时间下保留有效 MC 状态、连接拒绝与超时；接口检查覆盖 Cookie 身份、组织／单服范围、未配置、忽略任意目标参数、内网拒绝、归档及撤权。

公网示例 demo.mcstatus.io 返回有效状态及 Pong，当次测得 550ms，符合黄灯阈值；当前 NPU 保存地址 test 的 DNS 解析失败，返回红灯及原因，未修改业务地址。浏览器桥接仍不可用，悬停／点击视觉交互未复验；未重跑生产构建与整包全量回归。

### 服务器箴言图片（2026-10-12）

TypeScript、修改文件 ESLint、20 项核心数据库／RBAC 回归、6 项服务器管理组件检查和 4 项图片集成检查通过；本机 3001 HTTP 检查通过。真实图片测试使用随机 PostgreSQL schema／MinIO 桶和隔离 Next 开发实例，覆盖 multipart 上传、受权限保护的 WebP 读取、原图重裁剪、移除、并发／来源／范围／归档保护及解码／方向纠正。测试资源已清理，未向既有业务服务器写入图片。

推荐比例、三分网格和从 61.8034% 起向白色淡出的组件结构已检查。浏览器桥接重置后仍返回 `nodeRepl.fetch request failed`，拖动／触摸交互与视觉复验尚未完成；未重跑生产构建和整包全量回归。旧图片及未绑定图片对象保留，自动回收尚未接入。

### 服务器管理合并（2026-10-12）

TypeScript、修改文件 ESLint、20 项核心数据库／RBAC 回归及 5 项服务器管理组件检查通过。组件覆盖超管统一表单、组织／单服编辑、只读／审核角色、归档资源及真实分发／绑定状态；数据库检查保留字段升级拒绝和单服范围保护。当前 3001 开发实例 HTTP 检查覆盖统一导航、17 个模块入口及旧服务器／客户端路由跳转，登录／来源／存储等检查通过。

浏览器内置会话不可用，Edge 扩展桥接返回 `nodeRepl.fetch request failed`；此次未完成浏览器交互及视觉复验。没有通过页面修改既有服务器资料或发布，未重跑完整组包测试或生产构建。

### 通用 v2、固定链接刷新与 v1 分发校验（2026-10-11）

按三步完成：v2 移除架构选择／新草稿统一目标；固定 releaseId 刷新并提供包摘要保护、ETag 与到期时间；v1 补齐基准和存储产物校验，旧 READY 不重写。新[下载契约](launcher-download-api.md)与中英双语 [HTML spec](muapack-spec.html)同步，协议示例／旧签名保留。

下载专用测试 35 项、UI 测试 5 项通过。全套后端回归当次 151 项通过、3 项可选检查跳过；其中原跳过的生产 HTTP／Actions 流程随后使用实际 Next 构建单独运行通过，另两项真实导出包网络验收本次未重跑。隔离 PostgreSQL schema／MinIO bucket 验证 v1 五平台完整／增量包、v2 全平台同字节、固定目标跨版本切换、跨客户端／解绑／归档保护，以及 S3 Range 206、Content-Range 与 If-Match 412。新下载服务测试覆盖缺失对象、大小／摘要不符、基准身份／来源错误、刷新摘要冲突及旧 v1 摘要推导。

类型检查、全仓 Lint、最终生产构建通过；HTML 本地链接、JSON 示例及结构检查通过，隐藏 Edge 检查 1440／390 宽度无页面溢出，新增双语续传章节截图已检查。没有改写现有业务发布／签名，也没有改动 Launcher 源码；实际端侧续传、验签安装与游戏启动仍需联调。

### muapack v2 自动增量组包（2026-10-10）

第 5 步完成：上传时固定的当前已发布 v2 清单作为更新基准，Worker 在审核后同时生成 full 和 update。更新包带精确基准／目标、完整目标 mrpack 索引、全部文件／optional／地址／运行要求变化与变化所需本地载荷。远程模组与环境不下载；零变化允许零载荷。无发布基准、跨格式或平台无交集只生成 full，未发布草稿只作后台对比。基准损坏明确失败；full／update 均校验后才 READY，缺失 update 禁止发布。removalPolicy=retain，preserve／玩家文件不自动删除。

公开 packages 根据 acceptedFormatVersions、baseReleaseId、平台和可选 baseManifestSha256 返回 update／full；不匹配回退目标 full，并附 full 修复信息。管理完整下载始终 full，发布包详情显示真实 full／update 大小。当前生成一个固定基准的直接更新包，不组合历史更新链；旧 READY／签名不补写。增量分发不表示 Launcher 已安装或应用更新。

完整后端 122 项：120 通过、2 项可选实包默认跳过；包括隔离生产 HTTP／Actions 的自动增量实际下载验签、摘要不符回退，以及 v1 全流程、跨格式、未发布对比、零载荷、平台变化、optional／来源／环境／启动变化、缺失对象和损坏基准。4 项组件渲染、52 项冻结协议、TypeScript、ESLint、Prisma validate 和 .next/mua-v2-delta 生产构建通过。

真实 PCL 实包另外完成隔离 v2 1.0.0 → 1.1.0 同内容升级、审核、full／update 生成与验签、发布检查：132 文件（17 本地、115 远程），完整包 185,252,377 字节，更新包 62,010 字节、0 本地载荷，新 CAS 数据 0，远程／环境下载 0。报告在 .local/real-pcl-v2-delta-report.json；测试 schema／桶／产物已清理，没有创建业务发布。

本机 Next（3001）与独立 Worker 已加载 .next/mua-v2-delta，HTTP 与心跳检查通过。无需新增迁移，原十五份迁移保持有效；两份既有发布的 Manifest 摘要／签名及十份 READY 组包记录与部署前一致。Launcher 增量安装、缓存修复、optional 和环境安装仍需接入；页面尚未进行完整浏览器视觉复验。

### 历史：muapack v2 完整组包、审核与发布（2026-10-10）

第 4 步完成，并修复 PCL/config.json、PCL/Setup.ini 在隐私过滤前触发 v2 保留路径拒绝的问题。两种格式同用提交／审核／发布 API；v2 Worker 不下载远程模组或环境，准备跨平台 target 后等待审核，再从本地 CAS 生成完整包、独立域签名、只读逐文件校验并保存 OSS。只有当前必需任务 READY、审核修订一致且存储对象有效才可发布。改选平台递增 packageRevision、新建 universal 任务；旧 READY 字节保留。管理下载和公开完整包能力协商已接入，旧请求不支持当前 v2 时返回 415，不暗中回退历史版本。

后端 119 项回归：117 通过，2 项可选实包检查默认跳过；包含隔离生产 HTTP／Actions 的 v2 提交、审核、组包、下载和发布，以及 v1 全流程、跨格式切换、零本地载荷、签名与平台修订保护。4 项组件渲染、52 项冻结协议检查、v2 校验 CLI、TypeScript、ESLint、Prisma validate 与生产构建通过。

真实 PCL 样本另行完成隔离上传、识别、组包、审核、验签和发布：源包 182,847,230 字节；MC 1.21.1／Java 21／NeoForge 21.1.256；完整目标 132 文件，17 个本地载荷和 115 条远程声明；完整包 185,252,374 字节。远程与环境下载为 0；私有 PCL 配置已过滤。测试 schema、桶和产物已清理，不创建业务发布；报告在 Git 忽略的 .local/real-pcl-v2-report.json。

本机十五份迁移已应用，Next（3001）与独立 Worker 已加载 .next/mua-v2-publish；HTTP 检查和 Worker 心跳通过。两份既有业务发布的 OSS 摘要与数据库签名和部署前一致。已取消的原失败上传保持取消，不恢复或发布用户任务。生产 v2 更新包仍待第 5 步，协议验证 update 样例不代表自动生成；Launcher 安装／optional 选择／环境处理和真实游戏启动尚未验收。新增页面通过组件渲染，尚未进行完整浏览器视觉与交互复验。

### 历史：muapack v2 共享识别与 Worker 导入（2026-10-10）

第 3 步已接入 mrpack／PCL 统一识别与覆盖层：先反馈客户端名称、版本、MC／Java／加载器及模组，再校验本地 overrides 并注册 CAS 引用。远程保留 SHA-1／SHA-512／可选 SHA-256、大小、下载地址、optional／policy，不下载二进制、不安装环境。内部 mua-import-recipe 与旧文件索引分离，回收仅引用本地文件。前端远程状态 DECLARED，明确未验证字节，没有虚构进度；统计区分本地数据和远程声明，不显示假玩家更新量。

v2 上传 READY 只表示导入完成，Actions 返回 uploadId／recipeStatistics；提交、组包、审核和发布仍待第 4 步，API／数据库保留门槛。第十四份迁移 202610100004_v2_recipe_import 已应用，有效旧等待任务可排队，归档资源保留可取消状态。v1 处理、旧签名和下载保持兼容。

后端回归 112 项，111 通过、1 项可选实网 HMCL 测试跳过，包含隔离 Next HTTP／Cookie／Token／Actions、真实 MinIO 本地 CAS、远程不下载、格式锁定、覆盖层／optional、租约恢复、失败重试／撤权、归档删除／回收复用、旧等待迁移及旧数据升级。3 项界面渲染检查与 52 项离线协议检查通过；类型检查、全量 Lint、Prisma validate、生产构建通过。本机 Next／Worker 已切换 .next/mua-v2-import（3001），HTTP 检查通过，原有两份发布 Manifest 摘要与数据库签名保持不变；测试没有创建或修改业务客户端／发布。完整浏览器交互、生产 v2 组包及 Launcher 安装／游戏启动尚未验收。

### 历史：上传前 muapack v1／v2 选择（2026-10-10）

添加／更新必须在实际上传前选择格式，创建后锁定；恢复任务保留选择，取消后可另选。ClientUpload／ClientDraft／ClientRelease 保存 packageFormatVersion，历史和旧 API 默认 v1；提交／发布继承格式，不改写原 Manifest／签名。标准会话和 Token API 共用字段，Actions v2 上传完成后输出 WAITING_PROCESSOR，不虚报提交成功或继续等待。v2 暂只保存源包，专用解析器尚未接入；应用和数据库阻止进入 v1 Worker、提交、组包及发布，等待任务计入限额、名称确认和删除保护。

后端回归 107 项，106 通过、1 项可选真实 HMCL 测试跳过；含隔离生产 HTTP／Cookie／Token／Actions、v2 真 MinIO 上传保存、无 CAS／环境任务、v1 共存、格式锁定／非法值、等待任务取消／归档删除、旧数据升级与签名保护。另有 2 项客户端格式选择渲染／契约检查通过。类型检查、全量 Lint、Prisma validate、`.next/mua-format-choice` 生产构建及本机 HTTP 检查通过；52 项 v2 离线协议检查保持通过。

本机已应用第十三份迁移 202610100003_package_format_choice，Next（3001）与独立 Worker 已切换；原有两份正式发布的 OSS Manifest 摘要和数据库签名保持不变。未创建／修改／删除业务客户端或发布；新增操作由随机测试 schema／MinIO bucket 验证。完整浏览器交互和真实 Launcher v2 安装仍待后续验收。

### muapack v2 协议与离线样例（2026-10-10）

已冻结完整／更新包容器、归一化本地 overrides、完整远程索引、SHA-256／SHA-512 来源描述、optional／managed／preserve、基准和目标摘要、环境要求、跨平台配方及独立 Ed25519 签名域。生成两个混合 mrpack 输入、基准完整包、目标完整包和对应更新包；使用临时测试密钥，仅保存包外公钥。

离线检查 52 项通过，包含签名／CRC／载荷／目标与基准／索引／差异重算、零内容更新、本地 optional 切换和 preserve 移除声明，以及 29 项非法输入拒绝。样例无联网下载、数据库写入或真实环境安装；不代表 Launcher 修复／保留／回滚或游戏启动已实现。具体产物、摘要和复核命令见[样例说明](examples/muapack-v2/README.md)。本次没有迁移、生产业务流程变更或服务重启，下一步为上传前 v1／v2 选择与模型／API。

### 归档后的已发布客户端删除（2026-10-10）

归档成为优先的客户端生命周期状态，客户端列表／详情 API 返回 lifecycleStatus；已归档下架、无实际／待绑定且无活动 Worker 任务的客户端，无论是否曾发布，都可由 CLIENT_DELETE 账号删除。归档客户端退出待审核／已发布列表，版本记录在已归档页面保留。客户端删除不改写发布、签名或审计历史，管理下载和后续操作返回 404，身份不可恢复；Worker 回收源包、候选／发布 Manifest、平台清单及整包／更新包，按引用保护共享 CAS，环境缓存独立保留。

迁移 202610100002_archived_client_deletion 仅替换身份／删除触发器，不回填或重写业务记录；保留名称、授权来源、先归档、无绑定、任务保护及删除不可恢复条件。完整回归 105 项，104 项通过、1 项可选真实 HMCL 样本测试跳过；包含升级后的旧发布客户端删除、发布前拒绝、归档优先、HTTP 权限／来源／删除／404、不可变签名历史、整包／更新包回收、共享文件／环境缓存保护、回收复用及七天清理。类型检查、全量 Lint、Prisma validate、生产构建及本机 HTTP 检查通过。

本机已应用十二份迁移，Next（3001）切换 `.next/mua-archived-delete`，独立 Worker 已更新且心跳正常；现有两份正式发布的 Manifest／签名摘要保持不变，没有执行业务客户端删除。界面删除确认的浏览器视觉复验尚未完成。

### 未发布草稿生命周期（2026-10-10）

新增未发布版本的撤回／归档入口与标准 API，DRAFT_ARCHIVE、真实客户端范围及修订保护；活动组包取消租约，READY／CAS／源包不删除。上传选择明确的 comparisonDraftId，独立展示草稿对比与玩家已发布基准更新量；成功发布原子归档 replacesDraftId 可达的未发布祖先，独立草稿及已发布历史保留。已有未发布记录可在发布确认选择替代对象，或单独归档，不追溯猜测业务关系。归档记录可在客户端历史及“已归档版本”页面读取。

版本判断支持 SemVer（数字、预发布、构建元数据）及自定义标签内部 versionSequence。迁移 202610100001_draft_lifecycle 不改写历史 Manifest／签名。规则及 API 参数见[草稿生命周期](draft-lifecycle.md)。当前预览构建目录为 `.next/mua-draft-lifecycle`。

最终完整回归 104 项，103 项通过、1 项可选真实 HMCL 样本测试跳过；包含新归档 HTTP API、作用域／来源／修订校验、草稿替代链、归档与发布竞争、含已删除历史记录的数据库升级及既有上传／组包／签名协议。类型检查、全量 Lint、生产构建和本地 HTTP 检查通过。上线时序号回填曾被已删除客户端保护触发器阻止，已核对部分迁移状态后事务性完成回填并恢复全部保护，Prisma 确认无待执行迁移；现有两个正式发布的 Manifest 与签名摘要保持不变，Next 和 Worker 已更新。

### 更新统计文案（2026-10-10）

更新上传窗口显示“更新版本”。有当前已发布基准时按文件差异显示“玩家预计更新”；没有基准则显示“预计首次安装”，明确审核通过不等于发布并启用。上传阶段统计整合包文件，不包含后续组装的 Minecraft／Java／加载器环境。现有无基准草稿不会追溯改成增量发布，已签名产物保持不变。类型检查、Lint、生产构建、15 项 muapack 协议测试及三种统计组件渲染检查通过；当前预览构建目录为 `.next/mua-draft-lifecycle`。

### Linux ARM 默认选项（2026-10-10）

linux-aarch64 默认不勾选、灰色禁用，并提示“Minecraft 目前暂未支持 ARM 版 Linux 系统”。新上传及 API 省略 platforms 时只选择其余五项；既有草稿仍允许取消 Linux ARM，保留六平台协议与历史签名。协议／上传回归 41 项，40 项通过、1 项可选网络测试跳过，包含五平台默认任务及六平台显式清单兼容；组件渲染核实禁用和未勾选状态，类型检查、Lint、生产构建通过。本机 Next 已使用 `.next/mua-forge-warning`，HTTP 检查通过，Worker 和既有发布保持不变。

### 完整包管理下载（2026-10-10）

客户端管理表格已增加“下载完整包”，选择 READY 草稿／发布版本和平台，显示完整包大小；无完整产物时不可点击。后台接口重新校验 DRAFT_READ／RELEASE_READ、客户端归属、平台选择、READY 和 OSS 大小／摘要，返回五分钟附件下载链接。始终下载完整 muapack，不因存在更新包而返回增量包；未绑定／未上架客户端可由有权限账号下载，不开放玩家分发。

上传／发布集成回归 26 项，25 项通过、1 项可选 HMCL 网络测试跳过，包含新增实际 MinIO 下载与附件文件名、缺失对象、未完成状态、跨组织／跨客户端拒绝、发布读取与草稿读取隔离、存在增量包时仍下载整包，以及隔离生产 HTTP 接口测试。类型检查、Lint、`.next/mua-pack-download` 生产构建通过；本机 Next 已加载该构建，HTTP 检查通过，Worker 保持运行，既有发布清单与签名保持不变。

### 当前 Forge／NeoForge 阶段（2026-10-10）

已接入官方 spec 0／1 安装器与已适配客户端处理器，生成运行 JAR、平台启动参数及 SHA-256 环境清单，沿用镜像优先、官方回退、审核／签名与发布门槛。宿主处理器 Java 与目标 JRE 分开，未知任务明确失败。缓存新身份只用于 Forge／NeoForge，不改写既有发布；范围及部署配置见 [Forge 环境](forge-environments.md)。

完整回归 99 项，98 项通过、1 项可选 HMCL 网络测试跳过，包括 `.next/mua-forge` 隔离生产 HTTP／自动化脚本流程。类型检查、Lint、生产构建通过。实际 Windows amd64 环境下载、清单引用校验及再次解析缓存复用结果：

| 环境 | 文件数 | 完整字节数 | 目标 Java |
| --- | --- | --- | --- |
| MC 1.20.1／Forge 47.4.0 | 3,994 | 887,355,978 | Java 17 JRE |
| MC 1.21.1／NeoForge 21.1.256 | 4,307 | 1,097,055,356 | Java 21 JRE |
| MC 1.12.2／Forge 14.23.5.2860 | 1,536 | 322,887,015 | Java 8 JRE |

用户提供的 `test_pclFormat 1.0.0.zip` 在隔离数据库／MinIO 桶完成真实分片上传、识别、CAS、审核与 NeoForge 组包：124 个模组、4,439 个目标文件、4,294 个载荷对象，整包 1,719,296,634 字节（约 1.60 GiB）。重新下载并通过 ZIP SHA-256、CRC、签名、清单与环境引用校验；没有创建业务发布。报告保存在 Git 忽略的 `.local/real-neoforge-worker-report.json` 和三个 `*-environment-report.json`，测试资源已清理，正式环境缓存保留复用。

本机 Next 已切换 `.next/mua-forge`（3001），独立 Worker 已重启并有新鲜心跳；`check:http` 通过，原有一份发布的 Manifest／签名摘要与部署前一致。宿主处理器 Java 配置为本机 Java 21；因确认 NeoForge 系统 DNS 返回错误地址，开启 DOWNLOAD_DNS_OVER_HTTPS，未修改系统 DNS。默认配置仍关闭加密 DNS，镜像载荷代理仍关闭，总代理保留既有启用状态。

此前 15 条 FAILED 业务组包任务没有自动重排或发布；可以使用既有重试入口。未知安装格式、NeoForge 1.20.1 历史坐标及缺少目标平台环境仍可能失败。本次验收不代表 Launcher 已安装、玩家 optional 已启用或六平台真实游戏已启动。

### 镜像阶段记录（2026-10-10 复核）

镜像阶段完整回归 92 项，91 项通过、1 项可选真实 mrpack 网络测试跳过，包含 `.next/mua-mirrors` 隔离生产 HTTP 流程；类型检查、Lint、Prisma validate、生产构建通过。2026-10-10 又复跑环境／Modrinth 22 项，全部通过。实网 BMCLAPI 元数据／Fabric／Maven、中科大／南大 Maven、清华 JRE 及官方 Minecraft 回退已验证；清华 JRE 归档 58,475,080 字节，上游 SHA-256 校验通过。

完整 Minecraft 26.1／Fabric 0.19.5／Windows amd64／Java 25 JRE 环境已下载并校验：5,149 文件、759,236,155 字节，其中 Java 320 文件；有 bin/java.exe，无 bin/javac.exe。2026-10-10 重读环境清单及校验引用、再次解析复用缓存成功。旧 JDK 缓存仍保留，既有一份发布 Manifest 的 OSS 字节摘要及签名摘要与部署前一致。

本机 Docker 原有卷保持不变，PostgreSQL／MinIO／Redis 已恢复，生产预览和独立 Worker 已启动且有新鲜心跳。`check:http` 通过；实际下载设置 GET 与数据库一致，普通账号 403、未登录 401、重复镜像配置 400、跨站 PATCH 403；临时会话已清理，配置未改变。十份迁移已应用，新增设置在运行构建中可读取。当前设置为 BMCLAPI／中科大／南大、清华、JRE、镜像代理关闭，官方总代理保持原启用状态。

该镜像阶段的检查不代表六平台游戏启动或 Launcher 安装已验收。当时 Forge／NeoForge 安装器仍缺失；后续接入结果见本节上方。2026-10-10 再次尝试视觉复核时，computer-use 的 node_repl 内核初始化失败（windows sandbox: helper_unknown_error，setup refresh had errors）；设置卡片的浏览器视觉验收仍未完成。

复核时现有业务组包记录为 15 条 FAILED、3 条 QUEUED：12 条失败指向未接入 Forge／NeoForge，1 条缺少 Minecraft 26.1 Linux aarch64 原生库，另有超时和中断各 1 条。未自动重排或改写这些业务任务；Worker 心跳正常不等于所有客户端已完成组包。超时／中断可按原任务重试接口处理，不应直接归因为镜像缺失。

### 历史阶段记录

以下计数与运行结论属于对应历史阶段；当前状态以本节上方 Forge／NeoForge 复核及 README 为准。

muapack 组包阶段通过 71/71 测试，包括独立生产构建 `.next/mua-mirrors` 的隔离 HTTP API／自动化脚本、真实 MinIO 整包／更新包下载验签、六平台任务、失效租约、取消／重选平台、旧方案审核拦截、缺失 OSS 产物和数据库发布门槛。TypeScript、ESLint、Prisma validate、生产构建与本机 HTTP 检查通过。实际官方 Minecraft 26.1 + Fabric 0.19.5 + Windows amd64 Java 25 环境下载／校验并复用缓存成功：5,260 文件、874,866,875 字节，包含 4,750 个独立资源对象。新构建与 Worker 已在本机启动，原有发布清单与签名摘要保持不变。浏览器工具因 Node runtime 路径缺失无法启动，新增平台与进度界面未完成视觉复验；真实游戏启动仍未验证。

另在隔离数据库／临时客户端源包与产物桶使用上述真实官方缓存运行完整 Worker：识别 `.minecraft` 的 HMCL/Fabric 元数据，生成 READY 整包 877,039,791 字节（约 836 MiB），5,261 文件／5,056 个去重载荷对象，完成分片上传、再下载 ZIP SHA-256 校验及协议／签名／逐对象 CRC 校验。未创建业务发布，检查后清理隔离 schema／桶／临时包，仅保留可复用的正式环境缓存。该测试验证真实环境组包，不代表已执行游戏。

muapack 协议阶段完成 65/65 测试（原有 50 项和新增 15 项），包括独立生产构建 `.next/mua-protocol` 的隔离 HTTP 流程。新增测试覆盖真实整包／更新 ZIP、六平台声明、零载荷更新、内容去重、环境与客户端范围、签名／内容篡改、确定编码、CLI 及文档示例。TypeScript、ESLint 和独立生产构建通过；该构建用于验证，没有替换当前 `.next/mua-recycle` 预览或重启业务 Worker。

TypeScript、ESLint、生产构建、迁移和存储初始化通过。50 项测试通过（包含真实 PostgreSQL／MinIO 与隔离 HTTP 流程），包括 mods 自动识别／替换、非 JAR 与其他目录过滤、API 模组篡改忽略及无 mods 参数的自动化上传、格式适配器共用入口、旧记录迁移兼容、多客户端名称查重、确认绑定／解绑、审核后替换与绑定并发冲突、65 MiB 两分片、ZIP64／压缩／Unicode、损坏和危险 ZIP、CAS 增量统计、不可变版本、过期租约恢复、RBAC／Token 撤权，以及隔离 Next 实例的标准 API 上传脚本、审核发布与签名下载。

HTTP 本机检查覆盖登录、来源／输入保护、会话撤销、权限收缩、19 个模块入口与旧路径跳转、客户端 API 和实际存储状态。上一阶段内置浏览器验证过统一表格、更新预填、上传区、Java 7–25、Markdown 预览及窗口／输入跨轮询保留，旧截图在 .local/client-upload-preview.png。本次界面检查工具仍无法启动 Node runtime，新增模组表格及绑定界面的交互和视觉复验尚未完成。完整上传／审核／发布和绑定 API 在隔离 HTTP 集成测试中完成，没有向现有业务服务器写入测试整合包。移动端视觉检查尚未完成。

本次新增验证覆盖识别先于 CAS、CAS 期间可轮询到环境、PCL／HMCL／继承／JAR／冲突、官方 Java 边界、多实例暂停／权限／HTTP 选择、隔离模组与 preserve／隐私排除、运行环境缺省 API 及回填保留手工编辑。直接只读识别用户 test_client 样本得到 PCL MC 1.21.1／Java 21／NeoForge 21.1.256、HMCL MC 26.1／Java 25／Fabric 0.19.5，均无识别警告。浏览器工具仍报 Node runtime 路径不存在，新阶段提示和选择菜单尚未进行可视化复验。

删除验证覆盖真实 RBAC／条件、数据库保护、名称重用、取消任务、原包与 CAS 回收、共享及已发布历史保留、七天过期、回收命中零新增数据、损坏对象拒绝、并发上传／清理、历史索引异常暂停与晚到 S3 完成重试。实际 HTTP 覆盖删除、超管设置及来源保护。删除确认和设置表单尚未完成浏览器视觉复验。

本机生产预览地址 http://localhost:3001，当前构建目录 .next/mua-archived-delete，Worker 独立运行，上传与组包分别处理。重启步骤见 [README](../README.md) 和[客户端上传文档](client-upload-api.md)。这些是本地进程，不是 Windows 自动启动服务。

Modrinth 阶段完成 82 项回归（包含隔离生产 HTTP API／Actions 脚本）；可选真实网络测试单独通过 HMCL 样本的 Worker 下载、上游 SHA-1／SHA-512、CAS 与 MinIO 验证。PCL 真包只读解析验证 MC 1.21.1／Java 21／NeoForge 21.1.256、124 个模组；因 NeoForge 环境未接入，没有宣称可发布或游戏启动成功。类型检查、Lint、Prisma 验证、独立生产构建和本机 HTTP 检查通过；九份迁移已应用，本地 Next／Worker 已加载新版本。浏览器工具仍无法启动 Node runtime，新增表格和设置卡片的视觉验收尚未完成。
