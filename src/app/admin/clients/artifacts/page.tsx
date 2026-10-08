import { Planned } from "@/components/admin/common";
export default function Page() { return <Planned title="Artifacts" description="管理上传的整合包与转换后的客户端文件。" items={["支持 MultiMC、CurseForge、Modrinth 和传统 .minecraft 压缩包。","上传后自动识别版本、运行环境与模组清单。","转换为 MUA 专有整合包，按文件校验和去重存储。"]} />; }
