# 客户端上传、更新与发布

本阶段支持完整 .minecraft ZIP，包含 ZIP64、常规压缩 ZIP 与 UTF-8 路径。可以压缩 .minecraft 目录本身、其内部文件，或包含 .minecraft 的外层目录。CurseForge、Modrinth、MultiMC 格式明确拒绝，后续增加解析适配器。

## 网页面板

/admin/clients 为单一“客户端管理”表格。右侧“添加客户端”打开拖拽／点击上传窗口，选择所属组织，服务器可以暂不绑定。允许同组织上传多个客户端；每个服务器同时只绑定一个客户端，每个客户端同时至多绑定一个服务器。名称在组织内去首尾空白、NFKC 归一化并忽略大小写查重，归档也不释放名称；同名返回 409，提示使用原客户端的“更新”功能。更新必须上传完整 ZIP，原资料预填，名称固定，并设置新版本号。客户端版本、名称、MC、Java 7–25、Summary 与 Markdown Description 集中填写。模组列表是只读 TanStack 表格，支持搜索、排序与分页，展示 JAR 文件名及客户端内路径。Worker 扫描目标实例的 mods 文件夹，兼容根目录与版本隔离目录（含子目录），仅列出 .jar 文件，忽略 .jar.disabled、非 JAR 与其他目录中的 JAR。更新窗口先显示原版本列表，新 ZIP 解析后整体替换；MC／Java 在识别阶段自动回填并可核对调整，客户端发布版本仍需填写。

行内“绑定 / 解绑”管理关联。选择已有客户端的服务器时必须确认替换。新客户端尚未有当前发布时保存待绑定请求，服务器继续使用旧客户端；审核发布并启用当前版本时，有 CLIENT_BIND 的操作者按已确认的绑定修订完成替换。只有版本切换权限的人员可先启用客户端版本，再由管理员手动绑定。绑定已发布客户端可立即生效，旧客户端及历史保留。请求校验服务器 revision 与 expectedClientId；期间绑定发生变化返回 409，需要取消待绑定请求后重新确认。解绑保留客户端当前版本和全部历史，只停止该服务器分发。

提交后进入 /admin/releases/review。审核通过后由发布人员签名；同时拥有 RELEASE_ACTIVATE 的发布人员可发布并切换当前版本。仅拥有 RELEASE_PUBLISH 的账号可生成不可变发布，由版本切换人员在发布记录中启用。组织管理员默认能上传、更新、归档，默认没有审核、发布、切换权限。上传和审核期间保持现有当前版本。

归档保留 Client、草稿、Release 和存储对象，同时停止分发并清除当前绑定。恢复不会自动上架或恢复绑定。并发更新的基准若改变，提交／审核／发布返回 409，要求基于最新当前版本重新上传。

已归档、从未发布且没有实际／待绑定服务器的客户端可删除；组织／服务器管理员需要 CLIENT_DELETE，处理中任务暂不能删除。`POST /api/v1/clients/{clientId}/delete` 接收 `{}`，取消待处理上传，记录审计并隐藏客户端，释放名称，后续访问返回 404。Worker 回收原包、索引和无有效引用的 CAS；命中回收文件时校验后取回复用。默认保留 7 天，仅超管在 `/admin/system/settings` 或 `/api/admin/recycle-settings` 的 GET／PATCH 接口管理全局保留期。详见[回收站](client-recycle.md)。

## 本地启动

配置 .env 的 S3_ENDPOINT、S3_ACCESS_KEY_ID、S3_SECRET_ACCESS_KEY、S3_PACKAGES_BUCKET、S3_CAS_BUCKET、SIGNING_PRIVATE_KEY_PATH；本机使用 mualauncher-minio 的 9000 端口。S3_ENDPOINT 必须能被后台服务和上传浏览器访问。

    npm run db:deploy
    npm run storage:init
    npm run worker
    npm run dev -- -p 3001 -H 127.0.0.1

本次生产预览使用 .next/mua-recycle，监听 http://localhost:3001。APP_ORIGIN 要与实际面板 origin 对应。开发初始化只在私钥不存在时生成 Ed25519 密钥，不覆盖已有密钥；密钥在被 Git 忽略的 .local 中。生产需提供持久、受保护的签名密钥，并通过可信渠道固定 Launcher 公钥。

