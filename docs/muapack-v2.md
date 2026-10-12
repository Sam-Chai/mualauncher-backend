# muapack v2 协议基线

冻结日期：2026-10-10。已完成实施顺序第 1–5 步，支持 v2 完整组包、审核、签名和发布，以及显式能力协商的完整包下载。上传 READY 表示导入完成；PackageBuild READY 表示审核后完整产物已验签。生产增量包已接入，Launcher 安装尚未接入，不能把文档样例或后台验签当成游戏启动验收。

需求来源：[v2 需求与实施顺序](muapack-v2-design.md)。[v1 协议](muapack-v1.md) 及既有字节／签名继续保留。muapack formatVersion 2、mrpack formatVersion 1、旧 Release Manifest schemaVersion 2 是三个不同版本体系。

## 1. 边界与格式选择

v2 保留 mrpack 的本地 overrides，包含本地模组 JAR、配置、资源包等；索引声明的远程文件只保留下载声明。Worker 不下载远程模组及 Minecraft／Java／加载器二进制，不执行环境安装处理器。Launcher 负责远程下载、验证、缓存、安装及环境解析。

首批输入支持标准 mrpack 和已验证 PCL 内包封装，复用格式适配器。普通 .minecraft ZIP 不直接作为 v2 输入，不能猜远程来源；其转换留待后续。源包中应有的本地文件不可丢弃或被强制改成远程下载。

已接入字段 `packageFormatVersion: 1 | 2`：添加／更新窗口在开始实际上传前要求确认，创建 ClientUpload 时保存并锁定，重试及恢复沿用。选择属于该上传／候选版本，客户端后续版本可改选另一格式；已上传后改选需取消或另建上传，不改写原任务。旧 API 请求省略字段按 v1 兼容；新版 UI 与自动化脚本显式提交该字段。不根据扩展名推断分发版本。当前 Worker 自动生成 full／update 生产产物，旧 READY 与签名不补写，阶段状态与错误见[标准 API](client-upload-api.md)。

## 2. 容器、平台与目录

2026-10-11 更新：新 v2 不提供系统架构选择，统一生成单一 universal 配方包，同一发布与同一基准的产物对各系统字节相同。新草稿的 supportedPlatforms 固定为六个规范平台；它表示由端侧解析环境，不代表全部平台游戏启动已验收。旧已签名清单及离线样例的平台声明保留，不补写产物。v2 平台配置 API 返回 409；上传、审核与进度面板均不出现架构选择器。公开下载可以省略 platform，详见[下载与固定版本刷新](launcher-download-api.md)。

扩展名 .muapack，ZIP／ZIP64，Store／Deflate；不允许加密、符号链接、显式目录、重复／未知条目、大小写冲突及路径逃逸。路径沿用 v1 的 NFC、安全相对路径和 Windows 兼容规则。JSON 16 MiB，嵌套 32 层，最多 100000 个目标文件，单文件 2 GiB，声明目标文件总量 40 GiB；环境不属于这份目标文件大小统计。

```text
NPUcraft-1.1.0.muapack
├─ mua-pack.json
├─ modrinth.index.json
├─ overrides/                       # 仅本包声明的本地载荷
│  ├─ mods/local.jar
│  └─ config/game.toml
└─ metadata/
   ├─ target-manifest.json           # 始终为完整目标
   ├─ base-manifest.json             # 仅更新包
   └─ signature.json
```

只接受以上必需元数据与 payload 指定的 overrides 条目。产物不携带 client-overrides／server-overrides；输入先按远程声明 → overrides → client-overrides 归一化，忽略 server-overrides。最终由本地覆盖的同一路径不再出现在远程索引里。客户端 unsupported 的远程文件不纳入目标；optional 声明保留，本地覆盖同一路径时继承有效远程声明的 optional。

发布为一个跨平台配方包，`supportedPlatforms` 是有序、无重复、非空的规范平台集合。平台枚举沿用 v1 的六项；默认仍排除 linux-aarch64，其余五项，已有保护不取消。首版每个目标路径只有一种内容，不支持按操作系统选择不同模组／配置；依赖平台专属文件时需另建客户端或用 v1，不宣称平台依赖已适配。环境和原生库由 Launcher 按自身平台解析，不放入 overrides。

