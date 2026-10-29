/*
# Prevent self-service plan upgrades via profile replacement

1. Problem
  - `authenticated` held INSERT (all columns) and DELETE on `public.profiles`, with
    policies `insert_own_profile` and `delete_own_profile` scoped to the caller's own id.
  - The UPDATE grant is deliberately column-restricted so a user cannot change
    `plan` / `plan_expires_at`, but delete-then-insert bypassed that restriction entirely,
    letting any signed-in user re-create their own profile row with `plan = 'pro'`.

2. Security changes
  - Drop the `insert_own_profile` and `delete_own_profile` policies.
  - Revoke INSERT and DELETE on `public.profiles` from `anon` and `authenticated`.
  - SELECT and the column-restricted UPDATE are left untouched.

3. Notes
  1. Profile rows are created by the `handle_new_user` trigger (runs as the table owner),
     so sign-up is unaffected.
  2. Account deletion runs through the `delete-account` edge function with the service role,
     which is unaffected by these revokes.
  3. No application code inserts or deletes profiles from the browser.
*/

DROP POLICY IF EXISTS "insert_own_profile" ON public.profiles;
DROP POLICY IF EXISTS "delete_own_profile" ON public.profiles;

REVOKE INSERT, DELETE ON public.profiles FROM authenticated;
REVOKE INSERT, DELETE ON public.profiles FROM anon;
