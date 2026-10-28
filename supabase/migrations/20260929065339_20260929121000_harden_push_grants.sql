/*
# Harden push notification privileges

## Purpose
Tighten privileges on the objects added for push notifications so the browser roles
hold the least they need, and the server-only sweep function cannot be called by a
signed-in user.

## 1. push_config (server-only credentials)
- Revoke all privileges from `anon` and `authenticated`. RLS already denied every
  request because the table has no policies; this removes the table grants as well, so
  the VAPID private key and cron secret are unreachable from any browser role at the
  privilege level too. Only the service role may read it.

## 2. push_subscriptions
- Revoke all privileges from `anon`. Only signed-in students need their own device
  rows, and the owner-scoped RLS policies already restrict them to their own rows.

## 3. claim_due_push_reminders()
- Revoke EXECUTE from `anon`, `authenticated`, and `PUBLIC`. This SECURITY DEFINER
  function claims reminders across all users, so it must be callable only by the
  service role used by the scheduled sender function. `get_push_vapid_public_key()`
  intentionally remains callable by signed-in users; it returns only the public key.

## Notes
- Additive to the previous push migration; nothing is dropped or retyped.
- Safe to re-run.
*/

REVOKE ALL ON public.push_config FROM anon;
REVOKE ALL ON public.push_config FROM authenticated;

REVOKE ALL ON public.push_subscriptions FROM anon;

REVOKE EXECUTE ON FUNCTION public.claim_due_push_reminders(integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_due_push_reminders(integer) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_due_push_reminders(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_due_push_reminders(integer) TO service_role;
