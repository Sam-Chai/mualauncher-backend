ALTER TABLE "PlatformSettings" ADD COLUMN "enabledPackageFormats" INTEGER[] NOT NULL DEFAULT ARRAY[1,2]::INTEGER[];
ALTER TABLE "PlatformSettings" ADD CONSTRAINT "PlatformSettings_enabledPackageFormats_check"
  CHECK ("enabledPackageFormats" IN (ARRAY[1]::INTEGER[], ARRAY[2]::INTEGER[], ARRAY[1,2]::INTEGER[], ARRAY[2,1]::INTEGER[]));
