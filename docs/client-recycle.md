# 客户端删除与 OSS 回收站

更新：2026-10-10。当前实现使用 PostgreSQL RBAC、私有 MinIO / S3 和独立 Worker。

## 条件与权限

客户端必须已归档下架、没有实际或待确认服务器绑定，无论是否曾生成 ClientRelease 都可以删除。处理中上传或组包须等待 Worker 完成或失败；未完成上传、等待上传任务和未提交结果在删除事务中取消。此规则替代此前“从未发布才能删除”的限制。

客户端当前状态为 UNPUBLISHED／PUBLISHED／ARCHIVED，归档优先；API 的 lifecycleStatus 返回该单一状态。archivedAt 是归档事实，currentReleaseId 和 ClientRelease 保留最近选择与发布历史，不表示归档客户端仍在线。归档清除绑定并下架服务器，公开列表不返回该资源，公开 Manifest／文件／muapack 请求返回 404；管理端归档历史仍可读取和下载。归档客户端的版本从待审核／已发布列表移入已归档页面，恢复不自动重新绑定或上架。

CLIENT_DELETE 默认授予 ORG_ADMIN、SERVER_ADMIN，仍按真实组织／单服范围以及 Token 权限校验；超管也遵守业务条件。只读、编辑、审核或发布角色不自动获得删除权限。

界面只对有权限且符合条件的行显示“删除”，确认后调用 `POST /api/v1/clients/{clientId}/delete`，请求 `{}`，返回 `{ "ok": true }`。每次写入重新认证，在统一管理事务中校验，数据库触发器禁止绕过条件。已删除记录的详情、上传、审核和发布接口均返回 404。

Client.deletedAt 为不可恢复的删除标记：客户端退出列表、释放名称，底层行、不可变发布／签名／版本记录与审计保留，不能恢复身份或继续发布。删除后管理下载也返回 404；删除不改写已签名内容。名称归一化保持 NFKC／忽略大小写；SQL 迁移中的 `Client_active_name_key` 部分唯一索引只约束未删除行，Prisma 保留普通查询索引。迁移 202610100002_archived_client_deletion 仅替换删除条件触发器，不修改既有记录。

## 存储与复用

原始 ZIP、上传索引、候选／发布 Manifest、平台目标清单与整包／更新包产物位于私有 packages bucket 的 `recycle/clients/{clientId}/{originalKey}`；CAS 位于原私有 CAS bucket 的 `recycle/cas/sha256/{prefix}/{sha256}`。全局 Minecraft／Java／加载器环境缓存独立保留。

CasObject 记录摘要、大小和回收／清理时间，CasReference 记录客户端引用，RecycleObject 跟踪原包／索引搬移。Worker 写 CAS 时记录引用，包括中途失败任务已完成的文件。旧清单先按保存的摘要校验并补全引用；历史索引未完成或损坏时暂停回收清理并记录错误。

仍被任一未删除客户端引用的 CAS 保留，包括归档客户端和已发布历史；已删除客户端的历史引用不再阻止回收。最后一个有效引用消失后复制到回收区，校验再删除原对象。ZIP 超过单次复制上限时使用 S3 multipart copy。上传／取回／回收／清理使用同一个按摘要划分的 PostgreSQL 事务级 advisory lock，防止并发误删。

新上传命中回收文件时流式校验大小及 SHA-256，取回正常 CAS，登记新引用，不计为新增 CAS 数据。校验失败时任务失败；清理后的文件再次上传会重新写入。复用文件不恢复旧客户端、发布记录或签名。

SQL 与 S3 无法组成一个事务，使用确定性回收键和可重试状态，并轮询删除记录核对晚到的 S3 完成结果。清理仅处理已追踪、已到期的回收对象，不扫描删除任意 OSS 文件或未知孤儿对象。

## 配置与调度

`/admin/system/settings` 的“OSS 回收站”仅超管可见。文件保留期 recycleRetentionDays 默认 7 天，可设 1–365 的整数，从实际进入回收站计时。缩短期限后，已到期文件在下一轮永久移除，修改写审计。

- `GET /api/admin/recycle-settings`：返回 `{ "recycleRetentionDays": 7 }`。
- `PATCH /api/admin/recycle-settings`：同形请求，仅启用超管的正常面板会话可用，检查来源。组织管理员和服务器范围 Token 不能改全局设置。

Worker 每分钟启动后台维护，分批补索引、回收及清理，上传队列继续运行。Worker 停止时文件等待处理。归档自身不移动文件；本功能不定义 Launcher 对 preserve 文件的删除行为。

依据：[S3 CopyObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_CopyObject.html)、[UploadPartCopy](https://docs.aws.amazon.com/AmazonS3/latest/API/API_UploadPartCopy.html)、[PostgreSQL advisory locks](https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS)。
