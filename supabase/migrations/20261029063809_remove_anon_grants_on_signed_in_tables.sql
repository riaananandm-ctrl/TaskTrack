/*
# Remove leftover anonymous privileges on signed-in-only tables

1. Problem
  - Eleven tables still granted privileges to the `anon` role even though every
    policy on them is scoped `TO authenticated`. Row level security blocks `anon`
    today, so nothing is currently exposed, but the grants are excess privilege:
    any future permissive policy would immediately reach unauthenticated callers.

2. Security changes
  - Revoke ALL privileges from `anon` on: app_metrics, onboarding_progress,
    quiz_attempts, review_cards, review_decks, review_log, sync_change_inbox,
    user_badges, user_streaks, user_xp, weekly_availability.

3. Notes
  1. The app requires sign-in for all of these screens, so no feature relies on
     anonymous access to them.
  2. This brings these tables in line with the project's existing convention for
     user-owned tables.
*/

REVOKE ALL ON public.app_metrics FROM anon;
REVOKE ALL ON public.onboarding_progress FROM anon;
REVOKE ALL ON public.quiz_attempts FROM anon;
REVOKE ALL ON public.review_cards FROM anon;
REVOKE ALL ON public.review_decks FROM anon;
REVOKE ALL ON public.review_log FROM anon;
REVOKE ALL ON public.sync_change_inbox FROM anon;
REVOKE ALL ON public.user_badges FROM anon;
REVOKE ALL ON public.user_streaks FROM anon;
REVOKE ALL ON public.user_xp FROM anon;
REVOKE ALL ON public.weekly_availability FROM anon;
