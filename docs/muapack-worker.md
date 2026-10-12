# muapack 后台生成与分发

2026-10-09：已接入上传、审核、Worker、发布 API 与管理页面。输入支持完整 `.minecraft ZIP`、Modrinth `.mrpack` 与本次 PCL 封装；没有另建 Release 系统，见 [导入说明](modrinth-import.md)。

2026-10-10：上传前选择 v1／v2。下文环境准备、多平台物理组包与生产更新包规则用于 v1；v2 已接入单一跨平台完整配方、原审核／签名／发布及下载，不下载远程模组或运行环境。v2 任务使用 universal 和 packageRevision，改选平台生成新任务并重新审核，不改写旧 READY 包。公开完整包显式协商 acceptedFormatVersions，详见[v2 协议](muapack-v2.md)与[标准 API](client-upload-api.md)。v2 自动增量组包已接入，基准固定为上传时的已发布同格式版本；full／update 均验签保存才 READY。基准／平台不匹配使用 full，preserve 不自动删除；Launcher 安装留待后续。

## 使用流程

1. 添加／更新客户端，选择发布平台，默认选择除 linux-aarch64 外的五项。linux-aarch64 默认灰色禁用，提示“Minecraft 目前暂未支持 ARM 版 Linux 系统”；既有草稿已选择此项时仍可取消。API 的提交参数可带 `platforms`，省略时同样默认五项；协议仍保留六种平台，显式选择和历史清单兼容。
2. 提交后创建持久化 `PackageBuild`，每个平台一条。Worker 根据官方元数据准备 Minecraft、原生库、资源、加载器和 Java（默认 JRE），按超管配置优先下载镜像、失败回退官方，生成固定平台清单。
3. 未审核时任务停在 `PREPARED`，不生成签名包。审核可以与环境准备并行。
4. 审核通过后 Worker 封装签名整包。若上一当前发布有对应平台清单，同时生成“上一当前发布 → 新版本”更新包；否则此平台只有整包。
5. 每个包落盘后逐对象校验 CRC／大小／SHA-256／签名／环境清单，再分片上传 OSS。所选平台全部 `READY` 后才能发布。
6. 发布事务再次检查 RBAC、审核修订、客户端基准修订、产物状态、清单摘要和 OSS 大小／摘要元数据，数据库触发器也拦截未完成的发布。发布成功才切换版本与已确认的服务器绑定。

客户端表格每 5 秒显示真实平台进度；“组包 / 平台”列出阶段、错误、包大小和重试。上传可以关闭页面，Worker 不依赖浏览器。审核通过后改变平台选择会清除当前审核结论，重新进入审核；相同选择不清除审核。内容和启动描述不能原地更改，必须上传新版本。

客户端管理表格提供“下载完整包”：选择已生成的草稿／发布版本和平台，显示包大小；没有 READY 完整包时按钮不可点击。下载始终使用完整 `.muapack`，即使已有更新包也不返回增量包。后台下载不要求服务器上架或绑定，仍检查客户端范围及 DRAFT_READ／RELEASE_READ；不改变玩家公开分发规则。

平台方案使用独立 `packageRevision`，调整时递增，审核记录 `reviewedPackageRevision`。审核 API 同时校验 `contentRevision` 与 `packageRevision`（首次方案省略后者兼容为 1）；旧审核窗口对已改变的平台方案返回 409。取消正在处理的平台使旧租约失效；仍被选择的平台若签名期间审核失效，则回到等待审核，不能发布旧审批方案。

状态为 `QUEUED → PROCESSING → PREPARED → PROCESSING → READY`，失败为 `FAILED`。进度按实际阶段和已经读取的载荷对象数推进，环境下载另报实际资源文件计数。百分比是阶段权重，未宣称为网络字节百分比。任务有 120 秒租约、10 秒续期、2 小时上限；失效租约最多自动重领 3 次，失败可手动重试。完成产物和已发布记录不可修改。旧客户端仍继续分发。

## 环境与平台边界

- 当前环境解析器支持原版、Fabric、Quilt，以及已适配 spec 0／1 安装描述的 Forge／NeoForge。官方客户端处理器生成运行 JAR，未知任务明确失败；宿主 Java、支持范围和校验见 [Forge 环境](forge-environments.md)。
- 从 Mojang 官方目录校验版本元数据和 SHA-1，从 Fabric／Quilt Meta 获取加载器，Forge／NeoForge 使用官方 Maven 安装器和处理器；Maven 库校验官方 SHA-1，Java 使用 Adoptium API 和发行包 SHA-256。所有缓存／载荷统一 SHA-256 寻址。
- 环境下载使用内置官方／镜像映射与逐跳 HTTPS、公开 DNS／固定 IP 校验；BMCLAPI 可转向公开 HTTPS CDN。最多 4 个并发文件，无多段 Range；响应头 20 秒，镜像单次总下载 5 分钟、官方 10 分钟。总代理控制官方环境及 mrpack 下载，镜像代理开关默认关闭；MinIO 不走代理。mrpack 白名单不作用于环境源，详细覆盖与失败退避见[环境下载源](environment-download-sources.md)。
- 单个环境文件 2 GiB，Java／原生库解包 10 GiB、20,000 文件；拒绝路径逃逸、混合根目录、特殊文件及外部／循环链接。Java TAR 内部文件链接归一化为普通受校验文件，不执行归档内程序。
- 版本、加载器、Java 主版本、JRE／JDK imageType、平台和解析器版本共同确定缓存入口；镜像偏好不参与内容身份。首次选择精确 Java 构建后固定，不因供应商 latest 更新而悄悄改写。新清单显式记录 imageType，旧清单可缺省；不改写旧发布与签名。相同入口以独立 PostgreSQL 锁合并并发准备。
- 所有平台共享按上游摘要索引的文件缓存，避免重复从互联网下载同一 Minecraft JAR／资源。环境存储独立且保持私有，不参与客户端七天回收。未来需要单独制定环境淘汰策略。
- 六个平台是可选目标集合，不保证每个游戏／加载器／Java 组合都存在完整环境。2026-10-09 实测官方 Minecraft 26.1／Java 25 资料：Adoptium Windows aarch64 Java 25 的 JRE 列表为空，Minecraft 官方清单缺少 Linux aarch64 原生库。缺少所需环境的任务失败并阻止发布，需要管理员取消该平台或补充可信适配；JRE 不自动改用 JDK，超管可明确选择 JDK，但仍需满足全部游戏环境要求。不能用其他架构文件代替。

