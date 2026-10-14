# Union Link

对象存储现支持 `.env` 的 `OSS_PROVIDER=minio|aws|s3|ali|tencent|huawei`，三家云服务使用原生 SDK；配置、私有桶／CORS 和部署自检见 [对象存储配置](docs/object-storage.md)。现有 MinIO 的 `S3_*` 配置继续可用。

后台左侧 `API` 打开内嵌 Scalar，OpenAPI 3.1 中英文完整覆盖 66 个操作，可切换 5 个 Launcher 公开接口。[接入与 CI 校验](docs/openapi.md)、[客户端完整流程](docs/api-workflows.md)、[兼容性记录](docs/openapi-changelog.md)；`/openapi.json` 只公开 Launcher，完整 JSON 逐请求检查后台 Cookie。

Union Link 是 MUA 高校联盟启动器后端，使用 Next.js 16、Prisma 7 与 PostgreSQL。后台采用 shadcn/ui dashboard-01、Tailwind CSS、Lucide、TanStack Table、React Hook Form + Zod；图表仅使用 Tremor Raw。

已实现白名单登录、组织／单服 RBAC、PostgreSQL RLS、组织和服务器管理、成员授权、归档、审计，以及 .minecraft ZIP／Modrinth mrpack／PCL 封装上传、MinIO、Worker、SHA-256 CAS、版本差异统计、审核和 Ed25519 签名发布。Modrinth 远程下载、optional 全量打包与超管来源／代理设置见 [导入说明](docs/modrinth-import.md)。Launcher 增量安装／optional 选择尚未接入。RLS 角色、连接、部署与恢复见[数据库行级保护](docs/postgresql-rls.md)。

环境下载默认优先 BMCLAPI／中科大／南大和清华 Adoptium，失败回退官方；默认集成 JRE。超管在 Settings 管理下载源、JRE／JDK 与镜像代理开关（默认关闭）；官方环境和 mrpack 使用总代理设置，MinIO 不走代理。镜像覆盖范围、缓存兼容与验收记录见[环境下载源](docs/environment-download-sources.md)。

Forge／NeoForge 已接入官方客户端安装处理器、运行环境缓存与 muapack 组包，支持范围见 [Forge 环境](docs/forge-environments.md)。Worker 宿主需要 Java，推荐配置 FORGE_PROCESSOR_JAVA；目标客户端仍默认 JRE。可选 DOWNLOAD_DNS_OVER_HTTPS 默认关闭，本机因确认 DNS 异常而启用；加密 DNS 查询与镜像文件的代理选择分别遵循既有开关。

[产品需求](docs/mua-backend-requirements.md)、[数据库模型](docs/minimal-data-model.md)、[权限矩阵](docs/permission-matrix.md)、[实施进度](docs/implementation-status.md)、[管理界面](docs/admin-ui.md)。上传流程与标准 API 见[客户端上传文档](docs/client-upload-api.md)。

[muapack v1 协议](docs/muapack-v1.md)已提供整包／更新包模型、六平台环境引用、差异生成、独立签名和只读 ZIP 校验。运行 `npm run test:muapack` 验证协议，或 `npm run muapack:validate -- client.muapack trusted-public-key.pem` 校验实际文件。Worker 环境下载／缓存、六平台后台组包、发布门槛和表格进度已接入，见[后台组包](docs/muapack-worker.md)。Launcher 安装尚未接入。默认选择除 Linux aarch64 外的五个平台，Linux ARM 选项灰色禁用并显示提示；缺少官方 Java／原生库的平台会明确失败，需要调整平台后重新审核。

[muapack v2 协议基线](docs/muapack-v2.md)已冻结，并提供带签名的[完整／更新离线样例](docs/examples/muapack-v2/README.md)。已接入上传选择、共享识别、本地 CAS、完整组包及同一套审核／签名／发布；远程模组与环境只保存声明，由 Launcher 下载。单一跨平台 full 包经过 ZIP／内容／签名校验后才可发布，管理下载与显式能力协商的公开下载已接入。v2 自动增量组包与基准匹配分发已接入，Launcher 安装尚未完成；v1 继续完整运行。后续顺序见[v2 设计记录](docs/muapack-v2-design.md)。

## 启动本地环境

本机使用 Docker 容器 mualauncher-psql（127.0.0.1:15432，映射容器 5432）和 mualauncher-minio（127.0.0.1:9000）。连接、存储凭据和签名私钥路径保存在不提交 Git 的 .env 中；新环境从 .env.example 复制并填写，以实际容器映射为准。

~~~powershell
npm ci
# 首次配置：临时提供 DATABASE_ADMIN_URL；已有数据库追加 --adopt。
npm run db:provision -- --write-env
npm run db:deploy
npm run db:check
npm run auth:bootstrap
npm run storage:init
$env:APP_ORIGIN = 'http://localhost:3001'
npm run dev -- -p 3001 -H 127.0.0.1
~~~

