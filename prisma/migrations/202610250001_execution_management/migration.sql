DO $install$
DECLARE data_schema text := current_schema(); security_schema text := CASE WHEN current_schema()='public' THEN 'authz' ELSE current_schema()||'_authz' END;
BEGIN
EXECUTE replace(replace($definitions$
ALTER TABLE __data__."PlatformSettings"
 ADD COLUMN "executionMode" TEXT NOT NULL DEFAULT 'DOCKER_GVISOR' CHECK ("executionMode" IN ('DOCKER_GVISOR','BARE')),
 ADD COLUMN "executionRevision" INTEGER NOT NULL DEFAULT 0 CHECK ("executionRevision">=0);
ALTER TABLE __data__."WorkerHeartbeat" ADD COLUMN "executionStatus" JSONB;
CREATE TABLE __data__."ExecutionRun" (
 "id" UUID PRIMARY KEY, "workerId" TEXT NOT NULL, "daemonId" TEXT, "buildId" UUID,
 "mode" TEXT NOT NULL CHECK ("mode" IN ('DOCKER_GVISOR','BARE')), "adapter" TEXT NOT NULL,
 "state" TEXT NOT NULL CHECK ("state" IN ('PREPARING','RUNNING','SUCCEEDED','FAILED','CANCELLED','INTERRUPTED','CLEANUP_FAILED')),
 "planSha256" CHAR(64) NOT NULL, "image" TEXT NOT NULL, "architecture" TEXT NOT NULL,
 "limits" JSONB NOT NULL, "containers" JSONB NOT NULL DEFAULT '[]', "error" TEXT,
 "startedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(6) NOT NULL,
 "finishedAt" TIMESTAMPTZ(6)
);
CREATE INDEX "ExecutionRun_startedAt_id_idx" ON __data__."ExecutionRun"("startedAt","id");
CREATE INDEX "ExecutionRun_workerId_state_idx" ON __data__."ExecutionRun"("workerId","state");
ALTER TABLE __data__."ExecutionRun" OWNER TO mua_owner;
ALTER TABLE __data__."ExecutionRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE __data__."ExecutionRun" FORCE ROW LEVEL SECURITY;
CREATE POLICY execution_maintenance ON __data__."ExecutionRun" TO mua_owner USING (true) WITH CHECK (true);
CREATE POLICY execution_web ON __data__."ExecutionRun" FOR SELECT TO mua_web USING (__auth__.super_panel());
CREATE POLICY execution_worker ON __data__."ExecutionRun" TO mua_worker USING (true) WITH CHECK (true);
GRANT SELECT ON __data__."ExecutionRun" TO mua_web;
GRANT SELECT,INSERT,UPDATE ON __data__."ExecutionRun" TO mua_worker;
$definitions$, '__data__', quote_ident(data_schema)), '__auth__', quote_ident(security_schema));
END $install$;
