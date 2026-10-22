import { diagnosticText } from "@/lib/diagnostics";
import { z } from "zod";
import { packageFormatVersionSchema, type PackageFormatVersion } from "./client-contract";

export const DEFAULT_PACKAGE_FORMATS: PackageFormatVersion[] = [1, 2];
export const enabledPackageFormatsSchema = z.array(packageFormatVersionSchema).min(1, diagnosticText("diagnostics.packageFormatPolicy.enableAtLeastOneMuapackFormat")).max(2)
  .refine(values => new Set(values).size === values.length, diagnosticText("diagnostics.packageFormatPolicy.muapackFormatsMustNotBeRepeated"));

export function defaultUploadPackageFormat(enabled: readonly PackageFormatVersion[], preferred: PackageFormatVersion | null = null): PackageFormatVersion | null {
  if (preferred !== null && enabled.includes(preferred)) return preferred;
  return enabled.length === 1 ? enabled[0] : null;
}
