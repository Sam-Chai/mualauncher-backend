-- New diagnostics carry stable message codes. The database fallback is English.
ALTER TABLE "PackageBuild" ALTER COLUMN "phase" SET DEFAULT 'Queued';
