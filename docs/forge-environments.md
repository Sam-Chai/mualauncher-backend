# Forge／NeoForge 环境接入

2026-10-10：上传识别出的 Forge／NeoForge 依赖现在进入现有 PackageBuild 环境准备流程，与原版、Fabric、Quilt 共用 CAS、平台清单、审核、签名与发布门槛。不会降级成原版，也没有第二套 Release 系统。

## 安装与校验

Worker 按 Minecraft／加载器版本从官方 Maven 定位 installer.jar；依次尝试已配置国内 Maven 镜像，最后回退官方。Forge 使用 `maven.minecraftforge.net`，NeoForge 使用 `maven.neoforged.net/releases`。安装器 SHA-1 校验后安全解包，检查 install_profile.json、version.json、Minecraft 继承关系与加载器身份。

支持 spec 0／1 安装描述与已适配的客户端处理器：MCP_DATA、官方 mappings 下载、MERGE_MAPPING、jarsplitter、AutoRenamingTool／ForgeAutoRenamingTool、binarypatcher。仅处理 client 阶段；不执行 server 阶段、上传包内程序或任意启动前命令。未知处理器／任务、旧式未适配安装器明确失败。NeoForge 1.20.1 使用的历史 `net.neoforged:forge` 坐标尚未适配，不能据此宣称支持全部版本。

安装依赖按上游 SHA-1／大小校验，processor JAR 的 Main-Class 只从已校验 JAR 的 Manifest 读取。Minecraft mappings 由 Node 下载器下载，不交给 Java 联网下载。处理器在独立临时目录中执行，校验声明的输出摘要，并再次检查输入依赖没有被修改；只把运行库、生成的客户端／extra JAR 和加载配置纳入环境。安装工具不加入运行 classpath。旧原版依赖被加载器覆盖时从 classpath 移除，但原版环境清单仍保留完整事实。

处理器调用使用参数数组、关闭 shell、隐藏 Windows 窗口，移除数据库／存储凭据和 JAVA_TOOL_OPTIONS 等环境变量；单处理器上限十分钟，支持取消，内存上限 2 GiB。路径、普通文件、数量和文件大小沿用环境校验。**这不是操作系统沙箱**：执行的是官方上游代码，生产应给 Worker 独立最小权限账号和容器隔离。

## Worker Java 配置

处理器使用 Worker 宿主平台 Java，与分发包目标平台 JRE 分开。查找顺序：`FORGE_PROCESSOR_JAVA` → `JAVA_HOME/bin/java` → PATH 的 java。当前实测宿主 Java 21；处理器可能需要更高 Java 时会明确失败，不自动使用目标平台 Java 或忽略错误。例：

```dotenv
FORGE_PROCESSOR_JAVA="C:/Program Files/Eclipse Adoptium/jdk-21.0.10.7-hotspot/bin/java.exe"
DOWNLOAD_DNS_OVER_HTTPS="false"
```

目标客户端仍默认集成 Adoptium JRE（例如 MC 1.12.2／Java 8、1.20.1／Java 17、1.21.1／Java 21），缺少目标架构 JRE 或原生库仍阻止该平台发布。没有静默改为 JDK。

## 缓存与网络

Forge／NeoForge 使用 `forge-installers-3` 环境缓存身份；原版／Fabric／Quilt 保持 `mirrors-jre-2`，已有发布与签名不改写。安装器、工具依赖和游戏输入按上游摘要缓存；最终运行文件统一 SHA-256 CAS，环境清单包含精确文件、参数及来源摘要。同版本／平台／Java 类型可直接复用完整缓存。

本机实测 NeoForge 域名被系统 DNS 返回错误公开地址，导致 TLS 失败。提供可选进程配置 `DOWNLOAD_DNS_OVER_HTTPS=true`，通过固定 HTTPS `1.1.1.1/dns-query` 解析 A／AAAA，全部地址仍须公开，连接仍固定 IP 并校验原域名证书。默认关闭；启用后不静默回退系统 DNS。DNS 查询遵循总代理开关，镜像载荷本身仍遵循 mirrorProxyEnabled，因此可以是加密 DNS 走代理、镜像文件直连。MinIO 不受影响。本机已开启此选项，未修改 Windows DNS。

## 验证范围

实测版本为 Forge 1.20.1／47.4.0、Forge 1.12.2／14.23.5.2860、NeoForge 1.21.1／21.1.256，验收结果见[实施进度](implementation-status.md)。验证环境引用、完整清单、缓存复用和 muapack 签名／载荷，并不等于已通过 Launcher 安装或六平台游戏启动验收。旧 FAILED 任务保持记录，可通过现有重试接口重新准备，未自动发布业务客户端。

实现依据：[Forge 官方处理器](https://github.com/MinecraftForge/Installer/blob/2.0/src/main/java/net/minecraftforge/installer/actions/PostProcessors.java)、[NeoForge 官方处理器](https://github.com/neoforged/LegacyInstaller/blob/main/src/main/java/net/minecraftforge/installer/actions/PostProcessors.java)。
