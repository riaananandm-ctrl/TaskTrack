/*
# Stop direct client writes to the streaks table

1. Problem
  - `user_streaks` granted INSERT, UPDATE and DELETE on every column to
    `authenticated` with an `insert_own_user_streaks` policy, so a user could
    fabricate their study streak.

2. Security changes
  - Drop the `insert_own_user_streaks` policy.
  - Revoke INSERT, UPDATE and DELETE on `user_streaks` from `anon` and `authenticated`.
  - SELECT is kept so the streak widget still reads the value.

3. Notes
  1. The application only reads this table (the XP/streak widget and the stats
     helper); nothing in the app or in any database function writes it, so no
     feature is affected.
  2. Server-side code using the service role is unaffected by these revokes.
*/

DROP POLICY IF EXISTS "insert_own_user_streaks" ON public.user_streaks;

REVOKE INSERT, UPDATE, DELETE ON public.user_streaks FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.user_streaks FROM anon;
