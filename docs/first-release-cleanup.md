# Union Link 首发基线清理

2026-10-14：首个正式版本发布前，移除开发期间的兼容分支；API 文档版本统一为 1.0.0。完整规范 63 个操作，公开 Launcher 规范 4 个 GET。

## 当前契约

- 客户端 ID 必须为 UUID；服务器 ID 仍为既有的 3–5 位英文字母 MUA ID。
- 创建上传与 Actions metadata.json 必填数字 `packageFormatVersion: 1 | 2`，格式创建后锁定。
- 读取公开 Manifest、发现／刷新下载时必填 `acceptedFormatVersions`，允许 `1`、`2`、`1,2`、`2,1`；目录返回的链接已经携带当前发布格式。
- 提交上传不接受 `mods`、`modDetails`，模组信息由 Worker 产生。MC／Java 允许省略后使用识别结果。v1 的 platforms 可省略并采用五平台默认值；v2 不接受 platforms。
- 审核及发布必须提交当前 `contentRevision`、`packageRevision`。发布可选 `replacesDraftId`，归档／替代链和幂等语义保留。
- v1 的客户端清单只接受 `mua-client-manifest schemaVersion:2`；`.muapack formatVersion:1` 完整环境包继续提供。
- v2 只接受平台无关 `protocolRevision:2`；清单、数据库和响应均移除 supportedPlatforms，包差异不含 platformsChanged。universal 仍是内部组包任务标识。
- 更新产物必须保存 baseManifestSha256；Java 平台／环境清单及缓存必须保存 imageType。原始签名字节、校验和与发布身份仍受保护。
- 元数据缺失或无效时界面明确提示，不生成 Java 21 等默认展示事实。
- 服务器资料 API 不接受 iconObjectKey 写入；图片经专用 motto-image 接口上传、重裁剪和移除。数据库及读取字段名暂保留。

## 已移除的入口

七个旧页面跳转、资讯／活动／Launcher UI 占位页和专用占位组件已删除。归档版本使用 `/admin/releases/archived`；客户端详情仍通过 `/admin/clients/:clientId` 提供。

以下后台操作不再提供：

| 方法 | 路径 |
| --- | --- |
| GET | /api/admin/servers/:serverId/clients |
| POST | /api/admin/servers/:serverId/drafts |
| PATCH | /api/admin/servers/:serverId/drafts/:draftId |
| POST | /api/admin/servers/:serverId/drafts/:draftId/archive |
| POST | /api/admin/clients/:clientId/archive |

公开 `/api/v1/servers/:serverId/files/:sha256` 已移除。Launcher 使用 muapack 完整包／更新包和固定 releaseId 下载刷新；内部 CAS、共享引用及回收保护保留。

## 数据库与开发数据

首发迁移只有 `202610140001_initial_release`，包含全部 21 张业务表、索引、检查约束、不可变／生命周期触发器、48 条角色权限映射、分离连接角色和 FORCE RLS。部署前仍需运行 `npm run db:provision`；随后 `npm run db:deploy`、`npm run db:generate`、`npm run db:check`。不要对已存在的旧库直接重放初始迁移。

本机旧开发库升级前，业务数据及授权定义已备份至 `.local/backups/union-link-precleanup-20261014.dump`，原迁移文件和记账记录保存在同目录。该备份不含 PostgreSQL 集群角色密码。通过检查后清理 9 个已删除且无服务器绑定的测试客户端及其草稿、发布、上传、组包和引用记录；保留账号、组织、服务器、图片、设置、审计及共享 CAS 对象。对象存储中的原有字节未重写或删除。

开发库已原地移除旧平台列和 WAITING_PROCESSOR 状态，增加客户端 UUID 检查，并将迁移记录对齐首发基线。新建独立 schema 和既有开发库分别验证，数据库备份为本机恢复依据。

## 保留范围

v1／v2 双格式、optional 缺省 false、下载设置 PATCH 保留未提交字段、旧图片重裁剪适配、Linux ARM 已选项取消行为、Prisma 热重载缓存保护、外部整合包适配、签名、幂等、RBAC／RLS、完整包回退和 CAS 引用保护均保留。

离线 v1／v2 示例和测试夹具统一到当前契约；v2 样例只保留一套平台无关完整／更新包。OpenAPI 校验、路由覆盖及兼容性检查工具继续保留，检查目标改为首发基线。

## 验证结果

- 222 项 Node 测试通过，涵盖新基线、RLS、上传、组包、审核发布、增量下载、回收及界面契约；2 项真实整合包测试因没有提供输入文件跳过。
- 完整上传测试集包含生产 HTTP／Actions 的 v1、v2 和增量发布，同一次执行 40 项通过、2 项跳过。
- Edge 浏览器完成侧栏入口、Scalar、双语、黑白主题、公开／完整规范切换、规范下载与退出验证。
- 实际 HTTP 检查确认已删除页面返回 404；客户端详情在进入流式页面前统一检查 UUID，旧文本路径不会成为有效客户端页面。
- 生产构建、TypeScript、ESLint、Prisma validate／迁移状态、四个运行角色 db:check、OpenAPI 63/63 路由覆盖／首发基线检查通过；v2 样例独立离线检查 55 项通过。
