# v2 分发统计

2026-10-13：v2 第 6 步补齐。上传填写、审核详情、草稿记录和发布历史展示导入统计及只读分发统计；v1 保持原展示。

## 口径

目标本地／远程大小是清单声明总量，包含全部 optional。远程字节没有在后台下载或校验。本地载荷是本次包携带的未压缩文件大小，按路径统计；ZIP 大小来自当前修订 READY 产物，包含元数据和 ZIP 开销。首次安装使用完整包，有可用基准时使用更新包；无基准、跨格式或历史平台不兼容时回退完整包。

玩家基准采用上传时固定的同客户端已发布 v2，不用未发布草稿、版本号或现在的当前版本推断。READY 后采用实际产物的 baseReleaseId／baseManifestSha256；历史统计不改写产物或签名，已生成更新包可读取原基准的历史声明。摘要或身份损坏明确失败。

差异按路径展示新增、内容修改、移除、策略／optional 和地址变化，同一路径可有多种变化。内容比较与组包协议保持一致；本地策略变化仍计入更新包载荷。远程下载估计只计新内容／内容变化，并按 SHA-512 去重；仅地址、执行属性、策略或 optional 变化不重复计算已有内容下载。移除是声明差异，removalPolicy=retain，不自动删除玩家文件。

`knownNetworkBytes = selectedPackageBytes + remoteDownloadBytes`。假设基准文件完整、无额外玩家缓存且全部 optional 已选择；preserve、实际 optional 选择、缺失文件修复及缓存会改变下载量。它不包含协议开销和未知的 Minecraft／Java／加载器下载。`environmentBytes` 始终为 null，界面显示“待 Launcher 解析”；未组包时 ZIP 及 knownNetworkBytes 为 null，不伪造 0。即使零文件变化，更新包也有 ZIP／元数据下载量。后台 CAS 复用率仅表示后台存储复用。

## 只读 API

| GET 路径 | 权限 |
| --- | --- |
| `/api/v1/clients/uploads/{uploadId}/distribution-statistics` | DRAFT_READ |
| `/api/v1/clients/{clientId}/drafts/{draftId}/distribution-statistics` | DRAFT_READ |
| `/api/v1/clients/{clientId}/releases/{releaseId}/distribution-statistics` | RELEASE_READ |

Cookie 或 Bearer 均可，继续检查组织／单服范围。发布读取使用既有受限 release_details，不要求草稿权限；跨客户端拒绝，v1 或未准备索引返回 409。端点不提供下载链接或修改数据，公开 Launcher 响应不增加字段。完整 OpenAPI 更新为 0.3.0、69 操作。

## 验证

计算及中英文展示检查随 `test:admin-ui` 运行；上传流水线验证本地载荷与签名 update metadata 一致、READY ZIP 大小与实际产物一致。生产 HTTP 契约覆盖 Cookie／Bearer、跨范围、v1 拒绝、未组包 null 和仅读发布角色。浏览器检查历史入口的中英文统计和差异表；上传与审核复用同一统计组件。

Launcher 安装、环境大小解析与真实网络流量验收仍待端侧实施。

本轮本地检查通过：统计／组件 20 项、OpenAPI 9 项、v2 完整／自动增量流水线 2 项、生产 HTTP 契约 1 项及 v2／Scalar 浏览器 2 项；TypeScript、全仓 lint、69/69 覆盖与生产构建通过。测试资源为隔离数据库／MinIO，浏览器业务数据为只读拦截，不修改既有客户端或发布。CI 已加入客户端浏览器检查，远端运行须推送后触发。
