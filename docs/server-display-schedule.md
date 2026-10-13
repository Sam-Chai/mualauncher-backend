# 服务器展示时间

2026-10-12：服务器展示支持永久和区间两种模式。配置属于 Server，作用于该服务器当前绑定的客户端；与已有 sortOrder、themeColor 一同管理，不写入发布清单或签名。

## 后台

MUA 超管在 `/admin/servers` 编辑服务器：选择“永久展示”或“区间展示”，区间填写开始和结束时间，均按北京时间（Asia/Shanghai，UTC+08:00）。默认永久展示，既有记录不改变目录行为。只有超管面板会话可以修改展示配置，普通 SERVER_EDIT 仍只能修改服务器资料。

保留原有“标记上架”开关 `isListed`。要按区间展示，需启用该开关并具备有效发布、绑定及未归档资源。展示开始时自动进入目录，结束时自动从目录隐藏；查询时计算，无需 Worker 或定时写数据库。

客户端管理表格的状态下方，以及服务器管理的当前客户端状态下方，显示小字 `区间展示：开始时间-结束时间`。区间过期仍保留这条说明；客户端生命周期仍是已发布／未发布／已归档。中文和英文界面均支持。

## 管理 API

`PATCH /api/admin/servers/:serverId` 沿用 Cookie 面板会话、同源校验、SERVER_EDIT 范围校验、超管限制和 SERVER_EDIT 审计。

新增字段：

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| displayMode | PERMANENT / RANGE | 默认 PERMANENT |
| displayStartsAt | RFC 3339 时间字符串 / null | RANGE 必填，必须带 Z 或时区偏移 |
| displayEndsAt | RFC 3339 时间字符串 / null | RANGE 必填且严格晚于开始 |

例如：

```json
{
  "isListed": true,
  "displayMode": "RANGE",
  "displayStartsAt": "2026-10-20T08:00:00+08:00",
  "displayEndsAt": "2026-10-27T08:00:00+08:00"
}
```

允许 PATCH 单个时间字段，与已保存配置合并后整体校验。切换 `{"displayMode":"PERMANENT"}` 自动清空旧区间；永久模式显式传入非空时间拒绝。无效配置返回 400，越权返回 403。后台 state 的服务器对象返回上述三字段；客户端列表／详情新增 `displaySchedule` 对象，未绑定时为 null。

## 公开目录与下载

`GET /api/v1/servers` 沿用 `{ "servers": [...] }`，每项新增上述三字段。查询使用数据库当前时间：永久模式始终满足时间条件，区间模式要求 `displayStartsAt <= now < displayEndsAt`。所有原有上架、归档、删除、有效发布条件继续生效，排序仍为 sortOrder、serverId。响应保持 no-store，客户端下一次请求反映新状态。

展示区间只限制目录发现。它不会修改持久化 `isListed`、当前发布、绑定 revision 或客户端归档状态；不会停止已知服务器的 manifest、packages 及固定 releaseId 下载刷新。手动取消 `isListed` 或归档仍按既有规则停止公开分发。Launcher UI 布局和目录接入不在本次范围。

## 数据库与验证

迁移 `202610120005_server_display_schedule` 增加字段、有效区间 CHECK、超管展示配置触发器，并替换 RLS 的 public_servers 投影。public_snapshot 保持原有下载条件。必须使用独立 mua_migrator 执行迁移。

测试覆盖应用／数据库权限、无效和部分更新、开始包含／结束排除、区间前后目录过滤、到期下载快照继续可用、绑定与发布不变、手动下架、北京时间转换和中英文界面。

开发热更新：Next dev 的全局 Prisma 连接缓存按生成的模型和字段枚举校验。新增字段后自动替换旧模型客户端，普通热更新保留连接池，避免旧客户端遗漏展示字段并在保存时触发参数校验错误。
