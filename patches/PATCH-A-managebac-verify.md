# Patch A — ManageBac verification repair (REVIEW FIRST — blocks calendar verification)

Status: PROPOSED — not applied. No migration has been run, nothing deployed.

## Problem (evidence)

- `supabase/functions/managebac-connect/index.ts` (deployed), action `verify`, lines 398–416:
  counts rows in `public.managebac_verify_log` for the user in a 60 s window, then inserts
  a row. Both the count and the insert fail when the table does not exist → 503
  "Calendar verification is not configured correctly on our side."
- Live catalog check: `to_regclass('public.managebac_verify_log')` = NULL. No migration
  in `supabase/migrations/` creates it. Fail-closed, no security exposure, but every
  verify attempt fails.
- Concurrency flaw in the current design: count-then-insert are separate statements, so
  parallel verify requests can slip past the intended 5-per-minute limit.

## A1. SQL (single migration — for approval, file: `20261029xxxxxx_add_managebac_verify_log.sql`)

```sql
-- Schema verification first: if a partial/wrong table already exists, abort loudly
-- instead of trusting CREATE TABLE IF NOT EXISTS.
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
-- No policies: service_role bypasses RLS; every client role is denied outright.

-- Explicit privilege normalization; no reliance on default grants or comments.
REVOKE ALL ON public.managebac_verify_log FROM PUBLIC;
REVOKE ALL ON public.managebac_verify_log FROM anon;
REVOKE ALL ON public.managebac_verify_log FROM authenticated;
REVOKE ALL ON SEQUENCE public.managebac_verify_log_id_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.managebac_verify_log_id_seq FROM anon;
REVOKE ALL ON SEQUENCE public.managebac_verify_log_id_seq FROM authenticated;
GRANT SELECT, INSERT ON public.managebac_verify_log TO service_role;
GRANT USAGE  ON SEQUENCE public.managebac_verify_log_id_seq TO service_role;

-- Atomic per-user rate limit: advisory lock serializes a user's attempts so concurrent
-- verifies cannot exceed the window; retention bounded to 5 minutes; the table stores
-- only user_id + created_at (no calendar tokens, no feed URLs, no IPs).
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
```

## A2. Post-migration verification queries (must pass before code deploy)

```sql
SELECT c.relname, c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.managebac_verify_log'::regclass;
-- expect relrowsecurity = true
SELECT has_table_privilege('anon','public.managebac_verify_log','SELECT')          AS anon_select,  -- false
       has_table_privilege('authenticated','public.managebac_verify_log','INSERT') AS auth_insert,  -- false
       has_table_privilege('service_role','public.managebac_verify_log','INSERT')  AS svc_insert,   -- true
       has_function_privilege('authenticated','public.record_verify_attempt(uuid)','EXECUTE') AS auth_rpc; -- false
SELECT column_name, data_type, is_nullable FROM information_schema.columns
 WHERE table_schema='public' AND table_name='managebac_verify_log' ORDER BY ordinal_position;
```

## A3. Edge function diff (`supabase/functions/managebac-connect/index.ts`)

Replace lines 398–416 (comment block through the `logError` insert) with:

```ts
      // Per-user rate limit. One atomic server-side call: records the attempt and
      // returns how many attempts this user has made in the last 60 seconds.
      // Missing/misconfigured server setup still fails closed with a setup error.
      const { data: attemptCount, error: limitError } = await admin.rpc(
        'record_verify_attempt',
        { p_user_id: userId }
      );
      if (limitError) {
        return json({ ok: false, error: 'Calendar verification is not configured correctly on our side. Please try again later.' }, 503);
      }
      if ((attemptCount ?? 0) > 5) {
        return json({ ok: false, error: 'Too many verification attempts. Please wait a minute and try again.' }, 429);
      }
```

(Then delete the now-dead `const windowStart ...` block and the standalone
`admin.from('managebac_verify_log').insert(...)` call.) The rest of `verify`
(host checks, `confirmIsCalendar`, safe messages) is unchanged. Rate-limit
behavior is preserved: an attempt is counted before URL validation, exactly as today.

## Affected callers

- `managebac-connect` verify action only. Connect and disposition flows untouched.
- No frontend code changes. No other table/function references `managebac_verify_log`.

## Tests (isolated account, requires approval before running)

1. POST verify with a valid ManageBac subscription link → 200, `ok: true` (the current 503 is gone).
2. Six verifies within 60 s → the 6th returns 429 with the rate-limit sentence.
3. Two parallel verify requests → combined attempts cannot exceed 5 in the window (advisory lock serializes).
4. Direct browser-side insert attempt into the table as authenticated → permission denied.
5. Rows older than 5 minutes are removed by the next verify attempt (retention).
6. Re-confirm connect → sync still works (no regression on other actions).

## Deployment order

1. Apply the SQL migration (creates table + function; harmless while old code runs —
   old code never calls the function and still fails closed if the table were absent).
2. Run A2 verification queries.
3. Deploy `managebac-connect` via the edge-function deploy tool (single function).

## Compatibility risks

- If the migration is applied but the function redeploy fails, the old code keeps
  working against the new table (it inserts directly with service role, which still
  has INSERT). No breakage window.
- The 429 limit semantics change slightly: with the lock, the limit is now exact
  (5/min) rather than racy. Legitimate users retrying after an error may hit it
  sooner in bursts; the message tells them to wait a minute.

## Rollback

- Function `record_verify_attempt`: `DROP FUNCTION public.record_verify_attempt(uuid);`
- Table may remain (empty, deny-all) or be dropped; dropping is safe — old and new
  code paths both tolerate its absence (old code fails closed; nothing else reads it).
- Reverting the edge function to the prior source restores the old (broken) verify
  behavior only if the table is also dropped; otherwise the old code works against
  the new table.
