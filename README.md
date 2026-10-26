# Union Link 0.1.0

生产发布源码。应用版本 **0.1.0**；内嵌 OpenAPI 规范 **5.2.0**（完整 93 个操作，公开 11 个操作），两者独立版本化。

本分支保留网站、独立 Worker、全部数据库迁移、构建配置和生产部署/运维文件，不包含 docs、测试套件、本地启动脚本、账号、密钥或构建产物。公开 API 文档在 `/openapi.json`；后台 API 页面继承 Cookie 权限，规范由应用代码动态生成。

## 硬性要求

| 项目 | Linux | macOS |
| --- | --- | --- |
| 系统 | 推荐 Ubuntu 24.04，原生 x86_64/aarch64，内核至少 5.6 | macOS 13+，原生 Intel/Apple Silicon，禁止 Rosetta |
| 执行环境 | **Docker Engine + gVisor/runsc** | **专用 Colima Linux VM + Docker + gVisor/runsc** |
| Node.js | 已安装安全更新的 Node.js 24.x | 同左，模板需填写真实绝对路径 |
| 数据 | PostgreSQL 16+，三类私有对象存储桶，Ed25519 签名密钥 | 同左，可使用远程服务 |
| 托管 | systemd + Nginx HTTPS | launchd + Nginx HTTPS |

Web/Worker 运行于宿主 Node.js；不可信 Java 处理器必须通过 runsc 执行。本发布分支禁用 BARE，也不回退宿主 Java/runc。既有 BARE 设置须在可用 Worker 上报后由超管显式改为 Docker；历史 BARE 任务须取消并重建，不静默更换模式、缓存或签名。

单槽 Worker 建议至少 4 核/12 GB 宿主内存，磁盘按实际包规模规划。默认每任务 6 GB 内存、2 CPU、2 GB 工作区、256 MB tmp、256 PID。macOS 模板给 VM 4 核/10 GB/60 GB，宿主还须留出网站和系统资源。

Docker 控制权等同于高权限能力，只给 Worker/回收器；不要给 Web 用户 Docker 访问权，不开放未认证 TCP daemon。Web/Worker 使用不同宿主用户；模板中分别为 `union-link-web`、`union-link-worker`，macOS 分别为 `unionlinkweb`、`unionlink`。

## 安装与外部配置

Linux 代码目录 `/opt/union-link/app`，外部配置 `/etc/union-link`，数据 `/var/lib/union-link`。macOS Worker 代码目录 `/Users/unionlink/union-link`，配置 `/Users/unionlink/.config/union-link`；Web 用另一个账号及其独立代码副本/配置目录。下面命令用 Linux 路径示例，macOS 必须替换为实际绝对路径。环境文件中 `~` 和 `$HOME` 不会展开。

在目标系统检出本分支后安装依赖：

```sh
DATABASE_MIGRATION_URL='postgresql://build_only:build_only@127.0.0.1:1/build_only' npm ci --include=dev
```

Prisma CLI、tsx、TypeScript 为构建/迁移/Worker 所需，不能 omit dev。不要跨系统复制 node_modules、.next 或 Prisma 生成物。构建也需要 Prisma 配置中的 DATABASE_MIGRATION_URL 字段；准备外部**构建专用**文件，使用上述不能连接真实数据库的占位 URL，不向构建过程提供生产管理员密码。

复制 `deploy/*.env.example` 到代码目录外，改名去掉 `.example` 并编辑。全部 `CHANGE_ME` 必须替换。外部文件不可为符号链接，权限 0600/0640，父目录不可让其他用户写入，组中只能包含获准读取者。

| 文件 | 使用者与内容 |
| --- | --- |
| common.env | 每个服务各有一份；生产模式、公开 HTTPS origin、私有存储、密钥/临时绝对路径，不含 DB URL |
| web.env | 仅 mua_web、mua_auth、mua_public 三个受限连接及可信代理头 |
| worker.env | 仅 mua_worker 连接 |
| sandbox.env | Worker/回收器专用，固定 Docker context、镜像摘要、资源限制 |
| deploy.env | 一次性 mua_migrator 连接；初始化时临时加入数据库管理员连接、bootstrap 密码 |

