# Union Link OpenAPI 与 Scalar

2026-10-21 后续：OpenAPI 3.0.0 完整规范 83 操作，新增目录同步和组织头像 5 操作；组织资料 JSON 不再接受裸 avatarObjectKey，使用独立 multipart 头像接口。新增 3.0.0 基线并保留历史基线。详见 [变更记录](openapi-changelog.md) 和 [目录与头像](union-directory-sync.md)。

2026-10-21：OpenAPI 2.0.0 完整规范 78 操作；对外规范仍只含四个 Launcher GET，但均声明成员会话／LauncherToken 认证。新增 Union OAuth、只读 Launcher 登录桥接、成员目录和跨组织管理接口。后台完整规范要求有效管理 Cookie，普通 OAuth 成员不能读取；保留 1.0.0 基线，新增并检查 2.0.0 基线。开发期主动移除匿名兼容，不变更已签名包，见 [变更记录](openapi-changelog.md) 和 [实施说明](union-oauth-member-access.md)。下方旧操作数量和匿名说明为历史记录。

2026-10-14 首发基线：开发期旧入口、旧请求与历史协议分支已清理；当前规则、数据处理及验证见 [首发清理](first-release-cleanup.md)。本说明优先于下文历史实施记录。


第 1–7 步已接入：OpenAPI 3.1 中英文完整规范覆盖 64 个实际业务操作（1.1.0 新增超管存储遥测 GET），后台左侧 `API` 在 `/admin/api` 内嵌 Scalar。默认完整规范，可切换 Launcher 公开规范；语言、主题和登录重定向沿用网站设置。执行顺序见[客户端操作指南](api-workflows.md)，变更见[兼容性记录](openapi-changelog.md)，路径见[接口清单](api-inventory.md)。

## 发布边界

| 入口或产物 | 内容 | 访问方式 |
| --- | --- | --- |
| `/admin/api` | 内嵌 Scalar，完整及公开规范切换 | 后台会话；否则跳转登录 |
| `/api/admin/openapi?locale=zh-CN\|en-US` | 64 个完整操作 | 逐请求检查 Cookie；private, no-store；Vary: Cookie |
| `/openapi.json?locale=zh-CN\|en-US` | 4 个 Launcher GET | 公开，无后台和认证路径 |
| `docs/openapi/union-link.admin.{locale}.json` | 完整离线产物 | 随源码审查，不上传公共站点／Registry |
| `docs/openapi/union-link.{locale}.json` | 公开离线产物 | CI 通过后发布 GitHub Actions artifact |

页面保护不替代 JSON 端点保护。Bearer 仅适用于客户端标准 API，不能读取后台文档或修改 Settings。文档可见不授予业务权限；业务请求继续检查 RBAC、范围、修订、账户和 Token 状态，PostgreSQL RLS 保留。超管限定使用说明及 `x-superadmin-only` 标识，权限使用 `x-permissions`；字段限定和多资源权限须阅读操作说明。

Cookie 写请求要求同源 Origin，浏览器自动发送实际 Origin；Scalar customFetch 保留 Request 原有 JSON／Bearer 请求头，仅删除手填 Origin 并发送同源 Cookie。Bearer 写请求不要求 Origin；存在 Authorization 则只采用 Bearer，错误 Token 不回退 Cookie。HttpOnly Cookie 不读取到配置，调试凭据不持久化。Scalar JS/CSS 随应用打包，关闭 telemetry／AI，不使用 CDN 渲染器或第三方请求代理。

## 契约来源与检查

- `document.ts`／`schemas.ts` 显式建模公开接口，`private-document.ts`／`private-schemas.ts` 建模完整 DTO，均位于 `src/lib/openapi`。
- `scripts/openapi-sources.ts` 用 TypeScript AST 提取服务实际 Zod 请求校验表达式，生成纯模块 `requests.generated.ts`。提交和格式等共享 Zod 直接复用。旧 `input.fields` 请求显式建模，相关实现记录源文件摘要。生成器不连接数据库／OSS，不读取 .env。
- `scripts/openapi-coverage.ts` 独立读取 Route Handler，展开 catch-all 方法、路径长度、条件和候选列表，核对规范及清单。新增路由、删除实现或无法识别的路由条件使检查失败。框架隐式 HEAD／OPTIONS 和规范传输路由不计入 66 个业务操作。
- `openapi:check` 检查四份规范、引用、英文完整性、生成产物、实际接口覆盖、请求校验源、相关实现摘要和兼容性基线。
- AJV 2020-12 校验真实 HTTP：Cookie 上传、Bearer 分片／实例选择／审核／组包／发布／管理下载、修订冲突，后台组织／账号／授权／Token／Settings／状态，登录／改密／退出，图片 multipart 和 WebP。测试使用临时 schema 和 bucket，不改已有发布。成功请求和所有 JSON 响应按文档校验；故意无效的请求保留失败断言。
- 浏览器回归核对会话保护、66 个操作的下载、公开规范隔离、语言／主题、搜索、真实 GET、图片文件选择和窄屏布局。

