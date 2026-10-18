# PostgreSQL RLS 实施与部署

2026-10-18：`202610180001_storage_telemetry` 新增两张强制 RLS 的遥测表，当前共 23 张业务表。Worker 采集写入，Web 仅超管面板只读，auth/public 无表权限；启动检查按生成模型数量核验全部表。下文 21 表为原首发记录。

2026-10-14 首发基线：开发期旧入口、旧请求与历史协议分支已清理；当前规则、数据处理及验证见 [首发清理](first-release-cleanup.md)。本说明优先于下文历史实施记录。


2026-10-12：已实现第二层行范围保护；应用层 RBAC、字段白名单、归档规则、不可变发布触发器、审计及现有事务锁继续生效。没有改变发布字节、签名或 OSS 对象。

## 连接与角色

| 用途 | 环境变量 | PostgreSQL 角色 | 权限边界 |
| --- | --- | --- | --- |
| 管理与自动化业务 | DATABASE_URL | mua_web | 事务身份与组织／服务器权限控制业务行 |
| 登录、退出 | DATABASE_AUTH_URL | mua_auth | 账号查询、凭据、会话、登录节流、登录审计 |
| 玩家分发 | DATABASE_PUBLIC_URL | mua_public | 公开目录与分发事实函数；无业务原表读取权限 |
| 上传、组包、回收 | DATABASE_WORKER_URL | mua_worker | 跨组织任务读取，任务／CAS／回收写入；不能发布、授权或删除客户端 |
| 迁移、初始化 | DATABASE_MIGRATION_URL | mua_migrator | 显式 SET ROLE mua_owner；不用于服务进程 |
| 表及受限写函数所有者 | 无登录连接 | mua_owner | NOLOGIN，迁移管理员可切换 |
| 授权查询与完整性检查 | 无登录连接 | mua_lookup | NOLOGIN，独立读策略避免递归；锁行授权不能实际改写行 |

所有角色均 NOSUPERUSER、NOBYPASSRLS。21 张业务表启用 ENABLE 与 FORCE ROW LEVEL SECURITY；`_prisma_migrations` 属于部署元数据。运行角色不拥有表，不属于 owner／lookup，也没有建表、角色管理或数据库创建权限。lookup 的 CREATE 权限用于迁移时接收函数所有权；仅可信迁移所有者可切换到它。

启动时检查登录身份 session_user 与执行身份 current_user 均为指定受限角色、成员关系、DDL 权限、表所有者、完整 RLS 开关、策略覆盖、授权函数所有者和固定 search_path，以及数据库角色映射与 `src/lib/roles.ts` 一致性。不符合条件时拒绝启动；不接受 postgres 登录后 SET ROLE 冒充运行身份，也没有高权限连接回退。`npm run db:check` 检查四种运行连接。

## 身份与范围

通过 Cookie 或 Bearer token 的数据库查询验证有效期、撤销状态和活动账号，再在同一 Prisma interactive transaction 中使用 `set_config(..., true)` 设置 account_id、auth_kind、api_token_id。Cookie 请求明确清空 token ID；提交、回滚及连接池复用不会保留身份。没有上下文时不能访问管理业务数据。

数据库实时读取成员、单服授权及 Token。Token 权限为持有者实际权限与 Token capabilities／serverIds 的交集，包括 MUA 超管 Token；空 serverIds 沿用既有“不进一步限定服务器”契约。超管面板身份可以管理全部业务范围；它仍是 `mua_web`，不是数据库超级用户。Settings、账号管理、全局审计只对面板超管开放，普通账号只能通过投影读取上传格式、大小及组包运行环境类型。

客户端沿用当前绑定服务器；解绑后沿用固定 scopeServerId；没有服务器范围时使用组织权限。requestedServerId 仅代表待绑定意向，不授予权限。归档不撤销有权限的后台历史读取，已删除客户端隐藏。不可变发布及已有删除／绑定／活动租约触发器仍保留。

这一层主要防护应用查询遗漏范围过滤。事务身份由可信后端设置，持有数据库凭据并能任意执行 SQL 的攻击者可以伪造 GUC；本实现不声称抵御服务器失陷或数据库凭据泄露。RLS 也不替代动作、字段及业务状态检查。[PostgreSQL 官方说明](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)指出超级用户、BYPASSRLS 及整表操作的边界。

## 公开读取与特殊写入

