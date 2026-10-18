# 存储遥测

2026-10-18：主页「CDN 与存储流量」与 `/admin/system/storage` 已接入后台采集的存储数据。仅 MUA 超管 Cookie 会话可读，不随组织筛选变化；普通账号隐藏该卡片。CDN 保持待接入，不改变现有签名 URL、私有桶、发布字节及下载路径。

## 数据来源与边界

| 存储供应商 | 容量及对象数量 | 流量 |
| --- | --- | --- |
| 当前 MinIO | 优先使用 `/minio/v2/metrics/bucket` 的后台扫描统计，缺失时列举当前对象 | 桶级累计字节计数器，结合 `/minio/v2/metrics/node` 的进程启动时间计算增量 |
| AWS／通用 S3／阿里 OSS／腾讯 COS／华为 OBS | 通过统一 `ObjectStorage.listObjects` 分页累计对象大小 | 本版尚未实现各云监控适配，明确显示不可用，不伪造零值 |

没有配置额外的 Prometheus 服务也可以使用当前 MinIO 采集；本版将采样结果保存在 PostgreSQL。MinIO 使用 v2 指标，其他版本必须实际验证指标名称、标签和权限，不假定兼容。默认按 MinIO 原生方式，用现有凭据生成仅在进程内使用、五分钟有效的指标 JWT；可单独提供只读指标 token。指标访问不跟随重定向、不关闭 TLS 校验、不经过整合包下载代理。

MinIO 的容量是供应商后台扫描结果，不保证实时。多节点重复报告的桶容量取最大值而非重复相加；同一桶用于多种用途时只累计一次。容量数据时间由扫描年龄估算；无法取得年龄时明确不提供时间。对象列举为扫描期间的当前对象大小合计，不含历史版本、未完成分片或计费附加量，也不是原子快照。扫描中途失败不会把部分结果当完整容量；已有成功结果保留并标记失败。

流量包含 Worker、后台及其他访问配置桶的请求，不代表玩家完成下载数，也不是账单。首次采集只建立基线；缺失系列、节点变化、无法确认进程启动时间、进程重启及计数下降的区间不计算增量。零增量仅来自已存在且稳定的计数器；不存在的指标保持 null。

「今日已采集」按 Asia/Shanghai 当日零时取完整区间，显示采集起点，跨日区间不按比例估算。近 24 小时趋势按采集结束小时归集整个已观测区间，不估算区间内速率，不补零、不连接缺失点；因此图表与今日累计的跨日边界口径可能有差异。缺口通过 `hasGaps` 标记；缺少桶或方向的指标时只能看到已观测下界，不能视作全平台完整流量。

## 采集与部署

Web／Worker 继续使用相同的 `OSS_PROVIDER`、区域、Endpoint 和三个桶配置。原 `S3_*` 回退规则保持。新增可选变量：

```dotenv
OSS_TELEMETRY_ENABLED=true
# 仅 MinIO；默认使用现有存储 Endpoint，须为不含路径及凭据的 HTTP(S) origin。
# OSS_METRICS_ENDPOINT=http://127.0.0.1:9000
# 可选，服务端只读指标 token；不发送到浏览器。
# OSS_METRICS_BEARER_TOKEN=
```

先运行 `npm run db:deploy` 和 `npm run db:generate`，再重启 Web／Worker。迁移 `202610180001_storage_telemetry` 追加两张表，不改动首发迁移；当前 23 张业务表均需 FORCE RLS。Worker 自动启动采集，独立于上传和组包循环。MinIO 每分钟采集；通用对象列举每十五分钟采集；指标故障降级为十五分钟重试，避免每分钟全桶扫描。

也可独立运行：

```powershell
npm run storage:telemetry
npm run storage:telemetry -- --watch
```

后台租约由数据库原子领取，多 Worker／独立采集器共存时只执行一次。网络请求不占用数据库事务；失败不阻塞上传队列。流量区间保留 90 天。数据源按供应商、Endpoint、区域及实际桶集合区分，轮换凭据不会重置身份，切换存储不会把旧源数据并入新源。

新增表只允许 `mua_worker` 采集写入；`mua_web` 通过超管面板 RLS 只读，认证及公开角色无权限。监控凭据始终留在服务端。采集、列表及数据库错误仅向页面返回固定状态，不返回原始错误中的地址或凭据。

## HTTP 与验证

`GET /api/admin/storage-telemetry` 只读取数据库，不现场访问存储。返回容量快照、三个桶、今日已采集流量、24 小时序列及状态；字节和对象数量为十进制字符串，未测得为 null，响应 `no-store`。CDN 固定为 `NOT_CONNECTED`。

OpenAPI 1.1.0 新增一个后台 GET，共 64 操作；公开仍为四个 Launcher GET。沿用 1.0.0 兼容性基线，已有接口不变。

验证包括计数器重置、节点变化、分页失败、源身份、跨日累计、实际受限角色 RLS、并发租约及真实 MinIO 采集。使用已有对象的 Range GET 核对真实下行增量，不写入业务对象。其他云厂商容量大小映射由原生 SDK 本地 fixture 验证；真实云监控流量尚未实现，真实云桶及大规模列举仍需部署验证。

参考：[MinIO 指标及认证](https://github.com/minio/minio/blob/master/docs/metrics/prometheus/README.md)、[MinIO 指标定义](https://github.com/minio/minio/blob/master/docs/metrics/prometheus/list.md)。
