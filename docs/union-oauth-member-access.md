# Union OAuth 与成员访问：配置、使用和验证

2026-10-22：新增 [Launcher 游戏令牌换票](launcher-game-token-exchange.md)，复用 CODE:UID 和 PLAYER，保留原浏览器桥接、本地密码及 OAuth。直接换票 Token 最长 15 分钟，公开规范扩至 11 操作；真实上游及原生启动器仍待联调。

## PLAYER 与 Union 身份显示（2026-10-21 增量）

Union 账号在成员列表、账号目录和添加成员搜索中显示昵称与 `Union · CODE:ID`；只有实际拥有本地凭据时才显示 `@username`。账号搜索支持昵称、本地用户名和完整 Union sub，不把昵称作为唯一用户名、不创建密码或合并账号。

新增组织角色 `PLAYER`（玩家），其管理权限集合为空。Union 自动入组与手动添加普通成员默认使用 PLAYER；管理员清空组织角色后保存也归一化为 PLAYER，单服授权不接受此角色。资源可见范围继续使用原有成员分发层，只能访问已获准的已发布资源。`can_manage` 改为检查实际管理权限，PLAYER 非空不会因此进入后台或读取草稿；额外管理角色与单服管理授权仍按原规则生效，撤销后立即失效。

部署追加迁移 `202610210005_player_role`（先提交枚举）及 `202610210006_union_player_identity`（默认值、空角色回填、后台准入与受限身份目录）。只回填空的组织角色，不改已有管理角色、账号状态、成员停用状态、来源或身份映射；仍为 31 张 FORCE RLS 业务表。首次本地应用前备份 `.local/union-before-player-20261021.dump`。新目录函数沿用既有账号目录的授权与过滤，禁止匿名／公共分发角色调用，不公开邮箱或 OAuth 凭据。当前 OpenAPI 3.2.0／83 操作。

本地校验中调整了尚未发布的迁移 006 新函数的属主为非登录 `mua_owner`，与其他新授权函数一致；已同步当前开发数据库函数属主和该次迁移校验值，未重放迁移或修改账号数据。此项仅针对本轮尚未提交／发布的开发迁移，不作为已发布迁移的修改流程。

本轮验证：完整测试 263 通过、0 失败，2 项真实 PCL／HMCL 样本跳过；其中 Union 23、RLS 13、后台 UI 22 通过，生产构建 HTTP 门禁已执行。最终生产构建、类型、Lint、OpenAPI 和四个受限数据库角色检查通过。真实开发站实测 Sam_Chai 显示 `Union · MUA:9917`／玩家，后台准入为 false，页面无运行错误；截图 `.local/player-union-member.png`、`.local/player-permission-row.png`。本轮没有重做真实上游授权或 Launcher 原生登录验收。

日期：2026-10-21。设计依据：[实施方案](union-oauth-member-access-plan.md)。本文描述已经加入代码的后端与网页能力；真实 Union 授权、上游 PKCE 执行和 Fabric Launcher 接入需分别联调，不能以模拟测试代替。

后续已接入 [每分钟目录同步与 512×512 组织头像](union-directory-sync.md)：新 CODE 自动创建／关联组织，Settings 提供超管同步状态。此功能替代下文“必须先手工新增每个映射”的初始流程；冲突或人工例外仍在 `/admin/access` 处理。当前 31 张 FORCE RLS 业务表，OpenAPI 3.0.0 完整规范 83 操作。

## 1. 首次启用

1. 使用迁移连接执行 `npm run db:deploy`，再执行 `npm run db:generate`、`npm run db:check`。迁移新增七张 FORCE RLS 表，业务表共 30 张；原数据、账号、发布和签名保留。
2. 保留原账号密码登录，以本地超管进入 `/admin/access`，在“Union 皮肤站组织映射”维护 CODE 与组织的对应关系。`MUA` 对应 MUA 组织，其他代码对应其皮肤站组织。没有确认映射的来源不能自动入组；不根据邮箱匹配组织。
3. 获得应用凭据后在服务端设置：

   ```dotenv
   APP_ORIGIN="https://link.mualliance.cn"
   UNION_OAUTH_CLIENT_ID="由 Union 管理员签发"
   UNION_OAUTH_CLIENT_SECRET="由 Union 管理员签发"
   UNION_OAUTH_CLIENT_AUTH="post"
   UNION_OAUTH_SCOPE=""
   ```

