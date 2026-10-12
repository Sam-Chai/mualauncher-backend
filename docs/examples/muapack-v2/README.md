# muapack v2 离线验收样例

对应 [v2 协议基线](../../muapack-v2.md)。`revision-2/` 包含当前平台无关修订 2 的完整／更新包、展开清单、独立测试公钥与报告；本目录原三个包保留为历史平台结构兼容样例，字节／签名不改写。JAR 均为合成文本，地址使用 .invalid，不是可运行游戏。

## 文件

| 文件 | 内容 |
| --- | --- |
| [inputs/base.mrpack](inputs/base.mrpack)、[inputs/target.mrpack](inputs/target.mrpack) | 1.0.0／1.1.0 原始 mrpack，包含远程索引、本地模组、配置和覆盖层 |
| [base-full.muapack](base-full.muapack) | 1.0.0 完整包：5 个本地文件、3 个远程声明 |
| [target-full.muapack](target-full.muapack) | 1.1.0 完整包：5 个本地文件、4 个远程声明 |
| [update.muapack](update.muapack) | 1.0.0 → 1.1.0 更新包：3 个本地载荷、完整目标远程声明 |
| base-full/、target-full/、update/ | 与三个 ZIP 对应的展开内容，方便阅读清单与签名 |
| [test-public-key.json](test-public-key.json) | 包外测试公钥；仅供离线工具验证这些样例 |
| fixtures/remote/ | 远程哈希对应的合成测试字节，不在生成的 muapack 中 |
| [verification-report.json](verification-report.json) | 检查结果、每个 ZIP 的实际大小与 SHA-256 |
| [fixtures.mjs](fixtures.mjs) | 独立生成／只读校验工具，复用既有确定 JSON 编码和路径规则 |

完整包与更新包使用同一目标清单摘要。更新包虽然少携带两个本地文件，但同时携带完整基准、目标和变化描述；本样例文件极小，因此更新 ZIP 比完整 ZIP 大。实际大小应由构建结果展示，不能假定更新包一定更小。

## 差异预期

| 变化 | 内容 |
| --- | --- |
| added = 2 | config/new.toml（本地）、mods/new.jar（远程 optional） |
| modified = 3 | config/game.toml、mods/local.jar（本地），mods/core.jar（远程） |
| removed = 1 | config/old.toml（managed） |
| policyChanged = 1 | mods/optional.jar 从 optional 改为 required，内容不变 |
| sourceChanged = 1 | mods/mirror.jar 下载源改变，内容不变 |
| runtimeChanged | Fabric 0.16.9 → 0.16.10；Java 要求仍为 Adoptium JRE 21 |
| launchChanged | 增加示例 JVM 参数 |
| platformsChanged | windows-amd64 → windows-amd64、linux-amd64 |

mods/override.jar 的本地 overrides 覆盖同路径远程声明，继承 optional=true；完整包包含本地字节，索引不再列出该远程来源。client-overrides/config/game.toml 覆盖 overrides/config/game.toml；server-overrides 和 client unsupported 的远程文件不进入最终客户端。options.txt 为 preserve。

更新包的实际 overrides 只有 config/new.toml、config/game.toml、mods/local.jar。远程新增／修改、optional 切换和下载源变化均记录在清单中，不把远程模组下载进包。

## 校验与重新生成

在仓库根目录，已安装现有项目依赖时运行：

```powershell
node --conditions=react-server --import tsx docs/examples/muapack-v2/fixtures.mjs --check
```

只读校验磁盘上的历史和 revision-2 六个 ZIP，预期 checksPassed=62，networkRequests=0，installedGames=0。新增修订／摘要／签名绑定、混合历史基准更新、未知修订／字段混用拒绝检查；根目录原 verification-report.json 为历史 52 项报告，新组合报告见 revision-2/verification-report.json。

```powershell
node --conditions=react-server --import tsx docs/examples/muapack-v2/fixtures.mjs --generate
```

重新生成会覆盖本目录中的样例与报告。每次使用新的临时 Ed25519 密钥；只保存公钥，私钥不落盘。因此 ZIP 签名和摘要会变化，需要将公钥、三个包和报告一起更新。该公钥不应添加到生产 Launcher 的信任列表。正常复核使用 --check，不必重新生成。

## 后续实现验收边界

当前工具检验容器、来源声明和协议关系；验证“完整包具备缺失本地文件的修复载荷”以及“preserve 策略没有丢失”，不执行真正的修复、删除、联网下载、环境安装或启动前命令。ZIP 检查器为离线小样例设置 16 MiB 单条目／64 MiB 总量的内存限制，不是生产流式校验器。

| 后续场景 | 必须达到的行为 |
| --- | --- |
| 本地未变化文件缺失／损坏 | 从同目标摘要的完整包补取；不可跳过校验 |
| 远程缺失／修改 | Launcher 下载并检查全部声明哈希与大小；v2 Worker 无二进制下载 |
| preserve 已存在／被目标移除 | 不覆盖、不自动删除；缺失时才创建目标初始内容 |
| optional 默认关闭／切换开启 | 清单保留；本地字节可从完整包取，远程由端侧按选择下载；关闭的 JAR 不放进 mods 扫描目录 |
| 更新基准不匹配／跨 v1-v2／新增平台首次安装 | 使用目标完整包；已校验缓存仍可复用 |
| URL 变化、内容不变 | 更新签名与声明；已有有效缓存不重复下载 |
| 环境变化／首次安装 | Launcher 解析、校验并保存本地环境锁；后续启动不跟随 latest 自动替换 |
| 断网、下载哈希错误、安装失败 | 保留上一安装状态，不能提前写入成功版本 |
| 后台归档、权限撤销 | 沿用现有 RBAC／分发规则，不因增加 v2 绕过 |
| v1 与旧签名 | 原路径与已签名字节继续有效；不把旧 Manifest schemaVersion 2 当成 muapack v2 |

这些运行行为仍需在后续 Worker／API／Launcher 阶段实现和实测，不由本次样例报告宣称完成。

新修订样例可单独重新生成，不覆盖历史包：

```powershell
node --conditions=react-server --import tsx docs/examples/muapack-v2/fixtures.mjs --generate-revision-2
```

该操作仅覆盖 revision-2/，生成临时测试私钥并只保存公钥。安装端应严格核对 protocolRevision:2，不认识修订时拒绝；不把取消发布名单解释为所有系统均可运行。
