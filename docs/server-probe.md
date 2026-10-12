# Minecraft 服务器连接探测

2026-10-12：服务器管理表格、服务器详情与总览目录显示真实连接状态灯。按数据库保存的 `gameAddress` 探测 Minecraft Java Edition 状态协议（1.7+）；未配置地址、正在探测、归档资源或探测服务自身失败显示灰色，不能当成目标服务器断线。

| 灯色 | 条件 | 悬停内容 |
| --- | --- | --- |
| 绿色 | 收到有效 Minecraft 状态，往返时延低于阈值 | 在线、延迟、测量方式、版本、在线人数和检查时间 |
| 黄色 | 确认为 Minecraft 服务器，往返时延达到阈值 | 高延迟、实际时延和阈值，其他在线信息 |
| 红色 | DNS／连接失败、超时，或没有有效 Minecraft 状态 | 对应原因；TCP 连接成功但状态无效会明确指出 |
| 灰色 | 未配置、正在探测、归档或探测服务自身错误 | 当前不能确认状态的原因 |

默认黄灯阈值 **300 ms（含）**，可通过 `SERVER_PROBE_HIGH_LATENCY_MS` 调整。延迟是后端主机到服务器的测量，不是玩家所在网络的延迟。配置状态（上架、归档、客户端发布）与网络灯色独立，探测不改变目录资格或已有客户端发布。

## 探测方式

已调研 [mcstatus.io API](https://mcstatus.io/docs)、[服务说明](https://mcstatus.io/about) 和 [mcsrvstat.us API](https://api.mcsrvstat.us/)。公共 API 有缓存，mcstatus.io 不暴露可用于此处黄灯判断的延迟；不能拿一次 HTTP API 请求耗时替代 Minecraft RTT。因此后台直接发送 Java 状态握手／状态查询及带随机 8 字节标识的 Ping，解析有效状态并校验 Pong 标识，协议实现参考 [PrismarineJS ping](https://github.com/PrismarineJS/node-minecraft-protocol/blob/master/src/ping.js)。

仅端口开放、返回 HTTP 或普通 JSON 都不足以亮绿灯。若已经获得有效 MC 状态但服务端不响应 Pong，则使用状态请求往返时延，并在提示中标记测量方式；不把等待 Pong 的超时时间当成延迟。状态查询被关闭的服务器不能通过该机制确认，红灯提示可能关闭状态查询。Bedrock、历史 1.6 及更旧 Java 协议暂未接入。

界面首次进入就探测，可见页面每 60 秒刷新，恢复前台时刷新，点击灯可手动刷新。后端相同地址缓存 30 秒、合并并发请求，最多同时执行 4 个网络探测；缓存最多 512 条，排队最多 64 条，等待最多 8 秒。一次 DNS／协议探测总计最多 6 秒，状态响应最多 1 MiB。关闭页面后不持续发起新探测，当前没有独立 Worker 在线状态持久化或历史监控曲线。

## 地址与权限

`GET /api/admin/servers/{serverId}/probe` 使用后台 Cookie 会话，每次检查 SERVER_READ 和组织／单服范围，只使用服务器记录中的地址；不接受调用者指定任意主机、端口或绕过缓存的参数。归档组织／服务器不执行网络请求。数据库读取事务结束后再探测，返回前重新校验会话、权限和地址／归档状态，避免权限撤销或编辑期间返回旧状态。

地址支持主机名、`主机名:端口`、公网 IPv4 和 `[IPv6]:端口`，端口默认 25565。未显式指定端口且为域名时按 `_minecraft._tcp` SRV 记录查找目标；显式端口不使用 SRV。解析结果仅允许公网地址，禁止本机、内网和保留网段，所有 DNS 答案都检查后固定 IP 连接，防止重解析进入内网。原始主机名仍用于 Minecraft 握手的虚拟主机路由。不会采用下载代理或把代理出口耗时当成本机游戏探测时延。

JSON 返回 `state`（ONLINE／HIGH_LATENCY／OFFLINE／UNKNOWN）、`serverId`、`address`、`checkedAt`、`latencyMs`、`latencyKind`（PONG／STATUS）、`highLatencyMs`、`message`、`version` 和 `playersOnline`。无实际测量时延的失败状态返回 `latencyMs=null`。接口不返回玩家名单、服务器图标或其他未请求内容，结果不写入签名清单，也不新增数据库迁移。

## 验证

`npm run test:server-probe` 验证真实测试 TCP 服务的状态／Pong、分片、HTTP／无效 JSON、无 Pong、拒绝连接、超时、SRV、公网 DNS 固定、阈值和缓存并发。`npm run test:admin-ui` 检查四种灯色、延迟／失败提示和未配置／归档状态。隔离图片 HTTP 集成测试同时验证探测接口身份、组织／单服范围、只使用保存地址、拒绝内网、归档和撤权。

本轮对文档中的公网示例 `demo.mcstatus.io` 实际收到有效 MC 状态及 Pong，测得 550 ms 并正确为黄色；此为当次后端视角的结果，不是永久在线保证。已登记 NPU 的地址为 `test`，当前 DNS 解析失败，应显示红灯。未修改该地址或业务发布。浏览器桥接仍不可用，悬停和点击的实际浏览器视觉／交互复验尚未完成。
