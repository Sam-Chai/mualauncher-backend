# 客户端自动化与后台 API 操作指南

在后台左侧 API 打开完整 Scalar，按以下顺序操作。所有示例 ID、凭据、版本和地址均为占位值，必须从实际授权资源读取；不要用服务器 ID 代替新客户端 UUID，也不要把客户端 publicationRevision 当作服务器绑定 revision。

## 认证与准备

Cookie 会话：`POST /api/auth/login`，Content-Type 为 application/json，Origin 为站点完整 origin，正文 `{"username":"账号","password":"密码"}`。响应 `{ok:true}` 和 HttpOnly mua_session；保存 Cookie。之后后台读取使用 Cookie，写入还要 Origin。登录／退出也必须同源；改密会撤销账户全部会话，需要重新登录。

Bearer：先通过 Cookie 调用 `POST /api/admin/tokens`，例如 `{"name":"Client automation","serverIds":["ABC"],"permissions":["SERVER_READ","DRAFT_READ","DRAFT_CREATE","DRAFT_EDIT","DRAFT_SUBMIT","DRAFT_REVIEW","RELEASE_READ","RELEASE_PUBLISH","RELEASE_ACTIVATE","CLIENT_BIND"],"expiresInDays":1}`。只能授予自己已有的服务器权限，SERVER_READ 必须包含，明文 Token 只返回一次。日常推荐按上传、审核、发布职责拆分 Token。后续客户端标准 API 设置 `Authorization: Bearer mua_...`，写入使用 JSON，无须 Origin。Token 无权调用后台和认证接口。

先用后台 `GET /api/admin/state` 确认 organizationId、服务器 publicationRevision、boundClientId、开放格式及上传上限；Bearer 从 `GET /api/v1/clients` 或客户端详情读取其授权客户端。账号撤权／停用、Token 撤销或过期立即影响后续请求，超管 Token 也不会获得超管面板能力。

## 创建、上传、审核与发布

1. **创建客户端。** `POST /api/v1/clients`：`{"organizationId":"组织 UUID","name":"独立客户端名称","serverId":"ABC","publicationRevision":0,"expectedClientId":null,"replaceConfirmed":false}`。服务器修订和当前绑定从 state 读取，此处 0／null 仅表示实际尚未绑定的例子。Bearer 必须选择授权服务器；Cookie 组织权限可不填 serverId 创建未绑定客户端。需要 DRAFT_CREATE、DRAFT_SUBMIT，指定服务器另需 CLIENT_BIND。201 响应提供 clientId，名称在组织内规范化查重；同名用更新。替换旧绑定必须填真实旧 clientId／服务器修订并明确 replaceConfirmed=true，新客户端准备完成前旧客户端继续可用。

2. **固定更新基准并创建上传。** `GET /api/v1/clients/{clientId}` 读取 currentReleaseId 和 publicationRevision；`POST /api/v1/clients/uploads`：`{"clientId":"客户端 ID","fileName":"source.zip","size":实际字节数,"baseReleaseId":null,"basePublicationRevision":0,"packageFormatVersion":2}`。基准值必须来自该客户端，首次发布才为 null／0；更新上传完整源包，不上传差分 ZIP。响应 201 含 id、partSize、status=UPLOADING。格式创建后锁定，省略默认 1，不自动继承；超过实时上限 413，关闭格式 409，活动上传上限 429。

3. **分片 PUT 与完成。** 按返回 partSize（当前 64 MiB）切分文件，片号从 1 起。对每片 `POST /api/v1/clients/uploads/{uploadId}/parts`：`{"partNumber":1}`，获取有效 600 秒的 url；直接 PUT 该片二进制到 OSS url，不带后台 Cookie／Bearer，保留响应 ETag 的原始引号。非末片大小必须为 partSize。全部完成后 `POST .../{uploadId}/complete`：`{"parts":[{"partNumber":1,"etag":"\"OSS 返回值\""}]}`。不要用自行计算的 SHA-256 替代 ETag。complete 返回 QUEUED 或已有任务状态，不代表导入、组包或发布完成。上传会话有效期 24 小时，失效片链接可重新签发。

