# muapack v1 协议

更新日期：2026-10-10。状态：协议模型、差异生成、签名及只读 ZIP 校验器已实现；Worker 环境准备／镜像下载／缓存、后台组包、发布门槛和管理界面已接入，见[后台组包](muapack-worker.md)。Launcher 安装器与真实游戏启动验收尚未接入。

实现契约以 [muapack-contract.ts](../src/lib/muapack-contract.ts)、[muapack-protocol.ts](../src/lib/muapack-protocol.ts) 为准。本协议是新的包格式版本 1，不等同于现有 `mua-client-manifest` schemaVersion 1；既有 v1／v2 Manifest 的字节和签名保持不变。

## 1. 容器和布局

扩展名 `.muapack`，ZIP／ZIP64，文件条目采用 Store 或 Deflate；不使用加密、链接或显式目录条目。目录由文件路径隐含表达。

```text
NPUcraft-1.4.3-windows-amd64.muapack
├─ mua-pack.json
├─ metadata/
│  ├─ target-manifest.json
│  ├─ base-manifest.json            # 仅更新包，必须携带
│  ├─ signature.json
│  └─ environments/
│     └─ <环境清单的 SHA-256>.json   # 目标引用的所有环境
└─ objects/sha256/
   └─ <文件原始字节的 SHA-256>       # 每种内容一份
```

所有必需条目必须存在，不接受重复或额外条目。对象路径不使用玩家提供的路径；实际安装位置来自目标清单。图标、说明和许可证文件如纳入发布，应作为目标清单文件或字段表达；v1 不接受未声明的附加 ZIP 文件。

最多 100000 个目标文件、单文件 2 GiB、目标文件总展开大小 40 GiB。每份 JSON 最多 16 MiB，同时受到文件数量限制。路径必须是 NFC、使用 `/` 的安全相对路径；拒绝路径逃逸、反斜杠、Windows 保留名、大小写冲突和文件／目录冲突。

## 2. 平台与身份

平台固定为 `windows-amd64`、`windows-aarch64`、`linux-amd64`、`linux-aarch64`、`macos-amd64`、`macos-aarch64`。当前 v1 发布选项默认除 Linux aarch64 外的五个平台，Linux ARM 选项禁用并说明支持限制；协议仍保留六平台及既有选择兼容。不能选择空列表或重复平台。v2 不使用架构选择器。

入口归一化接受 win32 → windows、darwin → macos，x64／x86_64 → amd64、arm64 → aarch64；写入包内时只能使用规范值。

同一发布的各平台共享 organizationId、clientId、releaseId、客户端版本及内容修订。平台清单的 SHA-256 可以不同。客户端 ID 兼容历史字符串；组织／发布 ID 使用 UUID。身份字段不能直接拼接成本地路径。

服务器绑定继续由服务器目录 API 表达，不固定写入平台清单。改变绑定不改写客户端发布和包签名。

## 3. mua-pack.json

| 字段 | 意义 |
| --- | --- |
| format / formatVersion | 固定 `muapack` / `1` |
| packageType | `full` 或 `update` |
| platform | 目标平台规范值 |
| target | organizationId、clientId、releaseId、version、目标平台清单 manifestSha256 |
| base | 整包为 null；更新包为与 target 同结构的基准引用 |
| changes | added、modified、removed、policyChanged 四个完整变化列表 |
| payload | 唯一内容列表，每项 `{sha256,size}` |
| removalPolicy | `backup-managed` 或 `retain`，由构建请求明确选择 |

整包不得有基准或变化列表；更新包必须属于同一组织、同一客户端、同一平台的不同发布，版本标签也必须不同。

校验器读取基准和目标完整清单重新生成差异与载荷列表，必须与 mua-pack.json 完全一致。不能用手填计数替代变化清单。

## 4. 目标平台完整清单

`target-manifest.json` 使用 `format: mua-platform-manifest`、`formatVersion: 1`：

