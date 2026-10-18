# 对象存储供应商配置

2026-10-18：统一对象列表已暴露大小，供后台容量采集使用；当前 MinIO 另接桶级流量计数。其他云监控流量和 CDN 尚未接入，详见 [存储遥测](storage-telemetry.md)。

Union Link 通过 `OSS_PROVIDER` 选择存储适配器。Web 和 Worker 必须使用相同配置，并在调整后重启。此设置选择一个存储后端，不自动迁移旧桶中的对象，也不改写发布签名。

| OSS_PROVIDER | 使用的 SDK | 默认地址方式 |
| --- | --- | --- |
| minio | @aws-sdk/client-s3、s3-request-presigner | 路径式 |
| aws | @aws-sdk/client-s3、s3-request-presigner | 桶域名式 |
| s3 | 同上，其他 S3 兼容服务 | 路径式，可配置 |
| ali | ali-oss | OSS 原生域名和 OSS V4 签名 |
| tencent | cos-nodejs-sdk-v5 | COS 原生域名和签名 |
| huawei | esdk-obs-nodejs | OBS 原生域名和签名 |

原生 SDK 是项目的 npm 依赖，正常 `npm install` 即可，无需另外安装服务器或 Nginx njs 插件。只有选定供应商的 SDK 会创建客户端。SDK 的 Node.js 依赖通过 Next.js `serverExternalPackages` 保留原生加载。

## 公共配置

新配置采用 `OSS_ENDPOINT`、`OSS_REGION`、`OSS_ACCESS_KEY_ID`、`OSS_SECRET_ACCESS_KEY`、`OSS_SESSION_TOKEN`，以及 `OSS_PACKAGES_BUCKET`、`OSS_CAS_BUCKET`、`OSS_ENVIRONMENTS_BUCKET`。

不填写 `OSS_PROVIDER` 时仍使用 MinIO。MinIO／AWS／通用 S3 的连接配置允许回退到同名 `S3_*` 旧变量，`OSS_*` 优先；三家原生适配器只读取 `OSS_*` 连接参数，避免误用旧 MinIO Endpoint。桶名称允许回退旧 `S3_*_BUCKET`。示例文件已经切换到新变量，现有 `.env` 不需要立即迁移。

`OSS_SESSION_TOKEN` 用于临时凭据，不会自动获取或续期。更换凭据或选择供应商后，应重新启动 Web／Worker。密钥不得进入浏览器，浏览器只获取有时限的签名链接。

`OSS_FORCE_PATH_STYLE` 仅用于 MinIO／AWS／通用 S3；三家原生适配器要求 false。`OSS_CUSTOM_DOMAIN` 仅用于阿里云／华为云，并要求 Endpoint 包含 `{bucket}`，分别解析为三个桶绑定的域名。腾讯云可在 `OSS_ENDPOINT` 中使用 `{bucket}` 域名模板；默认域名留空即可。域名模板所涉及的 DNS、绑定和 HTTPS 证书须分别配置。

## MinIO

```dotenv
OSS_PROVIDER=minio
OSS_ENDPOINT=http://127.0.0.1:9000
OSS_REGION=us-east-1
OSS_ACCESS_KEY_ID=minioadmin
OSS_SECRET_ACCESS_KEY=YOUR_MINIO_PASSWORD
OSS_PACKAGES_BUCKET=mua-packages
OSS_CAS_BUCKET=mua-cas
OSS_ENVIRONMENTS_BUCKET=mua-environments
```

## AWS S3

```dotenv
OSS_PROVIDER=aws
OSS_ENDPOINT=
OSS_REGION=ap-southeast-1
OSS_ACCESS_KEY_ID=YOUR_ACCESS_KEY
OSS_SECRET_ACCESS_KEY=YOUR_SECRET_KEY
OSS_PACKAGES_BUCKET=YOUR_GLOBALLY_UNIQUE_PACKAGES_BUCKET
OSS_CAS_BUCKET=YOUR_GLOBALLY_UNIQUE_CAS_BUCKET
OSS_ENVIRONMENTS_BUCKET=YOUR_GLOBALLY_UNIQUE_ENVIRONMENTS_BUCKET
```

留空 Endpoint 使用 SDK 的区域地址。默认 `OSS_FORCE_PATH_STYLE=false`。创建非 us-east-1 区域桶时附带区域约束。自定义 S3 兼容服务用 `OSS_PROVIDER=s3` 并明确配置 Endpoint；需要域名式请求时显式设置 `OSS_FORCE_PATH_STYLE=false`。

## 阿里云 OSS

```dotenv
OSS_PROVIDER=ali
OSS_ENDPOINT=https://oss-cn-hangzhou.aliyuncs.com
OSS_REGION=cn-hangzhou
OSS_ACCESS_KEY_ID=YOUR_RAM_ACCESS_KEY
OSS_SECRET_ACCESS_KEY=YOUR_RAM_SECRET
OSS_PACKAGES_BUCKET=YOUR_PACKAGES_BUCKET
OSS_CAS_BUCKET=YOUR_CAS_BUCKET
OSS_ENVIRONMENTS_BUCKET=YOUR_ENVIRONMENTS_BUCKET
```

