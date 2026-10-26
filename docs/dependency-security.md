# 首发依赖安全整改

2026-10-25：处理当前锁文件的 npm audit 告警，并恢复 OpenAPI 源码、生成产物和兼容性检查。保留现有共享登录配额、认证权限、数据库结构及历史发布签名。

## 依赖变更

| 依赖 | 整改前 | 整改后 |
| --- | --- | --- |
| Zod | 3.25.76 | 4.6.7 |
| zod-to-openapi | 7.3.4 | 9.1.0 |
| Prisma CLI／Client／PostgreSQL adapter | 7.10.0 | 7.10.1 |
| Scalar React reference | 0.9.80 | 0.9.83 |
| Scalar OpenAPI parser | 0.29.13 | 0.29.16 |
| fast-uri，传递依赖 | 3.1.8 | 3.1.9 |

通过上游稳定版本更新，锁文件同时移除了受影响的 deepmerge-ts 7.1.5、mysql2 3.15.3、undici 7.29.1 和旧 AI SDK 工具依赖。原有华为 SDK 的 fast-xml-parser override 保留；没有使用强制自动修复、告警忽略清单或未经验证的跨版本 override。

整改前全部依赖有 35 个受影响包条目（14 高／19 中／2 低），生产依赖有 28 个（11 高／15 中／2 低）。整改后 `npm audit` 和 `npm audit --omit=dev` 均为 0。这些计数包含传递依赖传播，不等于同数量的独立漏洞。CI 在 npm ci 后增加全部依赖的 audit 门槛。

## 代码和契约兼容

- Zod 4 的 record 明确提供字符串键类型；细化后的对象直接使用 shape，表单 resolver 使用 Zod core 输入／输出类型。
- Zod 4 在实例创建时复制扩展方法。OpenAPI 注册边界克隆共享 schema，避免共享校验器早于 OpenAPI 扩展加载时发生 `openapi is not a function`；密码元数据使用原生 meta。
- 显式保留已发布的 JSON Schema 正则 source，避免生成器将 JavaScript 的 `/i` 标志错误拼到 pattern 尾部。运行时大小写处理不变。
- 新生成器移除了重复的 anyOf null 分支。兼容性检查只归一化 anyOf 中完全相同的分支；oneOf、真实 nullable 变化、字段、权限和认证变更仍会要求审查，新增回归覆盖这些区别。
- 重新生成源码摘要及中英文文档。OpenAPI 仍为 5.2.0、完整 93／公开 11，既有兼容性基线保留。
- 新增超长模组列表回归，确认 Zod 在集合超限时直接拒绝，避免为每个无效元素累积错误。

上游依据：[Zod 4 迁移](https://zod.dev/v4/changelog)、[集合大小检查修复](https://github.com/colinhacks/zod/pull/6652)、[undici 安全公告](https://github.com/nodejs/undici/security/advisories/GHSA-xjj6-f33q-929c)。

## 验证与边界

生产构建使用独立目录 `.next/security-release-candidate`，避免覆盖已有服务产物。数据库测试使用随机 schema 和临时 MinIO 桶，不将测试发布写入现有业务资源。修正租约回收测试：由 PostgreSQL 时间制造过期租约，避免 Windows 与数据库 VM 时差导致租约仍有效，并影响后续用例；未改变生产租约逻辑。

已完成类型、Lint、Prisma 受限连接检查、生产构建、OpenAPI 10 项、安全 16 项、执行／Forge 25 项、登录浏览器 8 项及 Scalar 浏览器 2 项验证。完整 `npm test` 已启用实际生产 HTTP 契约：各组累计 288 通过、5 失败、2 个外部真实样本跳过，脚本在 Union 专项失败后停止。失败集中在 Union／Launcher 会话签发；单独只读查询确认 Windows 时间领先 PostgreSQL VM 约 2–4 秒，按应用时间生成的最长会话期限会被数据库的最长有效期检查拒绝。测试进程临时时钟校准能通过相应签发用例，但产生其他时间相关差异，不能据此宣称全量回归通过。保留认证和数据库保护，待测试主机／数据库时钟同步后重跑；本次不修改系统时钟。

锁文件保留原有 `@emnapi/runtime` 1.11.3 可选 WASM 依赖记录，避免 Windows npm 更新时遗漏其他平台所需依赖；独立目录 npm ci dry-run 已通过。Windows 受限执行账号不能使用 SWC 的受保护原生缓存，构建与生产 HTTP 验证使用正常用户权限执行，未放宽缓存 ACL 或禁用校验。

审计只覆盖锁文件依赖，不证明整个服务没有漏洞，也不覆盖宿主 Node.js 内置 undici、Docker/runsc 或生产系统软件。本次没有升级宿主 Node、修改共享配额、应用数据库迁移、重启已有服务或部署到生产。部署时仍需使用已修补的 Node.js 运行时，并完成真实上游、云存储、目标机隔离和故障恢复验收。
