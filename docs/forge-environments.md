# Forge／NeoForge 环境接入

2026-10-10：上传识别出的 Forge／NeoForge 依赖现在进入现有 PackageBuild 环境准备流程，与原版、Fabric、Quilt 共用 CAS、平台清单、审核、签名与发布门槛。不会降级成原版，也没有第二套 Release 系统。

## 安装与校验

Worker 按 Minecraft／加载器版本从官方 Maven 定位 installer.jar；依次尝试已配置国内 Maven 镜像，最后回退官方。Forge 使用 `maven.minecraftforge.net`，NeoForge 使用 `maven.neoforged.net/releases`。安装器 SHA-1 校验后安全解包，检查 install_profile.json、version.json、Minecraft 继承关系与加载器身份。

支持 spec 0／1 安装描述与已适配的客户端处理器：MCP_DATA、官方 mappings 下载、MERGE_MAPPING、jarsplitter、AutoRenamingTool／ForgeAutoRenamingTool、binarypatcher。仅处理 client 阶段；不执行 server 阶段、上传包内程序或任意启动前命令。未知处理器／任务、旧式未适配安装器明确失败。NeoForge 1.20.1 使用的历史 `net.neoforged:forge` 坐标尚未适配，不能据此宣称支持全部版本。

安装依赖按上游 SHA-1／大小校验，processor JAR 的 Main-Class 只从已校验 JAR 的 Manifest 读取。Minecraft mappings 由 Node 下载器下载，不交给 Java 联网下载。处理器在独立临时目录中执行，校验声明的输出摘要，并再次检查输入依赖没有被修改；只把运行库、生成的客户端／extra JAR 和加载配置纳入环境。安装工具不加入运行 classpath。旧原版依赖被加载器覆盖时从 classpath 移除，但原版环境清单仍保留完整事实。

2026-10-25：Java 处理器已迁移到统一 Docker/gVisor 协议，固定 `runsc` 和镜像摘要，断网、只读根目录／输入卷、非 root、零安装器 capabilities、受限 tmpfs 与内存／CPU／PID／日志／时间配额。整个处理器链共用一个工作区，完成后先终止全部安装器后代，再导出指定产物并在 Worker 重算摘要。部署不符合策略直接失败，绝不回退宿主 Java 或 runc。旧版无需执行处理器的嵌入载荷仍直接校验导入。真实目标机隔离验收记录与部署见 [隔离执行](isolated-execution.md)。

## Worker 执行配置

默认 Docker/gVisor 模式使用原生 Linux 架构的固定 Java 21 执行镜像，与分发包目标平台 JRE 分开。该模式不使用 `FORGE_PROCESSOR_JAVA`／`JAVA_HOME`；升级执行 Java 需构建并固定新镜像，不能由整合包选择。设置页显式选择裸机时，才使用 `FORGE_PROCESSOR_JAVA`／JAVA_HOME／PATH 的 Java 21+，权限与限制见 [运行环境管理](execution-management.md)。例：

```dotenv
SANDBOX_JAVA_IMAGE="sha256:<sandbox:image 输出的 64 位摘要>"
SANDBOX_DOCKER_CONTEXT="colima-union-link"
DOWNLOAD_DNS_OVER_HTTPS="false"
```

目标客户端仍默认集成 Adoptium JRE（例如 MC 1.12.2／Java 8、1.20.1／Java 17、1.21.1／Java 21），缺少目标架构 JRE 或原生库仍阻止该平台发布。没有静默改为 JDK。

## 缓存与网络

Forge／NeoForge 使用 `forge-execution-2-<运行模式>-<执行镜像或 Java 及策略摘要>` 缓存身份；原版／Fabric／Quilt 保持原身份，已有发布与签名不改写。未签名任务不能继续复用缺少当前运行策略标记的旧 PREPARED 清单，不跨裸机和 Docker 复用。执行凭据保存到私有环境桶 `executions/<UUID>.json`，包括协议、计划摘要、镜像或 Java 标识与架构；它不是上游签名或游戏启动证明。安装器、工具依赖和游戏输入按上游摘要缓存；最终运行文件统一 SHA-256 CAS。同版本／平台／Java 类型与执行策略可复用完整缓存。

本机实测 NeoForge 域名被系统 DNS 返回错误公开地址，导致 TLS 失败。提供可选进程配置 `DOWNLOAD_DNS_OVER_HTTPS=true`，通过固定 HTTPS `1.1.1.1/dns-query` 解析 A／AAAA，全部地址仍须公开，连接仍固定 IP 并校验原域名证书。默认关闭；启用后不静默回退系统 DNS。DNS 查询遵循总代理开关，镜像载荷本身仍遵循 mirrorProxyEnabled，因此可以是加密 DNS 走代理、镜像文件直连。MinIO 不受影响。本机已开启此选项，未修改 Windows DNS。

## 验证范围

历史宿主执行曾验证 Forge 1.20.1／47.4.0、Forge 1.12.2／14.23.5.2860、NeoForge 1.21.1／21.1.256，不能作为本轮 gVisor 验收证据。本轮本地协议／适配器测试与目标机验收分别记录在 [隔离执行](isolated-execution.md)。完整组包校验仍不等于 Launcher 安装或游戏启动验收。旧 FAILED 任务保持记录，可通过现有重试接口重新准备，未自动发布业务客户端。

实现依据：[Forge 官方处理器](https://github.com/MinecraftForge/Installer/blob/2.0/src/main/java/net/minecraftforge/installer/actions/PostProcessors.java)、[NeoForge 官方处理器](https://github.com/neoforged/LegacyInstaller/blob/main/src/main/java/net/minecraftforge/installer/actions/PostProcessors.java)。
