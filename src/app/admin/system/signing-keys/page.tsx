import { SystemPlanned } from "@/components/admin/planned";
export default function Page() { return <SystemPlanned title="Signing Keys" description="管理发布签名与客户端信任。" items={["签名密钥生命周期和公钥发布。","审核通过后签署发布清单，Launcher 校验后安装。"]} />; }
