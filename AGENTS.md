<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## MUA Launcher 项目约定

- 管理界面采用 shadcn/ui dashboard-01 基础，保留用户指定的七个分组菜单与 `/admin` 路由；参见 [docs/admin-ui.md](docs/admin-ui.md)。Tailwind CSS、Lucide、TanStack Table、React Hook Form + Zod 为统一组件体系，Tremor Raw 仅用于图表。
- 页面不得使用模板模拟业务指标。Storage、Worker、签名显示真实运行状态，未接入的内容与 CDN 显示明确待接入状态；审计曲线仅超管可读，按完整时间窗口聚合。共享角色定义在 `src/lib/roles.ts`，服务端仍在每次请求中检查 RBAC。

- 产品需求和启动器代码观察记录见 [docs/mua-backend-requirements.md](docs/mua-backend-requirements.md)。后续设计或实现前先阅读该文档，区分确定需求、设计建议和待确定事项。
- 数据库模型与权限矩阵见 [docs/minimal-data-model.md](docs/minimal-data-model.md) 和 [docs/permission-matrix.md](docs/permission-matrix.md)；具体完成范围见 [docs/implementation-status.md](docs/implementation-status.md)，不要把完整发布流程的设计当作已实现功能。
- 当前阶段（2026-10-09）：已实现完整 .minecraft ZIP 上传／更新、本地 MinIO、独立 Worker、文件校验／CAS、审核／签名／发布与当前版本切换。旧客户端四个入口已合并为“客户端管理”。标准 API 与自动化脚本共用 ClientDraft／ClientRelease，参见 [docs/client-upload-api.md](docs/client-upload-api.md)。其他包格式、.muapack 导出、Launcher 增量安装、Redis 调度和 RLS 后续接入；新生成 Manifest v2 使用 clientId，旧 v1 保留签名字节并限制原服务器，Launcher 协议仍需联调。
- 启动器源码位于 `G:\Projects\Minecraft\BotWMCS\launcher-template-26.1`。它是基于 Fabric 的 Minecraft 客户端；后端对外提供 REST API，不能把现有占位界面视为已完成后端接入。
- 联合服以既有的 3–5 位纯英文字母 MUA server ID 作为底层标识；展示名称采用别名。不要另造 server ID 体系，大小写规范仍待确定。
- 用户已要求增加 Organization：内部 ID、别名、头像、简介，以及 members、servers、clients。组织管理员统一管理本组织全部服务器和专用客户端，包括正式服、测试服及后续新增资源；普通成员可按单服务器细分授权，不能越权到其他组织。
- 用户最新要求允许组织上传多个独立客户端，每个服务器同时至多绑定一个客户端。当前按每个客户端同时至多绑定一个服务器实现；可解绑后改绑同组织服务器，不同时跨服共享、不跨组织绑定。客户端使用独立 ID，新记录 UUID，旧 ID 保留。名称在组织内 NFKC／忽略大小写查重，归档不释放；同名必须使用更新。CLIENT_BIND 检查双方 RBAC，替换原绑定须确认；新客户端待审核发布并启用后按已确认 revision 替换，期间旧客户端继续可用。
- 账号采用白名单，权限按组织范围或单服务器范围及操作划分；MUA 超管可管理全部组织、服务器、发布、展示排序和颜色。
- 用户已确定先实现应用层 RBAC，后续再增加 PostgreSQL RLS 作为第二层保护。最小模型提案使用组织/服务器范围的预置角色及统一角色—权限映射；RLS 尚未实现，不得依赖它省略当前服务端范围校验。MUA 超管角色不等于数据库超级用户。
- 用户已确认支持独立 MUA 审核角色，模型提案可按组织或单服务器授权审核；审核、发布、切换权限分开，默认审核员只审核，额外能力需显式授予。
- 组织、服务器、草稿和发布采用归档，账号／成员停用，授权撤销保留记录。用户最新允许删除已归档、从未发布且无实际／待绑定服务器的客户端；CLIENT_DELETE 默认授予组织／服务器管理员，仍检查真实范围。删除保留不可恢复标记及审计，隐藏记录、释放名称；文件由 Worker 回收，默认保留 7 天，仅超管面板会话可改。共享 CAS 按引用保护，命中回收文件须 SHA-256 校验后取回复用。参见 [docs/client-recycle.md](docs/client-recycle.md)。归档自身不移动 OSS 对象，恢复不自动重新分发。
- 已发布版本不可原地修改，内容变更必须创建新版本；CAS 可复用相同文件字节，但不因此合并客户端身份或发布历史。解绑保留客户端当前版本、所有历史及存储对象；单服权限按当前绑定服务器或解绑后的固定 scopeServerId 校验。
- .minecraft ZIP 先识别客户端信息，再进入 CAS。Worker 通过 processingPhase 和 detectedInfo 反馈识别状态并提前填充 MC／Java；支持 PCL clientVersion、HMCL patches、标准版本继承及游戏 JAR 内 version.json。多实例先等待 select-instance，不能直接选第一个；冲突／缺失信息提示手动确认，客户端发布版本始终由管理员填写。Java 对照在 src/data/minecraft-runtimes.json，npm run runtime:sync 从官方目录更新；快照可加 --snapshots，不猜未知未来版本。
- 模组列表使用统一只读 TanStack 表格，从目标实例的 mods 文件夹（含子目录）自动列出 JAR 文件名与路径，兼容根目录和 versions/<实例>/mods；不能通过手填 API mods 覆盖 Worker 结果。识别后提前替换列表，完整校验前不能提交；审核／历史复用表格。格式识别、根目录定位、运行环境和模组发现统一在 src/lib/pack-inspection.ts 的适配器注册表；通用 ZIP／CAS 处理在 pack-parser。游戏 JAR 元数据读取仅用于运行环境，当前不解析模组 JAR 内名称／版本或依赖。
- 上传整合包由 Worker 归一化，按文件计算 SHA-256 并进入 CAS，生成 Release Manifest，经过 MUA 审核、签名和发布后供 Launcher 增量安装。
- 文件策略：`managed` 在缺失或哈希不一致时安装目标文件；`preserve` 只在不存在时创建，存在时不覆盖。旧文件清理行为尚未确定，不要把 `preserve` 文件视为可自动删除的文件。
- 开发使用 MinIO；生产存储供应商、包扩展名（`.muac` / `.muapack`）、Manifest 协议及签名方案尚未定案，不能把文档中的建议当成已批准的接口契约。