- `release`：组织／客户端／发布身份、version、name、summary、Markdown description、sourceSha256、contentRevision。
- `platform`：规范平台值。
- `runtime.minecraft`：精确游戏版本；`runtime.loader`：null 或 `{type,version}`，类型为 fabric、quilt、forge、neoforge。
- `runtime.java`：major、vendor、version、build、manifestSha256、executable，以及可选 imageType（jre／jdk）；不允许只用 Java 主版本决定缓存身份。新环境显式记录 imageType，旧签名清单可缺省，不能推定旧缓存就是 JRE。协议允许后续 Java 主版本，但当前 UI／识别支持范围不因此扩大。
- `environments`：minecraft、java 各一个；使用加载器时另有一个 loader。每项 `{kind,sha256}`。
- `launch`：主类、classpath、JVM／游戏参数、内存建议、启动前操作。
- `mods`：路径及可空的名称／版本；路径指向清单中的 JAR。Modrinth 导入增加可选 `optional`，缺省 false，与对应 files 标记一致。所有客户端可用 optional 文件包含在整包里，Launcher 决定是否启用，见 [导入说明](modrinth-import.md)。模组详细信息未识别时使用 null，不伪造名称或版本。
- `files`：目标平台完整文件列表。

每个文件包含 `{root,path,sha256,size,policy,executable}`。root 为 `instance` 或 `java`：instance 是该客户端实例目录，java 是由目标 Java 环境摘要固定的共享缓存目录。Java 文件必须是 managed；可执行入口必须标记 executable。POSIX 安装时根据此字段设置执行权限，Windows 不由它选择文件内容。

执行入口和所有 classpath 条目必须对应 managed 文件；所有 Java 文件必须属于已锁定的 Java 环境。账号文件和 `.mua` 内部安装状态不能由发布覆盖。

目标清单含所有所需运行文件，但协议验证仅证明文件和引用一致，不证明这些字节是可运行游戏，也不证明模组运行兼容性。真实环境适配器和各平台启动验收另行实施。

## 5. 环境清单

`mua-environment-manifest` / 1 包含 kind、platform、resolverVersion 和 managed files。

- minecraft：精确 minecraft 版本、sourceMetadataSha256。
- loader：精确 minecraft 版本、加载器 type／version、sourceMetadataSha256。
- java：major、vendor、version、build、可选 imageType、executable、下载归档 archiveSha256。imageType 如存在，须与目标 runtime.java 一致。

整个环境清单的确定编码 SHA-256 是环境内容身份。来源元数据／归档摘要、imageType 和 resolverVersion 参与身份；相同主版本但不同构建或 JRE／JDK 不视为同一 Java。环境清单与对象由独立环境 bucket 保存；当前使用存储中的环境入口缓存及独立 PostgreSQL 锁合并并发准备，镜像偏好不参与缓存身份。

包内必须携带目标引用的环境清单，按摘要寻址；引用类型、平台、精确版本和每个环境文件都要与目标完整清单匹配。缓存只有校验完成才可复用。

## 6. 启动配置

`launch` 包含 mainClass、classpath（instance 相对路径数组）、jvmArgs、gameArgs、memory、preLaunch。参数使用数组，每项保留一个 argv 参数，不拼接 shell 字符串。

内存为 `{mode:"auto",minimumMiB,recommendedMiB}`，推荐值不低于最低值。Launcher 按本机可用内存和玩家设置决定实际分配；参数数组不得另带 `-Xms`／`-Xmx`。玩家身份、令牌和安装路径通过启动时占位符填入，不能把实际账号数据打入共享包。占位符集合和 Launcher 解析器需联调，校验器不做字符串替换。

启动前操作的协议形态：

| type | 字段／规则 |
| --- | --- |
| mkdir | instance 相对 path |
| copy | from 为已签名 managed 文件位置，to 为 instance 相对路径，ifMissing 必须 true |
| exec | executable 为已签名 managed 文件位置，args 数组，workingDirectory 为 instance 相对路径或 null，requiresConsent 必须 true，timeoutSeconds 1–300，onFailure 为 abort／continue |

mkdir／copy 不得覆盖 managed 文件或 Launcher 内部状态；执行命令由发布审核和 Launcher 显式授权，不能自动信任导入格式中的私有命令。当前代码只校验声明，不执行操作，不启动 Java。

## 7. 更新语义