4. **轮询并选择实例。** `GET /api/v1/clients/uploads/{uploadId}` 读取 status、processingPhase、progress、detectedInfo、warnings。当 QUEUED 且 processingPhase=SELECT_INSTANCE，向用户展示 detectedInfo.candidates，明确选择后 `POST .../select-instance`：`{"instanceId":"候选 instanceId"}`。不得自动选第一项。继续等待 READY；FAILED 查看 error，成功 READY 后才可提交。新 v2 远程文件的 DECLARED 只代表声明保留，Worker 不下载其字节或替 Launcher 验证环境。

5. **提交审核。** READY 后 `POST .../{uploadId}/submit`：`{"versionLabel":"1.0.0","name":"该客户端名称","minecraftVersion":"1.21.1","javaVersion":21,"summary":"版本摘要","description":"版本说明"}`。可省略 MC／Java 使用 Worker 识别值，缺失则需明确填写；请求不接受 mods／modDetails，模组信息由 Worker 产生。已建立客户端名称不可改；首次无历史且唯一 READY 上传可确认识别名称。返回 draftId，重复相同提交返回原 ID。v1 可选 platforms，默认五项；v2 不按平台限制，不接受 platforms。

6. **审核。** 再查客户端详情，从对应 draft 读取 contentRevision、packageRevision。审核身份调用 `POST /api/v1/clients/{clientId}/drafts/{draftId}/review`：`{"decision":"approve","note":"已核对","contentRevision":1,"packageRevision":1}`，两修订必须取实际值；驳回使用 reject 且 note 非空。DRAFT_REVIEW 与发布权限分开。审核批准不代表组包 READY。v1 若需要调整平台，在审核前 POST .../platforms，变更提高 packageRevision、清除审核并回到 SUBMITTED；v2 不支持此操作。

7. **等待组包。** 轮询客户端详情中对应 drafts[].packageBuilds，查看 platform、status、phase、progress、error。PREPARED 是清单已准备、等待审核签名；READY 才表示产物保存完成。v1 为各选定必需平台，新 v2 为 universal 任务；详情没有单独的“组包状态”路径。实际服务端会再确认全部必需产物 READY，损坏对象不能发布。

8. **发布与启用。** `POST .../drafts/{draftId}/publish`：`{"activate":true,"contentRevision":1,"packageRevision":1}`。RELEASE_PUBLISH 必需，activate=true 另需 RELEASE_ACTIVATE。activate=false 只创建不可变发布，之后再查客户端的最新 publicationRevision，调用 `POST .../releases/{releaseId}/activate`：`{"publicationRevision":实际客户端修订}`。待替换绑定还会重新检查已确认服务器修订。首次发布响应含 releaseId、versionLabel、activated、archivedDraftIds；重复发布可仅含前两项。变更 replacesDraftId 另需 DRAFT_ARCHIVE 和两种草稿修订，成功后仅归档显式替代链。

9. **核对下载。** `GET .../releases/{releaseId}/package`，v1 加 `?platform=windows-amd64`，新 v2 可省略。管理下载需 RELEASE_READ，始终 full，链接有效 300 秒，校验字节 SHA-256 与响应 sha256；v2 管理响应 platform=universal。玩家公开下载还要求有效绑定／未归档当前发布／格式协商等，管理下载成功不代表公开目录上架或 Launcher 已完成安装。

### 使用现有自动化脚本

创建客户端后，可让已有 `scripts/upload-client.ts` 完成第 2–5 步。metadata.json 使用第 5 步资料并增加 `"packageFormatVersion":2`；第四个位置参数可传明确 instanceId。它固定当前已发布基准、分片上传、完成、轮询并提交，**不会自动审核或发布**。缺少实例选择或处理器未就绪会留下可在后台继续处理的上传。

PowerShell 示例（先在环境安全设置 MUA_API_TOKEN，避免把真实 Token 写入源码或日志）：

```powershell
$env:MUA_API_URL = 'https://实际站点'
npm run client:upload -- .\source.zip .\metadata.json CLIENT_ID INSTANCE_ID
```

脚本输出的 clientId、uploadId、draftId 用于后续审核和发布。CLI 入口的本地 20 GiB 上限不代替服务端实时设置；服务端仍可返回 413 或 409。

## 修订、失败与补充操作