Worker 为独立进程。任务保存在 PostgreSQL，领取、租约续期、失效租约回收、最多 3 次中断恢复及手动重试已实现，进程重启不会丢失已完成上传的任务。过期未完成分片在 24 小时上传期限加 15 分钟宽限后取消。Redis 调度尚未接入。Worker／Storage／Signing Keys 页面显示实际心跳、队列和存储／密钥状态。

## 标准 API

网页使用 HttpOnly 会话，写请求带 Origin。自动化使用 Authorization: Bearer mua_...，不要求 Origin，不继承浏览器会话。Token 在 Settings 创建，最多 90 天有效，只显示一次，限制服务器和权限；每次请求再次与账号当前 RBAC 取交集，账号停用、成员撤权、Token 撤销均生效。Token 不能创建其他 Token。

客户端端点统一使用 Client.id，不再把服务器 ID 当客户端身份；迁移保留旧客户端 ID 的原字符串，新客户端用 UUID。基准修订是客户端 revision，绑定修订是服务器 publicationRevision，不能混用。未绑定客户端由组织权限管理；单服授权按当前绑定服务器计算，解绑后使用固定 scopeServerId 作为授权来源，不能藉此操作其他服务器。没有来源服务器的独立客户端要求组织范围授权。新建时选定服务器要求 CLIENT_BIND；纯客户端编辑人员可按组织授权创建未绑定客户端。Token 创建独立客户端须选择授权服务器，创建或变更绑定还需 CLIENT_BIND。

上传 Token 通常包含 SERVER_READ、DRAFT_READ、DRAFT_CREATE、DRAFT_EDIT、DRAFT_SUBMIT。审核与发布权限显式另授。没有另一套 GitHub Release：下方接口仍生成同一组 ClientDraft／ClientRelease。

| 方法和路径 | 请求／作用 |
| --- | --- |
| GET /api/v1/clients | 受 RBAC 限制的真实客户端、绑定、草稿、发布和上传状态，包含未绑定客户端 |
| POST /api/v1/clients | {organizationId,name,serverId?:null或服务器ID,publicationRevision?,expectedClientId?,replaceConfirmed?}；返回 clientId |
| GET /api/v1/clients/:clientId | 客户端详情及可读版本历史 |
| POST /api/v1/clients/:clientId/bind | {serverId,publicationRevision,expectedClientId,replaceConfirmed}；CLIENT_BIND，检查双方权限与同组织 |
| POST /api/v1/clients/:clientId/unbind | {serverId:null或当前服务器ID,publicationRevision:null或当前绑定修订}；解绑或取消待绑定请求 |
| POST /api/v1/clients/uploads | {clientId,fileName,size,baseReleaseId,basePublicationRevision}；基准取客户端列表，返回 id、partSize |
| POST /api/v1/clients/uploads/:id/parts | {partNumber} 获取仅限该任务该分片的 10 分钟 PUT URL |
| PUT 返回的 URL | 二进制分片，记录响应 ETag；每片 64 MiB，末片可更小 |
| POST /api/v1/clients/uploads/:id/complete | {parts:[{partNumber,etag}]} 校验全部分片、大小和 ETag，合并后排队；大对象合并不持有数据库写锁 |
| GET /api/v1/clients/uploads/:id | 状态、processingPhase、提前保存的 detectedInfo／detectedMods、进度、警告、错误及差异统计 |
| POST /api/v1/clients/uploads/:id/select-instance | {instanceId}；在 SELECT_INSTANCE 阶段选择包内候选实例，沿用上传所有者／RBAC／基准校验，不重新上传 |
| POST /api/v1/clients/uploads/:id/retry | 空 JSON 重试失败的已上传任务 |
| POST /api/v1/clients/uploads/:id/cancel | 空 JSON 取消未开始处理、待填写或失败的上传，不删除业务历史 |
| POST /api/v1/clients/uploads/:id/submit | 下方版本资料，mods、minecraftVersion、javaVersion 可省略；运行环境缺省时采用 Worker 结果，未识别到则返回 400 要求填写。仅 READY 可提交。模组以 Worker detectedMods 为准，创建 SUBMITTED 草稿；相同资料重试返回同一 draftId |
| GET /api/v1/clients/:clientId/drafts/:draftId/manifest | 有 DRAFT_READ 时获取候选清单，供审核 |
| POST /api/v1/clients/:clientId/drafts/:draftId/review | {decision:"approve"/"reject",note,contentRevision}；驳回必须有说明 |
| POST /api/v1/clients/:clientId/drafts/:draftId/publish | {activate:true/false}；仅 APPROVED 修订可发布，true 另需 RELEASE_ACTIVATE |
| POST /api/v1/clients/:clientId/releases/:releaseId/activate | {publicationRevision} 切换／回退已发布版本，检查真实授权和当前修订 |
| POST /api/v1/clients/:clientId/archive | {archived:true/false}，要求 CLIENT_ARCHIVE |

