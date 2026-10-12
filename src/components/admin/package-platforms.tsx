"use client";
import { useId } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { MUA_PLATFORMS, type MuaPlatform } from "@/lib/muapack-contract";
import type { PackageFormatVersion } from "@/lib/client-contract";
export function PackageBuildOptions({ packageFormatVersion, ...props }: { packageFormatVersion: PackageFormatVersion | null;
  value: MuaPlatform[]; onChange: (value: MuaPlatform[]) => void; disabled?: boolean }) {
  if (packageFormatVersion === null) return null;
  if (packageFormatVersion === 2) return <p className="text-sm text-muted-foreground">v2 生成一个通用配方包，各系统下载相同的文件。模组下载和运行环境由 Launcher 解析、校验与安装，无需选择组包架构。</p>;
  return <PackagePlatforms {...props} />;
}
export function PackagePlatforms({ value, onChange, disabled }: { value: MuaPlatform[]; onChange: (value: MuaPlatform[]) => void; disabled?: boolean }) {
  const hintId = useId();
  return <fieldset disabled={disabled} className="space-y-3"><legend className="mb-2 text-sm font-medium">发布平台</legend>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{MUA_PLATFORMS.map(platform => {
      const unavailable = platform === "linux-aarch64", checked = value.includes(platform);
      return <label key={platform} className={`flex items-center gap-2 text-sm${unavailable ? " text-muted-foreground" : ""}`}>
        <Checkbox checked={checked} disabled={disabled || (unavailable && !checked)} aria-describedby={unavailable ? hintId : undefined}
          onCheckedChange={next => { if (unavailable && next) return; onChange(next ? [...value, platform] : value.filter(item => item !== platform)); }} />{platform}
      </label>;
    })}</div><p id={hintId} className="text-xs text-muted-foreground">Minecraft 目前暂未支持 ARM 版 Linux 系统</p>
    <p className="text-xs text-muted-foreground">默认选择其余五个平台。Worker 在后台准备环境并生成整包／更新包，关闭页面不影响任务；所选平台全部完成后才可发布。</p>
  </fieldset>;
}