Web 不可读取 worker/sandbox/deploy 配置。Linux 用 root:union-link-web 与 root:union-link-worker 的分别 0640 文件；从 common.env 制作 common-web.env/common-worker.env，TMPDIR 分别为 /var/lib/union-link/web-tmp 和 /var/lib/union-link/worker-tmp，与 systemd 模板一致。初始化命令用的 common.env 可以保留为管理员专用 0600。macOS 同理分开目录与用户。创建现有 TMPDIR 并授予对应服务写权限，私钥目录由部署管理员控制、服务只读，可用单独签名读取组向两个服务授权。

皮肤站网页登录须在 Union 上游登记 `${APP_ORIGIN}/api/auth/union/callback`，在 web.env 填入 UNION_OAUTH_CLIENT_ID/SECRET，可选 CLIENT_AUTH=post/basic 与 SCOPE（同样以 UNION_OAUTH_ 为前缀）。未登记时保留本地登录。Launcher 直接换票的来源默认不启用，需超管在设置中核准后单独完成真实上游验收；不通过 UUID/昵称合并身份。

`npm run with-env -- /absolute/common.env /absolute/role.env -- <script>` 清除继承的数据库连接，再依次加载指定文件；后面的同名值优先。禁止 checkout `.env*`。运行连接必须为 NO BYPASSRLS 的独立角色，不得替换成 postgres/mua_owner/mua_migrator。迁移使用 mua_migrator，通过 `options=-c role=mua_owner` 切换所有者；URL 中密码特殊字符必须编码。

## 数据库、存储和管理员

数据库管理员先创建独立空数据库 union_link，填写所有专用账号的确定密码。db:provision 会设置/重置这些固定角色的密码，只能用于此应用独立数据库和角色。所有迁移均须保留，禁止 db push 或重新生成历史迁移。

```sh
# 仅首次 provision 临时加载 DATABASE_ADMIN_URL。
npm run with-env -- /etc/union-link/common.env /etc/union-link/web.env /etc/union-link/worker.env /etc/union-link/deploy.env -- db:provision
# 立即从 deploy.env 移除 DATABASE_ADMIN_URL。
npm run with-env -- /etc/union-link/common.env /etc/union-link/deploy.env -- db:deploy
npm run with-env -- /etc/union-link/common.env -- storage:init
npm run with-env -- /etc/union-link/common.env -- storage:verify
# 临时加入 BOOTSTRAP_PASSWORD，可选 BOOTSTRAP_USERNAME；不会输出明文密码。
npm run with-env -- /etc/union-link/common.env /etc/union-link/deploy.env -- auth:bootstrap
# 删除 bootstrap 密码并收回迁移文件的运行用户读取权限。
npm run with-env -- /etc/union-link/common.env /etc/union-link/web.env /etc/union-link/worker.env -- db:check
```

初始化管理员只在没有活动超管时创建。发布分支要求显式外部密码，不向 checkout 保存初始凭据。db:provision 禁用 `--write-env`；`--adopt` 会变更数据库对象所有权，只在明确接管旧库时使用。

storage:init 只在缺失时创建桶与 Ed25519 私钥，不覆盖已有密钥。初始化后将密钥改为部署管理员所有、服务组只读（如 0640）。恢复必须使用原密钥；记录公钥指纹，在 Launcher 建立公钥信任并保管离线备份。

存储选项 `OSS_PROVIDER=minio/aws/s3/ali/tencent/huawei`，设置 REGION、ACCESS_KEY_ID、SECRET_ACCESS_KEY（统一 OSS_ 前缀）和 PACKAGES/CAS/ENVIRONMENTS 三个独立私有桶。MinIO/S3 必填 HTTPS OSS_ENDPOINT，默认 path style；原生云使用区域配置，默认 virtual host style，不填兼容 S3 端点。腾讯桶名包含 APPID；临时凭据用 OSS_SESSION_TOKEN。阿里/华为自定义域名可设 OSS_CUSTOM_DOMAIN=true 与含 `{bucket}` 的 endpoint。原生云桶禁用版本控制，正式发布须通过不可变写入能力验证。

真实网站 origin 的 CORS 应支持 GET/HEAD/PUT、Content-Type、Content-Length、Range、If-Match 和供应商签名所需头，暴露 ETag/Content-Length/Content-Range。storage:verify 会写入/复制/删除临时对象；成功不代表浏览器 CORS、真实云和 Launcher 下载已验收。

## Linux：安装 Docker 与 gVisor