这里使用原生 OSS Endpoint，不使用 `s3.oss-...` 地址。Region 也接受 `oss-cn-hangzhou`。中国内地新开通账号的默认外网域名可能受限制，需按 [阿里云当前访问规则](https://www.alibabacloud.com/help/zh/oss/developer-reference/use-aws-sdks-to-access-oss) 配置自定义域名：

```dotenv
OSS_CUSTOM_DOMAIN=true
OSS_ENDPOINT=https://{bucket}.storage.example.com
```

自定义域名模式应先在控制台创建桶并绑定域名，再运行验证；桶级创建操作可能不允许通过 CNAME 执行。

## 腾讯云 COS

```dotenv
OSS_PROVIDER=tencent
OSS_ENDPOINT=
OSS_REGION=ap-guangzhou
OSS_ACCESS_KEY_ID=YOUR_SECRET_ID
OSS_SECRET_ACCESS_KEY=YOUR_SECRET_KEY
OSS_PACKAGES_BUCKET=your-packages-1250000000
OSS_CAS_BUCKET=your-cas-1250000000
OSS_ENVIRONMENTS_BUCKET=your-environments-1250000000
```

桶名必须包含真实 APPID 后缀。使用默认 COS 域名时 Endpoint 留空；自定义域名示例 `https://{bucket}.storage.example.com`。新建桶不支持路径式访问，见 [COS 配置说明](https://intl.cloud.tencent.com/document/product/436/34688?lang=en)。

## 华为云 OBS

```dotenv
OSS_PROVIDER=huawei
OSS_ENDPOINT=https://obs.cn-north-4.myhuaweicloud.com
OSS_REGION=cn-north-4
OSS_ACCESS_KEY_ID=YOUR_AK
OSS_SECRET_ACCESS_KEY=YOUR_SK
OSS_PACKAGES_BUCKET=YOUR_PACKAGES_BUCKET
OSS_CAS_BUCKET=YOUR_CAS_BUCKET
OSS_ENVIRONMENTS_BUCKET=YOUR_ENVIRONMENTS_BUCKET
```

OBS 使用原生签名，要求 OBS 3.0 普通对象桶，禁止路径式访问；不适用于旧 OBS 2.0 桶或并行文件系统。部分 SDK 参数模型没有禁止覆盖或拷贝段源 ETag 条件；适配器使用原生 `createSignedUrlSync` 签发完整请求，按已签条件发送 HTTP。HTTPS 验证证书与主机名。SDK 的 XMLParser 依赖固定覆盖到 5.11.2，避免新增已知的 XMLBuilder 注入漏洞；真实 SDK XML 响应解析已有本地传输测试。

华为文档没有明确保证所有节点支持合并段禁止覆盖，且 [条件键支持存在区域差异](https://support.huaweicloud.com/perms-cfg-obs/obs_40_0041.html)。因此运行时能力检查是硬门槛：节点忽略禁止覆盖时，适配器拒绝正式 CAS／清单／包的不可变写入，不降级为可覆盖上传。配置支持的区域并通过 `storage:verify` 后才能部署。

## 权限、私有桶与浏览器 CORS

三个桶保持私有。IAM/RAM/CAM 最小权限应覆盖桶健康检查、版本控制读取、对象读写／删除／列举、分片初始化／上传／列举／完成／中止和服务端复制；阿里云健康检查使用 GetBucketInfo。`storage:init` 仅在确认 404 后尝试建桶，建桶需要额外权限。已预建桶不需要授予建桶权限。

回收复制按供应商上限切换到分片复制：阿里云采用保守的 1,000,000,000 字节单次上限，腾讯云／华为云采用 5,000,000,000 字节，S3／MinIO 保留 5 GiB。所有分片复制都固定源 ETag，保留 SHA-256 元数据。参考 [阿里云单次复制 1 GB 限制](https://help.aliyun.com/en/oss/developer-reference/copy-objects-13)。

阿里云、腾讯云、华为云的正式存储桶必须关闭且从未启用版本控制；启用或暂停版本控制会使厂商禁止覆盖头失效，适配器会阻止不可变写入。每次不可变写入重新读取版本控制状态。第一次不可变写入还会使用 `.union-link-storage-probes/<随机 ID>` 临时对象验证普通上传和分片完成均拒绝覆盖；成功后缓存该进程的能力结果，失败不缓存并清理探测资源。禁止在运行期间移除相关桶策略或改变此能力。

Endpoint 必须能被 Web、Worker、上传浏览器及 Launcher 访问。当前内部读取和公开签名共享 Endpoint；不要只配置服务器可达的内网域名。对象存储请求不经过后台整合包下载总代理设置。

浏览器上传需要允许站点 Origin 的 PUT，并暴露 `ETag`。网页下载／续传还应允许 GET、HEAD、Range、If-Match，暴露 ETag、Content-Range、Content-Length、Content-Disposition；预检 OPTIONS 由供应商 CORS 配置处理。Native Launcher 不受浏览器 CORS 限制。签名 URL 视为不透明值，不解析或替换其中厂商签名参数。

## 初始化与验证

```powershell
npm run storage:init
npm run storage:verify
npm run test:storage
```

`storage:init` 创建缺失的私有桶并保留既有签名密钥。`storage:verify` 使用三个已存在的配置桶，只写入 `.union-link-storage-verification/<随机 ID>` 临时对象，验证 SHA-256／元数据、禁止覆盖、浏览器式签名分片 PUT、分片完成、私有 GET、Range／If-Match、ETag 和服务端复制，并在结束时删除临时对象、取消未完成分片。它不会迁移业务数据、改变桶权限或签名。

本地 `test:storage` 使用真实厂商 SDK 和本地 HTTP fixture，验证原生请求／签名／编码／XML 解析以及拒绝不安全的存储服务；既有集成测试固定为本机 MinIO，使用随机桶，避免误清理生产云桶。本次未提供云账号，三家真实云连接、实际 CORS、大文件复制和区域能力须在部署时实测；不能把本地 fixture 测试当作云端验收。

切换已有生产数据时，需要另外迁移三个桶中的完整对象和元数据，保留原对象键和 SHA-256，确认 Web／Worker 指向同一后端后再切换。迁移不在本次配置功能的自动执行范围内。
