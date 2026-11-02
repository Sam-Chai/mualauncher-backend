# Launcher 游戏令牌换票

2026-11-03 修复：传统 Passport JWT 的 exp／iat／nbf 接受 RFC 7519 NumericDate 的有限小数秒，保留比较精度及 90 秒剩余有效期、30 秒时钟偏差保护。格式拒绝改为独立固定诊断码，详见下方“身份格式错误”；不记录原始令牌、声明值或解析异常。无需数据库迁移，OpenAPI 6.1.1。

2026-11-02 组织授权补充：组织管理员和超管现在可在组织编辑窗口允许／撤销 Launcher 直接换票。Worker 为授权组织按 ALI 自动维护来源；系统设置可选择仅对新建组织自动授权。原超管来源接口继续作为手动配置／停用入口，自动同步不覆盖手动来源。组织授权、网络可用性和 Token 兼容性为不同条件，自动发现不声明完成 UID／日志验收。完整规则见 [组织启动器登录授权](organization-launcher-authorization.md)。

2026-10-22：后端已实现；原生启动器和真实皮肤站游戏令牌仍需联调。[设计方案](launcher-yggdrasil-token-exchange-plan.md) 保留完整原理、安全边界及验收矩阵。

玩家手动选站，在启动器完成皮肤站登录及角色选择后提交有效游戏 accessToken。Union Link 在固定来源在线验票，核对数字 UID、selectedProfile 和上游角色资料，再按 CODE:UID 复用或创建本地账号、签发只读 mul_ Token。同一账号的多个角色不会变成多个本地账号；角色资料、UUID 和皮肤签名不能单独登录。

本地密码、Union OAuth 和浏览器 start/confirm/claim 保留。新成员为 PLAYER；成员停用不会因换票恢复，管理员的 mul_ Token 也不能用于后台。本次未修改 launcher-template-26.1 仓库。

2026-11-02：认证地址及目录名称改为 ALI 发现。新增迁移 `202611020001_yggdrasil_ali`，解除旧固定地址等式约束；既有来源保留原地址但停用并递增修订，重新核准后才启用，不自动批准站点，不改历史包或发布签名。发现请求不携带凭据，8 秒总超时、64 KiB 元数据限制、有限跳转，逐跳校验 HTTPS／公网地址并固定 DNS。发现发生在写事务之外，保存时重新校验权限及来源／目录修订；换票只使用已保存的地址，不在携带 Token 时重新发现或跟随重定向。ALI 不代替游戏 Token 兼容性及 UID／角色归属验收。

## 1. 超管核准来源

本地诊断可运行 `npm run check:ali`，只读读取本地目录并分别使用 Worker 当前下载设置及认证直连网络检查所有主地址／别名，不核准来源、不发送凭据。报告保存于 `.local/reports`；`npm run check:ali -- --retry-report <报告.json>` 仅复测未成功路径，保留先前成功结果和失败证据。存在站点未在两条路径解析到一致结果时退出码为 1。检测确认 JSON、公钥字段及 skinDomains，不代替游戏 Token／UID 验收。

2026-11-02 实测修正：初始响应即使为 HTTP 400，仍需读取 ALI 指示；最终元数据必须成功返回。认证网络固定 DNS 地址时同时指定 IP family，避免当前 Node.js 的 `lookup(all=true)` 回调约定导致 `ERR_INVALID_IP_ADDRESS`。本地迁移已执行，四个运行角色的 FORCE RLS 校验通过；远端未部署。

默认没有已启用来源，目录同步不会自动核准认证地址。公开列表为空时，使用浏览器登录桥接。

超管通过网页登录 Cookie，在内嵌 Scalar 完整规范调用 GET/PUT `/api/admin/launcher-providers`。写操作必须同源；不接受 Bearer。请求示意：

```json
{
  "id": "<新生成的UUID，修改使用已有ID>",
  "revision": 0,
  "siteCode": "MUA",
  "displayName": "MUA 官方皮肤站",
  "bsRoot": "https://skin.mualliance.ltd",
  "adapter": "MUA_YGGC_ONLINE_V1",
  "enabled": true,
  "verificationNote": "实际插件版本、OAuth UID 对照、双账号及多角色验收结果",
  "confirmUidMapping": true,
  "confirmCredentialLogRedaction": true
}
```

