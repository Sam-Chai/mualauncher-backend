-- Existing endpoints were guessed. Preserve them for review, but require ALI reapproval before use.
DO $install$
DECLARE ds text := current_schema(); constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT c.conname FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
    JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname=ds AND t.relname='LauncherAuthProvider' AND c.contype='c'
      AND pg_get_constraintdef(c.oid) LIKE '%"authApiRoot"%"bsRoot"%'
  LOOP
    EXECUTE format('ALTER TABLE %I."LauncherAuthProvider" DROP CONSTRAINT %I', ds, constraint_name);
  END LOOP;
  EXECUTE format($ddl$ALTER TABLE %I."LauncherAuthProvider" ADD CONSTRAINT launcher_provider_https_api_root
    CHECK (length("authApiRoot") BETWEEN 1 AND 2048 AND "authApiRoot" ~ '^https://'
      AND "authApiRoot" !~ '[[:space:]?#@]')$ddl$, ds);
  EXECUTE format('UPDATE %I."LauncherAuthProvider" SET enabled=false, revision=revision+1, "updatedAt"=now()', ds);
END $install$;
