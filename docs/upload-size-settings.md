# muapack 上传大小设置

Settings（`/admin/system/settings`）增加“muapack 上传大小”，单位 MB，默认 **1024 MB（1 GB）**。1 MB 按 1024 × 1024 字节计算；允许整数 1–20480 MB，上界沿用现有 320 个 64 MB 分片与数据库 20 GB 的技术限制。

只有 MUA 超管面板会话可以管理；组织／服务器管理员、普通账号和 API Token 不能修改。更新写入 `PlatformSettings.maxUploadSizeMb`，记录 `UPLOAD_SIZE_SETTINGS_UPDATE` 审计，包含修改前后数值。数据库同样约束配置范围。

`GET /api/admin/upload-size-settings`、`PATCH /api/admin/upload-size-settings` 均仅限超管面板会话。PATCH 请求体为 `{ "maxUploadSizeMb": 1024 }`，仍检查会话和同源写入。所有后台账号可从 `/api/admin/state` 读取当前 `maxUploadSizeMb`，用于上传窗口显示上限，不因此获得配置权限。

限制作用于制作 muapack v1／v2 的完整源包上传（`.minecraft ZIP`、Modrinth mrpack、PCL 导出 ZIP）。网页选文件和开始上传时检查大小；共用的 `createUpload` 在创建 OSS multipart 前再次读取实时上限。标准 API、Actions、超管自己的上传都适用，超过配置返回 **413**，不创建上传任务或 OSS 分片会话；等于上限允许。超过绝对技术上限的请求参数仍返回 400。

修改配置只控制新建上传；已创建上传仍可获取分片链接、完成、重试、导入、审核和发布。调整不删除旧任务、不下架历史、不修改签名，也不限制 Worker 生成的最终 full／update muapack 体积。当前不新增直接导入 `.muapack` 的能力。

2026-10-23：新签发的每个 PUT URL 都把从上传记录计算的精确分片字节数纳入签名，非末片 64 MiB，末片也必须精确匹配。MinIO／AWS／S3 的 SigV4、阿里 OSS V4 additional headers、腾讯 COS 签名头都包含 Content-Length；华为 OBS 使用原生 SDK 显式 V4 签名方法，仅改变上传链接，不改变其他 OBS 操作。浏览器 Blob／脚本 Buffer 自动发送长度，不要求 JavaScript 设置受限请求头；不接受无长度的流式直传。完整合并时的分片数、大小和 ETag 校验继续保留。

返回字段、权限和有效期不变，现有任务按创建时已保存的 size 计算，降低 Settings 上限不影响其继续上传。部署前已签出的旧 URL 最长仍可用十分钟，不能通过代码升级追溯撤销；需要立即阻断时应取消对应 multipart。真实云端须运行 `npm run storage:verify`，其中新增超长和过短分片拒绝验证，并验收浏览器 CORS。SDK 签名及本地 HTTP fixture 通过不代表真实云已验收。

部署执行 `npm run db:deploy`、`npm run db:generate`，已有设置行迁移后默认 1024 MB，不改动其他设置和上传记录。