更新以完整文件为单位。文件键为 root + path；added／removed 保存完整文件描述；modified／policyChanged 保存 before／after。内容或 executable 改变属于 modified，策略改变属于 policyChanged；同一文件可以同时出现在两类变化中。

整包载荷包含目标所有唯一内容。更新包载荷包含新增、修改和策略变化涉及的目标内容，去重后携带；包括变化后的 preserve 默认内容，在玩家缺失该文件时可用。目标完整清单始终携带；未变化内容从经过校验的基准或缓存复用。

新增目标 Java 环境目录时，应从校验过的旧环境／缓存复用未变化内容，形成完整的新目录；不能原地修改其他客户端仍使用的旧 Java 缓存。

安装器必须核对基准发布 ID、清单摘要和平台；缺失／损坏的未变化内容需要修复，不能仅更新版本标签。实例应先准备和校验，再完成安装事务并更新本地记录；崩溃恢复和本地记录格式尚未实现。

`preserve` 已存在时不覆盖；removed 中的 preserve 只报告，不删除。`retain` 不自动清理旧文件；`backup-managed` 仅允许对旧清单明确管理的 instance 文件备份后清理，不能删除玩家自建文件或直接清理共享 Java 缓存。政策转换的安装确认和备份细节留给 Launcher 联调，当前无执行删除代码。

构建策略暂按“每个所选平台一个整包；存在同平台上一当前发布时另生成一个更新包”。没有同平台基准时只需要整包。更早基准回退目标整包；不默认生成所有历史两两组合。此策略可在后续任务模型中扩展，不改变包内 base／target 语义。

## 8. 确定编码和签名

所有协议 JSON 为 UTF-8；对象键按 JavaScript 字符串比较的 UTF-16 顺序排列，数组顺序保留。标量采用 JSON.stringify 编码，对象／数组使用无空白分隔符拼接，无 BOM、缩进或结尾换行；数字形式的对象键同样按字符串排序。只允许安全整数和有效 Unicode 字符，嵌套最多 32 层，不接受重复键或额外空白。读取器以精确原始字节验证摘要；其他语言实现应对照示例字节，不重新编码后验签。

`signature.json` 使用 `mua-pack-signature` / 1，包含 algorithm（Ed25519）、keyId、metadataSha256 和 Base64 signature。

签名消息为 ASCII `MUA-MUAPACK-V1` + 一个 NUL 字节 + mua-pack.json 精确字节。keyId 为公钥 SPKI DER 的 SHA-256 前 24 个十六进制字符，与现有密钥标识规则一致；可信公钥由包外提供，不能从包内自我声明建立信任。

签名绑定 mua-pack.json；该文档绑定目标／基准清单摘要、平台、完整差异和载荷摘要。目标又绑定环境摘要、启动配置和所有文件。最终 ZIP 的摘要记录于 OSS／数据库产物描述，不写入 ZIP 自身，避免循环引用。

构建签名不是公开发布状态。审核通过的固定修订在公开发布前完成最终封装；发布 API 仍需检查审核、RBAC、构建修订和产物 READY。现有发布 API 已接入此门槛，详见[后台组包](muapack-worker.md)。

## 9. 校验与示例

2026-10-11 已接入 v1／v2 一致的公开下载校验与固定 releaseId 链接刷新。v1 更新产物新增记录基准平台清单的 SHA-256，旧 READY 记录从封存清单核对并推导，保留原签名。提供的基准摘要不符时选择 full；发布／基准身份、清单或 OSS HEAD 大小／摘要不符时拒绝签发。ETag 不替代 ZIP SHA-256 或包签名，详见[Launcher 下载 API](launcher-download-api.md)。

```powershell
npm run test:muapack
npm run muapack:validate -- client.muapack trusted-public-key.pem
```

命令检查签名、完整清单、环境、差异、ZIP 条目及逐对象 CRC／SHA-256／大小，成功输出类型、平台、基准／目标版本、对象数和字节数；失败退出码非零。命令不会提取文件、访问数据库／OSS、下载依赖或执行启动操作。

可读示例位于 [examples/muapack](examples/muapack/README.md)，使用合成文件，仅用于协议学习和校验。测试另外生成真实签名 ZIP、六个平台包、完整／更新包和损坏样例，不使用生产密钥。
