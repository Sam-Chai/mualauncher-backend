# Union Link API 接口清单

由 `npm run openapi:generate` 生成。以下为实际业务路径，catch-all 已展开；HEAD／OPTIONS 框架隐式方法不作为独立业务操作。

64 个业务操作均已纳入受保护的后台完整 OpenAPI；公开规范仅含 Launcher 的 4 个 GET。文档不授予业务权限。

Cookie 写操作要求同源 Origin；Bearer 仅适用于客户端标准 API，并继续检查实时 RBAC。Auth 登录／退出要求同源，改密还要求有效会话。

| 方法 | 路径 | 分组 | 认证 | OpenAPI | 实现目录 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/servers` | Launcher | public | 公开及后台规范 | `src/app/api/v1/servers` |
| GET | `/api/v1/servers/{serverId}/manifest` | Launcher | public | 公开及后台规范 | `src/app/api/v1/servers` |
| GET | `/api/v1/servers/{serverId}/packages` | Launcher | public | 公开及后台规范 | `src/app/api/v1/servers` |
| GET | `/api/v1/servers/{serverId}/releases/{releaseId}/packages` | Launcher | public | 公开及后台规范 | `src/app/api/v1/servers` |
| GET | `/api/v1/clients` | Clients | session OR bearer | 仅后台规范 | `src/app/api/v1/clients` |
| POST | `/api/v1/clients` | Clients | session OR bearer | 仅后台规范 | `src/app/api/v1/clients` |
| GET | `/api/v1/clients/{clientId}` | Clients | session OR bearer | 仅后台规范 | `src/app/api/v1/clients` |
| POST | `/api/v1/clients/{clientId}/bind` | Clients | session OR bearer | 仅后台规范 | `src/app/api/v1/clients` |
| POST | `/api/v1/clients/{clientId}/unbind` | Clients | session OR bearer | 仅后台规范 | `src/app/api/v1/clients` |
| POST | `/api/v1/clients/{clientId}/archive` | Clients | session OR bearer | 仅后台规范 | `src/app/api/v1/clients` |
| POST | `/api/v1/clients/{clientId}/delete` | Clients | session OR bearer | 仅后台规范 | `src/app/api/v1/clients` |
| POST | `/api/v1/clients/uploads` | Clients | session OR bearer | 仅后台规范 | `src/app/api/v1/clients` |
| GET | `/api/v1/clients/uploads/{uploadId}` | Clients | session OR bearer | 仅后台规范 | `src/app/api/v1/clients` |
| GET | `/api/v1/clients/uploads/{uploadId}/distribution-statistics` | Clients | session OR bearer | 仅后台规范 | `src/app/api/v1/clients` |
| GET | `/api/v1/clients/{clientId}/drafts/{draftId}/distribution-statistics` | Clients | session OR bearer | 仅后台规范 | `src/app/api/v1/clients` |
| GET | `/api/v1/clients/{clientId}/releases/{releaseId}/distribution-statistics` | Clients | session OR bearer | 仅后台规范 | `src/app/api/v1/clients` |
| POST | `/api/v1/clients/uploads/{uploadId}/parts` | Clients | session OR bearer | 仅后台规范 | `src/app/api/v1/clients` |
| POST | `/api/v1/clients/uploads/{uploadId}/complete` | Clients | session OR bearer | 仅后台规范 | `src/app/api/v1/clients` |
| POST | `/api/v1/clients/uploads/{uploadId}/submit` | Clients | session OR bearer | 仅后台规范 | `src/app/api/v1/clients` |
| POST | `/api/v1/clients/uploads/{uploadId}/retry` | Clients | session OR bearer | 仅后台规范 | `src/app/api/v1/clients` |
| POST | `/api/v1/clients/uploads/{uploadId}/cancel` | Clients | session OR bearer | 仅后台规范 | `src/app/api/v1/clients` |
| POST | `/api/v1/clients/uploads/{uploadId}/select-instance` | Clients | session OR bearer | 仅后台规范 | `src/app/api/v1/clients` |
| GET | `/api/v1/clients/{clientId}/drafts/{draftId}/manifest` | Clients | session OR bearer | 仅后台规范 | `src/app/api/v1/clients` |
| GET | `/api/v1/clients/{clientId}/drafts/{draftId}/platform-manifest` | Clients | session OR bearer | 仅后台规范 | `src/app/api/v1/clients` |
| GET | `/api/v1/clients/{clientId}/drafts/{draftId}/package` | Clients | session OR bearer | 仅后台规范 | `src/app/api/v1/clients` |
| POST | `/api/v1/clients/{clientId}/drafts/{draftId}/archive` | Clients | session OR bearer | 仅后台规范 | `src/app/api/v1/clients` |
| POST | `/api/v1/clients/{clientId}/drafts/{draftId}/platforms` | Clients | session OR bearer | 仅后台规范 | `src/app/api/v1/clients` |
| POST | `/api/v1/clients/{clientId}/drafts/{draftId}/retry-packages` | Clients | session OR bearer | 仅后台规范 | `src/app/api/v1/clients` |
| POST | `/api/v1/clients/{clientId}/drafts/{draftId}/review` | Clients | session OR bearer | 仅后台规范 | `src/app/api/v1/clients` |
| POST | `/api/v1/clients/{clientId}/drafts/{draftId}/publish` | Clients | session OR bearer | 仅后台规范 | `src/app/api/v1/clients` |
| GET | `/api/v1/clients/{clientId}/releases/{releaseId}/package` | Clients | session OR bearer | 仅后台规范 | `src/app/api/v1/clients` |
| POST | `/api/v1/clients/{clientId}/releases/{releaseId}/activate` | Clients | session OR bearer | 仅后台规范 | `src/app/api/v1/clients` |
| GET | `/api/admin/state` | Admin | session | 仅后台规范 | `src/app/api/admin` |
| GET | `/api/admin/pipeline` | Admin | session | 仅后台规范 | `src/app/api/admin` |
| GET | `/api/admin/storage-telemetry` | Admin | session | 仅后台规范 | `src/app/api/admin` |
| GET | `/api/admin/tokens` | Admin | session | 仅后台规范 | `src/app/api/admin` |
| GET | `/api/admin/recycle-settings` | Admin | session | 仅后台规范 | `src/app/api/admin` |
| GET | `/api/admin/download-settings` | Admin | session | 仅后台规范 | `src/app/api/admin` |
| GET | `/api/admin/package-format-settings` | Admin | session | 仅后台规范 | `src/app/api/admin` |
| GET | `/api/admin/upload-size-settings` | Admin | session | 仅后台规范 | `src/app/api/admin` |
| GET | `/api/admin/organizations/{organizationId}/account-search` | Admin | session | 仅后台规范 | `src/app/api/admin` |
| POST | `/api/admin/tokens` | Admin | session | 仅后台规范 | `src/app/api/admin` |
| POST | `/api/admin/tokens/{tokenId}/revoke` | Admin | session | 仅后台规范 | `src/app/api/admin` |
| POST | `/api/admin/organizations` | Admin | session | 仅后台规范 | `src/app/api/admin` |
| POST | `/api/admin/servers` | Admin | session | 仅后台规范 | `src/app/api/admin` |
| POST | `/api/admin/accounts` | Admin | session | 仅后台规范 | `src/app/api/admin` |
| PATCH | `/api/admin/organizations/{organizationId}` | Admin | session | 仅后台规范 | `src/app/api/admin` |
| PATCH | `/api/admin/servers/{serverId}` | Admin | session | 仅后台规范 | `src/app/api/admin` |
| PATCH | `/api/admin/accounts/{accountId}` | Admin | session | 仅后台规范 | `src/app/api/admin` |
| POST | `/api/admin/organizations/{organizationId}/archive` | Admin | session | 仅后台规范 | `src/app/api/admin` |
| POST | `/api/admin/servers/{serverId}/archive` | Admin | session | 仅后台规范 | `src/app/api/admin` |
| PUT | `/api/admin/organizations/{organizationId}/members/{accountId}` | Admin | session | 仅后台规范 | `src/app/api/admin` |
| PUT | `/api/admin/organizations/{organizationId}/members/{accountId}/servers/{serverId}` | Admin | session | 仅后台规范 | `src/app/api/admin` |
| PATCH | `/api/admin/recycle-settings` | Admin | session | 仅后台规范 | `src/app/api/admin` |
| PATCH | `/api/admin/download-settings` | Admin | session | 仅后台规范 | `src/app/api/admin` |
| PATCH | `/api/admin/package-format-settings` | Admin | session | 仅后台规范 | `src/app/api/admin` |
| PATCH | `/api/admin/upload-size-settings` | Admin | session | 仅后台规范 | `src/app/api/admin` |
| GET | `/api/admin/servers/{serverId}/probe` | Admin | session | 仅后台规范 | `src/app/api/admin` |
| GET | `/api/admin/servers/{serverId}/motto-image` | Admin | session | 仅后台规范 | `src/app/api/admin` |
| POST | `/api/admin/servers/{serverId}/motto-image` | Admin | session | 仅后台规范 | `src/app/api/admin` |
| DELETE | `/api/admin/servers/{serverId}/motto-image` | Admin | session | 仅后台规范 | `src/app/api/admin` |
| POST | `/api/auth/login` | Auth | same-origin | 仅后台规范 | `src/app/api/auth/[action]/route.ts` |
| POST | `/api/auth/logout` | Auth | same-origin | 仅后台规范 | `src/app/api/auth/[action]/route.ts` |
| POST | `/api/auth/password` | Auth | session + same-origin | 仅后台规范 | `src/app/api/auth/[action]/route.ts` |

合计 64 个业务操作，均已描述。客户端身份统一为 UUID；上传与生命周期操作仅提供独立客户端标准 API。

文档基础设施：`GET /openapi.json?locale=zh-CN|en-US` 为公开 Launcher 规范；`GET /api/admin/openapi?locale=zh-CN|en-US` 逐请求检查后台 Cookie 会话并返回完整规范。`/admin/api` 内嵌 Scalar 默认完整规范，可切换公开规范。内部契约不得加入公开输出。

JSON 请求、异步 S3 分片上传、图片 multipart/form-data 与二进制响应必须分别建模。源包上传完成、导入 READY、审核批准、组包 READY 和发布是不同状态。协议、签名与资源生命周期约束详见既有专题文档。
