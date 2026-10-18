# Union Link

Union Link 是 MUA 高校联盟启动器后端，包含 Next.js 管理后台与 REST API，以及独立的上传／组包 Worker。业务数据使用 PostgreSQL，文件使用私有对象存储，发布使用 Ed25519 签名。

`release/server` 是服务器部署分支，保存完整源码、数据库迁移、锁文件与部署模板。服务器拉取后仍需安装依赖、配置外部资源、应用迁移和构建；Git 不保存数据库、文件桶、环境凭据或签名私钥。此版本用于受控服务器测试，目标环境验收通过前不代表生产发布批准。

## 当前范围

已实现白名单账号、组织／单服 RBAC、四类运行数据库角色与 FORCE RLS、服务器和客户端管理、`.minecraft ZIP`／Modrinth mrpack／已验证 PCL 封装导入、CAS、差异统计、审核、muapack v1／v2 完整包与更新包、签名发布、下载链接刷新、回收，以及中英文／明暗主题。后台 `API` 内嵌 Scalar，当前完整 OpenAPI 为 **64 个操作**，公开文档仅 **4 个 Launcher GET**。

对象存储支持 `minio | aws | s3 | ali | tencent | huawei`；三家国内云采用原生 SDK，业务共用统一接口。存储容量遥测已接入，MinIO 另有已采集流量。CDN、其他云监控流量、OIDC／Yggdrasil、CurseForge／MultiMC 导入尚未接入。Launcher 的安装、信任公钥配置、增量更新与 optional 选择仍需联调，后台组包成功不等于游戏启动验收。

## 部署配方

本仓库提供 **Ubuntu 24.04 LTS + Node.js 24.x + PostgreSQL 16 + Java 21 + systemd + Nginx HTTPS** 的单机测试部署方案。对象存储使用独立 MinIO 或上述云服务；Web 与 Worker 可部署在同机。首轮不依赖 Redis，也不采用 `next dev`、静态导出或只启动 Web 的方式。

| 组件 | 要求 |
| --- | --- |
| Node / npm | Node 24.x，随附 npm；锁文件安装，构建与运行使用同一套 Node |
| Web | 生产构建后 `next start`，只监听 `127.0.0.1:3001` |
| Worker | 独立常驻 Node 进程；`tsx` 为运行依赖，宿主 Java 21 或更高 |
| PostgreSQL | 专用实例／数据库；web、auth、public、worker、migrator 分离，不使用超级用户运行服务 |
| 对象存储 | 三个不同的私有桶；服务器、浏览器和 Launcher 均可通过 HTTPS 访问 |
| HTTPS | 自有域名与有效证书，`APP_ORIGIN` 精确匹配协议、域名和端口 |
| 持久目录 | `/var/lib/union-link/signing` 保存密钥，`/var/lib/union-link/tmp` 保存工作临时文件 |

临时空间需按任务和并发预留：单次 ZIP 允许展开至 **40 GiB**，组包还会额外占用空间。不要按源 ZIP 大小配置磁盘。CPU／内存容量需要使用实际整合包压测确定。