## 3. 目标完整清单

target-manifest.json 使用 `format: mua-recipe-manifest`、`formatVersion: 2`，所有字段必需，除文中注明的可选字段外拒绝未知字段。

| 字段 | 契约 |
| --- | --- |
| release | organizationId、clientId、releaseId、version、name、summary、Markdown description、sourceSha256、contentRevision；身份与长度沿用 v1 |
| supportedPlatforms | 上述平台集合；仅表示发布允许端侧尝试安装，不能代替真实启动验收 |
| runtime | minecraft 精确版本、loader=null 或精确 type／version、java 要求、resolverVersion |
| launch | jvmArgs、gameArgs、memory、preLaunch；不固化最终 mainClass／classpath |
| files | 最终实例根目录的完整目标列表，按 path 的 UTF-16 字符串顺序升序排列 |

文件公共字段为 `{path,size,hashes,source,policy,optional,executable}`，policy 为 managed／preserve，后两项为显式布尔值。path 为唯一文件身份；所有文件均位于客户端实例，不能写 Java 缓存、versions、libraries、assets、natives、runtime、账号／启动器私有文件或 .mua 状态。

本地 source 为 `{type:local,entry:overrides/<path>}`；hashes 只含 SHA-256。entry 必须与 path 对应，不使用任意 ZIP 路径。即使某个更新包不携带此文件，目标清单仍保留这一完整描述。本地 optional 字节仍包含在完整包，是否放入启用目录由 Launcher 决定。

远程 source 为 `{type:remote,downloads:[HTTPS URL...]}`；hashes 必含 SHA-1 和 SHA-512，可额外带声明的 SHA-256，全部小写十六进制。SHA-512 为主要内容身份，不能只凭 SHA-1 判断复用；Launcher 下载后必须核对全部声明哈希与实际大小。声明大小／哈希是发布者的要求，后台未下载时不得标为已验证文件字节。地址不能带凭据、片段或临时签名令牌，必须是持久公开下载入口；逐跳 HTTPS、来源策略、公开地址及大小限制在端侧执行。使用代理也不得绕过目标保护。

本地同摘要、远程同 SHA-512 的大小声明必须一致。本地／远程来源互换按修改处理，不在后台未经验证就断言两种哈希表示相同字节。Launcher 可以在实际校验后建立 SHA-512 与 SHA-256 缓存对应关系。模组列表由 files 的 mods/**/*.jar 派生，不能手填覆盖；optional 与文件策略独立。

## 4. mrpack 索引

modrinth.index.json 保持 formatVersion=1、game=minecraft，name／versionId／summary 取目标发布信息，dependencies 取 runtime 的 Minecraft 与加载器；Java 等扩展不塞入 dependencies。files 只包含最终 source.remote 文件，按 path 排序，映射 path、hashes、fileSize、downloads、env；env.client 为 required／optional，env.server 固定 unsupported，因为产物是客户端。

索引完整表达目标所有远程文件，即使是更新包也不能删掉未变化项。本地文件仅在 MUA 完整清单与 overrides 表达，不伪造下载 URL。校验器必须从目标清单重新生成索引并逐字节比较，不能将索引和清单作为独立可编辑事实来源。