新建 revision=0；修改提交当前 revision，保存递增修订。来源 CODE/根地址创建后不可改写；新增地址另建来源。bsRoot 必须为目录主地址或别名，站点及组织有效。后端从 bsRoot 按标准 ALI 发现认证 API Root：GET 并跟随安全校验后的 HTTPS 重定向，读取绝对或相对 `X-Authlib-Injector-API-Location`；没有 ALI 时使用最终响应 URL，不补路径。自指 ALI 复用响应，不递归追踪多级 ALI 指示。获取并校验元数据后保存 authApiRoot。启用／重新核准时重新发现，失败返回 502 且不保存；已有来源停用不依赖上游连通。目录或来源修订、停用变化后，旧直接换票会话立即失效，须重新核准。

启用前必须核实实际 OAuth 和游戏令牌 UID 对应关系、不同账号角色不能交叉使用、多角色不会创建新账号，以及上游/代理/APM 凭据日志脱敏。确认字段是超管对验收的声明，接口不代替真实验收。尚未验收时不要启用，或记录 enabled=false。YITUEM 两域名需分别核实 UID 命名空间，不能因同组织就合并账号。

首版支持核实后的传统 MUA Yggdrasil Connect Passport 令牌：RS256、数字字符串 sub、有效 selectedProfile/exp/aud/jti，不接受 Janus iss。旧版、Janus 或其他不能证明相同 UID 的来源使用浏览器桥接；不能按版本字符串自动开放。

## 2. Launcher 调用合同

1. GET `/api/auth/launcher/providers` 获取已核准有效来源的安全投影，用户手动选站。
2. 启动器向该站认证、选择角色，取得最终游戏令牌。已绑定角色 A 的令牌不能直接 refresh 成 B，切换按上游协议重新认证/选择。
3. 安全随机生成 32 字节，base64url 编码为 43 字符 codeVerifier；计算 codeChallenge=BASE64URL(SHA256(codeVerifier))。只保留在当前流程内存。
4. POST `/api/auth/launcher/yggdrasil/start`：`{providerId,codeChallenge,codeChallengeMethod:"S256"}`。成功 201 返回 attemptId、nonce、expiresIn=120、providerId、providerRevision。
5. POST `/api/auth/launcher/yggdrasil/exchange`：

```json
{
  "attemptId": "<start返回的UUID>",
  "nonce": "<start返回的43字符nonce>",
  "codeVerifier": "<内存中的43字符verifier>",
  "gameAccessToken": "<皮肤站签发的最终游戏令牌>",
  "gameProfile": { "id": "<选中角色UUID>", "name": "<角色名，可省略>" }
}
```

需要时附加 gameClientToken，最大 256 字符。UUID 可带标准连字符，服务端规范化为小写 32 位。严格拒绝额外字段、完整 properties、客户端 UID/组织/权限和任意 URL。只接受 JSON，最大 32 KiB；游戏令牌最大 16384 字符。

6. 成功 200 返回 tokenType=Bearer、token、UTC expiresAt、expiresIn、本地账号和 unionSubject、已验证 gameProfile、providerId；不返回游戏令牌，不设置网页登录 Cookie。
7. 用 `Authorization: Bearer mul_…` 调用 `/api/member` 和四个 `/api/v1/servers…` GET；退出调用 POST `/api/auth/launcher/logout`，清除本地凭据与资源缓存。

providers/start/exchange 不使用 Cookie 判断账号，不接受 Authorization 或查询参数；存在 Origin 时只接受本站 Origin，原生客户端可不发送 Origin。不要用全局拦截器向认证、OSS 或第三方请求附加 Token。

## 3. 安全与生命周期

固定来源 `/authserver/validate` 对同一原始游戏令牌成功后，才读取可信 JWT sub 和 selectedProfile，并核对角色归属及资料。公开 profile 查询只补充名字，不证明所有权。不会通过 refresh/invalidate 或 join/hasJoined 探测身份，不改动游戏会话。

