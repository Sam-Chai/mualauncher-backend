-- An empty legacy platform column selects the platform-independent v2 revision.
-- Existing drafts, READY artifacts, published manifests and signatures are not rewritten.
-- Preserve the canonical-list validation and review locks for historical v2 drafts.
CREATE OR REPLACE FUNCTION mua_v2_platforms_valid(selected TEXT[]) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT cardinality(selected)=0 OR (cardinality(selected)>0 AND cardinality(selected)<=6 AND selected=ARRAY(
  SELECT p FROM unnest(ARRAY['windows-amd64','windows-aarch64','linux-amd64','linux-aarch64','macos-amd64','macos-aarch64']) WITH ORDINALITY AS platforms(p,n)
  WHERE p=ANY(selected) ORDER BY n))
$$;