安装 Docker Engine、curl、python3、bzip2、CA 证书，确认 cgroup 可用。按 [gVisor 官方安装说明](https://gvisor.dev/docs/user_guide/install/) 选择经审核的固定 YYYYMMDD.N 版本和**当前架构完整 bundle** 的 SHA-512；不要只复制单个 runsc 二进制。

```sh
# 预先 export RUNSC_VERSION=... RUNSC_SHA512=...，固定值，不用 latest。
sudo env RUNSC_VERSION="$RUNSC_VERSION" RUNSC_SHA512="$RUNSC_SHA512" sh deploy/execution/install-runsc.sh
# 安排维护窗口，重启 Docker 可能影响已有容器。
sudo systemctl restart docker
docker --context default info
```

脚本校验摘要、安装版本目录、备份并合并 daemon.json，不自动重启 daemon。只给 union-link-worker 用户 Docker 访问权；保持 sandbox.env 中 context 为 default 和正确 Docker CLI 绝对路径。其他 context 须先核实 daemon 归属。参见 [gVisor Docker 指南](https://gvisor.dev/docs/user_guide/quick_start/docker/)。

## macOS：专用 Linux VM

原生终端安装 Node 24、Docker CLI、Colima、python3、Nginx。Apple Silicon 的 Homebrew 路径通常是 /opt/homebrew/bin，Intel 通常 /usr/local/bin，以实际路径为准。Docker Desktop 默认 runc 与直接在 Darwin 执行 runsc 均不满足要求。

以 Worker 专用普通账号设置当前架构 RUNSC_VERSION/RUNSC_SHA512 后：

```sh
sh deploy/execution/configure-macos.sh
colima start --profile union-link --foreground
# 另一终端，同一用户：
docker --context colima-union-link info
```

脚本只创建新的 union-link profile，已有则拒绝覆盖。原生 VZ，关闭 Rosetta/binfmt/agent 转发，只共享只读 provision 目录，不共享可写 home。VM 首次启动需联网安装基础工具、下载固定 gVisor；任务容器仍断网。sandbox.env 必须设 SANDBOX_DOCKER_CONTEXT=colima-union-link 和实际 Docker CLI 路径；common.env 中密钥/TMPDIR 改成 macOS 路径。

初次检查后 Ctrl+C 正常停止前台 Colima，再安装 launchd 托管，避免两个 supervisor。真实机器必须验证 FileVault 解锁、无登录会话与重启后 VM 冷启动行为；plist 模板不代表无人值守启动已验收。

## 执行镜像和隔离验收（两个系统必做）

审核原生架构 Node 24 Debian/glibc 镜像与 Temurin 21 JRE 镜像，以 repository@sha256:... 填入 SANDBOX_NODE_BASE/SANDBOX_JAVA_BASE。不要用浮动 tag、Alpine Node 或跨架构模拟。

```sh
npm run with-env -- /etc/union-link/common.env /etc/union-link/sandbox.env -- sandbox:image
# 将输出的 SANDBOX_JAVA_IMAGE=sha256:... 写回 sandbox.env，固定本 daemon 的身份。
npm run with-env -- /etc/union-link/common.env /etc/union-link/sandbox.env -- sandbox:check
npm run with-env -- /etc/union-link/common.env /etc/union-link/sandbox.env -- sandbox:verify
```

sandbox:check 实际启动隔离容器，检查 Linux daemon、runsc、镜像、非 root、零 capabilities、断网、只读根和资源限制，缺失即失败。sandbox:verify 额外需要宿主 JDK 21+ 的 javac/jar，**仅编译受控运维探针** deploy/execution/probes/IsolationProbe.java，验证目录边界、后代清理、磁盘/PID/内存、符号链接、输入篡改、超时、日志、取消及资源回收。宿主 JDK 不执行上传的处理器，也不作为降级路径。探针属于部署验收工具，不是携带本地业务测试套件。

## 构建和托管

```sh
# build.env 为外部非特权构建配置，含 Prisma 所需的占位迁移 URL。
npm run with-env -- /absolute/build.env -- build
npm run with-env -- /etc/union-link/common.env /etc/union-link/web.env -- deployment:check --role web
npm run with-env -- /etc/union-link/common.env /etc/union-link/worker.env /etc/union-link/sandbox.env -- deployment:check --role worker
```

预检验证生产配置、密钥、数据库身份/FORCE RLS、存储桶、Web 构建及 Worker 真实隔离能力。服务每次启动先预检；运行中隔离故障仍继续报告 Worker 心跳，不自动降级。用服务入口启动，不绕过预检直接调用 Worker。

Linux：创建两个无交互账号和各自私有 tmp、只读源码及配置目录；仅将 Worker 加入 docker 组。检查 deploy/systemd 中 Node 的真实绝对路径、HOME（使用命名 Docker context 时设为 Worker 自己的 home）和各用户可读配置。Web 只能写其 .next 与自己的 tmp；Worker 有自己的 tmp，密钥只读。修改 ReadWritePaths 与对应 common 配置保持一致。

Worker/回收器模板的 HOME 为 /var/lib/union-link/worker-home；创建该目录并由 Worker 所有，将所需 Docker context 配置放在那里。systemd 的 ProtectHome 禁止访问 /home，因此不要把 Docker context 或密钥留在被屏蔽的 home 中。

```sh
sudo install -m 0644 deploy/systemd/*.service deploy/systemd/*.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now union-link-web.service union-link-worker.service union-link-sandbox-reap.timer
sudo systemctl status union-link-web union-link-worker union-link-sandbox-reap.timer
sudo journalctl -u union-link-worker -n 100 --no-pager
```

macOS：编辑 deploy/launchd/*.plist.example 的账号、HOME、Node/Colima、代码、配置及日志路径。创建日志目录，复制为 /Library/LaunchDaemons/org.unionlink.*.plist，root:wheel、0644，先 plutil -lint。plist 不含秘密；运行账号必须为普通用户。Web 账号使用单独源码副本并在同架构系统重新 npm ci/build，不得访问 Worker 用户 home、Docker context 或凭据。

```sh
sudo launchctl bootstrap system /Library/LaunchDaemons/org.unionlink.colima.plist
# VM 与 sandbox:check 成功后，再启动其余三个服务。
sudo launchctl bootstrap system /Library/LaunchDaemons/org.unionlink.web.plist
sudo launchctl bootstrap system /Library/LaunchDaemons/org.unionlink.worker.plist
sudo launchctl bootstrap system /Library/LaunchDaemons/org.unionlink.sandbox-reap.plist
sudo launchctl print system/org.unionlink.worker
```

更新服务先 launchctl bootout 对应 plist，再 bootstrap。launchd 不保证 VM/Worker 顺序，Worker 预检失败后重启并等待实际可用的执行环境。回收器每 30 秒只清理本应用 namespace 的过期受管资源，不用无范围 docker prune 代替。

## HTTPS 与对外验收

使用实际域名和有效证书。将 deploy/nginx/nginx-proxy.inc 安装到 /etc/union-link/nginx-proxy.inc，在 Nginx http{} 中 include union-link.conf 安装副本；修改 server_name、固定 HTTPS 重定向域名、证书和 include 路径。macOS 可改为专用配置目录。先 nginx -t 再重载服务。

Next 仅监听 127.0.0.1:3001，公网不开放 DB/Docker/Node。模板覆盖单 IP X-UnionLink-Client-IP，与 web.env 对应；不信任任意 X-Forwarded-For。若前方有 CDN，须按官方地址段配置 Nginx real_ip 并阻断绕过入口，验证客户端真实 IP。入口按 IP 限流，应用配额制度保持原有行为。

正式公开前须在目标机完成：登录/权限/停用/凭据撤销、真实 Union OAuth/skin-site 换票、上传→导入→审核→隔离组包→签名→发布→Launcher 下载/验签/安装、v1/v2 更新包、真实云 CORS 与大小签名、Range/If-Match 续传及下载刷新、VM/Web/Worker 冷启动/恢复/资源回收、备份恢复和负载/日志/告警验收。

记录发布 commit、Node/Docker/runsc 版本、VM 架构、镜像摘要和公钥指纹。本地构建/静态检查不替代 Linux/macOS、真实云与 Launcher 验收；源分支保留回归测试。

升级须在新版本目录安装、构建、预检，备份后 db:deploy，停止接收新任务并安全停止 Worker，再切换服务路径。保留旧代码和原密钥；数据库迁移可能不可逆，不能假定只切代码即可回滚。禁止重签已有发布或批量删除共享 CAS。第三方组件许可见 deploy/licenses，其余许可证随 npm 包提供。