独立环境桶 `S3_ENVIRONMENTS_BUCKET` 默认 `mua-environments`。`npm run storage:init` 创建源包／产物、客户端 CAS、环境三个私有桶。环境 `manifests/<sha256>.json` 和对象 `sha256/<前两位>/<sha256>` 不可变。

平台清单从官方环境与已校验的实例文件合并：排除上传包的其他版本、旧 libraries／assets／runtime／natives，选中实例的隔离 mods／config 等移至实例根目录。发布内容由平台完整清单锁定。当前只保留官方启动参数，内存默认自动模式（最低 1024 MiB、建议 4096 MiB），无启动前命令；手工启动配置编辑尚未提供。

旧 `/manifest` 与 `/files` 接口继续提供原 v1/v2 客户端清单兼容内容；其原始运行文件不等于新平台环境。muapack 安装必须使用包内目标完整清单与启动描述，不得把旧清单当作已包含新 Java／加载器的跨平台安装协议。

## API

| 方法和路径 | 作用与授权 |
| --- | --- |
| POST `/api/v1/clients/uploads/{uploadId}/submit` | 原上传接口，可增加 `platforms` 数组；客户端身份／基准／RBAC 校验不变 |
| POST `/api/v1/clients/{clientId}/drafts/{draftId}/platforms` | `{ "platforms": ["windows-amd64"] }`；DRAFT_CREATE、DRAFT_SUBMIT，更新还需 DRAFT_EDIT；取消平台使其旧租约失效，重新选择时恢复排队；审核通过后调整须重新审核 |
| POST `/api/v1/clients/{clientId}/drafts/{draftId}/retry-packages` | `{}`；相同编辑权限，重排必需的失败任务 |
| GET `/api/v1/clients/{clientId}/drafts/{draftId}/package?platform=windows-amd64` | DRAFT_READ；返回 READY 完整包的 5 分钟签名下载 URL、文件名、SHA-256 和大小，检查 OSS 对象；未完成返回 409 |
| GET `/api/v1/clients/{clientId}/releases/{releaseId}/package?platform=windows-amd64` | RELEASE_READ；同一完整包下载契约，支持有权限的历史／归档记录；删除客户端不可读 |
| GET `/api/v1/clients` | 原列表增加草稿 `packageBuilds`，仍检查范围与 DRAFT_READ |
| POST `/api/v1/clients/{clientId}/drafts/{draftId}/publish` | 原接口，未全部生成返回 409，缺失或损坏产物不能发布 |
| GET `/api/v1/servers/{serverId}/packages?platform=windows-amd64&baseReleaseId=<UUID>` | 仅已上架、组织／服务器／客户端／发布均未归档的当前发布；匹配基准则返回更新包，否则整包 |

下载描述包含版本、平台、包类型、基准、ZIP SHA-256／大小、目标清单摘要、签名 key ID、5 分钟 S3 下载 URL，并同时提供整包回退。客户端目录增加 `packagesUrl`。桶不开放匿名读取，API 不接受任意 OSS 键。固定 OSS 产物有 immutable 缓存头，实际 CDN 鉴权／撤销仍未接入。

更新包记录全部差异，包括移除，但 `removalPolicy` 当前固定为 `retain`，不授权 Launcher 删除旧文件；preserve 不覆盖。旧版本没有平台清单时只生成整包，旧 v1/v2 Manifest 与签名保持原字节，不自动重构历史发布。

客户端删除需归档下架、无实际／待绑定且无活动上传／组包，不限制已发布历史；Worker 会回收原包、候选／发布清单以及该客户端 muapack 前缀下的目标清单、整包／更新包、完成／失败尝试产物。源包 CAS 共用现有引用保护。全局环境缓存不随单客户端删除；数据库版本和签名记录保留不改写。

## 验证边界

集成测试使用隔离 PostgreSQL schema／三个 MinIO 桶、注入的合成环境和临时 Ed25519 密钥，真实生成、上传、下载和验证六平台整包／更新 ZIP；没有生产假环境开关。另有官方环境下载与缓存复用检查。完成这些检查不代表 Launcher 已安装或真实游戏已启动：启动器接入、安装／修复、可信公钥固定及六平台游戏启动验收仍需后续联调。
