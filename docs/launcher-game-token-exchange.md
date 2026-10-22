# Launcher 游戏令牌换票

2026-10-22：后端已实现；原生启动器和真实皮肤站游戏令牌仍需联调。[设计方案](launcher-yggdrasil-token-exchange-plan.md) 保留完整原理、安全边界及验收矩阵。

玩家手动选站，在启动器完成皮肤站登录及角色选择后提交有效游戏 accessToken。Union Link 在固定来源在线验票，核对数字 UID、selectedProfile 和上游角色资料，再按 CODE:UID 复用或创建本地账号、签发只读 mul_ Token。同一账号的多个角色不会变成多个本地账号；角色资料、UUID 和皮肤签名不能单独登录。

本地密码、Union OAuth 和浏览器 start/confirm/claim 保留。新成员为 PLAYER；成员停用不会因换票恢复，管理员的 mul_ Token 也不能用于后台。本次未修改 launcher-template-26.1 仓库。

## 1. 超管核准来源

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

新建 revision=0；修改提交当前 revision，保存递增修订。来源 CODE/根地址创建后不可改写；新增地址另建来源。认证根固定为 bsRoot + `/api/yggdrasil`。目录主地址或别名必须包含该根地址，站点及组织有效。目录或来源修订、停用变化后，旧直接换票会话立即失效，须重新核准。

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

新公开接口错误为 `{error,code,requestId}`，429 附 Retry-After:300。INVALID_REQUEST/LOGIN_ATTEMPT_INVALID 为 400；GAME_TOKEN_INVALID/EXPIRING 为 401；PROVIDER_DISABLED/ACCOUNT_OR_PROVIDER_UNAVAILABLE/INVALID_ORIGIN 为 403；PROFILE_MISMATCH/CHANGED/LOGIN_ATTEMPT_USED 为 409；过大/类型错误为 413/415；限流 429；上游失败 502，不支持身份合同或服务异常 503。

游戏登录成功而本站失败时保留有效游戏登录，显示 Union Link 连接失败，允许退避重试或浏览器桥接；不展示旧账号列表，也不绕过验证。新错误的 error 当前为稳定英文错误码，客户端可按 code 本地化。

OpenAPI 4.0.0：完整 88 操作、公开 11 操作，包含四个分发 GET、成员自查、浏览器 start/claim/logout，以及直接换票 providers/start/exchange。approve、OAuth 回调、超管来源及全部后台/自动化接口不加入公开规范。中英文源/JSON、接口清单和新基线同步，开发期无需兼容旧规范。

## 5. 数据库和验证边界

迁移 202610220001 新增 LauncherAuthProvider、LauncherGameLoginAttempt、Session 来源/profile 字段及受限签发函数；202610220002 保留身份解析重构前 OAuth 审计的组织和映射修订。33 张业务表 FORCE RLS，四个运行角色继续隔离。已应用本地开发库，未部署远端。

专项：`npm run test:launcher-auth`。综合：test:union、test:openapi、openapi:check、typecheck、lint、db:check。生产构建后设置 `MUA_HTTP_TEST_DIST=.next` 和 `MUA_UNION_BROWSER_TEST=1` 运行 test:union，使用临时 schema、专用 fixture 和模拟上游，检查生产 HTTP、权限与 Scalar 页面。实际外部令牌、各站身份合同和 Fabric 游戏进服仍需单独验收。

覆盖同账号双角色、OAuth 身份复用、PLAYER、伪造签名/角色、失败配额、并发一次性、到期、来源修订/停用、成员停用、请求脱敏和私网拒绝。没有使用真实玩家游戏令牌进行验收。

本轮验证：生产构建、类型、Lint、OpenAPI 生成/检查及四个运行角色 db:check 通过；认证与成员 33 项（含生产 HTTP 和 Edge/Scalar 浏览器）、RLS 13 项、OpenAPI 9 项通过，0 失败。浏览器截图 `.local/launcher-exchange-api.png`；这些测试使用模拟上游，不能代替真实外部登录。

本轮第一次迁移前备份因容器认证信息缺失失败，随后仍执行迁移，未形成该次迁移前恢复点。已补做迁移后只读备份 `.local/union-after-game-exchange-1792640090503.dump`（506704 字节），不是迁移前备份；该追加迁移未改写既有业务数据，原有旧备份保留。