提交资料示例：

    {
      "versionLabel": "1.4.3",
      "name": "NPUcraft",
      "minecraftVersion": "1.21.1",
      "javaVersion": 21,
      "summary": "更新客户端配置与模组",
      "description": "## 更新内容\n\n- 升级模组\n- 修正配置"
    }

模组列表由 Worker 自动生成并固定到草稿、Release 环境快照及 Manifest；旧自动化请求中的 mods 字段仍接受，但不作为事实来源。client:upload 的 metadata.json 可省略 mods、minecraftVersion 与 javaVersion。已发布历史不重写；新上传及更新采用本规则。

## 先识别、后 CAS

上传仍使用同一 ClientUpload／ClientDraft／ClientRelease 管线。processingPhase 为 FETCHING（读取源码包）、INSPECTING（识别客户端信息）、SELECT_INSTANCE（等待选择）或 CAS（完整校验／Hash／CAS）；识别结果在 CAS 写入之前提交数据库，前端 1.5 秒轮询即可提前回填。源 ZIP 的下载与摘要计算发生在识别之前；逐文件 CAS 处理在识别检查点之后。短任务可能在两次轮询之间完成某个阶段，不人为延迟 Worker。

detectedInfo 包含 schemaVersion:1、instanceId、minecraftVersion、javaVersion、javaComponent、loader、loaderVersion、minecraftSource、javaSource、warnings、requiresSelection 和 candidates。这些是导入观察结果，不是新 Launcher 协议；Manifest v2 继续按已确认资料保存 runtime。JSON／JAR 元数据冲突时 MC／Java 不自动回填，管理员需确认；客户端业务版本 versionLabel 不从实例名推断。

支持 PCL clientVersion、HMCL patches[game]、Forge／NeoForge 参数、标准 Mojang id 和 inheritsFrom，以及游戏 JAR 的 version.json；不执行上传代码，不访问上传 JSON 内任意下载 URL。Java 优先有效 JSON 声明、JAR 要求与官方缓存，官方默认要求高于声明时提示并修正。当前不验证全部模组的 Java 依赖兼容性。

多个独立实例时 status 保持 QUEUED、processingPhase 为 SELECT_INSTANCE，释放租约且不会被 Worker 重复领取。只有上传所有者或超管且仍拥有资源权限才能调用 select-instance；选择后重新排队识别，CAS 前再校验权限、基准和租约。选中实例及其父版本目录进入清单，其余 versions 目录忽略，共用 libraries／assets 保留。隔离实例的 mods 路径保持 versions/<实例>/mods/...，个人 options／servers.dat／saves 使用 preserve；.hmcl／PCL 私有实例配置不分发。

正式版 Java 对照缓存位于 src/data/minecraft-runtimes.json，通过 npm run runtime:sync 更新（HTTPS 官方域名、版本身份与官方 SHA-1 校验）；npm run runtime:sync -- --snapshots 可加入快照。旧版缺少 Java 声明时明确标记推荐 Java 8，不能视作官方最低要求；未知未来版本不猜测。正常 Worker 识别无需外网。

自动化对多实例包可传第四个参数 INSTANCE_ID：npm run client:upload -- complete-client.zip metadata.json CLIENT_ID INSTANCE_ID。未指定时脚本清楚提示任务 ID，保留任务供面板选择，不另建发布系统。READY／SUBMITTED 后数据库禁止改变识别结果与所选实例。

格式识别、客户端根目录定位、运行环境和模组识别统一由 src/lib/pack-inspection.ts 的格式适配器负责，src/lib/minecraft-inspection.ts 实现 .minecraft 元数据规则，src/lib/pack-parser.ts 提供共用 ZIP 安全校验、文件流、SHA-256 与 CAS 管线。后续格式补齐同一注册表，不另建上传／发布系统。本阶段仅识别 mods JAR 的文件名和路径，不读取模组 JAR 内的名称、版本或依赖；其他输入格式依然明确拒绝。元数据 JSON 最大 1 MiB，最多 64 个版本 JSON、继承链最多 16 层，参与元数据读取的游戏 JAR 最大 256 MiB；安全限制或 CRC 校验失败会终止处理。

