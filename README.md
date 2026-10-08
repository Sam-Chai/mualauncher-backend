# MUA Prism

MUA 高校联盟启动器后端，使用 Next.js 16、Prisma 7 与 PostgreSQL。后台采用 shadcn/ui dashboard-01、Tailwind CSS、Lucide、TanStack Table、React Hook Form + Zod；图表仅使用 Tremor Raw。

已实现业务模型与迁移、白名单登录、组织／单服范围 RBAC、组织与服务器管理、成员授权、版本资料草稿、归档及审计。整合包上传、Worker、CAS、审核签名发布和 Launcher 增量安装尚未接通；PostgreSQL RLS 留在第二阶段。

需求与权限依据：[产品需求](docs/mua-backend-requirements.md)、[数据库模型](docs/minimal-data-model.md)、[权限矩阵](docs/permission-matrix.md)。实际完成范围、REST 接口及验证记录见[实施进度](docs/implementation-status.md)。

## 启动开发环境

本地 PostgreSQL 使用现有 Docker 容器 `mualauncher-psql`，地址为 `127.0.0.1:5432`。项目根目录的 `.env` 已配置用户提供的开发连接，不提交到 Git。新环境复制 `.env.example` 并填写数据库密码。

`APP_ORIGIN` 配置站点的协议、域名、端口，末尾不加斜杠；默认 `http://localhost:3000`。本地站点兼容同协议、同端口的 `localhost`、`127.0.0.1` 和 IPv6 回环别名；其他站点必须精确匹配配置，跨站请求仍被拒绝。HTTPS origin 自动启用 Secure Cookie。生产使用 HTTPS，运行数据库账号与迁移账号应分离，不能照搬当前 postgres 开发账号。

```powershell
npm ci
npm run db:deploy
npm run auth:bootstrap
npm run dev
```

打开 http://localhost:3000/admin。服务创建服务器时登记既有 MUA ID，不自动分配新的 MUA ID。菜单、路由和组件说明见[管理界面](docs/admin-ui.md)。

首次运行 `auth:bootstrap` 创建超管 `mua-admin`，随机密码写入 Git 忽略的 `.local/initial-admin-*.txt`。登录后到“系统 → Settings → 账号安全”修改密码，再删除该凭据文件。已有启用超管时重复运行不会重设账号。

可在执行 bootstrap 的进程中设置 `BOOTSTRAP_USERNAME` 和 `BOOTSTRAP_PASSWORD` 指定初始凭据；提供密码时不生成凭据文件。不要把密码写入 npm 参数、源码或提交内容。面板不提供公开注册，普通账号由超管在“联盟管理 → 成员 → 白名单账号”创建。

头像与图标目前保存对象键，待 MinIO 接入后提供文件上传及图片分发。版本资料草稿可以编辑，整合包文件上传和发布操作尚未开放。

## 当前本机实例与独立构建

本次已执行两份迁移、创建初始超管，并在 http://localhost:3001 启动本地生产模式实例，仅绑定 127.0.0.1。默认 `.next` 的日志被现有进程占用，因此使用独立构建目录；没有停止现有进程。

需要重新启动此实例时，先停止对应端口的旧实例，再运行：

```powershell
$env:APP_ORIGIN = 'http://localhost:3001'
$env:NEXT_DIST_DIR = '.next/mua-prism'
npm run build
npm run start -- --hostname 127.0.0.1 --port 3001
```

构建和启动必须使用相同的 `NEXT_DIST_DIR`。普通 3000 端口开发不需要设置它。本次服务是本地进程，不是自动启动的 Windows 服务。

## 验证与数据库工具

```powershell
npm run db:validate
npm run db:check
npm run typecheck
npm run lint
npm test
```

`npm test` 使用真实 PostgreSQL：建立随机临时 schema，应用本仓库迁移，验证权限／约束／会话与并发，最后只清理该 schema。测试连接需要创建 schema 的权限，不改变 public 中的业务记录。

验证已运行的本机实例：

```powershell
$env:SMOKE_ORIGIN = 'http://localhost:3001'
npm run check:http
```

HTTP 检查默认读取本地初始凭据文件；改密后通过当前进程环境变量 `SMOKE_USERNAME`、`SMOKE_PASSWORD` 提供测试超管凭据。该检查会产生真实登录审计，退出时撤销测试会话。

`npm ci`、`npm run dev` 与 `npm run build` 自动生成 Prisma 客户端。其他工具：

```powershell
npm run db:generate
npm run db:studio
npm run db:migrate -- --name your_change
```

生产应用已提交迁移使用 `npm run db:deploy`。迁移包含 Prisma 无法表达的检查、表达式索引和触发器，新增迁移时必须保留这些约束，不使用 reset 丢弃业务记录。

服务端数据库入口为 `src/lib/prisma.ts`；认证、RBAC 与管理业务分别集中在 `src/lib/auth.ts`、`src/lib/rbac.ts`、`src/lib/management.ts`。不能从 Client Component 导入数据库或认证实现。

系统字体用于界面，构建不依赖 Google Fonts。npm 的默认缓存若因本机目录权限不可写，可使用 `npm ci --cache "$env:TEMP/mualauncher-npm-cache"`。
