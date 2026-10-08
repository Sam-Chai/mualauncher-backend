<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## MUA Launcher 项目约定

- 产品需求和启动器代码观察记录见 [docs/mua-backend-requirements.md](docs/mua-backend-requirements.md)。后续设计或实现前先阅读该文档，区分确定需求、设计建议和待确定事项。
- 最小数据库模型与权限矩阵提案见 [docs/minimal-data-model.md](docs/minimal-data-model.md) 和 [docs/permission-matrix.md](docs/permission-matrix.md)；字段及默认权限仍是设计提案，按用户反馈更新后再落实到代码或迁移。
- 当前阶段（2026-10-08）：仅记录需求、查看代码，不实现面板、API、Worker、数据库业务模型、迁移或 OSS 部署。后续用户明确要求实现时，再按其授权范围推进。
- 启动器源码位于 `G:\Projects\Minecraft\BotWMCS\launcher-template-26.1`。它是基于 Fabric 的 Minecraft 客户端；后端对外提供 REST API，不能把现有占位界面视为已完成后端接入。
- 联合服以既有的 3–5 位纯英文字母 MUA server ID 作为底层标识；展示名称采用别名。不要另造 server ID 体系，大小写规范仍待确定。
- 用户已要求增加 Organization：内部 ID、别名、头像、简介，以及 members、servers、clients。组织管理员统一管理本组织全部服务器和专用客户端，包括正式服、测试服及后续新增资源；普通成员可按单服务器细分授权，不能越权到其他组织。
- 用户最新决定保留组织层并采用一服一客户端：Server 与 Client 一对一，客户端有多个草稿和历史发布，每服最多一个当前发布。发布版本不能被其他服务器选用，包含同组织其他服务器。不要实现跨服务器或跨组织版本共享。
- 账号采用白名单，权限按组织范围或单服务器范围及操作划分；MUA 超管可管理全部组织、服务器、发布、展示排序和颜色。
- 用户已确定先实现应用层 RBAC，后续再增加 PostgreSQL RLS 作为第二层保护。最小模型提案使用组织/服务器范围的预置角色及统一角色—权限映射；RLS 尚未实现，不得依赖它省略当前服务端范围校验。MUA 超管角色不等于数据库超级用户。
- 用户已确认支持独立 MUA 审核角色，模型提案可按组织或单服务器授权审核；审核、发布、切换权限分开，默认审核员只审核，额外能力需显式授予。
- 用户已确认删除采用归档制度，保留组织、服务器、客户端、草稿、发布和历史；账号和成员用停用，授权撤销保留记录，面板不提供永久删除。归档不触发 OSS/CAS 对象删除，恢复不自动重新分发。
- 已发布版本不可原地修改，内容变更必须创建新版本；CAS 可复用相同文件字节，但不因此共用发布记录或修改一服一客户端关系。
- 上传整合包由 Worker 归一化，按文件计算 SHA-256 并进入 CAS，生成 Release Manifest，经过 MUA 审核、签名和发布后供 Launcher 增量安装。
- 文件策略：`managed` 在缺失或哈希不一致时安装目标文件；`preserve` 只在不存在时创建，存在时不覆盖。旧文件清理行为尚未确定，不要把 `preserve` 文件视为可自动删除的文件。
- 开发使用 MinIO；生产存储供应商、包扩展名（`.muac` / `.muapack`）、Manifest 协议及签名方案尚未定案，不能把文档中的建议当成已批准的接口契约。
