# 环境下载源与代理

2026-10-09 实现，2026-10-10 复核：Settings → Worker 下载源与代理，仅 MUA 超级管理员的面板会话可读写。复用 `/api/admin/download-settings`，API Token 和普通组织账号不可修改。

默认选择 BMCLAPI、中科大、南大；Java 选择清华 Adoptium，集成类型为 **JRE**。界面按 BMCLAPI → 中科大 → 南大顺序尝试勾选项；API 可传有序子集。最后始终保留官方回退。全部取消镜像则只使用官方。

## 覆盖范围

| 下载内容 | 镜像映射 | 最后回退 |
| --- | --- | --- |
| Mojang 版本目录、版本 JSON、游戏 JAR、资源索引 | BMCLAPI 保留官方路径 | 官方 JSON 指定的 Mojang URL |
| 游戏资源哈希对象 | BMCLAPI `/assets/<prefix>/<sha1>` | `resources.download.minecraft.net` |
| 游戏依赖、平台原生库、Fabric／Quilt／Forge／NeoForge Maven 库、安装器及校验文件 | BMCLAPI `/maven/<coordinate>`；中科大／南大 `/bmclapi/<coordinate>` | 其官方 Maven 仓库 |
| Fabric／Quilt 加载配置 | BMCLAPI `/fabric-meta`、`/quilt-meta` | Fabric／Quilt 官方 Meta |
| Temurin Java 压缩包 | 清华 `/Adoptium/<major>/<jre-or-jdk>/<arch>/<os>/<exact-filename>` | 官方 API 返回的 GitHub 发行包 |
| Java 版本、精确构建和 SHA-256 | **Adoptium 官方 API** | 清华并未同步所需校验元数据，不能伪装成镜像 API |

中科大、南大是静态 Maven 镜像，不是完整 BMCLAPI API。它们的 `assets/` 目录不是 Mojang 的哈希资源树；不会把版本目录、Meta 或资源哈希对象盲目改写到这两个镜像。Quilt／Forge／NeoForge 镜像内容可能缺失，自动回退；NeoForge 官方仓库的 releases 前缀在镜像坐标路径中移除。安装处理器另见 [Forge 环境](forge-environments.md)。

