# 登录表单的密码 URL 泄露修复

2026-10-21。原共享 `SchemaForm` 仅依赖 React 的提交处理器，没有明确声明 HTML 提交方法。正常登录使用 JSON POST；但浏览器原生提交会默认使用 GET，将命名输入（包括密码）编码进网址。

修复如下：

- 所有共享表单明确使用 `method="post"`，覆盖登录、创建账号、重置密码、修改密码以及其他共享表单。
- 服务端渲染及首次 hydration 时禁用整个 fieldset。只有 React 处理器就绪后才启用；脚本不可用时不能输入或提交密码。
- 登录表单明确指定原生目标 `/api/auth/login`，不会把密码提交到当前页面的查询参数。正常脚本仍调用原有 JSON POST，并保留原登录成功跳转逻辑。
- 强制绕过脚本的原生提交使用 POST 请求体。现有 JSON-only API 对 URL-encoded 请求返回 415，不认证、不生成 Cookie。没有新增登录接口或改变 OAuth、会话、RBAC 和密码哈希逻辑。

此修复阻止后续表单生成密码链接，无法撤回已发送请求在浏览器历史、代理或服务器日志中的记录。若真实密码曾出现在网址中，应更换对应密码；清理历史记录不能代替更换密码。

验证：`npm run typecheck`、`npm run lint`、`npm run test:admin-ui`（23 项）以及 `SMOKE_ORIGIN=https://link.mualliance.cn npm run test:auth:browser`（3 项）通过。浏览器回归覆盖无脚本时禁用、原生 POST 的网址／请求体和 415 拒绝，以及现有账号正常 JSON 登录、跳转和退出。原生提交测试仅使用假账号和假密码；正常登录凭据从环境变量或被 Git 忽略的本地初始账号文件读取，不记录密码。

修复前的全部未提交工作已保存为本地提交 `3aa3d1f`，没有推送远端；本修复作为该提交之后的独立工作区改动保留。

## 2026-10-22 主题按钮与密码折叠区 hydration 修复

两条警告同属服务端 HTML 与客户端首次渲染不一致，但不是同一个触发点：

- 主题按钮直接用 `resolvedTheme` 渲染 `aria-pressed`。服务端无法读取 localStorage，输出 false；浏览器恢复暗色主题后，首次渲染可能已经是 true。共享 `useHydrated` 使用 `useSyncExternalStore` 的服务端快照，让 SSR 与 hydration 都先使用 false；接管后再显示真实状态并启用按钮。图标仍通过 CSS 与首屏主题恢复脚本展示，不因等待 hydration 闪回浅色。
- 原生 `details/summary` 可以在 React 加载前自行展开，给服务端生成的元素添加 `open` 属性；用户快速点击、慢速脚本加载或浏览器状态恢复都可能触发。改为 `aria-expanded`／`aria-controls` 的 React 控制按钮和 `hidden` 内容区，默认收起，hydration 完成前禁用按钮。保留小入口、键盘操作、密码表单 POST 目标及未接管时 fieldset 禁用。

修复没有通过 `suppressHydrationWarning` 忽略这些属性差异。浏览器回归现在同时检查控制台和 `pageerror`，避免只监听异常而漏掉 React 的控制台警告。

新增回归覆盖：阻塞 Next.js 脚本时尝试提前展开、接管后 Enter 展开／再次收起、持久化暗色主题下登录页与后台整页刷新、主题切换后刷新，以及已有三项表单安全检查。

浏览器测试可通过 Union 的隔离 HTTP fixture 执行：设置 `MUA_HTTP_TEST_DIST` 为独立生产构建目录，或同时设置 `MUA_HTTP_TEST_DEV=1` 使用专用开发目录；再设置 `MUA_AUTH_BROWSER_TEST=1` 并执行 `node --conditions=react-server --import tsx --test tests/union-access.test.ts`。该入口强制使用 127.0.0.1 临时端口、隔离数据库 schema 和合成测试凭据，不读取真实管理员凭据或访问外部登录站点。

本轮验证：独立生产构建通过；开发／生产两套隔离 HTTP 专项各 27／27 通过，对应浏览器各 5／5 通过，无 hydration 控制台警告。界面测试 23 项、TypeScript 和相关 ESLint 通过。`/api/auth/login` 的原生 URL-encoded POST 返回 415 是预期的内容类型保护，不是 hydration 错误；JSON 登录仍返回 200。
