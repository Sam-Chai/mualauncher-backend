# 服务器验收与运维

部署入口为 [README](../README.md)，对应分支 `release/server`。下列检查针对真实目标环境；本地构建、SDK fixture、MinIO 通过不能替代真实云验收。

## 环境预检查

systemd 每次启动自动以运行用户执行预检查。管理员也可在构建、迁移、存储初始化后执行：

```bash
cd /opt/union-link/app
sudo npm run with-env -- /etc/union-link/common.env /etc/union-link/web.env -- deployment:check --role web
sudo npm run with-env -- /etc/union-link/common.env /etc/union-link/worker.env -- deployment:check --role worker
# all 用于部署管理员检查，额外要求 migration 配置，不用于常驻服务。
sudo npm run with-env -- /etc/union-link/common.env /etc/union-link/web.env /etc/union-link/worker.env /etc/union-link/deploy.env -- deployment:check --role all
```

预检查不写业务数据、不生成密钥、不建桶；它校验配置、密钥、构建、临时目录权限、Java、受限角色／RLS，并读取桶状态。它不验证浏览器跨域、签名 PUT、不可变写入、任务完成、磁盘容量或备份恢复。失败不自动改用管理员连接或关闭 RLS。管理员检查通过仍须确认 systemd 以运行用户启动成功。

## 开放测试前的验收

记录 commit、时间、配置版本、签名 key ID 与结果，不保存明文凭据或完整签名下载链接。

| 范围 | 必须通过 |
| --- | --- |
| 入口 | HTTPS 证书可信；登录及后台正常，无混合 HTTP 内容；Cookie 为 Secure／HttpOnly／SameSite |
| 权限 | 未登录被拒绝；跨组织读写被拒绝；只读、编辑、审核、发布角色边界正确；普通账号／Token 不得操作超管设置／遥测 |
| 上传 | 浏览器分片 PUT 成功，ETag 可读；非法来源、超限和不支持格式失败；Worker 识别／进度正常 |
| 发布 | 分别完成 v1／v2 上传、审核、组包、签名和发布；READY 前不能发布；旧包／签名不变 |
| 下载 | 完整包／更新包大小与 SHA-256 正确；错误基准回退 full；过期按固定 releaseId 刷新；Range 返回 206，If-Match 不匹配被拒绝 |
| Worker | 心跳新鲜且任务实际完成；处理中停止／重启后恢复，无永久卡住；无 Worker 时不误报任务完成 |
| 存储 | 三桶私有、匿名读失败；storage:verify 通过；浏览器 CORS；云区域与禁止覆盖能力实测 |
| 遥测 | 采集时间推进、权限隔离；未知为 null，CDN 待接入；MinIO 重启不生成虚假流量 |
| 容量 | 实际大包和预计并发下测磁盘峰值、CPU、内存、耗时／积压；不以小样本 p95 宣称容量达标 |
| 恢复 | 数据库、三桶、密钥有匹配备份；一次隔离恢复成功；代码、迁移及 key ID 匹配 |

推荐先观察一个完整日常使用周期的队列失败、存储错误、服务重启和磁盘增长，再扩大测试范围。Launcher 游戏安装／启动是另外的验收项目。

## 备份与回退

备份覆盖数据库（含 authz、迁移元数据及引用）、角色配置／受保护连接、三个桶的对象和元数据、Ed25519 私钥、配置与 commit。密钥备份加密保管，不进入 Git、日志或公开 artifact。使用专用备份账号和密码文件／秘密管理器，不把密码放命令参数中。

建立一致备份时停止 Web／Worker，确认退出，再执行数据库快照／pg_dump 和存储快照／复制；停止期间不能允许其他自动化写入。保留对象键、SHA-256 元数据和原始字节。备份完成并验证可恢复后启动。数据库自动备份不替代密钥和桶备份。

恢复演练在隔离数据库／桶中完成：建立匹配角色，恢复数据、对象和同一私钥，应用匹配 commit，执行 db:check，核验账号、绑定、历史、CAS 引用、key ID 和下载摘要。不能覆盖正在使用的数据库或桶。

