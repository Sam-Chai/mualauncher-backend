"use client";
import { Button } from "@/components/ui/button";
import type { PackageFormatVersion } from "@/lib/client-contract";
import { DEFAULT_PACKAGE_FORMATS } from "@/lib/package-format-policy";

export function PackageFormatChoice({ value, onChange, locked = false, busy = false, enabledFormats = DEFAULT_PACKAGE_FORMATS }: {
  value: PackageFormatVersion | null; onChange: (value: PackageFormatVersion) => void; locked?: boolean; busy?: boolean; enabledFormats?: readonly PackageFormatVersion[];
}) {
  return <fieldset disabled={locked || busy} className="space-y-3"><legend className="text-sm font-medium">选择 .muapack 格式</legend>
    <div className="grid gap-3 sm:grid-cols-2">
      {(locked && value !== null && !enabledFormats.includes(value) ? [] : enabledFormats).map(version => <Button key={version} type="button" variant={value === version ? "default" : "outline"}
        aria-pressed={value === version} onClick={() => onChange(version)} className="h-auto items-start whitespace-normal p-4 text-left">
        <span className="space-y-1"><span className="block font-semibold">{version === 1 ? "v1 · 完整环境包" : "v2 · 轻量配方包"}</span>
          <span className="block text-xs font-normal">{version === 1 ? "后台准备模组与 Minecraft、Java、加载器环境。" : "保留本地 overrides，远程模组与环境由 Launcher 下载。"}</span></span>
      </Button>)}
    </div>
    <p className="text-xs text-muted-foreground">{locked ? `本次上传已锁定为 v${value}；改选需取消并重新上传。` : "开始上传前请选择格式，每次更新都可以重新选择。"}</p>
    {locked && value !== null && !enabledFormats.includes(value) && <p className="text-xs text-muted-foreground">此格式已关闭新上传，已创建的任务可以继续处理。</p>}
    {value === 2 && <p className="text-xs text-muted-foreground">v2 支持 Modrinth mrpack／PCL 封装；生成跨平台完整配方包，审核签名后发布，模组与环境的远程下载由 Launcher 执行。</p>}
  </fieldset>;
}
