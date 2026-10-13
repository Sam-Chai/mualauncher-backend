-- Expand schedule edits to scoped SERVER_EDIT without changing registration or public visibility semantics.
DO $install$
DECLARE
  data_schema text := current_schema();
  security_schema text := CASE WHEN current_schema()='public' THEN 'authz' ELSE current_schema() || '_authz' END;
  statement text;
BEGIN
  statement := $definitions$
CREATE OR REPLACE FUNCTION "__auth__".guard_server_display() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, "__data__", "__auth__", pg_temp AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
   IF (NEW."displayMode",NEW."displayStartsAt",NEW."displayEndsAt") IS NOT DISTINCT FROM
      (OLD."displayMode",OLD."displayStartsAt",OLD."displayEndsAt") THEN RETURN NEW; END IF;
   IF "__auth__".maintenance() OR "__auth__".super_panel() OR "__auth__".server_permission(OLD."serverId",'SERVER_EDIT') THEN
     RETURN NEW;
   END IF;
 ELSE
   IF NEW."displayMode"='PERMANENT' AND NEW."displayStartsAt" IS NULL AND NEW."displayEndsAt" IS NULL THEN RETURN NEW; END IF;
   IF "__auth__".maintenance() OR "__auth__".super_panel() THEN RETURN NEW; END IF;
 END IF;
 RAISE insufficient_privilege;
END $$;
REVOKE ALL ON FUNCTION "__auth__".guard_server_display() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "__auth__".guard_server_display() TO mua_web,mua_owner;
$definitions$;
  EXECUTE replace(replace(statement,'__data__',replace(data_schema,'"','""')),'__auth__',replace(security_schema,'"','""'));
END $install$;
