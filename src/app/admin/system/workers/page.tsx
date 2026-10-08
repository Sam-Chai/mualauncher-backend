import { SystemPlanned } from "@/components/admin/planned";
export default function Page() { return <SystemPlanned title="Worker" description="监控整合包解析与转换任务。" items={["队列调度、解析进度与失败重试。","转换整合包、计算文件校验和并生成发布清单。"]} />; }