基础结构遵循 [Modrinth 官方格式](https://support.modrinth.com/en/articles/8802351-modrinth-modpack-format-mrpack)。完整包可作为普通 mrpack 内容导出，但普通安装器不执行 MUA 验签／策略／更新保证；更新包的 overrides 不完整，不支持直接作为普通 mrpack 导入。

## 5. 环境与启动要求

runtime 固定为 `{minecraft,loader,java,resolverVersion}`。loader 类型沿用 fabric／quilt／forge／neoforge，版本精确；java 为 `{major,vendor,imageType}`，vendor 首版 adoptium，默认 imageType=jre，jdk 必须由超管明确选择，不能因缺少 JRE 静默降级。Java 主版本采用已核实的 MC 对照或管理员确认，不猜未来版本。

首版锁定环境要求，不在后台预选 Java 二进制构建。`resolverVersion: mua-runtime-resolver-1` 定义 Launcher 的可信官方元数据解析、镜像重写与校验规则；未知规则版本拒绝安装。Launcher 首次安装时选符合要求的 Java 精确构建，并保存 vendor／imageType／build、归档摘要、Minecraft／加载器元数据摘要、解析器版本、平台及最终环境清单到本地 .mua/runtime-lock.json。后续启动复用已验证锁定与缓存，不跟随 latest 自动替换；安全升级或修复时按明确端侧操作重新解析并记录。

相同发布在两台首次安装时间不同的机器上可能使用同主版本的不同 Java 安全构建，这是本协议的明确选择，不声称 v1 式逐字节环境可重现。若未来要求发布固定 Java 构建，应新增显式协议能力并重新发布，不补写旧签名。Minecraft 和加载器版本仍固定，端侧按可信上游摘要校验其载荷。

launch 字段沿用 v1 的参数数组、内存范围及 mkdir／copy／exec 声明；参数是追加项，最终主类、classpath、原生库由 Launcher 解析环境生成。jvmArgs 不得覆盖内存／classpath／主 JAR，gameArgs 不得覆盖身份令牌、安装目录或运行环境位置；未知占位符拒绝。首版发行方追加参数不接受占位符，玩家信息只在可信环境启动参数中填入，不写进包。

mkdir／copy 使用实例安全路径，不覆盖 managed 文件或内部状态；copy 的来源、exec 可执行入口必须对应目标清单中 required、managed 的本地文件，exec 还须 executable=true。exec 保留 requiresConsent=true、timeoutSeconds 1–300、onFailure=abort／continue，由 Launcher 明确授权后执行。modpack 不提供 shell 字符串或任意网络执行命令。

仅当 Launcher 有对应加载器安装能力时安装。Forge／NeoForge 需要端侧处理安装器、校验处理器与依赖、生成运行文件，不能以现有后台 Worker 的支持代替。公开镜像偏好可单独下发，镜像不改变内容身份；Worker 私有代理 URL／凭据不下发到玩家。

## 6. mua-pack.json 与差异

| 字段 | 契约 |
| --- | --- |
| format／formatVersion | muapack／2 |
| packageType | full／update |
| target／base | release 引用 `{organizationId,clientId,releaseId,version,manifestSha256}`；full 的 base=null |
| indexSha256 | modrinth.index.json 精确字节摘要 |
| changes | added、modified、removed、policyChanged、sourceChanged、runtimeChanged、launchChanged、platformsChanged |
| payload | `{entry,sha256,size}` 数组，按 entry 排序，仅实际携带的本地 overrides；路径不重复 |
| removalPolicy | retain 或 backup-managed，构建显式选择 |
| minimumLauncherProtocol | 数字 2，为协议能力等级，不是 Launcher 软件版本号 |

目标／基准清单的精确字节绑定到引用摘要；目标引用字段必须与目标 release 一致。更新要求基准与目标都是 v2、同组织／客户端、不同发布和版本；base-manifest 必须完整携带。没有合适基准则生成 full。平台更新要求运行平台同时在 base／target 支持集合中，否则回退 full。

文件变化以 path 为键重新计算，不凭标签大小或 JSON 手填计数：

- added／removed 保存完整文件描述。
- modified 保存 before／after：来源类型、内容哈希、大小或 executable 改变；一个文件可同时改变策略。
- policyChanged 保存 before／after：policy 或 optional 改变。
- sourceChanged 保存 before／after：同为 remote、内容身份不变但 downloads 有变化；不计为内容下载需求。
- runtimeChanged／launchChanged／platformsChanged 为 null 或 `{before,after}`；平台集合改变不默认算所有文件修改。
- 重命名按 removed＋added，不通过名称猜内容关系。每类文件变化按目标／旧 path 排序，不允许重复项。

full 的变化数组必须为空，环境／启动／平台变化必须为 null。full payload 包含全部本地目标文件，包括 optional；update payload 包含 added／modified／policyChanged 涉及的本地 after 文件，去除重复路径，远程文件永远不作为载荷。相同本地字节可在后台 CAS 复用，ZIP overrides 布局按目标路径保存，不要求包内内容去重。

## 7. 安装、修复、optional 与删除

Launcher 先验签和全部本地载荷，再准备下载／安装，成功后原子更新本地 releaseId、目标清单摘要、平台、文件记录和环境锁定；失败保留上一安装状态。基准核对使用身份和摘要，不仅用版本标签。即使更新包声明某文件未变化，也要校验实际存在和内容，不盲目信任本地记录。

managed 缺失或哈希不符则安装目标；preserve 已存在不覆盖／不删除，缺失才使用目标初始内容。optional 按 clientId＋path 保存选择，同路径更新沿用，重命名重新确认；disabled 的本地 JAR 留在 Launcher 缓存或实例外，不留在游戏扫描的 mods 目录。关闭 optional 不等于后台改变发布清单。

缺失未变化的本地文件时，首版从当前目标 full 包补取，校验它与更新包的 target 摘要一致；不要求新增单文件下载 API。远程缺失直接按目标地址补下载。base 不符、跨 v1／v2 或无平台基准时使用目标 full，但端侧仍可逐文件校验并复用缓存。

retain 只记录 removed；backup-managed 仅对基准明确管理的实例文件先备份，再移出启用目录。preserve、玩家自建文件和共享环境目录不得自动清理。缺少未携带的旧字节或文件被玩家修改时，不承诺删除／恢复旧字节，保留备份与冲突记录供确认。

Launcher 网络预计量与包 ZIP 大小、本地载荷大小、远程声明大小分别显示。后台 CAS 复用率不等于玩家下载节省率；未知环境量为待解析，不能伪造数字。远程上游失效时如无有效缓存则失败，不用未校验文件替代；MUA 不把 v2 改成后台代下载。

## 8. 确定编码、签名与发布

沿用 v1 UTF-8、对象键按 UTF-16 排序、数组保序、JSON.stringify 标量、无 BOM／空白／结尾换行、安全整数与有效 Unicode、嵌套限制。拒绝重复键；用原始字节验证，不重新格式化后验签。

signature.json 为 `{format:mua-pack-signature,formatVersion:2,algorithm:Ed25519,keyId,metadataSha256,signature}`。签名消息为 ASCII `MUA-MUAPACK-V2`＋NUL＋mua-pack.json 精确字节。keyId 沿用公钥 SPKI DER 的 SHA-256 前 24 个十六进制字符，可信公钥由包外提供；不能以包内或同包附带的公钥建立生产信任。

metadata 绑定目标／基准清单、索引、变化及本地载荷；目标绑定全部下载地址、哈希、optional、环境和启动要求。仅替换下载源也改变签名，需要新的发布内容，不在旧发布上编辑。镜像是端侧传输策略，必须下载相同哈希内容。ZIP 摘要放在 OSS／数据库产物记录，不能放回 ZIP 形成循环引用。

审核、修订锁、发布门槛、服务器绑定和归档删除沿用原系统。v2 READY 表示本地载荷及下载配方／签名已校验，不表示远程字节、环境或游戏已验收；只有审核与发布事务成功才公开。归档后不再出现在服务器目录，公开请求拒绝；已签发短期 OSS 地址的既有有效期不被协议撤回。本地 overrides 按现有引用／回收规则处理，远程描述不形成后台 CAS 引用。

API 能力协商必须在返回包前完成：旧请求默认只接受 v1；当前发布仅有 v2 时向旧端返回明确“不支持该协议”，不偷偷改发旧版本，也不将 v2 当 v1 发送。v1 与 v2 更新包不能互相应用。

## 9. 离线验收与实现边界

样例与独立校验见 [examples/muapack-v2](examples/muapack-v2/README.md)。包括原始混合 mrpack、基准 full、目标 full、对应 update、外部测试公钥及远程合成字节。fixtures 使用 .invalid 地址，不进行网络访问，不是可启动游戏。

最低验收：验签链与 ZIP CRC／摘要、本地／远程严格分离、同路径本地覆盖、基准与目标关系、完整索引、增量重算、optional／来源／环境／启动／平台变化、本地载荷完备、更新修复与保留行为；拒绝篡改、未知版本、旧签名域、错误基准、非法路径、大小写／文件目录冲突、缺失／额外载荷、索引冲突、源声明缺少强哈希和未知字段。

完整／增量组包、API 能力协商和发布门槛已接入；端侧环境解析器与安装记录仍是后续实现契约，本次离线工具只验证样例容器与声明，不安装、下载、执行命令、连接数据库／OSS或调用生产密钥。