参考：[BMCLAPI 文档](https://bmclapidoc.bangbang93.com/)、[中科大实际目录](https://mirrors.ustc.edu.cn/bmclapi/)、[南大目录](https://mirrors.nju.edu.cn/bmclapi/)、[清华 Adoptium](https://mirrors.tuna.tsinghua.edu.cn/Adoptium/)。后台设置提供这些可见来源链接，标明 BMCLAPI 来源。

## 设置契约

GET／PATCH `/api/admin/download-settings` 在既有白名单／代理字段之外增加：

```json
{
  "minecraftDownloadSources": ["bmclapi", "ustc", "nju"],
  "javaDownloadSources": ["tuna"],
  "mirrorProxyEnabled": false,
  "javaImageType": "jre"
}
```

- `downloadProxyEnabled` 控制官方环境下载和 mrpack 远程文件；使用现有 `downloadProxyUrl` HTTP(S) CONNECT 代理。
- `mirrorProxyEnabled` 默认 false，镜像及其 CDN 整个下载流直连；仅总代理开关启用时生效。开启后镜像也用同一代理。官方回退独立按总开关选择代理。
- mrpack 白名单只作用于包内远程来源，不能阻断内置环境镜像／官方源。上传／读取 MinIO 不经过此网络代理。
- 旧 PATCH 调用省略新增字段时保留当前配置；配置变更记入审计。每次环境解析读取一份设置快照，正在运行的任务不因修改设置中途换配置。

## 校验、回退与缓存

HTTP 错误、连接／TLS 错误、超时、文件大小／上游哈希不符、元数据结构错误或目录缺少目标版本均尝试下一个源。不缓存失败文件；删掉本次创建的部分文件后重试。任务取消立即停止，不触发官方回退。请求响应头上限 20 秒；镜像单次总下载 5 分钟，官方 10 分钟，Worker 整体仍有 2 小时上限。单一镜像资源类别连续失败两次后暂停尝试 60 秒，避免几千个资源重复等待同一故障源；其他类别和官方不受影响。

仅 HTTPS 443，无 URL 凭据；每跳公开地址检查、DNS 固定和 TLS 验证。BMCLAPI 会动态分配 OpenBMCLAPI CDN 域名，这些跳转允许公开 HTTPS 节点，不接受私网／回环／保留 IP 或 HTTP 降级。其他来源保留固定官方／镜像域名和路径校验。下载最多五次重定向、单文件 2 GiB；最终字节校验上游 SHA-1／SHA-256，保存 SHA-256 CAS。

CONNECT 隧道检查目标全部 DNS 结果后，在同时有 IPv4／IPv6 时优先选择已验证的 IPv4；未放宽私网检查、DNS 固定或 TLS 主机验证。这样避免本地代理对 IPv6 目标重置连接；仍不支持 SOCKS 和代理账号密码。

原版／Fabric／Quilt 环境解析器保持 `mirrors-jre-2`，Forge／NeoForge 使用 `forge-installers-3`；缓存身份包含 Java `imageType`，JRE 和 JDK 不互相混用。源偏好不参与内容身份，修改镜像不重复构造已完成环境。Minecraft 原文件按上游摘要复用已有缓存。新 Java 环境和平台清单显式记录 `imageType`；旧清单可省略该字段，其签名和发布不改写。已准备／完成的任务也不会因全局设置变化自动重构。

可选 Worker 进程配置 `DOWNLOAD_DNS_OVER_HTTPS=true` 使用固定 HTTPS 加密 DNS，默认关闭。查询遵循总代理，镜像载荷仍遵循 mirrorProxyEnabled；所有地址的公开性、连接固定和 TLS 校验保持不变。用于本机已确认的 DNS 错误，不是关闭来源验证，详见 [Forge 环境](forge-environments.md)。

JRE 不可用时明确报错，不静默改装 JDK 或使用其他架构。超管可以明确选择 JDK，或管理员修改发布平台／Java 版本。2026-10-09 实测 Java 25 Windows ARM64 的官方 JRE 列表为空；缺少 Linux ARM64 游戏原生库的既有平台限制仍存在。

本阶段不接入镜像测速、自动最优源或 Range 分段。验证镜像下载／组包并不代表六平台真实 Minecraft 启动已验收。

## 验收记录

2026-10-09 的完整回归共 92 项：91 项通过，1 项可选真实 mrpack 网络测试跳过，包含隔离生产 HTTP API；类型检查、Lint、Prisma validate 和 `.next/mua-mirrors` 生产构建通过。实网验证覆盖 BMCLAPI 元数据／Fabric／Maven、中科大／南大 Maven、清华 JRE，以及 Minecraft 元数据官方回退；未把静态 Maven 验证扩大为大学镜像完整 API 或 Quilt 启动验收。

清华 Java 25 Windows amd64 JRE 归档大小 58,475,080 字节，SHA-256 为 `4c95451cea98556def2c54f7782933f52a26d4a36bd85e1d59f0364464828b07`，与官方元数据一致。完整 Minecraft 26.1／Fabric 0.19.5／JRE 环境共 5,149 文件、759,236,155 字节，其中 Java 320 文件；包含 `bin/java.exe`，不含 `bin/javac.exe`。上游 release_name 使用 `jdk-25.0.4.1+1`，该字符串不能代替实际 imageType 判定。

2026-10-10 运行复核：

| 检查 | 结果 |
| --- | --- |
| 环境／Modrinth 针对性回归 | 22/22 通过，包含代理 DNS／TLS、坏哈希回退、取消、退避与 JRE／JDK 缓存隔离 |
| 运行中 GET 设置与数据库 | 完全一致；当前国内源默认顺序、JRE、镜像代理关闭，既有总代理启用状态保留 |
| 实际权限和输入保护 | 普通账号 GET／PATCH 403，未登录 401，重复源 PATCH 400，跨站 PATCH 403；检查未修改设置，临时会话已清理 |
| 数据库 | 十份迁移已应用，包含 202610090006_environment_mirrors |
| 运行服务 | 原有 Docker 卷保留，PostgreSQL 127.0.0.1:15432、MinIO 9000、Next 3001、独立 Worker 心跳正常；check:http 通过 |
| 环境缓存 | 重读清单、引用校验及再次解析复用成功；旧 JDK 缓存仍可读取 |
| 已发布兼容 | 既有一份发布的 OSS Manifest 字节摘要及签名摘要与部署前一致 |

本机检查报告保存在被 Git 忽略的 `.local/mirror-settings-review.json`、`.local/jre-environment-report.json` 和 `.local/environment-mirrors-smoke.json`，完整回归日志为 `.local/mirrors-tests.log`。这些是本机验收证据，不是生产监控。2026-10-10 的 computer-use 视觉复核尝试因 node_repl 内核的 Windows sandbox 初始化失败（helper_unknown_error: setup refresh had errors）而未能进入浏览器。设置卡片视觉复验、Launcher 安装／验签和六平台真实游戏启动未完成；后续 Forge／NeoForge 接入验收另见 [实施进度](implementation-status.md)。
