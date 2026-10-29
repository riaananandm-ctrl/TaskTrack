/*
# Remove anonymous execute rights on the XP and metrics functions

1. Problem
  - `award_xp` and `record_metric` still reported as executable by `anon`: Postgres
    grants EXECUTE to PUBLIC on every new function, so revoking from `anon` alone
    left the PUBLIC grant in place.

2. Security changes
  - Revoke EXECUTE on both functions from PUBLIC and `anon`.
  - Grant EXECUTE to `authenticated` and `service_role` only.

3. Notes
  1. Both functions already raised 'Not authenticated' for anonymous callers, so this
     removes an unusable privilege rather than changing behaviour.
  2. Signed-in use (onboarding steps, task completion, metrics) is unaffected.
*/

REVOKE EXECUTE ON FUNCTION public.award_xp(integer, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.record_metric(text, jsonb) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.award_xp(integer, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_metric(text, jsonb) TO authenticated, service_role;
