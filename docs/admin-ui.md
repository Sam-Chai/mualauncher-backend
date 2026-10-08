# MUA Management Platform 管理界面

更新时间：2026-10-08。入口为 `/admin`，本机地址 http://localhost:3001/admin。根路径及旧 `/dashboard` 路径跳转到 `/admin`。

## 技术栈与来源

- Next.js 16 App Router、TypeScript、React 19；沿用 PostgreSQL / Prisma。
- [shadcn/ui dashboard-01](https://ui.shadcn.com/blocks?category=dashboard)：通过官方 CLI 引入，使用 SidebarProvider / SidebarInset、侧栏、顶部导航和卡片布局，菜单改为 MUA 分组。桌面可折叠为图标栏，移动端使用 Sheet。
- Tailwind CSS 4、Lucide Icons、shadcn Radix 组件；TanStack Table 8.21.3 支持搜索、排序、隐藏列、分页与每页数量选择。
- React Hook Form + Zod 统一用于登录、组织、服务器、Listing、成员授权、白名单账号、草稿和改密表单；服务端仍独立验证输入与权限。
- [Tremor Raw AreaChart](https://www.tremor.so/docs/visualizations/area-chart) 仅用于图表，基于 Recharts。没有安装旧 `@tremor/react` 包（它声明 React 18 peer）；没有使用 Tremor 全局 UI。
- 当前认证仍为本地白名单，后续接入 MUA OIDC / Auth.js；MinIO / S3、Redis / Worker 尚未接入。

Tremor 源码来自官方 [AreaChart v1.0.0](https://github.com/tremorlabs/tremor/tree/main/src/components/AreaChart) 及配套工具。调整了导入路径、Lucide 图标、图例滚动按钮、Recharts 3 Tooltip label 类型及 SSR 初始尺寸（浏览器通过 ResizeObserver 适配实际尺寸）；保留 Apache-2.0 [许可证](licenses/TREMOR-LICENSE)。shadcn 组件采用 [MIT 许可证](licenses/SHADCN-LICENSE)，本地将移动端检测改为 useSyncExternalStore，固定 Skeleton 宽度以满足渲染纯度与水合要求。

## 路由与功能

| 页面 | 路径 | 当前功能 |
| --- | --- | --- |
| 总览 | `/admin` | 真实资源数量、服务器目录、Tremor 图表 |
| 组织 | `/admin/organizations` | 新建、资料编辑、归档/恢复 |
| 成员 | `/admin/members` | 组织角色、单服授权、添加已有成员；超管另有白名单账号页签 |
| 权限 | `/admin/permissions` | 与服务端共用的角色—权限矩阵 |
| Server | `/admin/servers` | 登记已有 MUA ID、资料编辑、归档/恢复 |
| Listing | `/admin/listings` | 超管设置顺序、颜色、上架标记，查看真实分发资格 |
| 状态 | `/admin/servers/status` | 数据库配置状态，尚无游戏在线检测 |
| Client Profiles | `/admin/clients` | 权限范围内的专用客户端 |
| 客户端详情 | `/admin/clients/[id]` | 简介/绑定、草稿创建/编辑/归档/恢复、只读发布历史；id 为 server ID |
| 客户端发布 | `/admin/clients/[id]/releases` | 不可变版本资料与发布历史 |
| Releases | `/admin/clients/releases` | 可访问客户端的发布历史 |
| 待审核 | `/admin/releases/review` | 按 DRAFT_REVIEW 权限读取 SUBMITTED 草稿，无审核写操作 |
| 已发布 | `/admin/releases/published` | 未归档发布记录，包括历史版本；标记当前版本 |
| 已撤销 | `/admin/releases/revoked` | 暂展示已归档发布记录；独立撤销流程待接入 |
| Audit Log | `/admin/system/audit` | 超管最近 50 条操作审计 |
| Settings | `/admin/system/settings` | 自助改密及真实接入状态 |

以下入口已经建立，但只显示待接入说明：Artifacts、Runtime、资讯、活动、Launcher UI、Worker、Storage、Signing Keys。Launcher 排序和颜色设置目前在 Listing 管理；上传、内容管理和完整发布流程没有因此被视为完成。

## 数据与权限

左侧导航按当前账号的 RBAC 权限显示入口，空分组自动隐藏。组织级入口读取组织权限，服务器、客户端及发布入口读取所有可访问服务器的权限并集；Listing、内容管理及系统管理入口仅对 MUA 超级管理员显示，账号设置始终可见。顶部组织筛选只影响页面数据，不改变账号本身的菜单权限。菜单隐藏只是界面行为，API 仍在服务端独立校验权限。

顶部组织筛选只过滤后端按 RBAC 收窄后的数据。一服一客户端、每服最多一个当前发布、发布内容不可变、归档保留历史等规则保持不变。写接口继续使用 HttpOnly 会话、来源校验及服务端权限重查。

登录、退出与改密完成后会重新加载页面，清除前一个账号留在浏览器中的管理状态；同源的其他已打开标签页也会刷新。侧栏显示当前账号的名称和组织管理员范围，用户菜单显示登录用户名。

超管图表使用完整近 14 天 AuditEvent，按 Asia/Shanghai 划分日期并补齐无操作日；全平台指标不随组织筛选变化。普通成员只能看到可访问组织的服务器分布，不返回平台审计曲线或白名单账号清单。CDN 流量、缓存命中率、容量指标尚未接入数据源，不展示模拟数值。

## 验证

- TypeScript、ESLint 与生产构建通过。
- 17 项真实 PostgreSQL 测试通过，包含侧栏权限收敛、不可变发布、归档、来源保护、会话撤销、跨账号身份切换与完整审计聚合。
- HTTP 检查覆盖登录、总览及 21 个模块入口、会话撤销、来源/输入保护、Cookie 和公开目录。
- 浏览器桥接返回 `nodeRepl.fetch request failed`，未完成点击交互、移动端与截图视觉验收。