元数据请求最大 256 KiB；ZIP 最大 20 GiB，展开后最多 40 GiB，单文件最多 2 GiB，总条目最多 100000，模组 JAR 最多 2000 个。不会把整包放入 Next.js 内存。分片可重传，complete 与相同 submit 可重试；再次调用已完成的 publish 返回同一 Release，不会自动把新版本回退到旧版本。

自动化脚本只调用上述 API，提交后等候人工审核：

    npm run client:upload -- complete-client.zip metadata.json CLIENT_ID

设置 MUA_API_URL 与 MUA_API_TOKEN；Token 放在 GitHub Actions Secret，API_URL 必须可从执行环境访问。脚本按 64 MiB 读取文件、上传并等待 Worker，输出 draftId 与真实统计，不输出 Token 或签名上传 URL。

## CAS 与安全解析

原始包／索引／Manifest 存入私有 mua-packages，逐文件 SHA-256 对象存入私有 mua-cas 的 sha256/前两位/完整摘要。同字节跨版本／跨组织可复用对象，业务版本与服务器绑定仍独立。写入带 SHA-256 校验与条件创建；CAS 只复用符合大小和摘要元数据的对象。

解析采用 [yauzl](https://github.com/thejoshwolfe/yauzl) 按条目读取，不把包内路径用作本地解压目标。每个文件流式计算 SHA-256／CRC32、校验实际展开大小；拒绝路径逃逸、绝对路径、加密、链接、大小写冲突、Windows 保留名称、异常压缩率和损坏文件。上传遵循 [S3 multipart 生命周期](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html)。

常见 launcher_accounts.json、launcher_profiles.json、账号缓存、日志、截图、crash-reports 和内部安装记录不进入 CAS／公开清单；原始 ZIP 私有保存，没有公开原始包下载。模组自己的私密配置仍需服主与审核员检查。options、servers.dat、saves 默认 preserve，其他文件 managed。当前没有逐文件策略编辑。

## 差异统计

- 新增／修改／删除：相对于上传开始时当前 Release 的路径／SHA-256。
- 客户端完整大小：清单文件展开后的字节总和，区别于原 ZIP 大小。
- 实际新增数据：本次解析写入 CAS 的新对象字节，同内容多个路径只算一次。
- 玩家预计更新：假设上一版本完整安装，按唯一哈希计算需下载的新 managed 文件，以及此前没有的 preserve 文件。已有 preserve 不覆盖；缓存、手动修改和首次安装会改变下载量。
- CAS 复用率：按唯一内容字节占比，1 - 新 CAS 字节 / 本版本唯一内容字节，与玩家下载量的分母不同。
- 删除统计只表达差异，preserve 不自动删除；Launcher 的旧 managed 文件清理策略仍待联调。

## Manifest 与公开下载

新生成 mua-client-manifest schemaVersion 2，包含真实 organizationId、clientId、版本／名称、runtime、mods、Summary／Description、源 ZIP SHA-256、排序后的 {path,sha256,size,policy} 文件列表与 update 统计。提交后锁定清单，审核绑定 contentRevision，发布内容不可修改。精确 UTF-8 字节受 SHA-256 摘要及 Ed25519 签名覆盖。

GET /api/v1/servers/:serverId/manifest 返回精确签名 JSON 字节，响应头包含 X-MUA-Manifest-Sha256、X-MUA-Signing-Key、X-MUA-Signature、X-MUA-Signature-Algorithm。GET /api/v1/servers/:serverId/files/:sha256 仅允许当前公开版本中的哈希，返回 5 分钟下载 URL。归档／下架停止生成新链接；已签发链接在短期到期前仍可用。猜测其他组织私有 CAS 哈希不能通过此接口下载。

后续：其他包格式解析、.muac／.muapack 导出、生产密钥生命周期、Launcher 验签／增量安装与旧 managed 文件清理。服务器目录的 currentRelease 包含 clientId 与 manifestUrl；服务器身份由目录及请求路由确定，不写死进新版不可变清单。旧 schemaVersion 1 的清单、摘要和签名保留原字节，只能绑定原服务器；跨服务器绑定前需要上传新版本生成 v2。启动器源码尚未修改，需联调新的 clientId / serverId 分离协议。
