-- Remove anon role grants from all user-data tables.
-- RLS policies on these tables only target TO authenticated, so anon
-- already gets zero rows. Removing the grants is defense-in-depth: it
-- eliminates the possibility that a future policy change or a missed
-- edge case exposes user data to unauthenticated requests.
-- The anon key is still valid for Supabase Auth (signUp, signIn, etc.)
-- which does not go through table-level grants.

REVOKE SELECT, INSERT, UPDATE, DELETE ON public.profiles FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.tasks FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.subjects FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.reminders FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.study_sessions FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.study_session_messages FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.user_settings FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.weekly_plans FROM anon;