| 值 | 来源及用途 |
| --- | --- |
| 客户端 publicationRevision | 客户端详情；上传 basePublicationRevision、启用发布 |
| 服务器 publicationRevision／客户端 bindingRevision | state 中服务器或客户端详情；绑定／解绑／确认替换 |
| 草稿 contentRevision | drafts[]；审核、归档，发布建议携带 |
| 草稿 packageRevision | drafts[]；审核、归档和组包方案，发布建议携带 |

409 时停止当前动作，重新读取状态和修订，重新比较基准／绑定／替代关系，让操作者确认变化后继续；不能机械替换修订并自动覆盖新状态。上传期间发布基准改变可能需要新建上传，不保证 retry 能解决。401 重新认证，403／404 检查真实范围，413 调整源包或请超管修改上限，415 检查 Content-Type／格式。

| 操作 | 路径及正文 | 关键限制 |
| --- | --- | --- |
| 绑定 | POST /clients/{id}/bind；serverId、服务器 publicationRevision、expectedClientId、replaceConfirmed | CLIENT_BIND，同时核对双方／被替换者范围；只能同组织，pending=true 保持旧客户端 |
| 解绑 | POST /clients/{id}/unbind；serverId、服务器 publicationRevision，未绑定均 null | CLIENT_BIND；历史、存储和固定 scopeServerId 保留 |
| 归档／恢复客户端 | POST /clients/{id}/archive；archived 布尔值 | CLIENT_ARCHIVE；归档清除实际／待绑定，恢复不自动重新分发 |
| 删除客户端 | POST /clients/{id}/delete；{} | CLIENT_DELETE；已归档、无绑定、无活动处理任务；曾发布可删除，签名历史保留，不可恢复 |
| 归档未发布草稿 | POST /clients/{id}/drafts/{draftId}/archive；两种草稿修订 | DRAFT_ARCHIVE；取消活动组包租约，保留 READY，无恢复参数 |
| 重试导入 | POST /clients/uploads/{uploadId}/retry；{} | 仅 FAILED，所有者／超管及 DRAFT_CREATE；不重新上传 |
| 取消上传 | POST /clients/uploads/{uploadId}/cancel；{} | 未提交且非 PROCESSING；历史保留 |
| 重试组包 | POST /clients/{id}/drafts/{draftId}/retry-packages；{} | SUBMITTED／APPROVED 未归档，DRAFT_CREATE／SUBMIT，更新另需 EDIT |
| 草稿管理下载 | GET /clients/{id}/drafts/{draftId}/package；v1 platform 查询 | DRAFT_READ，READY 后 full，不依赖目录上架 |

本表路径均以 `/api/v1` 为前缀。管理归档、删除和解绑不会改写旧发布字节或签名，文件回收由 Worker 按引用与保留期处理。

## 后台接口与图片

后台接口仅 Cookie。组织／服务器／账号创建、组织／服务器归档、审计、pipeline 以及四种 Settings 的独立 GET／PATCH 都仅超管；普通账号从 state 读取开放格式／上传上限。组织编辑与成员／授权受组织权限控制，服务器资料和图片受 SERVER_EDIT／READ 控制；颜色与展示模式／时间受服务器范围 SERVER_EDIT 控制；排序和上架仅超管。详见 Scalar 的逐操作说明及[权限矩阵](permission-matrix.md)。

图片 POST `/api/admin/servers/{serverId}/motto-image` 使用 multipart/form-data，不手填 Content-Type 的 boundary：source 为静态 PNG／JPEG／WebP 文件（≤8 MiB、1600 万像素），crop 是 JSON 文本，610×400 原图的例子为 `{"left":0,"top":0,"width":1,"height":0.648936170212766}`，expectedIconObjectKey 也是 JSON 文本，首次填写文字 `null`，已有图片填写 JSON 引号包裹的对象键。选区比例须符合 2.35:1，其他尺寸须重新计算或用前端裁剪器产生；省略 source 使用保留原图重裁剪。上传前 GET `?variant=metadata` 读取当前 key 和 crop，变化 409 后重新读取，不自动覆盖。

GET 默认及 `variant=source` 返回 image/webp 二进制；`variant=metadata` 返回 JSON。DELETE 使用 JSON expectedIconObjectKey，权限及修订同样检查，旧对象保留。probe GET 仅按已保存 gameAddress 探测，任意查询地址不会改变目标。Token 创建、列举与撤销只操作本账号，普通账号也可为自己已有的允许权限创建受限 Token。
