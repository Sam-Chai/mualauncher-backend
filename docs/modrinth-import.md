# Modrinth 与 PCL 整合包导入

2026-10-09：支持标准 `.mrpack` 和本次 PCL 样本的 ZIP 封装。与 `.minecraft ZIP` 共用 ClientUpload、ClientDraft、ClientRelease、RBAC、CAS、审核及 muapack 后台组包；没有第二套发布系统。

## 输入与识别

依据 [Modrinth 官方规范](https://support.modrinth.com/en/articles/8802351-modrinth-modpack-format-mrpack)，ZIP 根目录必须有 UTF-8 `modrinth.index.json`，支持 formatVersion 1 / game minecraft。读取 name、versionId、summary 和 dependencies；Minecraft 版本与加载器版本分开保存，Java 使用现有官方版本目录／已核实离线对照，不从整合包名称猜测。未知依赖或多个加载器明确拒绝，未知 Java 待管理员确认。

PCL 适配检测外层 `PCL/Setup.ini` 和唯一 `.mrpack`，验证并读取内包，不执行 EXE、不分发外层启动器或设置。只保证该已检查封装，不能推断所有 PCL 导出变体都兼容。

上传表单先用文件名作为新客户端临时名称；Worker 返回包内名称后自动填充。首次提交前可确认名称，组织内重名返回 409 并提示使用更新。该确认要求没有历史草稿／发布且仅有一个活动上传；数据库也保护此条件。已建立版本的客户端名称、身份和权限来源仍不可改变。更新自动填充 versionId，但必须与原版本不同，且不能重复已发布／待处理版本。

## 文件归一化与 optional

1. 排除 `env.client = unsupported` 的文件；未声明 env 时按 required。所有 optional 客户端文件都下载并保留，后台不提供删减 optional 的选择。
2. 按远程文件 → overrides → client-overrides 层顺序归一化，忽略 server-overrides。覆盖同一路径允许，大小写冲突、重复路径、目录冲突和逃逸拒绝；本地覆盖保留该路径原有 optional 标记。
3. 游戏 versions/libraries/assets/natives/runtime 由 MUA 环境管理，mrpack 不得覆盖这些根目录。沿用原包隐私过滤和 managed/preserve 策略；模组仅从最终 mods 路径的 JAR 列出，不解析 JAR 内名称／版本或依赖。
4. Worker 先持久化识别信息及模组列表，再进入 DOWNLOADING，所有远程文件完成后进入 CAS。远程文件检查 SHA-1、SHA-512、大小，再计算 SHA-256；本地 ZIP 校验 CRC32／大小并计算 SHA-256。最终进入现有 CAS（包含删除回收文件的取回复用）和差异统计。

`optional` 与 `managed/preserve` 独立：前者表示玩家是否选择安装／启用，后者定义被选择文件的更新方式。上传结果 `detectedInfo.importFiles` 保存 path/source/optional/size/downloads/status/downloadedBytes/error，前端按实际字节显示进度。失败不能提交，整任务可重新分析；已完成下载不会跨任务保存分段断点。

## 发布清单与 Launcher API

新上传的发布 Manifest v2 增加 `modDetails: [{path, optional}]`，文件清单可带 `optional: true`。API 提交的 mods/modDetails 被忽略，采用 sealed Worker 结果；原有已签名清单不重写。

muapack 平台清单在 `files` 和 `mods` 保留匹配的 optional 标记，整包包含全部客户端可用文件，包括所有 optional。更新包按完整目标清单生成；仅 optional 改变也记录在 policyChanged，目标完整清单仍列出全部文件。Java、classpath 与环境文件不能 optional。

Launcher 可读取：

- GET `/api/v1/servers/{serverId}/manifest`：签名覆盖的原发布清单，modDetails/files 带 optional。
- GET `/api/v1/servers/{serverId}/packages?platform=windows-amd64`：已校验的当前平台 mods，optional 缺省在此 API 明确返回 false；同时返回整包／更新包描述。
- muapack 内 `metadata/target-manifest.json`：optional 与文件字节身份一起由签名绑定。

Launcher 必须持久化玩家选择，在安装／更新时仅启用所选 optional 模组，不能把全部 JAR 直接放入启用的 mods 目录；包里的完整字节可以留作后续启用。该端侧选择／安装功能尚未修改或验证。optional 的更新选择不能改变后台发布清单与签名。

## 远程来源与代理设置

`/admin/system/settings` 的 Worker 下载卡片，及 GET/PATCH `/api/admin/download-settings`，只允许启用的超管面板会话访问。普通组织管理员、审核员和服务器 API Token 无权配置。

PATCH 需要既有来源／代理字段；新增环境下载字段可省略，此时保留当前值。以下调用仍兼容：

```json
{
  "remoteSourceWhitelistEnabled": false,
  "remoteSourceHosts": ["cdn.modrinth.com", "edge.forgecdn.net", "mediafilez.forgecdn.net"],
  "downloadProxyEnabled": false,
  "downloadProxyUrl": ""
}
```

默认域名白名单关闭。启用后要求完整域名精确匹配，原始下载声明和逐跳重定向均检查；不支持通配符。初始列表还包含 GitHub、GitLab 与已知 GitHub 发行文件域名。任务开始解析时读取配置快照；更改设置影响后续解析／重试，不改写正在下载的任务。

白名单关闭也始终限制 HTTPS/443、禁止凭据／私网／本机／保留地址，DNS 所有解析结果须为公开地址，并将实际连接固定到已检查的 IP，防止二次解析绕过；最多 5 次重定向，逐跳重新校验。HTTP/HTTPS CONNECT 代理可以是超管配置的本地代理，但隧道目标仍固定为公开 IP，TLS 校验原目标证书；不支持 SOCKS 或账号密码。总代理同时控制 mrpack 远程文件和官方环境下载，镜像是否走代理另由默认关闭的 mirrorProxyEnabled 决定；MinIO 不经过此代理。mrpack 白名单不作用于内置环境源，环境下载保留独立来源校验，详见[环境下载源](environment-download-sources.md)。

每任务最多 4 个文件并发，每个来源最多 2 次尝试，可依次尝试镜像；每次请求 10 分钟，整任务沿用 2 小时期限。单文件 2 GiB、最终文件 100000、展开 40 GiB、模组 2000，索引 16 MiB。整合包下载失败不切换当前版本。

## 下载器选择与限制

已评估 [gkpln3/dl](https://github.com/gkpln3/dl)：MIT 的 Rust CLI，具备 HTTP Range 多连接、断点状态和自动连接管理。接入需要增加多平台二进制部署、子进程管理，以及把逐跳来源／DNS 固定／代理／校验／进度与 Worker 租约连接起来。项目自身大文件基准不能证明对这些模组和本地网络同样有效。本阶段使用 Node 原生流式下载与 4 文件并发，暂不引入它，也不做单文件 Range 分段；若后续吞吐实测成为瓶颈，再独立验证。

环境组装支持原版／Fabric／Quilt，以及已适配安装器格式的 Forge／NeoForge；未知处理器明确失败，不降级为原版。PCL 样本的 NeoForge 21.1.256 进入相同的环境准备和组包流程，详见 [Forge 环境](forge-environments.md)。跨平台环境缺失仍沿用原发布门槛；完成组包不代表游戏启动已验收。

## 验证

解析、下载双哈希／大小、4 文件并发、覆盖层、PCL 内包、optional 签名及变化、真实 CONNECT/TLS/重定向检查均有测试。隔离 PostgreSQL/MinIO 验证上传、名称确认、伪造标记忽略、审核、整包／更新包与公开 API。`MUA_REAL_MRPACK` 可指定本地 HMCL 样本运行可选真实网络测试，使用独立临时数据库／存储；测试后清理，不创建业务发布。

真实 HMCL 样本识别 MC 26.1 / Java 25 / Fabric 0.19.5，远程 Fabric API 为 2521340 字节，下载并校验后 CAS SHA-256 为 `7fe7bea3dbb7b2e9ff998ab583130cd62fab22ab8a5229656ff14b2e648c91dd`。此结果是导入验证，不代表 Launcher 已安装或游戏已启动。