以下命令除明确标注外均在服务器执行；替换示例域名和所有 `CHANGE_ME_*`。默认 `/usr/bin/node`；通过 [Node.js 官方发行包](https://nodejs.org/en/download) 安装在其他位置时，修改两个 service 文件中的 Node 绝对路径。systemd 不读取交互终端的 nvm 配置。

## 首次部署

### 1. 安装基础环境并拉取分支

先安装 Node 24，检查 `node --version`、`npm --version` 和 `command -v node`。再安装系统依赖：

```bash
sudo apt-get update
sudo apt-get install -y git nginx postgresql-16 postgresql-client-16 openjdk-21-jre-headless ca-certificates
sudo systemctl enable --now postgresql
sudo useradd --system --user-group --home-dir /var/lib/union-link --create-home --shell /usr/sbin/nologin union-link
sudo install -d -o union-link -g union-link -m 0750 /opt/union-link
sudo install -d -o root -g union-link -m 0750 /etc/union-link /var/lib/union-link/signing
sudo install -d -o union-link -g union-link -m 0700 /var/lib/union-link/tmp
sudo -u union-link git clone --branch release/server --single-branch https://github.com/Sam-Chai/mualauncher-backend.git /opt/union-link/app
cd /opt/union-link/app
```

私有仓库须提前配置只读仓库访问，不要把访问 Token 写进 clone URL 或提交。`useradd` 和 `git clone` 只在首次执行。防火墙仅开放所需 SSH、80／443；3001、5432、MinIO 控制台不直接面向公网。对象存储数据入口使用独立 HTTPS 域名。

安装和构建不需要真实数据库密码。生成用 URL 仅供 Prisma 读取配置，不用于连接或迁移：

```bash
sudo -u union-link env DATABASE_MIGRATION_URL='postgresql://generate_only:unused@127.0.0.1:5432/generate_only' npm ci --include=dev
sudo -u union-link env NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 DATABASE_MIGRATION_URL='postgresql://generate_only:unused@127.0.0.1:5432/generate_only' npm run build
```

本方案保留构建／运维工具依赖，**不要使用 `--omit=dev` 或 `npm prune --omit=dev`**。迁移、校验和后续原地构建需要这些工具。Web 启动后仍是生产模式。

### 2. 填写仓库外配置

```bash
sudo install -o root -g union-link -m 0640 deploy/common.env.example /etc/union-link/common.env
sudo install -o root -g union-link -m 0640 deploy/web.env.example /etc/union-link/web.env
sudo install -o root -g union-link -m 0640 deploy/worker.env.example /etc/union-link/worker.env
sudo install -o root -g root -m 0600 deploy/deploy.env.example /etc/union-link/deploy.env
sudoedit /etc/union-link/common.env /etc/union-link/web.env /etc/union-link/worker.env /etc/union-link/deploy.env
```

| 文件 | 内容 | 使用者 |
| --- | --- | --- |
| `common.env` | HTTPS Origin、OSS、绝对签名路径、临时目录、Java | Web／Worker／运维命令 |
| `web.env` | `DATABASE_URL`、`DATABASE_AUTH_URL`、`DATABASE_PUBLIC_URL` | Web |
| `worker.env` | `DATABASE_WORKER_URL` | Worker |
| `deploy.env` | `DATABASE_MIGRATION_URL`；仅首次临时添加 `DATABASE_ADMIN_URL` | 管理员单次命令 |

密码包含 `@ : / ? # %` 等字符时须 URL 编码。远程数据库还需按要求配置 TLS／证书。Web／Worker 必须指向同一数据库、同一组桶和同一签名密钥。**服务器源码目录不得创建 `.env`、`.env.local` 或 `.env.production*`**；预检查会拒绝启动，防止 Next.js／dotenv 意外加载部署管理员凭据。

`with-env` 按顺序读取文件，将变量交给单个 npm 子进程，不执行 shell `source`、不打印密码，并清除父进程遗留的数据库连接。示例采用简单的单行引号值，兼容 systemd 和 dotenv；不要使用 `$变量` 插值或 shell 表达式。

### 3. 创建数据库角色并应用迁移

全新专用 PostgreSQL 实例先创建数据库，并在交互式 psql 中配置管理员密码：

```bash
sudo -u postgres createdb union_link
sudo -u postgres psql
# 在 psql 中执行：\password postgres
# 完成后：\q
```

在 `deploy.env` 中临时填写 `DATABASE_ADMIN_URL`。provision 创建／配置项目角色，并采用各 env 文件中填写的密码。角色名称属于整个 PostgreSQL 实例；不要对其他环境共用的实例反复 provision，以免改变它们的角色密码。

```bash
sudo npm run with-env -- /etc/union-link/common.env /etc/union-link/web.env /etc/union-link/worker.env /etc/union-link/deploy.env -- db:provision
```

成功后立即从 `deploy.env` 删除 `DATABASE_ADMIN_URL`，然后执行：

```bash
sudo npm run with-env -- /etc/union-link/common.env /etc/union-link/deploy.env -- db:deploy
sudo npm run with-env -- /etc/union-link/common.env /etc/union-link/web.env /etc/union-link/worker.env -- db:check
sudo npm run with-env -- /etc/union-link/common.env /etc/union-link/deploy.env -- auth:bootstrap
```

当前有两份迁移，23 张业务表全部 FORCE RLS。只用 `db:deploy` 应用已提交迁移，不能以 `db push`／`migrate reset` 替代。已有数据库先备份；只有需要接管旧对象所有权时才经审查使用 `db:provision -- --adopt`，正常更新不重复 provision。

首次超管默认 `mua-admin`，随机密码保存于 checkout 的 `.local/initial-admin-*.txt`，仅管理员可读。通过 SSH 查看后登录改密并删除该文件；已有活动超管时不会重置。普通账号由超管创建，没有开放注册。

### 4. 准备对象存储与签名密钥

按 [对象存储配置](docs/object-storage.md) 准备三个私有桶和专用最小权限凭据。MinIO 使用独立账号，不采用 `minioadmin` 根账号。云厂商需正确区域与原生配置。浏览器 CORS 至少允许实际 `APP_ORIGIN` 的 PUT／GET／HEAD、签名上传所需请求头、Range／If-Match，并暴露 ETag／Content-Range／Content-Length／Content-Disposition。OPTIONS 由存储服务处理，CORS 不开放匿名读取。

```bash
sudo npm run with-env -- /etc/union-link/common.env -- storage:init
sudo chown root:union-link /var/lib/union-link/signing/ed25519.pem
sudo chmod 0640 /var/lib/union-link/signing/ed25519.pem
sudo npm run with-env -- /etc/union-link/common.env -- storage:verify
```

`storage:init` 创建缺失桶，并以独占方式生成缺失密钥；已有密钥保持不变。无建桶权限时提前建桶。`storage:verify` 在随机前缀写入并清理临时对象，验证禁止覆盖、分片上传、Range／If-Match、复制和元数据；它不配置 CORS，仍需浏览器实测。不支持原子禁止覆盖的原生云桶会失败，不能绕过检查部署。

签名密钥在 checkout 外持久保存并单独备份。更新应用／重建服务器必须恢复同一密钥，不得因挂载错误生成新密钥替代历史身份。测试与正式环境使用不同密钥。

### 5. 安装 systemd 服务

```bash
sudo install -m 0644 deploy/systemd/union-link-web.service /etc/systemd/system/union-link-web.service
sudo install -m 0644 deploy/systemd/union-link-worker.service /etc/systemd/system/union-link-worker.service
sudo systemd-analyze verify /etc/systemd/system/union-link-web.service /etc/systemd/system/union-link-worker.service
sudo systemctl daemon-reload
sudo systemctl enable --now union-link-web union-link-worker
sudo systemctl status union-link-web union-link-worker --no-pager
```

两个服务均为非 root，启动前检查自身角色的环境、Ed25519 密钥、数据库身份／RLS、桶访问；Web 检查构建，Worker 检查 Java。检查失败会阻止启动，systemd 按限制重试。Worker 不持有 Web／迁移连接，Web 不持有 Worker／迁移连接。日志进入 journald：

```bash
sudo journalctl -u union-link-web -u union-link-worker -n 100 --no-pager
sudo journalctl -u union-link-worker -f
```

改安装目录、构建目录或 Node 路径时，同步修改 WorkingDirectory、ExecStart／ExecStartPre、ReadWritePaths。模板仅允许 Web 写 `.next`／临时目录，Worker 写临时目录；密钥只读。

### 6. 接入 HTTPS 并验收

准备有效证书。编辑 [Nginx 模板](deploy/nginx/union-link.conf) 中全部域名与证书路径后启用：

```bash
sudo install -m 0644 deploy/nginx/union-link.conf /etc/nginx/sites-available/union-link
sudoedit /etc/nginx/sites-available/union-link
sudo ln -s /etc/nginx/sites-available/union-link /etc/nginx/sites-enabled/union-link
sudo nginx -t
sudo systemctl reload nginx
```

证书申请／续期按现有 ACME 方案配置；没有证书时不要加载示例 TLS 配置。后台／API 不叠加公共缓存。模板关闭代理缓冲以支持流式响应；整合包直接分片上传到 OSS，Nginx 的 32 MiB 上限用于控制请求／图片，不是整合包上传上限。

先限制测试人员访问。按 [服务器验收与运维](docs/server-deployment.md) 验证登录、权限、v1／v2 发布闭环、公网存储上传下载、续传、Worker 中断恢复、备份恢复与实际负载，再扩大测试。

## 后续拉取与更新

采用单机维护窗口，停止服务后更新，避免覆盖运行中构建。先完成数据库／对象存储／密钥备份，记录旧 commit；不要只备份 Git。

```bash
cd /opt/union-link/app
sudo -u union-link git status --short
sudo -u union-link git rev-parse HEAD
sudo systemctl stop union-link-web union-link-worker
sudo -u union-link git pull --ff-only origin release/server
sudo -u union-link env DATABASE_MIGRATION_URL='postgresql://generate_only:unused@127.0.0.1:5432/generate_only' npm ci --include=dev
sudo -u union-link env NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 DATABASE_MIGRATION_URL='postgresql://generate_only:unused@127.0.0.1:5432/generate_only' npm run build
sudo npm run with-env -- /etc/union-link/common.env /etc/union-link/deploy.env -- db:deploy
sudo npm run with-env -- /etc/union-link/common.env /etc/union-link/web.env /etc/union-link/worker.env -- db:check
sudo systemctl start union-link-web union-link-worker
sudo systemctl status union-link-web union-link-worker --no-pager
```

**每步成功后再继续**；失败时保留维护状态并排查。配置与密钥在仓库外，正常更新不重复 provision、bootstrap 或生成密钥。模板变更后审查、重新安装并 `daemon-reload`。迁移没有自动 down；含不兼容迁移时不能只 checkout 旧 commit 回退，见运维文档。

## 开发与发布检查

本地开发复制 `.env.example` 为 `.env`，配置本地服务与受限连接后，执行 `npm ci`、`npm run db:deploy`、`npm run db:check`、`npm run storage:init`、`npm run auth:bootstrap`。分别启动 `npm run dev -- -p 3001` 和 `npm run worker`，`APP_ORIGIN=http://localhost:3001`。Windows 的 `start-frontend.ps1`／`start-backend.ps1` 仅是开发窗口启动器。

发布候选在**独立测试数据库／MinIO** 验证，不能把完整测试指向业务数据。测试创建随机 schema／桶并执行写入清理；现有集成 fixture 固定 MinIO，云验收使用 `storage:verify` 与业务闭环。

```bash
npm ci --include=dev
npm run db:validate
npm run db:check
npm run lint
npm run openapi:check
npm run build
npm run typecheck
# 默认构建目录为 .next；更改时需与测试保持一致。
MUA_HTTP_TEST_DIST=.next npm test
npm audit --omit=dev --audit-level=high
npx playwright install chromium
# 启动生产 Web，配置专用超管测试账号后：
npm run test:openapi:browser
npm run test:server-motto:browser
npm run test:clients:browser
```

PowerShell 使用 `$env:MUA_HTTP_TEST_DIST='.next'`。完整 HTTP 测试仅在设置该变量时执行；两个真实包测试还需 `MUA_REAL_V2_PACK`／`MUA_REAL_MRPACK`，否则明确跳过。浏览器测试需 `SMOKE_ORIGIN`、`SMOKE_USERNAME`、`SMOKE_PASSWORD`，会创建测试资源，见各脚本。CI 使用隔离 PostgreSQL／MinIO 运行构建、完整测试与浏览器流程，只发布公开 OpenAPI artifact。

## 文档入口

| 内容 | 文档 |
| --- | --- |
| 验收、备份、恢复 | [服务器部署与运维](docs/server-deployment.md) |
| 数据库角色、RLS | [PostgreSQL RLS](docs/postgresql-rls.md) |
| 私有桶、云厂商、CORS、自检 | [对象存储](docs/object-storage.md) |
| 遥测口径、采集状态 | [存储遥测](docs/storage-telemetry.md) |
| API 与后台操作 | [API 工作流](docs/api-workflows.md)、[OpenAPI](docs/openapi.md) |
| muapack 与下载 | [v1](docs/muapack-v1.md)、[v2](docs/muapack-v2.md)、[下载刷新](docs/launcher-download-api.md) |
| 环境与宿主 Java | [下载源](docs/environment-download-sources.md)、[Forge／NeoForge](docs/forge-environments.md) |
| 需求、权限、功能边界 | [需求](docs/mua-backend-requirements.md)、[权限矩阵](docs/permission-matrix.md)、[实施记录](docs/implementation-status.md) |