JSON Schema 无法表达全部 Zod refine、实时 RBAC 和跨字段规则，相关约束写在操作说明并由真实服务测试检查。源码摘要要求实现变化后重新生成并审查契约，不能单靠摘要证明业务语义。

## 本地验证

```text
npm run openapi:generate
npm run openapi:check
npm run test:openapi
npm run test:downloads
npm run test:admin-ui
npm run typecheck
npm run lint
npm run build
```

真实契约测试需要 PostgreSQL 分离角色、MinIO 和生产构建。设置 `MUA_HTTP_TEST_DIST` 为实际构建目录（默认 `.next`），再运行 `npm run test:openapi:contracts`。缺少该变量时上传 HTTP 测试会跳过，不能算验收完成。图片测试启动独立 Next 实例；Windows 终端须能关闭它启动的子进程。

浏览器回归测试已启动的服务，默认 `http://localhost:3001`／无头 Edge。用 `SMOKE_ORIGIN`、`SMOKE_BROWSER`、`SMOKE_USERNAME`、`SMOKE_PASSWORD` 指定预览及已有测试账号，本地亦可读取忽略目录 `.local/initial-admin-*.txt`。执行 `npm run test:openapi:browser`，正常登录，结束后退出；截图在 `.local/api-documentation-*.png`，不上传公开 artifact。Linux CI 使用 Chromium。

## CI 与发布

[API contracts 工作流](../.github/workflows/openapi.yml) 在 PR、push 和手动触发时执行。使用临时 PostgreSQL／MinIO，显式配置分离角色；管理员连接仅用于角色初始化，其后由迁移角色建表，应用不回退特权连接。检查规范／兼容性、关键契约、既有下载／UI、类型、lint、生产构建和真实 Scalar 浏览器行为。

全部通过后，仅上传两份公开 JSON，artifact 按 commit SHA 命名、保留 14 天。后台完整文档随网站构建部署，通过受保护入口提供；不向 Pages 或公共 Registry 发布。工作流已加入仓库，远端运行须提交／推送后触发，本地验证不代表已在 GitHub 执行。

接口变更须同步定义、生成产物、审查差异与兼容性、更新变更记录并执行检查。生成命令不修改基线；已有操作的请求、响应、参数或认证变化会被基线阻止。确认变化后记录版本／迁移影响，保存新基线并修改检查引用，保留旧基线。描述修改及新增操作兼容通过；字段变化或删除一律要求审查。

API URL 的 /v1、muapack 格式和文档版本独立。新 v2 protocolRevision:2 公开响应无 platform，管理下载仍有 platform=universal；历史签名和受限平台不改写。Manifest 验签使用原始响应字节，ETag 可为 null、不能替代 SHA-256。见[下载契约](launcher-download-api.md)和[muapack v2](muapack-v2.md)。

## 2026-10-13 本地验收

四份规范、实际覆盖 66/66、源码／产物／兼容性检查通过；9 项 OpenAPI、1 项生产 HTTP 完整流程、4 项图片／后台／认证、36 项下载和 16 项既有 UI 回归均通过。无头 Edge 浏览器回归通过双语、黑白主题、搜索、66 操作下载、公开／完整切换、图片表单、真实目录 GET 200、390px 布局及 Scalar Cookie POST 退出；核对 JSON Content-Type、实际 Origin 和退出后 401。工作流 YAML、类型、全仓 lint 和生产构建通过。

修复 Scalar 传入 Request 时自定义 fetch 意外清空原请求头的问题；业务 API 未改变。最终本地生产预览为 `http://localhost:3001/admin/api`，构建目录 `.next/union-link-api-complete`，预览不是自动启动服务。远端 GitHub Actions 未执行，待提交／推送后触发。

参考：[Scalar 集成](https://scalar.com/products/api-references/integrations/nextjs)、[本地化](https://scalar.com/products/api-references/localization)、[Zod 3](https://github.com/asteasolutions/zod-to-openapi)、[Node 设置](https://github.com/actions/setup-node)、[artifact 发布](https://github.com/actions/upload-artifact)。
