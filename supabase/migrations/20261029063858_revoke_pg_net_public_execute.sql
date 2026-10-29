/*
# Remove the public execute grant on the outbound HTTP functions

1. Problem
  - The previous migration revoked EXECUTE from `anon` and `authenticated`, but the
    `net` HTTP functions carry an EXECUTE grant to PUBLIC (`=X/supabase_admin`),
    which still leaves every role able to call them.

2. Security changes
  - Revoke EXECUTE on `net.http_get`, `net.http_post` and `net.http_delete` from
    PUBLIC, and revoke USAGE on the `net` schema from `anon` and `authenticated`.

3. Notes
  1. Privileged server-side roles (the extension owner and the job runner) retain
     access, so scheduled work is unaffected.
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
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', r.sig);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Could not revoke public execute on %: %', r.sig, SQLERRM;
    END;
  END LOOP;

  BEGIN
    REVOKE USAGE ON SCHEMA net FROM anon, authenticated;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Could not revoke usage on schema net: %', SQLERRM;
  END;
END $$;