公开角色只能执行 `authz.public_servers()` 与 `authz.public_snapshot(serverId,releaseId)`，角色权限映射是非业务静态元数据。分发快照仅包含当前有效上架绑定、同客户端可下载的目标发布、必要的增量基准及 READY 产物信息，不包含凭据、成员、完整草稿或审计。现有解析器继续校验 OSS 大小、摘要、基准、平台和签名契约；链接仍为五分钟签名、支持固定 releaseId 刷新。

RELEASE_READ 使用独立投影取得已发布版本的组包摘要与下载信息，不因此开放原始草稿读取。凭据创建、乐观校验的密码更改、会话撤销、客户端删除标记及归档时解绑下架，通过带范围检查的受限函数完成；完整性触发器以 lookup 查看关联记录并锁行，不受调用者不可见关联行影响。

SECURITY DEFINER 函数均使用固定 `pg_catalog, data_schema, authz, pg_temp` 搜索路径、限定表名，撤销 PUBLIC EXECUTE，再按用途授予执行权限。管理函数与公开函数分别检查各自边界。

## 部署顺序

1. 停止新写入并等待或安全停止本项目 Web／Worker。备份数据库、原环境配置和现有角色授权；保留 OSS／Docker volumes。对全新数据库可直接执行下列步骤。
2. 临时提供 DATABASE_ADMIN_URL，执行 `npm run db:provision -- --write-env`。已有数据库先审查当前权限并追加 `--adopt` 将当前 schema 的表、枚举、序列和触发函数交给 mua_owner。脚本不打印密码；本地环境文件备份位于被 Git 忽略的 `.local`。生产用秘密管理器保存连接，不使用 --write-env。
3. 使用 DATABASE_MIGRATION_URL 执行 `npm run db:deploy`。迁移 `202610120002_row_security` 原子安装授权 schema、函数、策略和 GRANT；角色创建独立于 Prisma migration。
4. 执行 `npm run db:check`、`npm run test:rls`、类型检查、构建与回归。实际受限账号的验证不能由 owner／postgres 查询代替。
5. 以新配置重启 Web 和 Worker。Web 部署仅保留 web/auth/public 连接；Worker 部署仅保留 worker 连接、所需存储／签名配置；迁移、管理员连接不进入运行环境。验证登录、管理、公开下载及真实 Worker 心跳。

首次部署前确认应用专用数据库中没有旧运行角色、PUBLIC 表权限或其他角色授予绕过保护的成员关系。角色脚本是显式配置工具，不会撤销未识别的外部账号权限。不要在不审查的情况下用于共享业务数据库。

## 验证与恢复

`tests/rls.test.ts` 使用随机 schema、实际 web/auth/public/worker 账号，测试无上下文拒绝、跨组织、单服、解绑与待绑定、角色差异、超管 Token 交集、权限撤销、凭据隔离、连接池提交／回滚／并发，以及公开和 Worker 最小权限。上传回归中的 Worker 使用独立账号；HTTP 回归使用真实受限 Web 与公开连接。

性能样本交替执行同一管理状态查询的 owner 基线与受限连接，预热 10 次后记录 100 次 p95；设置 MUA_RLS_PERF_GATE=1 时启用 20% 自动门槛。此开发小规模数据结果用于发现回归，不代替生产数据量、并发和网络环境压测；生产发布仍应按批准的 p95 增幅 20% 门槛复测。

本次验收：202 项不同测试通过（核心 20、受限 RLS 9、上传／Worker 40、完整 HTTP／Actions 1、协议／环境／下载／探测 107、图片 HTTP 4、格式组件 6、管理组件 15）；两项依赖外部真实包样本的测试未运行。TypeScript、ESLint、生产构建、数据库模型、四种受限连接与本地 3001 HTTP 检查通过。早期 35 次短样本出现过 33.3% 波动，因此减少逐行重复账号查询，并把样本扩为 100 次。最终开启 20% 门槛的管理状态 p95：owner 20.34ms、受限连接 16.91ms，门槛通过；该小样本不表示生产环境会更快。未进行生产数据库部署或生产规模压测。

故障时先停服务，保留受限身份，不临时改回 postgres 或关闭 FORCE RLS。优先修复连接／迁移或部署兼容修复。需要完整回退时，把部署前备份恢复到隔离数据库，核验迁移版本、账号、绑定、发布历史和 CAS 引用后，使用与备份匹配的应用版本和部署配置切换；保留当前数据库便于排查。新写入后不可直接覆盖恢复旧备份。Prisma 没有自动 down migration，本变更不提供一键删除策略的降级脚本。
