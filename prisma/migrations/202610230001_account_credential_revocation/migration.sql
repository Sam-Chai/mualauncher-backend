DO $install$
DECLARE data_schema text := current_schema(); security_schema text := CASE WHEN current_schema()='public' THEN 'authz' ELSE current_schema()||'_authz' END;
BEGIN
EXECUTE replace(replace($definitions$
CREATE FUNCTION __auth__.revoke_credentials(account_id uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,__data__,__auth__,pg_temp AS $$
DECLARE sessions integer; tokens integer; approvals integer;
BEGIN
 PERFORM pg_advisory_xact_lock(731402,1);
 IF NOT (coalesce(current_setting('mua.auth_kind',true),'')='session' AND __auth__.active_actor()
   AND ($1=__auth__.actor_id() OR __auth__.super_panel())) THEN RAISE insufficient_privilege; END IF;
 DELETE FROM __data__."Session" WHERE "accountId"=$1;
 GET DIAGNOSTICS sessions = ROW_COUNT;
 UPDATE __data__."ApiToken" SET "revokedAt"=now() WHERE "accountId"=$1 AND "revokedAt" IS NULL;
 GET DIAGNOSTICS tokens = ROW_COUNT;
 DELETE FROM __data__."LauncherLoginAttempt" WHERE "accountId"=$1;
 GET DIAGNOSTICS approvals = ROW_COUNT;
 RETURN jsonb_build_object('ok',true,'sessions',sessions,'apiTokens',tokens,'launcherApprovals',approvals);
END $$;
ALTER FUNCTION __auth__.revoke_credentials(uuid) OWNER TO mua_owner;
REVOKE ALL ON FUNCTION __auth__.revoke_credentials(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION __auth__.revoke_credentials(uuid) TO mua_web;
$definitions$, '__data__', quote_ident(data_schema)), '__auth__', quote_ident(security_schema));
END $install$;
