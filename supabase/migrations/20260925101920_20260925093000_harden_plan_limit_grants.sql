/*
# Harden plan_limits and ai_usage, and lock down limit functions

## Purpose
Tighten the two tables and two functions added for plan limits so the browser
holds no write capability on them at all, and so the privileged functions are not
reachable by unauthenticated callers.

## Changes

### ai_usage
Revoke the table-wide grants (which included INSERT/UPDATE/DELETE) from anon and
authenticated, then grant SELECT only. Writes stay exclusively inside
`reserve_ai_request()` / `refund_ai_request()`, which run as the function owner.
Row-level security already blocked writes because no write policy exists; removing
the grants makes that explicit rather than policy-dependent.

### plan_limits
Same treatment: SELECT only for authenticated, no grants for anon. The plan
definitions are readable by signed-in users for display, and writable only by the
service role.

### reserve_ai_request / refund_ai_request
REVOKE EXECUTE from PUBLIC (the default source of the anon grant) and from anon,
leaving only authenticated. Both functions already reject a null auth.uid(), but an
unauthenticated caller should not be able to invoke them at all.

## Security
No policy changes. Grants only. Function bodies are unchanged.
*/

REVOKE ALL ON ai_usage FROM anon, authenticated;
GRANT SELECT ON ai_usage TO authenticated;

REVOKE ALL ON plan_limits FROM anon, authenticated;
GRANT SELECT ON plan_limits TO authenticated;

REVOKE EXECUTE ON FUNCTION reserve_ai_request() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION refund_ai_request() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION reserve_ai_request() TO authenticated;
GRANT EXECUTE ON FUNCTION refund_ai_request() TO authenticated;
