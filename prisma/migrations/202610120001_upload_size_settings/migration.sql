ALTER TABLE "PlatformSettings"
  ADD COLUMN "maxUploadSizeMb" INTEGER NOT NULL DEFAULT 1024;

ALTER TABLE "PlatformSettings"
  ADD CONSTRAINT "PlatformSettings_upload_size_bounds"
  CHECK ("maxUploadSizeMb" BETWEEN 1 AND 20480);
