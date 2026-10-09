# MUA Management Platform 管理界面

更新时间：2026-10-08。入口 /admin，本机地址 http://localhost:3001/admin。根路径与旧 /dashboard 跳转至 /admin。

## 技术栈与来源

- Next.js 16 App Router、TypeScript、React 19、PostgreSQL／Prisma。
- [shadcn/ui dashboard-01](https://ui.shadcn.com/blocks?category=dashboard) 使用 SidebarProvider／SidebarInset、侧栏、顶部导航与卡片，改为 MUA 分组。桌面折叠图标栏，移动端使用 Sheet。
- Tailwind CSS 4、Lucide、shadcn Radix 组件、TanStack Table；表格支持搜索、排序、分页、列显示和每页数量。
- React Hook Form／Zod 用于表单，服务端独立验证输入与权限。
- [Tremor Raw AreaChart](https://www.tremor.so/docs/visualizations/area-chart) 仅用于真实图表，基于 Recharts；未使用 Tremor 全局 UI。
- 本地白名单登录；MinIO／S3 和独立 Worker 已接入，任务持久化于 PostgreSQL。Redis 与 MUA OIDC／Auth.js 尚未接入。

Tremor 来自官方 [AreaChart v1.0.0](https://github.com/tremorlabs/tremor/tree/main/src/components/AreaChart) 与配套工具，调整导入、Lucide 图标、图例滚动、Recharts 3 Tooltip 和 SSR 初始尺寸；保留 [Apache-2.0 许可证](licenses/TREMOR-LICENSE)。shadcn 保留 [MIT 许可证](licenses/SHADCN-LICENSE)，移动端检测使用 useSyncExternalStore，Skeleton 使用固定宽度。

## 路由与功能

| 页面 | 路径 | 当前功能 |
| --- | --- | --- |
| 总览 | /admin | 真实资源统计、目录与 Tremor 图表 |
| 组织 | /admin/organizations | 资料、归档／恢复，超管新建 |
| 成员 | /admin/members | 组织／单服授权；超管管理白名单账号 |
| 权限 | /admin/permissions | 与后端共用的角色矩阵 |
| Server | /admin/servers | 登记既有 MUA ID、编辑、归档／恢复 |
| Listing | /admin/listings | 超管管理排序、颜色、上架资格 |
| 状态 | /admin/servers/status | 资料状态，暂无游戏在线检测 |
| 客户端管理 | /admin/clients | 表格、完整 ZIP 添加／更新、解析统计、归档、历史切换 |
| 客户端详情 | /admin/clients/[id] | 同一管理表格限制到指定 server ID |
| 待审核 | /admin/releases/review | 版本资料、Markdown、文件列表和差异；审核／驳回／签名发布 |
| 已发布 | /admin/releases/published | 历史 Release 与当前版本 |
| 已撤销 | /admin/releases/revoked | 旧归档视图；独立撤销流程未实现 |
| Worker | /admin/system/workers | 心跳、队列与任务进度 |
| Storage | /admin/system/storage | 实际 MinIO bucket 可用状态 |
| Signing Keys | /admin/system/signing-keys | 当前签名公钥信息，私钥不返回前端 |
| Audit Log | /admin/system/audit | 超管最近 50 条审计 |
| Settings | /admin/system/settings | 自助改密与 API Token |

Client Profiles、Releases、Artifacts、Runtime 四个客户端菜单合并为“客户端管理”。旧 /admin/clients/artifacts、runtime、releases 与 [id]/releases 路径跳转到统一管理界面。资讯、活动与 Launcher UI 仍是待接入页面；排序和颜色目前在 Listing 管理。

## 客户端上传与更新

表格右侧“添加客户端”打开大拖拽／点击上传区。选择服务器时只显示有真实创建／提交权限且可操作的服务器；超管覆盖全部服务器。没有可用服务器时按钮禁用并提示先登记。已有客户端通过“更新”上传完整 .minecraft ZIP，预填原版本资料，必须另设版本号。

客户端名称、版本、MC、Java 7–25、模组列表、Summary 与 Markdown Description 在同一窗口填写。浏览器分片直传 MinIO；Worker 先显示“正在识别客户端信息”，提前回填 MC、Java 和 mods 列表，再进行完整校验／CAS。支持 PCL、HMCL、标准版本 JSON／继承、游戏 JAR 的 version.json 及版本隔离 mods。多实例显示选择菜单，选定后继续；识别缺失／冲突可手工确认。回填不会反复覆盖用户修改，客户端发布版本仍手动填写。显示新增／修改／删除数量、完整大小、实际新增数据、预计下载量与 CAS 复用率，READY 前不能提交审核。关闭窗口后可继续处理中的任务、选择实例、填写、取消或失败重试。

提交进入审核；内容锁定，旧 Release 保留并继续服务。审核员检查资料和逐文件清单后批准或驳回。发布人员生成签名 Release；同时有版本切换权限才可直接切换当前绑定。仅有发布权限时生成历史 Release，再由获授权人员启用。并发更新基准发生变化会拒绝覆盖，要求基于最新当前版本重新上传。

组织／服务器管理员可以归档客户端；归档保留历史与存储对象，清除当前绑定并停止分发。恢复不自动设为当前或上架。已发布内容不得修改，更新只能生成新版本。

已归档、从未发布且无实际／待绑定服务器的客户端，拥有 CLIENT_DELETE 时显示“删除”，使用确认窗口。删除后列表隐藏、名称释放，Worker 回收文件。Settings 的“OSS 回收站”仅超管可见，设置文件保留期（默认 7 天）；共享文件不回收，匹配回收文件可校验后取回复用。详细规则见[回收站](client-recycle.md)。

## 数据与权限

侧栏入口与空分组按当前 RBAC 隐藏。组织入口依组织权限，服务器／客户端／发布入口取可访问服务器权限并集；Listing、内容和系统运行管理仅超管可见，Settings 始终可见。组织筛选只过滤后端已授权的数据，不改变账号本身权限。API 不依赖菜单隐藏，在服务端再次校验账号、作用域与资源归属。

登录、退出、改密后重新加载页面与同源其他标签，清除旧账号管理状态。侧栏显示当前账号身份和组织管理员范围，用户菜单显示登录用户名。

超管图表使用完整近 14 天 AuditEvent，按 Asia/Shanghai 补齐日期；普通成员只见有权限组织的服务器分布。CDN 流量和游戏在线指标未接入，不显示模拟数字。

## 验证

TypeScript、ESLint、生产构建及 50 项测试通过（含真实 PostgreSQL／MinIO 与隔离 HTTP 流程），包含多客户端绑定、迁移兼容、标准 API Token 上传脚本、真实隔离 HTTP 审核发布、签名与 CAS 下载。运行实例 HTTP 检查覆盖登录、19 个模块入口、客户端 API、存储状态和来源／会话保护。本次浏览器工具启动失败，新增绑定和模组表格界面的交互和视觉复验尚未完成。

Edge 扩展桥接不可用，但通过内置浏览器完成了本机登录、统一菜单／表格、更新资料预填、大上传区、Java 7–25、Markdown 预览和窗口跨多次自动刷新的交互检查，并保存截图至 .local/client-upload-preview.png。检查中修复了轮询重建表格单元格导致窗口关闭的问题。没有向现有业务服务器写入测试整合包；完整上传／审核／发布以隔离 HTTP 集成测试验证。移动端视觉验收尚未完成。
