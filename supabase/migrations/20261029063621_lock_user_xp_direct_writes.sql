/*
# Stop direct client writes to the XP table

1. Problem
  - `user_xp` granted INSERT, UPDATE and DELETE on every column to `authenticated`,
    with an `insert_own_user_xp` policy, so a user with no XP row could create one
    with any `total_xp` / `level` they liked.

2. Security changes
  - Drop the `insert_own_user_xp` policy.
  - Revoke INSERT, UPDATE and DELETE on `user_xp` from `anon` and `authenticated`.
  - SELECT is kept so the app can still display XP and level.

3. Notes
  1. XP rows are written only by `award_xp`, which is SECURITY DEFINER and therefore
     unaffected by these revokes.
  2. No application code writes this table directly.
*/

DROP POLICY IF EXISTS "insert_own_user_xp" ON public.user_xp;

REVOKE INSERT, UPDATE, DELETE ON public.user_xp FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.user_xp FROM anon;
