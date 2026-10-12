# muapack v1 合成示例

`full/` 表示 1.0.0 的整包，`update/` 表示 1.0.0 → 1.0.1 的更新包；平台为 windows-amd64。示例的文件摘要基于测试中合成的文本字节，不是实际 Minecraft、Java 或模组内容，不提供可运行客户端。

示例 JSON 采用协议确定编码；目标、基准和环境摘要可以直接校验。这里不保存私钥、生产签名或载荷对象，因此不能把此目录直接压缩后作为有效分发包。测试会另行生成临时 Ed25519 密钥、签名和实际 ZIP，验证完整包与更新包。

生成示例：

```powershell
node --conditions=react-server --import tsx scripts/generate-muapack-examples.ts
```

生成器只写此文档示例目录，不连接数据库／OSS，不下载或执行文件。测试读取这些 JSON 验证摘要、环境和差异，协议变动时必须同步生成。
