# Union Link
欢迎使用 Union Link。该系统可以分发支持版本管理的 .muapack 格式的整合包文件。

## 什么是 .muapack？

.muapack 是 MUA 高校联盟基于 .mrpack 研发的新型整合包格式，目的是给各个高校的各模组服服主上传分发使用。相较于 .mrpack，该格式支持多元化的版本管理以及增量更新系统。

该文档会详细说明 .muapack 的工作原理与启动器适配相关的逻辑。

## .muapack 技术手册

.muapack 有两个版本，分别是 V1 与 V2。

**.muapack V1：**该版本支持打包完整的模组、运行环境。在启动器进行安装 V1 版本时，无需进行联网。

**.muapack V2：**该版本继承了 .mrpack 的直链模组下载。在启动器进行安装 V2 版本时，需要进行联网下载对应的模组与运行环境。

***MUA 与 Union Link 体系推荐使用 V2 版本，因为该版本体积更小，占用带宽极少。对于有需要进行离线安装的组织，我们也提供限时的 V1 版本分发渠道。***

无论是 V1 还是 V2，两者都支持完整发布与增量发布。

**完整发布：**内部包含最新版本的完整内容，安装完整发布后可以直接运行客户端。

**增量发布：**内部只包含上一版本到最新版本的文件变化，安装增量发布时需要有上一版本的完整发布。

![image-20261013191805737](C:\Users\omgst\AppData\Roaming\Typora\typora-user-images\image-20261013191805737.png)

*关于 .muapack 的详细技术细节以及规范，详情请看* **MUA Package Specification**

### .muapack 的文件内容

与 .mrpack 一样，.muapack 也使用 ZIP64 来进行封装与储存。一个标准的 .muapack 的内容应该是这样的：

#### .muapack V1

v1 是带完整预安装文件与精确运行环境的单平台容器。包内内容以 SHA-256 对象存储；安装位置由目标平台清单决定，不由对象 ZIP 路径决定。

```
packv1-1.4.3-windows-amd64.muapack
├── mua-pack.json                           [协议识别]
├── metadata/target-manifest.json           [目标清单文件表单]
├── metadata/base-manifest.json             [完整清单文件表单 / 仅更新包包含该文件]
├── metadata/signature.json                 [密钥]
├── metadata/environments/<sha256>.json     [运行环境]
└── objects/sha256/<sha256>                 [原始文件字节]
```

#### .muapack V2

```
packv2-1.4.3.muapack
├── mua-pack.json                           [协议识别]
├── modrinth.index.json                     [Modrinth 源]
├── metadata/target-manifest.json           [目标清单文件表单]
├── metadata/base-manifest.json             [完整清单文件表单 / 仅更新包包含该文件]
├── metadata/signature.json                 [密钥]
└── overrides/<path>                        [本地文件]
```

有关于更多信息，如这些文件与表单的格式和内容，请看 **MUA Package Specification**

## 使用 Union Link 平台管理服务器与客户端

Union Link 支持两种方式分发整合包：

1. Union Link 后台
2. 接入整合包分发 API 的启动器（如 Union Link Launcher 等）

### Union Link 后台

![image-20261013160436811](G:\Projects\Minecraft\BotWMCS\mualauncher-backend\docs\images\image-20261013160436811.png)

Union Link 后台只允许相应的组织管理员进行访问。

要想分发整合包，请遵循以下几个步骤：

- **要是第一次分发整合包：**
  1. 寻找 Union Link 管理员申请将自己高校服务器接入 Union Link 体系
  2. 使用管理员提供的账号和密码登录到 Union Link 后台
  3. 在 `服务器管理` 页面新增自己高校的服务器
  4. 在 `客户端管理` 页面为服务器绑定整合包并上传
  5. 等待管理员审核，审核完毕后会将整合包自动推送给接入 Union Link 体系的启动器
- **要是分发更新包：**
  1. 前往 `客户端管理` 页面
  2. 选择要更新的整合包，点选 `更新` 按钮
  3. 上传新的整合包，并完成资料填充
  4. 等待管理员审核，审核完毕后会将更新包自动推送给接入 Union Link 体系的启动器

### Union Link Launcher (WIP)

进入 ULL 之后，点击 `选项` 按钮，进入之后按 `ESC` 退出。重复 5 次，并关闭 ULL。再次打开 ULL 后，会发现加载进度条变成了灰黑色。此时进入 ULL 的助理页面。在该页面，执行以下操作：

- **分发整合包与更新包**：
  1. 点击 `登录 Union Link` 按钮，在弹出的窗口输入 Union Link 账号和密码，登录后台
  2. 登录完成后，点击 `服务器管理` 页面，新增自己高校的服务器
  3. 在 `客户端管理` 页面为服务器绑定 整合包 / 更新包 并上传
  4. 等待管理员审核，审核完毕后会将整合包自动推送给接入 Union Link 体系的启动器