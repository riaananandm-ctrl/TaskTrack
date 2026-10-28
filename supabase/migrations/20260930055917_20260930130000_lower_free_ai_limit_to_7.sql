/*
# Lower the free-plan daily AI limit to 7

## Purpose
The free plan's daily TaskTrack AI message limit was 20. It is now 7, matching the
product decision. The server reads this row in `reserve_ai_request()`, so the change
takes effect immediately and is the single source of truth for enforcement.

## Notes
- Only the `free` row is touched. The `pro` row is unchanged.
- Idempotent: safe to re-run.
*/

UPDATE public.plan_limits
SET daily_ai_messages = 7
WHERE plan = 'free';
