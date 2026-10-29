/*
# Remove outbound HTTP execute rights from the app's client roles

1. Problem
  - The `pg_net` extension's HTTP functions (`net.http_get`, `net.http_post`,
    `net.http_delete`) were executable by `anon` and `authenticated`. They are not
    reachable through the Data API today because the `net` schema is not exposed,
    but the privilege is unnecessary and would make any future wrapper in an exposed
    schema into a server-side request forgery primitive.

2. Security changes
  - Revoke EXECUTE on the three `net` HTTP functions from `anon` and `authenticated`.

3. Notes
  1. Scheduled/server-side jobs run as privileged roles and keep their access, so no
     background work is affected.
  2. Nothing in the application calls these functions.
*/

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'net'
      AND p.proname IN ('http_get', 'http_post', 'http_delete')
  LOOP
    BEGIN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon, authenticated', r.sig);
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'Could not revoke execute on %', r.sig;
    END;
  END LOOP;
END $$;
