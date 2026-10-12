# 开放格式与更新默认值

2026-10-11 已接入。muapack 的分发格式与客户端版本号独立。

## 更新默认值

“更新”窗口优先选择该客户端**首次发布**使用的格式，首次发布由 publishedAt／id 的升序确定，包含已归档的发布历史。后续手动跨格式发布不改变这一默认值。没有发布历史时沿用最近草稿格式；没有历史格式时使用 v1。用户在实际上传前仍可手动改选。

添加新客户端且两种格式均开放时，仍需明确选择。只开放一种时自动选择该格式。首次格式已关闭时，同样选择唯一开放的格式。恢复上传始终保留该上传锁定的 packageFormatVersion。

## 超管设置

Settings → “开放的 muapack 格式”，默认 v1／v2 全选，至少开放一种。普通管理员不能修改，API Token 即使属于超管也不能修改。所有已认证后台账号的 state 中包含非敏感的 enabledPackageFormats，上传／更新按钮只显示开放选项，打开窗口时刷新设置。

```http
GET /api/admin/package-format-settings
PATCH /api/admin/package-format-settings
Content-Type: application/json

{"enabledPackageFormats":[1,2]}
```

接口要求超管面板会话，PATCH 同时检查请求来源。合法值为 [1]、[2]、[1,2]（保存时排序）；空数组、重复项、未知版本及字符串版本返回 400。变更写入审计。

设置控制**新上传创建**。标准 REST API、网页及 Actions 同样检查：请求关闭的格式返回 409，旧请求省略 packageFormatVersion 时仍按 v1，因此关闭 v1 后旧请求也会被拒绝，不悄悄改成 v2。写请求沿用应用层事务锁，设置保存与上传创建按顺序生效。

已创建上传仍可恢复、识别、提交、审核、组包和发布；关闭格式不取消任务、改写签名或下架历史。恢复已关闭格式的上传显示只读的锁定格式说明，不提供该格式的新上传按钮。玩家分发与固定发布下载刷新仍以发布可用性和 Launcher 能力协商为准。关闭格式后，历史客户端要制作新版本必须选择开放的格式；跨格式更新仍生成目标完整包。

数据库迁移 `202610110001_package_format_settings` 为 PlatformSettings 添加 enabledPackageFormats，既有设置默认开放两种，数据库 CHECK 同时拒绝非法配置。独立设置接口仅更新此字段，保留下载源、代理、Java 类型和回收站设置。
