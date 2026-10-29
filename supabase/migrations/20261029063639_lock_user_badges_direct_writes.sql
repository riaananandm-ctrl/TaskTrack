/*
# Stop direct client writes to the badges table

1. Problem
  - `user_badges` granted INSERT, UPDATE and DELETE on every column to
    `authenticated` with an `insert_own_user_badges` policy, so a user could award
    themselves any badge without earning it.

2. Security changes
  - Drop the `insert_own_user_badges` policy.
  - Revoke INSERT, UPDATE and DELETE on `user_badges` from `anon` and `authenticated`.
  - SELECT is kept so earned badges still display.

3. Notes
  1. Badges are granted only by `award_xp` (SECURITY DEFINER), which is unaffected.
  2. No application code writes this table directly.
*/

DROP POLICY IF EXISTS "insert_own_user_badges" ON public.user_badges;

REVOKE INSERT, UPDATE, DELETE ON public.user_badges FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.user_badges FROM anon;
