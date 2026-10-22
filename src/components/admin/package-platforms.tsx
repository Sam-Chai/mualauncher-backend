"use client";
import { useI18n } from "@/components/preferences";
import { useId } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { MUA_PLATFORMS, type MuaPlatform } from "@/lib/muapack-contract";
import type { PackageFormatVersion } from "@/lib/client-contract";
export function PackageBuildOptions({ packageFormatVersion, ...props }: { packageFormatVersion: PackageFormatVersion | null;
  value: MuaPlatform[]; onChange: (value: MuaPlatform[]) => void; disabled?: boolean }) {
  const { t } = useI18n();
  if (packageFormatVersion === null) return null;
  if (packageFormatVersion === 2) return <p className="text-sm text-muted-foreground">{t("packagePlatforms.v2GeneratesOneUniversalRecipeDownloadedByAllSystems")}</p>;
  return <PackagePlatforms {...props} />;
}
export function PackagePlatforms({ value, onChange, disabled }: { value: MuaPlatform[]; onChange: (value: MuaPlatform[]) => void; disabled?: boolean }) {
  const { t } = useI18n();
  const hintId = useId();
  return <fieldset disabled={disabled} className="space-y-3"><legend className="mb-2 text-sm font-medium">{t("packagePlatforms.releasePlatforms")}</legend>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{MUA_PLATFORMS.map(platform => {
      const unavailable = platform === "linux-aarch64", checked = value.includes(platform);
      return <label key={platform} className={`flex items-center gap-2 text-sm${unavailable ? " text-muted-foreground" : ""}`}>
        <Checkbox checked={checked} disabled={disabled || (unavailable && !checked)} aria-describedby={unavailable ? hintId : undefined}
          onCheckedChange={next => { if (unavailable && next) return; onChange(next ? [...value, platform] : value.filter(item => item !== platform)); }} />{platform}
      </label>;
    })}</div><p id={hintId} className="text-xs text-muted-foreground">{t("packagePlatforms.minecraftDoesNotCurrentlySupportLinuxArm")}</p>
    <p className="text-xs text-muted-foreground">{t("packagePlatforms.theOtherFivePlatformsAreSelectedByDefaultWorker")}</p>
  </fieldset>;
}