另开终端启动独立 Worker：

~~~powershell
npm run worker
~~~

打开 http://localhost:3001/admin/clients。停止 Worker 不会丢失已经完成上传的任务；重新启动后继续处理。系统页面显示实际 Worker 心跳、存储和签名公钥状态。

APP_ORIGIN 必须匹配页面的协议、主机和端口，末尾不加斜杠。本地允许同协议、同端口的 localhost、127.0.0.1 和 IPv6 回环别名；其他来源精确匹配，跨站请求拒绝。HTTPS origin 自动启用 Secure Cookie。

首次 auth:bootstrap 创建超管 mua-admin，随机密码写入被 Git 忽略的 .local/initial-admin-*.txt。已有启用超管时不会重置账号。登录后在“系统 → Settings → 账号安全”修改密码并删除初始凭据文件。可通过进程环境 BOOTSTRAP_USERNAME、BOOTSTRAP_PASSWORD 提供初始凭据，不能把密码写进命令参数或提交内容。面板没有公开注册，普通账号由超管在“联盟管理 → 成员 → 白名单账号”创建。

服务器登记使用既有 MUA ID，不自动分配新 ID。组织可上传多个独立客户端，每服同时只绑定一个客户端；同组织同名使用更新，绑定替换需确认，解绑保留版本历史。上传与更新都进入审核；当前版本在批准并发布切换前继续使用。组织管理员可以管理本组织的客户端，审核、发布、切换分别授予权限。[服务器箴言图片](docs/server-motto-images.md)已支持真实上传、61:23 网格裁剪、原图重裁剪和受权限保护的后台预览；组织头像和玩家公开图片分发尚未接入。

## 本机生产预览

当前预览使用 .next/mua-v2-delta 独立构建目录，监听 http://localhost:3001，仅绑定 127.0.0.1。客户端管理提供上传前 v1／v2 选择，以及已生成完整 muapack 的版本／平台选择和下载。重新构建前停止此预览实例，再运行：

~~~powershell
$env:APP_ORIGIN = 'http://localhost:3001'
$env:NEXT_DIST_DIR = '.next/mua-v2-delta'
npm run build
npm run start -- -p 3001 -H 127.0.0.1
~~~

构建与启动必须使用相同 NEXT_DIST_DIR。Worker 仍须单独运行。本机进程没有注册为 Windows 自动启动服务。生产需配置 HTTPS、独立最小权限数据库／存储账号和持久受保护的签名密钥。

## 验证

~~~powershell
npm run db:validate
npm run db:check
npm run test:rls
npm run typecheck
npm run lint
npm test
~~~

测试使用真实 PostgreSQL 的随机临时 schema 和专用随机 MinIO bucket，应用本仓库迁移，验证 RBAC、RLS、不可变版本、并发、ZIP 安全、分片、CAS、签名及发布，最后只清理测试资源，不修改 public 业务记录。DATABASE_MIGRATION_URL 用于创建和清理测试 schema；四种受限运行连接用于 RLS 与 HTTP 验证。

完整 HTTP／自动化脚本测试需要先完成独立生产构建：

~~~powershell
$env:MUA_HTTP_TEST_DIST = '.next/mua-v2-delta'
npm test
~~~

该测试在临时数据库 schema 上启动隔离的 Next 实例，以标准 API Token 运行 client:upload 脚本，检查提交、审核、发布、签名和公开 CAS 下载。未设置 MUA_HTTP_TEST_DIST 时跳过这一项。

检查已经运行的本机实例：

~~~powershell
$env:SMOKE_ORIGIN = 'http://localhost:3001'
npm run check:http
~~~

HTTP 检查默认读取初始超管凭据文件；改密后通过当前进程 SMOKE_USERNAME、SMOKE_PASSWORD 提供凭据。检查会产生真实登录审计，结束时撤销测试会话。

npm ci、npm run dev 与 npm run build 自动生成 Prisma 客户端。数据库工具包括 db:generate、db:studio 和 db:migrate -- --name your_change。部署已有迁移使用 db:deploy；迁移包含 Prisma 无法表达的检查、索引和触发器，不能用 reset 丢弃业务数据。

数据库入口为 src/lib/prisma.ts；认证／RBAC 为 auth.ts、api-auth.ts、rbac.ts；客户端业务为 client-service.ts、client-worker.ts、pack-parser.ts、storage.ts 和 signing.ts。Client Component 不得导入服务端数据库或认证实现。

构建使用系统字体，不依赖 Google Fonts。npm 默认缓存不可写时可使用 npm ci --cache "$env:TEMP/mualauncher-npm-cache"。