4. 登记唯一的完整回调：`https://link.mualliance.cn/api/auth/union/callback`。不要在后面预填 code 或 state。`UNION_OAUTH_CLIENT_AUTH` 可选择 `post` 或 `basic`；scope 与认证方式须按上游实际契约核实，未给出的 scope 不猜测。
5. 通过反向代理测试时，从 `https://link.mualliance.cn/login` 发起登录，不从 localhost 发起后再回到外部域名。反向代理须正确转发回调路径、Cookie、Host／转发信息，且不能缓存个性化响应。
6. 本地脚本支持 `./start-frontend.ps1 -Origin https://link.mualliance.cn`。未传 `-Origin` 时，脚本清除当前窗口继承的旧 `APP_ORIGIN`，由 Next 读取环境文件，避免旧 localhost 进程变量覆盖 `.env` 的 HTTPS 地址；显式 `-Origin` 仍优先。控制台显示实际登录域名，本地端口仅作为反向代理连接地址。正式迁移服务器后保持域名与路径即可沿用回调。
7. 使用 `next dev` 经外部域名访问时，在 `next.config.ts` 的 `allowedDevOrigins` 中加入 `link.mualliance.cn` 并重启服务，代理须支持 `/_next/hmr` 的 WebSocket 升级。若页面可以显示但表单没有发送请求，先检查前端初始化和 WebSocket；若密码登录返回“请求来源不被允许”，检查运行中的 Origin，而不能仅查看 `.env`。OAuth start 返回的 `redirect_uri` 应使用 HTTPS 域名，不应为 localhost。不要通过关闭来源校验或 Secure Cookie 来绕过配置问题。

未设置 Client ID／Secret 时，登录页保留密码表单并说明 Union 尚未配置。此时不跳转上游，start 接口返回 503，仍可配置映射、使用本地管理账号和测试其他功能。不要把 Client Secret、上游令牌或管理 ApiToken 放进启动器。

## 2. 登录实现与安全边界

- 协议层使用 `oauth4webapi`，采用固定的 Union 授权、令牌及 userinfo 地址，不按 OIDC discovery 或 ID Token 解析。
- 每次登录生成新的 S256 PKCE verifier/challenge 和随机 state，始终同时发送 PKCE 与 state；失败不会自动重试成无 PKCE 模式。支持情况尚未实测，真实验收要验证错误 verifier 会被上游拒绝，不能仅凭成功登录认为上游执行了 PKCE。
- 登录关联使用独立 `mua_union_login` Cookie，HttpOnly、SameSite=Lax、五分钟过期、路径 `/api/auth/union`；HTTPS Origin 时带 Secure。它与旧 `mua_session` 无关，回调不依赖旧登录 Cookie。
- state 和浏览器随机量在数据库保存摘要；verifier 仅在受限的短期登录事务中保存。DELETE RETURNING 原子消费事务后才换取令牌；重复回调、过期、跨浏览器关联或上游失败均不能重用已消费事务。
- 本地网页登录仍使用现有 Session、随机 Token 摘要和十二小时有效期。管理与成员共用本地会话系统，Cookie 为 HttpOnly、SameSite=Lax；写操作继续检查同源 Origin。
- 首次 OAuth 登录按完整 sub 创建无密码、无后台角色的普通账号；同 sub 并发登录不重复建号。相同邮箱、昵称或游戏角色不会合并账号。
- 重复登录不覆盖管理角色，不恢复人工停用成员，不重建撤销授权；已有皮肤站映射不能直接转移到另一组织。
- 用户信息不保存邮箱；只使用 sub 与昵称。上游请求禁止自动跟随重定向，设置超时，userinfo 大小受限。错误回调跳转脱敏错误页，不将令牌、state、授权码或 Secret 输出到日志／页面。

