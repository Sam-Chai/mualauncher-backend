"use client";
import { useI18n } from "@/components/preferences";
import { Button } from "@/components/ui/button";
import type { PackageFormatVersion } from "@/lib/client-contract";
import { DEFAULT_PACKAGE_FORMATS } from "@/lib/package-format-policy";

export function PackageFormatChoice({ value, onChange, locked = false, busy = false, enabledFormats = DEFAULT_PACKAGE_FORMATS }: {
  value: PackageFormatVersion | null; onChange: (value: PackageFormatVersion) => void; locked?: boolean; busy?: boolean; enabledFormats?: readonly PackageFormatVersion[];
}) {
  const { t } = useI18n();
  return <fieldset disabled={locked || busy} className="space-y-3"><legend className="text-sm font-medium">{t("packageFormatChoice.selectMuapackFormat")}</legend>
    <div className="grid gap-3 sm:grid-cols-2">
      {(locked && value !== null && !enabledFormats.includes(value) ? [] : enabledFormats).map(version => <Button key={version} type="button" variant={value === version ? "default" : "outline"}
        aria-pressed={value === version} onClick={() => onChange(version)} className="h-auto items-start whitespace-normal p-4 text-left">
        <span className="space-y-1"><span className="block font-semibold">{version === 1 ? t("packageFormatChoice.v1FullEnvironmentPackage") : t("packageFormatChoice.v2LightweightRecipe")}</span>
          <span className="block text-xs font-normal">{version === 1 ? t("packageFormatChoice.backendPreparesModsAndMinecraftJavaAndLoaderEnvironments") : t("packageFormatChoice.keepLocalOverridesLauncherDownloadsRemoteModsAndEnvironments")}</span></span>
      </Button>)}
    </div>
    <p className="text-xs text-muted-foreground">{locked ? t("packageFormatChoice.lockedFormatHint", { "format": value }) : t("packageFormatChoice.chooseAFormatBeforeUploadingEachUpdateCanUse")}</p>
    {locked && value !== null && !enabledFormats.includes(value) && <p className="text-xs text-muted-foreground">{t("packageFormatChoice.newUploadsForThisFormatAreDisabledExistingTasks")}</p>}
    {value === 2 && <p className="text-xs text-muted-foreground">{t("packageFormatChoice.v2SupportsModrinthMrpackAndPclArchivesItCreates")}</p>}
  </fieldset>;
}