更新失败时：

1. 保持服务停止，保留日志、当前数据库和 checkout，不用 git reset --hard 清理诊断证据。
2. 未迁移时可在独立目录检出旧 commit、安装并构建，调整 service 路径（含可写目录）后启动。
3. 已迁移时先判断旧代码兼容性；Prisma 没有自动 down。优先兼容修复，不假定旧 commit 可用。
4. 整体回退须先恢复到隔离资源、验证后切换；接受过新写入时先处理新增数据，不能覆盖旧备份。

## 依赖安全记录

此部署分支将 Prisma／Client／PostgreSQL adapter 同步升级到 7.10.1，Scalar React 升到 0.9.81，修复此前运行依赖链中的 deepmerge-ts、mysql2 和 AI SDK 告警。以发布验证时的 `npm audit --omit=dev` 结果为准，依赖公告后续可能变化。

开发依赖仍有 `eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch → braces` 的嵌套模式栈耗尽告警（审计计为五个受影响包），当前 registry 没有修复版 braces。它仅由检查工具处理可信仓库文件／glob 配置，不在 Web／Worker 请求链使用。保持 Lint 配置可信，不接收用户提交的 glob 作为配置；暂不采用审计建议的 Next ESLint 主版本降级。见 [官方公告](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)。保留工具依赖的服务器也需跟踪后续修复。

## 故障定位

| 现象 | 检查 |
| --- | --- |
| systemd 启动失败 | 预检查日志、Node 路径、env 权限、checkout 是否误放 .env、迁移版本 |
| 心跳有但不完成任务 | 队列错误、OSS 权限、Java／外部下载、磁盘、租约；心跳不代表任务健康 |
| 登录后写入 403 | APP_ORIGIN、HTTPS／端口、权限与修订、反代 Host／Origin；不放宽来源检查 |
| 上传预检失败／读不到 ETag | OSS 公网域名、TLS、CORS 方法／请求头／ExposeHeaders |
| 外部无法下载 | Endpoint 是否内网可达、TLS、DNS；不重写签名 URL |
| 存储写入失败 | 版本控制、区域、禁止覆盖能力／权限；不关闭不可变保护 |
| Java 处理失败 | 宿主 Java 路径／版本、支持范围和工作目录，不修改目标客户端 Java 要求 |
| 遥测过期 | Worker、迁移、租约、MinIO metrics 权限；其他云未接监控流量 |

至少监测剩余磁盘、服务退出／重启、队列滞留和失败、心跳、遥测新鲜度、备份及恢复记录。模板提供进程托管和日志，不宣称已部署告警平台。

## 分支验证记录（2026-10-18）

- 从不含 .env、旧构建、node_modules 和生成客户端的干净源码目录完成 npm ci --include=dev 与生产构建；仅提供生成用假 URL，不使用真实数据库凭据构建。
- 完整 npm test：241 项通过、2 项真实包样本测试因未提供输入而跳过；包含真实受限角色、HTTP／Actions 上传发布、存储／遥测、协议及组件回归。修复了 core／upload 测试只加载首发迁移的问题，现按顺序应用全部迁移。
- Scalar、箴言图片、v2 客户端三项浏览器回归通过；类型、Lint、Prisma 模型、四类运行角色与 OpenAPI 64/64 检查通过。
- 生产依赖 npm audit --omit=dev 无告警；完整依赖仍有上文记录的开发工具告警。
- 一次性 Debian Linux 容器中的 systemd-analyze verify、Nginx TLS 配置 nginx -t 通过；未在目标 Ubuntu 主机实际启动服务。Windows 沙箱的图片测试子进程清理需额外进程权限，已清理并以具备权限的进程单独复验四项通过、正常退出。

未执行远端部署、真实云桶／CORS、目标环境备份恢复或负载验收；这些仍由部署后的验收清单覆盖。
