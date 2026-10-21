DO $install$
BEGIN
EXECUTE format('ALTER TYPE %I."Role" ADD VALUE IF NOT EXISTS ''PLAYER''',current_schema());
END $install$;
