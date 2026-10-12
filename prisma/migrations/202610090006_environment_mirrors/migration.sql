ALTER TABLE "PlatformSettings"
  ADD COLUMN "minecraftDownloadSources" TEXT[] NOT NULL DEFAULT ARRAY['bmclapi', 'ustc', 'nju']::TEXT[],
  ADD COLUMN "javaDownloadSources" TEXT[] NOT NULL DEFAULT ARRAY['tuna']::TEXT[],
  ADD COLUMN "mirrorProxyEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "javaImageType" TEXT NOT NULL DEFAULT 'jre',
  ADD CONSTRAINT "minecraft_download_sources_valid" CHECK (
    "minecraftDownloadSources" <@ ARRAY['bmclapi', 'ustc', 'nju']::TEXT[] AND
    array_position("minecraftDownloadSources", NULL) IS NULL AND
    cardinality("minecraftDownloadSources") <= 3 AND
    cardinality("minecraftDownloadSources") = (('bmclapi'=ANY("minecraftDownloadSources"))::int + ('ustc'=ANY("minecraftDownloadSources"))::int + ('nju'=ANY("minecraftDownloadSources"))::int)),
  ADD CONSTRAINT "java_download_sources_valid" CHECK ("javaDownloadSources" IN (ARRAY[]::TEXT[], ARRAY['tuna']::TEXT[])),
  ADD CONSTRAINT "java_image_type_valid" CHECK ("javaImageType" IN ('jre','jdk'));
