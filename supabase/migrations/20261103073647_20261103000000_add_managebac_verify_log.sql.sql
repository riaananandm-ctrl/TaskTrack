/*
# Add ManageBac verification rate-limit table

1. Background
- The deployed `managebac-connect` edge function records one row per calendar
  verification attempt in `public.managebac_verify_log` and refuses more than 5
  attempts per user per 60 seconds. The table was never created, so every verify
  request failed closed with HTTP 503 "Calendar verification is not configured
  correctly on our side." This migration creates the missing table so calendar
  verification works.

2. New Tables
- `managebac_verify_log`
  - `id` (bigint, identity, primary key)
  - `user_id` (uuid, not null, references auth.users on delete cascade)
  - `created_at` (timestamptz, not null, default now())
  No feed URLs, tokens, or IPs are stored — only who attempted and when.

3. New Functions
- `record_verify_attempt(p_user_id uuid)` returns integer: atomically records one
  verification attempt (advisory lock prevents concurrent requests exceeding the
  limit), prunes rows older than 5 minutes, and returns the user's attempt count
  in the last 60 seconds. SECURITY DEFINER, search_path pinned to public.

4. Security
- RLS enabled on `managebac_verify_log` with NO policies: no client role can read
  or write it directly. Only the service role (edge functions) touches it.
- Privileges normalized explicitly: all revoked from PUBLIC, anon, authenticated
  (table and its identity sequence); SELECT+INSERT granted to service_role only.
- `record_verify_attempt` revoked from PUBLIC, anon, authenticated; EXECUTE
  granted to service_role only.

5. Notes
- Additive only: no existing tables, columns, or functions are modified. The
  currently deployed edge function (direct count + insert with service role)
  works unchanged against this table.
*/

DO $$
DECLARE v_missing text;
BEGIN
  IF to_regclass('public.managebac_verify_log') IS NOT NULL THEN
    SELECT string_agg(name, ',') INTO v_missing
    FROM (VALUES ('id'),('user_id'),('created_at')) AS c(name)
    WHERE NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='managebac_verify_log'
        AND column_name = c.name);
    IF v_missing IS NOT NULL THEN
      RAISE EXCEPTION 'managebac_verify_log exists but is missing columns: %', v_missing;
    END IF;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.managebac_verify_log (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.managebac_verify_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.managebac_verify_log FROM PUBLIC;
REVOKE ALL ON public.managebac_verify_log FROM anon;
REVOKE ALL ON public.managebac_verify_log FROM authenticated;
REVOKE ALL ON SEQUENCE public.managebac_verify_log_id_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.managebac_verify_log_id_seq FROM anon;
REVOKE ALL ON SEQUENCE public.managebac_verify_log_id_seq FROM authenticated;
GRANT SELECT, INSERT ON public.managebac_verify_log TO service_role;
GRANT USAGE  ON SEQUENCE public.managebac_verify_log_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.record_verify_attempt(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_count integer;
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'user required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('managebac_verify:' || p_user_id::text, 0));
  DELETE FROM public.managebac_verify_log
   WHERE created_at < now() - interval '5 minutes';
  INSERT INTO public.managebac_verify_log (user_id) VALUES (p_user_id);
  SELECT count(*) INTO v_count
    FROM public.managebac_verify_log
   WHERE user_id = p_user_id
     AND created_at >= now() - interval '60 seconds';
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.record_verify_attempt(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_verify_attempt(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.record_verify_attempt(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.record_verify_attempt(uuid) TO service_role;