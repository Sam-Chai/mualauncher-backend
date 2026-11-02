# 组织启动器登录授权

2026-11-02 双地址补充：每个 CODE＋登记地址独立授权。YITUEM 的 `https://skin.yitmc.cn` 与 `https://skin.uemcraft.cn` 在组织表格按地址顺序上下显示两个状态，编辑页分别勾选；即使两站 ALI 指向相同 API，也不共用授权。关闭一个地址只递增该来源修订并撤销该来源会话，另一个地址的授权和会话不受影响。既有组织授权作为默认值保留，迁移不更改当前选择；显式地址选择不会被定期同步或新组织默认设置覆盖。

组织 PATCH 新增 `skinSiteAuthorizations` 数组，元素为 `{code,url,enabled}`，须同时提交当前 `launcherLoginRevision`。只接受本组织已登记的地址，重复／错误类型拒绝，未知或过期地址返回 409。数组只更新提交的地址，不影响其他地址。原 `launcherLoginEnabled` 写法仍表示明确设置全部地址，并清除地址覆盖；不能与数组混用。后台 `skinSites` DTO 每个地址新增 `launcherLoginEnabled`，组织级同名字段保留为默认值。迁移 `202611020003_skin_site_launcher_authorization` 在 Organization 保存地址授权覆盖，无新增表，仍 34 张 FORCE RLS 表。OpenAPI 6.1.0，完整 94／公开 11。

2026-11-02。本次仅在本地实施，不部署远端。

组织表格的“授权”表示是否允许玩家使用该组织皮肤站的账号进行 Launcher 直接换票。组织管理员可在本组织编辑窗口勾选“允许启动器通过皮肤站账号登录 Union Link”，超管可管理全部组织。此选项不授予后台管理权限，不影响原有网页 Union OAuth 或浏览器桥接登录。

组织授权与技术可用性分开：授权后，Worker 在目录同步周期中对有效主地址和保留别名进行匿名 ALI 发现，验证元数据后保存组织自动管理的来源。网络失败、HTTP 降级、无有效元数据不会发布新来源，失败保留到目录同步日志。当前游戏 Token 适配器不因此扩大兼容范围；Janus／旧版／其他不兼容 Token 仍会被在线身份验证拒绝。自动发现不伪造双账号、UID 映射或日志脱敏验收声明，自动来源的 verifiedById 为 null，verificationNote 明确说明实际边界。

系统 → 设置 → Union 组织目录同步中的“自动授权新添加的组织”默认关闭，仅超管 Cookie 可修改。启用后仅影响之后经目录同步或超管手动新建的组织；不回填现有组织，不覆盖已有组织的人工开关，关闭默认值也不撤销已经授予的组织授权。将新目录地址关联到既有组织时保留该组织原授权。

## 权限与生命周期

- 组织 PATCH 需要现有 ORG_EDIT，当前仅组织管理员和超管拥有；API 提交 launcherLoginEnabled 时必须同时提交 launcherLoginRevision。
- 数据库触发器维护组织授权修订，应用层按旧修订检查，过期提交返回 409。取消和重新授予授权均递增关联来源修订，使旧会话和进行中的换票请求失效；重新启用不恢复旧 Token。
- 目录 Worker 的受限 SQL 函数重新校验有效租约、组织授权修订、皮肤站修订、所属组织及地址。抓取期间撤销／重新授权、修改目录地址或归档的结果不应用。
- 未变化的定期发现不递增来源修订，避免每分钟使会话失效。超管通过原来源接口做出的手动配置／停用不会被组织自动同步覆盖。
- 目录租约、同源 Cookie 写入、RLS、DNS 固定、HTTPS、请求大小与超时限制继续保留。授权不修改包、发布或历史签名。

## 数据库与 API

迁移 `202611020002_organization_launcher_authorization` 新增 Organization.launcherLoginEnabled／launcherLoginRevision、PlatformSettings.autoAuthorizeNewOrganizations／unionAuthorizationRevision、LauncherAuthProvider.managedByOrganization，并允许自动来源 verifiedById 为 null。无新增业务表，仍为 34 张 FORCE RLS 表。迁移仅保留既有 enabled 来源对应组织的明确授权，其他现有组织保持未授权。

新增 `PATCH /api/admin/union-sync`：

```json
{"autoAuthorizeNewOrganizations":true,"revision":0}
```

返回同步状态及最新 authorizationRevision；仅超管会话、同源请求。组织设置沿用 `PATCH /api/admin/organizations/:id`：

```json
{"launcherLoginEnabled":true,"launcherLoginRevision":0}
```

后台 state 的组织 DTO 新增授权与修订，GET /api/admin/union-sync 新增默认授权与修订。完整规范 94／公开 11。由于组织权限新增门槛、后台 DTO 和来源核准人 nullable 的变化，OpenAPI 提升为 6.0.0，保留 5.2.0 及之前的基线。客户端应按返回 authApiRoot 使用来源；目录身份和勾选授权均不代替有效游戏凭据。