参考：[RFC 9700](https://datatracker.ietf.org/doc/html/rfc9700)、[oauth4webapi 官方示例](https://github.com/panva/oauth4webapi/blob/main/examples/oauth.ts)。本地 state、Cookie 和 PKCE 请求处理已实现不等于上游安全能力已完成真实验收。

## 3. 成员与管理员

普通用户登录后进入 `/member`，浏览本组织可展示服务器和已经批准的外部服务器，以及每台服务器当前可分发客户端。成员页面可以选择下载平台并下载完整包，不开放独立未绑定客户端、草稿、候选版本或完整后台历史。

有有效管理角色的账号可以进入原 `/admin`。普通成员的有效 Cookie 不能读取后台状态、内部 OpenAPI 或管理接口；Launcher 凭据即使属于管理人员也不能替代管理 Cookie。原密码登录、角色授权、审核与发布流程保留。

跨组织访问在 `/admin/access` 操作：

1. 源组织管理员选择本组织有效成员、目标组织、服务器及申请理由。
2. “全选全部可申请服务器”保存当前具体 ID 集合。“是否自动加入新增的服务器到列表”默认不选，需一起交由目标管理员批准。
3. 目标组织管理员查看准确范围与自动新增选项后同意或拒绝；源组织管理员可取消待处理申请。
4. 批准增加指定成员的读取范围，不把其加入目标组织，不授予管理能力。请求 revision 防止旧页面重复或过时审批。
5. 扩大已有范围需新申请；原授权继续有效，直到双方管理员之一撤销。申请与批准事实保留，撤销必须填写原因。

当前申请／授权列表返回各自最近 200 条。授权判断读取所有有效授权，不受列表上限影响；历史量超过此范围时，应扩展管理分页，不删除历史记录。

## 4. 自动新增与展示时间

首次可展示事实保存为 `ServerMemberVisibility.firstVisibleAt`。它与批准时刻比较，配合明确勾选的服务器集合计算覆盖范围：

```text
所选服务器
或（批准自动新增 且 首次可展示时刻晚于授权批准时刻）
```

首次事实与审批使用同一事务锁顺序。未来展示窗口在资源具备有效发布与绑定时预登记计划时刻；发生业务变化时撤销／重算尚未发生的计划，已经发生的首次事实不重置。这样不会把时间窗口开启依赖于“第一次有人查询目录”，也无需让 Worker 进行审批。

例如：批准 A 且开启自动新增时，已可展示但未选择的 B 始终不因重新上架而加入；尚未发布的 C 在之后首次满足条件时可加入。后续客户端更新／换绑沿用服务器访问范围；解绑后不能继续凭该服务器访问旧客户端。

迁移对可识别的旧发布记录作保守基线回填。上线前应核对旧数据中没有固定 scopeServerId、绑定已清除而缺少可恢复历史的服务器；不能宣称迁移能恢复不存在的完整历史事实。

展示窗口只过滤目录，仍按既有规则允许在窗口结束后对有效在线绑定执行下载／固定版本刷新，但必须拥有当前账号授权。未上架、归档、删除、解绑或无有效发布的资源不能通过猜 ID 访问。

## 5. Launcher 登录桥接与资源 API

原生登录使用本系统的桥接，不假设 Union 支持 device code：

1. Launcher 生成随机 verifier，计算 SHA-256 base64url challenge，向 `POST /api/auth/launcher/start` 提交 `{challenge}`。
2. 打开响应中的 loginUrl，在浏览器使用 Union 或原账号密码登录，并显式点击确认。此地址不含长期 Token。
3. Launcher 向 `POST /api/auth/launcher/claim` 提交 `{id,verifier}`；未确认返回 202，确认后返回 `mul_...` 本地只读 Token 和有效期。登录请求五分钟过期、一次性领取，错误 verifier 拒绝，每次尝试限制领取请求频率。
4. 后续资源请求携带 `Authorization: Bearer mul_...`。退出调用 `POST /api/auth/launcher/logout`，本地清除 Token。不要把 Token 交给 OSS 签名链接或其他 Origin。

`GET /api/member` 返回当前成员身份、所属组织和合并后的资源目录。原四个 Launcher GET 均要求成员 Cookie 或 Launcher Token，匿名返回 401；越权资源返回 404。存在 Authorization 时不回退 Cookie。

每次目录、Manifest、packages 和固定 release 刷新都检查实时账号／成员／授权；OSS 工作在数据库事务外执行，返回前再次核验授权与绑定。格式协商、更新基准、产物大小／摘要、签名及 Range／ETag 契约保留。

个性化结果使用 `private, no-store` 和 `Vary: Cookie, Authorization`。撤权立即阻止后续签发与刷新；已签发的五分钟 OSS 链接和已下载文件不能被即时收回。

后端登录桥接不代表 `launcher-template-26.1` 已接入。该仓库的真实浏览器登录、Token 安全保存、401 处理和安装联调需单独完成。

## 6. 数据库、契约与验证

- 新增迁移：`202610210001_union_member_access`。自动建号与入组由 `mua_auth` 的受限函数执行；普通账号不会获得组织角色。申请、审批、撤销与映射写入保留双层范围检查和审计。
- 七张新业务表全部启用 FORCE RLS；无运行角色可执行原无身份分发投影。`mua_public` 保留为受限连接，但不再具有匿名读取业务资源的能力。启动检查验证模型数量、策略、安全函数及无范围投影的授权。
- 公开发布的 API 文档仍只包含四个 Launcher GET，但操作要求登录；内部完整规范为 78 个操作。OpenAPI 版本 2.0.0，保留旧基线并新增 2.0.0 基线，明确接受开发期认证破坏性变更，不提供匿名兼容旁路。
- `npm run test:union` 使用临时 schema 和模拟 OAuth 响应测试身份、会话、审批、撤销、PKCE 请求及回调保护，不读取真实应用凭据。
- 生产 HTTP 集成测试：先 `npm run build`，设置 `MUA_HTTP_TEST_DIST=.next` 后运行 `npm run test:union`。设置 `MUA_UNION_BROWSER_TEST=1` 可附加无头 Edge 页面检查，截图写入被忽略的 `.local`。
- 既有上传 HTTP 契约测试使用独立普通成员会话测试分发，管理自动化 Token 不再充当玩家登录凭据。

真实 Union 登录未验证时，仍必须保留这些待验收事项：实际 Client ID／Secret、scope、post/basic 认证方式、各来源站点 OAuth 可用性、上游错误 verifier 拒绝、授权取消、真实反向代理 Cookie 行为、上游账号停用传播和实际 Launcher 接入。

### 2026-10-21 本地验收记录

- 生产构建、Prisma validate／generate、TypeScript、ESLint 与 `openapi:check` 通过；中英文公开／完整规范覆盖 78／78 操作。
- 在 `MUA_HTTP_TEST_DIST=.next`、`MUA_UNION_BROWSER_TEST=1` 下执行完整 `npm test`：253 项通过、0 项失败，2 项真实 PCL／HMCL 外部样本测试因未提供样本跳过。Union 专项 15 项全部通过，其中包含独立 Cookie、一次性 state、S256 请求、模拟上游响应、成员权限、自动新增、撤销、密码登录、Launcher 登录桥接及实际 HTTP 检查。
- 无头 Edge 实际操作了源组织提交申请、目标组织批准、成员目录增加服务器、源组织撤销、成员目录移除服务器的流程；截图位于 `.local/union-member-preview.png` 与 `.local/union-access-preview.png`，完整测试日志位于 `.local/union-final-suite.log`。这些截图和模拟身份不代表真实 Union 登录已通过。
- 应用本机迁移前已备份 PostgreSQL：`.local/union-before-oauth-20261021-134741.dump`（429438 字节）。`202610210001_union_member_access` 已应用到当前本地开发库，`db:check` 的四个运行角色与 FORCE RLS 检查通过；未部署到云端。
- 尚未填入或使用真实 Client ID／Secret，也未修改 Fabric Launcher 仓库。拿到凭据后按第 1、2 节完成真实 HTTPS 回调和上游 PKCE 验收，再进行原生 Launcher 联调。

### 2026-10-21 HTTPS 登录配置修复

- 本地已配置真实应用凭据；凭据仅保存在被 Git 忽略的 `.env`，本文不记录其值。真实 Union 授权和上游 PKCE 验收仍待完成。
- 用户添加的 `allowedDevOrigins` 已允许公网开发域名。之后排查发现旧进程变量仍把 Origin 固定为 localhost，优先于 `.env`，导致公网密码登录 403 和错误 OAuth 回调。启动脚本已修正；重启时刻意继承旧 localhost 值，确认运行中的 OAuth 回调仍为 HTTPS 域名且 Cookie 带 Secure。
- 无头 Edge 经公网实际完成密码表单 POST（200）、会话 Cookie 和 `/admin` 跳转，前端无运行错误，HMR 已收到消息；随后注销本次测试会话。结果与截图位于 `.local/login-proxy-verification.json`、`.local/login-proxy-fixed.png`。密码未重置，来源校验与安全 Cookie 保留。
