# 实施进度：第一阶段管理闭环

更新时间：2026-10-08。用户已授权开始实现。此文档区分已运行的功能、仅有数据库基础的功能和后续工作。

## 已实现并接通本地 PostgreSQL

- 已迁移至 shadcn/ui dashboard-01 的 MUA 管理界面，入口 `/admin`，菜单与路由见 [管理界面](admin-ui.md)。表格采用 TanStack Table，表单采用 React Hook Form / Zod，Tremor Raw 仅用于真实图表；现有 CRUD、RBAC 与归档功能均接入新页面。
- 超管图表按上海时区聚合完整近 14 天审计并补齐无记录日；普通成员仅显示可访问组织的资源分布。CDN 流量尚未接入。

- 13 个 Prisma 模型、3 个枚举及两份已执行迁移。账号、组织、成员、服务器、专用客户端、单服角色授权、草稿、发布快照、当前发布引用及审计均已建表；另有独立本地凭据、会话及登录限流表。
- 白名单用户名／密码登录，无公开注册。用户名不区分大小写并保存为小写；密码长度 12–128 位，以随机盐 scrypt（N=131072、r=8、p=1）存储。参考 [OWASP 密码存储建议](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)。本地凭据与稳定账号 ID 分离，后续 YGG 身份绑定不需更换账号 ID。
- 12 小时数据库会话：256 位随机令牌，数据库只保存 SHA-256 摘要；Cookie 设置 HttpOnly、SameSite=Strict、Path=/，APP_ORIGIN 为 HTTPS 时设置 Secure。退出、停用账号或重设密码撤销会话。参考 [OWASP 会话管理建议](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)。
- 数据库共享登录限流：每用户名 15 分钟最多 10 次尝试，全站 5 分钟最多 60 次尝试，成功登录也计入。管理写接口检查配置的 APP_ORIGIN、JSON 类型及 32 KiB 正文限制。
- 应用层 RBAC：预置角色统一展开为权限，组织角色与单服角色取并集；每个接口重新读取会话、成员和真实资源归属。组织管理员自动覆盖后续新增服务器；普通成员不能读取无授权的服务器。
- 组织资料、服务器资料、展示排序／颜色／上架标记、白名单账号、组织成员与单服角色的管理页面及 REST 接口。组织创建、服务器登记、全局展示、归档和特权角色分配仍为 MUA 超管专属。普通组织管理员只管理已有白名单中的普通成员，不能调整管理员或审核／发布／切换人员的成员资格。
- 组织、服务器及客户端容器的归档／恢复；归档清空相关当前发布并下架，恢复不自动上架或恢复当前发布。客户端归档同时下架该服务器。
- 客户端版本资料草稿的创建、编辑、读取、归档／恢复；编辑检查 contentRevision，旧修订返回冲突。简介、更新日志与版本名称均为该草稿的内容。当前不开放上传、提交审核或发布动作。
- MUA 超管查看最近 50 条审计；管理变更与审计同事务写入，审计记录不可修改或删除，凭据和令牌不写入审计。
- 所有管理写操作、登录最终建会话及授权撤销使用同一 PostgreSQL 事务级 advisory lock，并在锁内重新认证。第一阶段以较粗的锁保证白名单系统的撤权和“至少一个启用超管”约束；后续扩大并发时再细化。
- `GET /api/v1/servers` 提供公开服务器目录基础，仅返回未归档、标记上架且已有可用当前发布的服务器，并按排序值、server ID 排列。现在没有发布版本，目录返回空数组。

头像／图标当前可保存 OSS 对象键，界面采用组织文字头像。文件上传和图片分发尚未接入，不把对象键当成可直接访问的图片 URL。

## 已落实的数据库业务约束

- MUA server ID 为 3–5 位 ASCII 字母；原始大小写保留，大小写无关唯一；归档不释放 ID。
- 服务端创建服务器、专用 Client 和空 ServerPublication 同事务完成，延迟约束阻止缺少客户端或发布引用容器的服务器提交。
- Client 的组织必须与 Server 相符；服务器 ID 与组织归属不可修改。
- 单服授权必须关联同组织的成员和服务器，禁止单服 ORG_ADMIN。
- 每服最多一个当前发布，复合外键及触发器拒绝跨服引用，包含同组织其他服务器。
- ClientRelease 内容只读，仅 archivedAt 可变；版本标签和源草稿唯一性保留，发布须匹配已批准草稿修订及 Manifest 摘要。已提交草稿内容锁定，已发布源草稿不可修改。
- 已归档资源不能被重新绑定为当前发布；业务表阻止硬删除，审计只允许追加。

这些数据库约束不等于签名验证服务。当前 SQL 只检查签名字段存在；真正的密钥管理、签名生成和 Launcher 验签仍属于发布阶段。使用 postgres 的现有开发连接也不代表生产环境完成数据库最小权限配置。

## 尚待实施

