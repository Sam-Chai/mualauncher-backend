import { SystemPlanned } from "@/components/admin/planned";
export default function Page() { return <SystemPlanned title="Storage" description="管理客户端对象存储与分发。" items={["开发环境接入 MinIO，生产环境使用兼容 S3 API 的存储。","上传、下载、文件去重与容量统计。","CDN 下载流量将在遥测接入后展示。"]} />; }
