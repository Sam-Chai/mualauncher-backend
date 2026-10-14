# muapack v2 离线样例

只提供 protocolRevision:2 的平台无关协议。base-full.muapack、target-full.muapack、update.muapack 及展开目录使用同一测试公钥，完整基准、目标、差异及本地载荷均可检查。所有 JAR 是合成文本，远程地址使用 .invalid，不是可运行游戏。

生成：`node --conditions=react-server --import tsx docs/examples/muapack-v2/fixtures.mjs --generate`。校验：同一命令改为 `--check`，执行 55 项独立离线检查，不访问网络或数据库。

inputs 保存合成 mrpack 输入；fixtures/remote 是远程声明的测试字节。verification-report.json 记录大小、摘要及检查结果。生产验证器另由 tests/muapack-v2.test.ts 交叉检查签名、清单和载荷。