HTTPS 验证证书/主机名，公网 DNS 全结果检查并固定连接地址；10 秒总超时、64 KiB 响应上限，禁止自动重定向、HTTP 降级、私网和环境代理。密码只发所选皮肤站；游戏令牌不进数据库、缓存、队列、审计或日志。响应错误不回显上游正文或凭据，认证响应 private, no-store。

APP_ORIGIN 必须使用 HTTPS；仅同机 localhost/回环允许 HTTP 测试，配置为公网 HTTP 时新接口返回 HTTPS_REQUIRED。生产网关仍须阻止明文外部认证流量；服务器收到请求后再拒绝，不能补救客户端此前经明文网络发出的凭据。

attempt 120 秒、nonce/verifier 常量时间比较、共享数据库限流、原子 PENDING → VERIFYING → CONSUMED/FAILED。网络在事务外；最终事务重新核查来源/目录修订和账号/成员。并发最多一次签发；失败或响应丢失需要新建 attempt，不保存可重领明文 Token。

Token 到期为 min(签发时间+15分钟, 上游exp-30秒)，扣除余量后不足 60 秒拒绝。不签发独立 refresh token；到期时用有效游戏令牌重新换票，游戏令牌刷新由启动器负责。数据库只存随机部分 SHA-256 和最小 profile/认证来源元数据。

切换站点、账号或角色时隔离旧请求、资源缓存和签名 URL，重新核验，不让旧响应覆盖新账号。本地账号、成员、来源及权限撤销实时参与资源检查；上游撤销没有推送，传播窗口最长为剩余 15 分钟。已有短期 OSS 链接及已下载文件不能收回。

持久化使用操作系统凭据保管，不可用时只保留内存，不保存密码或明文 Token JSON。Bearer 被盗仍可能被使用；nonce/S256 保护本次尝试，不提供 DPoP 约束。完整安全说明见方案第 5 节。

### 限流与代理

每 5 分钟：全局创建 120 次、换票 300 次；每来源创建/换票各 60 次；每账号通过验证后 10 次。每 attempt 最多 5 次请求，含错误 verifier；每来源最多 4 个有效期内 VERIFYING。失败配额独立提交，不能随业务回滚清零。

默认不信任 X-Forwarded-For。仅后端被可信反向代理隔离且代理**覆盖**客户端同名头时，配置 `LAUNCHER_AUTH_CLIENT_IP_HEADER`；必须单个 IP，缺失或列表拒绝。启用后每 IP 创建/换票各 20 次、每 IP+来源换票 10 次/5 分钟。校园 NAT 需压测调整。不保证代理隔离时留空，不能声称已启用按 IP 限流。

## 4. 错误与 API 文档

### 身份格式错误

以下结果均为 HTTP 503，JSON 的 `code` 为 `diagnostics.game.<错误码>`，`params` 为 `{}`，并携带独立 `requestId`。除适配器拒绝外，均先要求同一原始 Token 通过固定皮肤站的在线验证；不会因解码成功就认定身份。多个字段同时不合规时，按表中顺序返回首个失败类别。旧 `IDENTITY_PROOF_UNSUPPORTED` 不再由该验证路径返回。

| 错误码 | 原因 |
| --- | --- |
| `PROVIDER_ADAPTER_UNSUPPORTED` | 来源适配器未受支持 |
| `GAME_TOKEN_FORMAT_UNSUPPORTED` | JWT 头或载荷无法解析为有效对象 |
| `GAME_TOKEN_ALGORITHM_UNSUPPORTED` | JWT 算法不是 RS256 |
| `GAME_TOKEN_HEADER_UNSUPPORTED` | JWT 存在未支持的 crit 关键头 |
| `GAME_TOKEN_ISSUER_UNSUPPORTED` | JWT 带有当前适配器不支持的 iss |
| `GAME_TOKEN_SUBJECT_UNSUPPORTED` | sub 缺失，或不是受支持的数字 UID 字符串 |
| `GAME_TOKEN_PROFILE_INVALID` | selectedProfile 缺失或不是有效 UUID |
| `GAME_TOKEN_EXPIRY_INVALID` | exp 缺失、不是正有限数字或超出日期范围 |
| `GAME_TOKEN_NOT_BEFORE_INVALID` | 可选 nbf 存在但不是受支持的有限数字日期 |
| `GAME_TOKEN_ISSUED_AT_INVALID` | 可选 iat 存在但不是受支持的有限数字日期 |
| `GAME_TOKEN_AUDIENCE_INVALID` | aud 缺失或不符合字符串／字符串数组要求 |
| `GAME_TOKEN_ID_INVALID` | jti 缺失或不符合非空字符串要求 |

