/*
# Stop direct client writes to the metrics table

1. Problem
  - `app_metrics` granted SELECT, INSERT, UPDATE and DELETE on every column to both
    `anon` and `authenticated` with an `insert_own_app_metrics` policy, so anyone with
    a session could inject or alter arbitrary analytics rows.

2. Security changes
  - Drop the `insert_own_app_metrics` policy.
  - Revoke INSERT, UPDATE and DELETE on `app_metrics` from `anon` and `authenticated`.
  - SELECT is kept for the owner-scoped read policy.

3. Notes
  1. The app records metrics exclusively through the `record_metric` function
     (SECURITY DEFINER), which is unaffected, as is `award_xp`'s metric insert.
  2. No application code writes this table directly.
*/

DROP POLICY IF EXISTS "insert_own_app_metrics" ON public.app_metrics;

REVOKE INSERT, UPDATE, DELETE ON public.app_metrics FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.app_metrics FROM anon;