| 工作 | 当前状态 |
| --- | --- |
| MinIO、上传会话、原始包下载与图片分发 | 未接入 |
| MultiMC／CurseForge／Modrinth／传统 .minecraft 自动识别 | 未实现 |
| Worker 队列、解析进度、重试与安全解压 | 未实现 |
| .muac／.muapack 归一化、逐文件 SHA-256、CAS 去重 | 未实现 |
| Manifest 协议及 managed／preserve 文件政策 | 需求已记录，未生成或分发 Manifest |
| 提交／撤回审核、审核通过／驳回、审核修订绑定 | 模型与 RBAC 权限已预留，无业务接口或面板按钮 |
| 签名发布、历史版本切换、发布版本归档／恢复 | 模型与只读历史已具备，写流程尚未接通 |
| 草稿复制、跨服复制并重新审核 | 未实现 |
| Launcher REST 目录接入、Manifest 验签与增量安装 | 启动器源码未修改 |
| PostgreSQL RLS、非超级用户运行连接 | 第二阶段，未启用 |
| YGG 认证接入 | 未实现，当前使用本地白名单凭据 |

下一步建议接入 MinIO 与上传任务，完成一个受授权约束的原始整合包上传／解析闭环，再落实 Manifest 和发布流程。包扩展名、Manifest 协议、签名方案和旧文件清理仍需定稿。

## 接口约定

管理接口使用 HttpOnly 会话 Cookie；非 GET 请求须带 `Origin: <APP_ORIGIN>` 与 `Content-Type: application/json`。没有公开注册或物理删除接口。身份无效返回 401，无操作权限返回 403，无读取权限的资源返回 404，资源状态或修订冲突返回 409。

| 方法与路径 | 用途 |
| --- | --- |
| POST `/api/auth/login` | `{username,password}` 登录 |
| POST `/api/auth/logout` | `{}` 退出 |
| POST `/api/auth/password` | `{currentPassword,newPassword}` 改密并撤销会话 |
| GET `/api/admin/state` | 返回按权限收窄的面板数据，不返回凭据／令牌 |
| POST `/api/admin/organizations` | 创建组织 |
| PATCH `/api/admin/organizations/:id` | 修改组织资料 |
| POST `/api/admin/servers` | 登记服务器，自动创建专用客户端与空当前引用 |
| PATCH `/api/admin/servers/:serverId` | 修改服务器；展示字段仅超管可写 |
| POST `/api/admin/{organizations,servers,clients}/:id/archive` | `{archived:true/false}` 归档／恢复 |
| POST `/api/admin/accounts`、PATCH `/api/admin/accounts/:id` | 创建／调整白名单账号 |
| GET `/api/admin/organizations/:id/account-search?q=...` | 有成员管理权限时搜索已有白名单，至少 3 字符、最多 10 条 |
| PUT `/api/admin/organizations/:id/members/:accountId` | `{roles,status}` 组织角色与成员状态 |
| PUT `/api/admin/organizations/:id/members/:accountId/servers/:serverId` | `{roles}` 单服授权，空数组为撤销并保留记录 |
| GET `/api/admin/servers/:serverId/clients` | 按权限返回草稿与发布历史 |
| POST `/api/admin/servers/:serverId/drafts` | 新建版本资料草稿 |
| PATCH `/api/admin/servers/:serverId/drafts/:draftId` | 编辑，携带 contentRevision |
| POST `/api/admin/servers/:serverId/drafts/:draftId/archive` | 草稿归档／恢复 |
| GET `/api/v1/servers` | 公开目录基础；当前阶段无 Manifest 下载端点 |

## 验证与当前运行

- `npm run db:validate`、`npm run db:deploy`、`npm run typecheck`、`npm run lint` 与独立目录生产构建通过。
- `npm test`：16 项测试通过，包括本地来源别名与跨站拒绝、完整审计统计、平台指标权限隔离、平台超管切换为组织管理员的身份回归及真实 PostgreSQL 集成测试。自动建立随机临时 schema，并只移除该测试 schema；不写入 public 的业务记录。
- `npm run check:http`：真实 HTTP 登录页面、`/admin` 总览及 21 个模块入口、未认证拒绝、跨站拒绝、字段／正文限制、Cookie 属性、数据收窄及退出撤销通过。
- 已修复本地登录的来源不匹配：本地配置兼容同协议、同端口的回环地址别名，`localhost:3001` 与 `127.0.0.1:3001` 的真实登录检查均通过。其他端口、非回环来源、缺失 Origin 和跨站请求继续拒绝；生产域名仍精确匹配配置。
- 浏览器扩展桥接返回 `nodeRepl.fetch request failed`，因此尚未完成浏览器交互与截图视觉验收；HTTP 页面和接口验证已完成。
- 当前 Prisma／pg 8 组合在关联查询时输出排队查询的弃用提示；当前查询、事务及并发测试通过，后续升级 pg 主版本时需重新验证适配器兼容性。
- 本次本地面板运行在 `http://localhost:3001`，仅绑定 127.0.0.1。使用 `.next/mua-prism` 独立构建目录避开现有进程占用的默认 `.next` 日志，不改变现有进程。
- 已初始化本地超管 `mua-admin`。随机初始密码在 `.local/initial-admin-*.txt`；该目录被 Git 忽略。首次登录后在“系统 → Settings → 账号安全”修改密码，并删除本地凭据文件。

上述服务是本次启动的本地进程，不是 Windows 自动启动服务。生产环境还需 HTTPS、运行数据库账号及对象存储等部署配置。
