# Windows / WSL2 开发与隔离验收

2026-10-25 已在本机 `Ubuntu-24.04` 中搭建独立环境，用户 `omgst`，项目位于 `/home/omgst/projects/mualauncher-backend`。Windows 原项目与 WSL 副本各自维护依赖、生成文件和环境配置；修改代码后需显式同步或通过 Git 传递，不会自动双向同步。

## 当前环境

| 项目 | 配置 |
| --- | --- |
| WSL 内核 | 6.6.87.2-microsoft-standard-WSL2 / amd64 |
| Node.js | Linux v24.22.1，`/usr/local/bin/node` |
| JDK | OpenJDK 21.0.12.1，`/usr/bin/javac`、`/usr/bin/jar` |
| Docker | Ubuntu 独立 Docker Engine 29.9.2，`default` context |
| gVisor | 完整发行包 20261019.0，systrap |
| Web | http://localhost:3101 |
| PostgreSQL | WSL 127.0.0.1:25432，独立 `union_link_wsl` 数据库及卷 |
| MinIO API / Console | http://localhost:19000 / http://localhost:19001，独立卷和凭据 |
| 执行镜像 | `sha256:e91372791c90bd6d0d1d9e91ff0d6f85dd2c7e5391e83b91a00327a04134a03a` |

开发环境凭据、独立签名密钥、Compose 配置及初始后台密码均只保存在 WSL 副本的 `.env` / `.local`，受私有权限保护，不提交 Git，不复用操作系统密码。后台用户名为 `mua-admin`，密码见 `.local/initial-admin-*.txt`；登录后可修改。

WSL 的 Docker Hub 直连出现 DNS 异常，因此首次执行镜像在 Windows Docker Desktop 使用固定摘要的 Node 24 / Temurin 21 基础镜像构建，再经 `docker save` / `docker load` 导入 Ubuntu。导入的是 Linux OCI 镜像，不包含 Windows Node、项目 `.env` 或运行容器数据。PostgreSQL 16 和 MinIO 镜像同样固定摘要并导入；记录见 WSL `.local/wsl-image-identities.json`。后续镜像更新仍需校验并显式导入，任务不会自动 pull。

## 进入与运行

Windows PowerShell：

```powershell
wsl -d Ubuntu-24.04 -u omgst
```

Ubuntu：

```bash
cd ~/projects/mualauncher-backend
node -p 'process.platform + " " + process.execPath'
systemctl is-active union-link-wsl-web union-link-wsl-worker
```

Web、Worker、基础设施及回收 timer 已注册为 systemd 服务，在该 Ubuntu 启动后运行。WSL 本身的 Windows 开机启动和无人值守恢复尚未验收。

```bash
# 查看日志
journalctl -u union-link-wsl-worker -n 40 --no-pager
journalctl -u union-link-wsl-web -n 40 --no-pager

# 修改代码或配置后重启；不影响 Windows 原服务
sudo systemctl restart union-link-wsl-web union-link-wsl-worker

# 停止开发应用
sudo systemctl stop union-link-wsl-web union-link-wsl-worker
```

基础设施配置位于 `.local/wsl-compose.json`，包含私有配置，不打印或上传。仅绑定本机回环端口。停止容器而保留数据可运行 `sudo systemctl stop union-link-wsl-infra`；不要执行 `down -v` 或删除卷来解决启动问题。

## 重跑隔离验收

```bash
cd ~/projects/mualauncher-backend
SANDBOX_ENV_FILE=.local/sandbox.env npm run sandbox:check
SANDBOX_ENV_FILE=.local/sandbox.env npm run sandbox:verify
```

也可运行 `.local/bin/verify-isolation`，输出保存到 `.local/wsl-sandbox-check.log` 和 `.local/wsl-isolation-verify.log`。CLI 探针使用独立随机 namespace，不写网站的业务实例历史。

本机已实际通过十项 runsc 探针：权限/凭据/网络/只读边界、遗留后代、临时盘耗尽、PID 限额、链接拒绝、输入篡改拒绝、超时、Java heap、日志溢出和取消。每项都确认容器/卷无残留。Java heap 耗尽不等于已做宿主或容器总内存 OOM 故障注入。生产构建、类型、Lint、受限数据库检查和真实网站登录/Worker 就绪页面检查通过。

最终 WSL `npm test`：332 通过、0 失败、2 个未提供的真实导入样本跳过，包含生产 HTTP 契约；修复后的执行专项在 Windows 和 Linux 均为 25/25。验收摘要见 WSL `.local/wsl-acceptance-summary.json`，不含凭据的日志也已保存至 Windows 原项目 `.local/wsl-acceptance/`。

## 全量回归

```bash
cd ~/projects/mualauncher-backend
NEXT_DIST_DIR=.next/wsl-production npm run build
MUA_HTTP_TEST_DIST=.next/wsl-production \
  MUA_TEST_JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 npm test
```

生产测试构建与运行中的开发服务分目录；测试创建随机数据库 schema 和 MinIO 桶，使用 WSL 独立服务。`.env` 同时提供指向 WSL MinIO 的 `OSS_*` 和测试夹具使用的 `S3_*` 配置，不能沿用默认 9000 端口。日志见 `.local/wsl-full-tests.log`。

首次 Linux `npm ci` 发现原锁文件缺少可选 emnapi 依赖，已补齐锁文件且没有升级原有包版本。新库初始化还修复了角色配置未移交 schema 所有者、bootstrap 事务未传迁移客户端的问题；运行连接仍保持四类受限角色，不通过 postgres/BYPASSRLS 绕过。真实 Linux 回归还修复了裸机虚拟工作区被二次替换的问题，执行指纹更新为 `bare-java-2`，不复用此前裸机缓存。

## 验收边界

当前证明的是 WSL2 中真实 gVisor 的上述隔离行为。网站已读取在线 Worker 的 Docker/runsc 探针结果，默认模式为 `DOCKER_GVISOR`。真实 Forge/NeoForge 完整产物与签名、容器总内存/CPU 压测、Worker/Docker 崩溃恢复、WSL 冷启动及双节点交接仍需分别执行；不能将此结果替代原生生产 Linux 或 macOS 的验收。完整矩阵见 [隔离部署与验收](isolated-execution.md)。
