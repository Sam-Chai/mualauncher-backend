DO $install$
DECLARE data_schema text := current_schema(); security_schema text := CASE WHEN current_schema()='public' THEN 'authz' ELSE current_schema()||'_authz' END;
BEGIN
EXECUTE replace(replace($definitions$
CREATE TABLE __data__."StorageTelemetrySource" (
  "id" CHAR(64) PRIMARY KEY, "provider" TEXT NOT NULL, "snapshot" JSONB, "counters" JSONB,
  "sampledAt" TIMESTAMPTZ(6), "attemptedAt" TIMESTAMPTZ(6), "error" TEXT,
  "leaseToken" UUID, "leaseUntil" TIMESTAMPTZ(6), "nextCollectAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE __data__."StorageTelemetrySample" (
  "id" UUID PRIMARY KEY, "sourceId" CHAR(64) NOT NULL REFERENCES __data__."StorageTelemetrySource"("id") ON DELETE RESTRICT,
  "startsAt" TIMESTAMPTZ(6) NOT NULL, "endsAt" TIMESTAMPTZ(6) NOT NULL,
  "sentBytes" BIGINT, "receivedBytes" BIGINT, "buckets" JSONB NOT NULL,
  CONSTRAINT telemetry_interval CHECK ("endsAt">"startsAt"),
  CONSTRAINT telemetry_nonnegative CHECK (("sentBytes" IS NULL OR "sentBytes">=0) AND ("receivedBytes" IS NULL OR "receivedBytes">=0))
);
CREATE UNIQUE INDEX "StorageTelemetrySample_sourceId_endsAt_key" ON __data__."StorageTelemetrySample"("sourceId","endsAt");
CREATE INDEX "StorageTelemetrySample_sourceId_startsAt_idx" ON __data__."StorageTelemetrySample"("sourceId","startsAt");
ALTER TABLE __data__."StorageTelemetrySource" OWNER TO mua_owner;
ALTER TABLE __data__."StorageTelemetrySample" OWNER TO mua_owner;
ALTER TABLE __data__."StorageTelemetrySource" ENABLE ROW LEVEL SECURITY;
ALTER TABLE __data__."StorageTelemetrySource" FORCE ROW LEVEL SECURITY;
ALTER TABLE __data__."StorageTelemetrySample" ENABLE ROW LEVEL SECURITY;
ALTER TABLE __data__."StorageTelemetrySample" FORCE ROW LEVEL SECURITY;
CREATE POLICY telemetry_web ON __data__."StorageTelemetrySource" FOR SELECT TO mua_web USING (__auth__.super_panel());
CREATE POLICY telemetry_web ON __data__."StorageTelemetrySample" FOR SELECT TO mua_web USING (__auth__.super_panel());
CREATE POLICY telemetry_worker ON __data__."StorageTelemetrySource" TO mua_worker USING (true) WITH CHECK (true);
CREATE POLICY telemetry_worker ON __data__."StorageTelemetrySample" TO mua_worker USING (true) WITH CHECK (true);
GRANT SELECT ON __data__."StorageTelemetrySource", __data__."StorageTelemetrySample" TO mua_web;
GRANT SELECT,INSERT,UPDATE ON __data__."StorageTelemetrySource" TO mua_worker;
GRANT SELECT,INSERT,DELETE ON __data__."StorageTelemetrySample" TO mua_worker;
$definitions$, '__data__', quote_ident(data_schema)), '__auth__', quote_ident(security_schema));
END
$install$;