小数秒本身不是格式错误。时间合法但已过期／临近到期仍返回 `GAME_TOKEN_EXPIRING`（401）；签发／生效时间超过时钟偏差仍返回 `GAME_TOKEN_INVALID`（401）。已验证的角色与所选角色不符仍返回 `PROFILE_MISMATCH`（409）。HTTP 503 在这里表示当前身份合同无法支持，不代表请求没有到达服务器。启动器应识别上述代码并只记录代码、阶段、状态和 requestId，不输出 Token 或上游响应。

新公开接口错误为 `{error,code,requestId}`，429 附 Retry-After:300。INVALID_REQUEST/LOGIN_ATTEMPT_INVALID 为 400；GAME_TOKEN_INVALID/EXPIRING 为 401；PROVIDER_DISABLED/ACCOUNT_OR_PROVIDER_UNAVAILABLE/INVALID_ORIGIN 为 403；PROFILE_MISMATCH/CHANGED/LOGIN_ATTEMPT_USED 为 409；过大/类型错误为 413/415；限流 429；上游失败 502，不支持身份合同或服务异常 503。

游戏登录成功而本站失败时保留有效游戏登录，显示 Union Link 连接失败，允许退避重试或浏览器桥接；不展示旧账号列表，也不绕过验证。新错误的 error 当前为稳定英文错误码，客户端可按 code 本地化。

OpenAPI 4.0.0：完整 88 操作、公开 11 操作，包含四个分发 GET、成员自查、浏览器 start/claim/logout，以及直接换票 providers/start/exchange。approve、OAuth 回调、超管来源及全部后台/自动化接口不加入公开规范。中英文源/JSON、接口清单和新基线同步，开发期无需兼容旧规范。

## 5. 数据库和验证边界

迁移 202610220001 新增 LauncherAuthProvider、LauncherGameLoginAttempt、Session 来源/profile 字段及受限签发函数；202610220002 保留身份解析重构前 OAuth 审计的组织和映射修订。33 张业务表 FORCE RLS，四个运行角色继续隔离。已应用本地开发库，未部署远端。

专项：`npm run test:launcher-auth`。综合：test:union、test:openapi、openapi:check、typecheck、lint、db:check。生产构建后设置 `MUA_HTTP_TEST_DIST=.next` 和 `MUA_UNION_BROWSER_TEST=1` 运行 test:union，使用临时 schema、专用 fixture 和模拟上游，检查生产 HTTP、权限与 Scalar 页面。实际外部令牌、各站身份合同和 Fabric 游戏进服仍需单独验收。

覆盖同账号双角色、OAuth 身份复用、PLAYER、伪造签名/角色、失败配额、并发一次性、到期、来源修订/停用、成员停用、请求脱敏和私网拒绝。没有使用真实玩家游戏令牌进行验收。

本轮验证：生产构建、类型、Lint、OpenAPI 生成/检查及四个运行角色 db:check 通过；认证与成员 33 项（含生产 HTTP 和 Edge/Scalar 浏览器）、RLS 13 项、OpenAPI 9 项通过，0 失败。浏览器截图 `.local/launcher-exchange-api.png`；这些测试使用模拟上游，不能代替真实外部登录。

本轮第一次迁移前备份因容器认证信息缺失失败，随后仍执行迁移，未形成该次迁移前恢复点。已补做迁移后只读备份 `.local/union-after-game-exchange-1792640090503.dump`（506704 字节），不是迁移前备份；该追加迁移未改写既有业务数据，原有旧备份保留。
