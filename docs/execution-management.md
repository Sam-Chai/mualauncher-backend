# 运行环境设置和执行实例

2026-10-25：设置页新增“安装器运行环境”，后台任务新增“执行实例”。页面、三条 API 和数据库第二层保护均仅允许超管 Cookie；普通管理员、PLAYER、API Token 不可读取或修改。Worker 只能读设置、上报状态及写执行记录，不能改变运行方式。

设置页在宽屏下将“安装器运行环境”与“沙箱管理”分为左右等宽板块，窄屏上下排列。“沙箱管理”仅为占位，明确显示尚未接入，预留后续 GitHub Actions、Argo 等工作流控制面板。后台外层布局使用不可滚动的裁剪容器，仅内容区独立滚动，避免焦点定位或路由切换将顶部导航栏滚出视口。

默认 `DOCKER_GVISOR`。没有新鲜的合格 Worker 时选项置灰，默认值仍保持 Docker，不会悄悄改成裸机。真正可选要求 Docker CLI/daemon 连通、Linux daemon、注册 runsc、固定执行镜像，以及真实容器指纹、UID/capabilities、资源策略与 Java 探针通过。macOS 使用专用 Colima Linux VM；原生目标机部署及隔离验收仍见 [Docker/gVisor 部署](isolated-execution.md)。

裸机需要手动选择 `BARE` 并保存，且至少有一个在线 Worker 上报 Java 21+。优先使用 `FORGE_PROCESSOR_JAVA`，其次 JAVA_HOME，最后 PATH。仅精简进程环境变量并限制 JVM heap、时间、日志与输入/输出校验；不限制宿主总内存、CPU、磁盘、PID 或网络，不隔离同账号文件、进程及凭据。POSIX 按进程组、Windows 按 taskkill 终止可追踪后代，不能保证清理主动脱离的程序。页面会明确说明这一边界；生产应使用专用低权限 Worker 账号。

Web 不访问 Docker socket，也不把自身的系统状态当作执行节点状态。Worker 每 10 秒心跳、约 30 秒采样 Docker、gVisor 和本地 Java；页面每 10 秒刷新。心跳超过 30 秒或样本超过 90 秒时，保留观察值并标为过期，不能据此启用对应选项。Docker 不可用时 Worker 继续上报并处理不需要 Java 执行的任务，执行请求仍严格遵守已选模式；旧的 SANDBOX_REQUIRED 不再覆盖数据库选择。

切换使用修订号防止覆盖其他管理员的修改，并保存审计事件。新任务在环境准备时固定模式和执行指纹，运行中不切换，不终止正在执行的容器。Forge/NeoForge 的新缓存和未签名目标清单包含模式及指纹，不跨裸机和 gVisor 复用，不把 Worker ID 或任务 ID 放进缓存内容身份；历史签名与 READY 产物保持原样。

执行实例保存最近可浏览的 100 次尝试：执行/组包任务/Worker 标识、模式、计划摘要、镜像/Java 标识、架构、起止时间、结果，以及实际 executor 和 input 容器的 ID、名称、状态与参数。临时容器删除后仍能查看记录。裸机记录明确显示“裸机运行”，CPU/总内存/磁盘/PID 限额显示与宿主共享，不模拟 Docker 实例。

Docker 实例由生命周期回调记录，并由 Worker 按 daemon 标识及工作流 namespace 校准；不同 daemon 的同名容器不会互相影响。只根据完整 Docker 快照确认资源已删除，失败或不完整快照不推断删除。使用 updatedAt 条件避免旧快照覆盖更新；故障中断记录不能被当作成功。页面/API 不提供任意命令、挂载、inspect、启动或删除 Docker 对象的入口；不返回环境变量、宿主挂载路径或原始命令行。

新增迁移 `202610250001_execution_management`：PlatformSettings 的运行模式和修订、WorkerHeartbeat 的状态 JSON、独立 ExecutionRun 历史；共 34 张业务表强制 RLS。OpenAPI 5.2.0 完整 93／公开 11，无已存在操作的破坏性变更。
