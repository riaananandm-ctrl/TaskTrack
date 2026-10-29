/*
# Bound the daily AI usage refund

1. Problem
  - `public.refund_ai_request()` is executable by every signed-in user and simply
    decrements today's `ai_usage.request_count` with no cap and no proof that a
    provider call actually failed, so a user could call it repeatedly and never
    reach their daily AI message limit.

2. Modified tables
  - `ai_usage`: new column `refund_count` (integer, not null, default 0) recording
    how many refunds have been granted for that user on that day.

3. Security changes
  - `refund_ai_request()` now refuses when there is nothing to refund
    (`request_count = 0`) and when the day's refund allowance (3) is exhausted.
    It stays a no-op rather than raising, so the chat edge function's cleanup path
    is unchanged.

4. Notes
  1. Genuine provider failures are still refunded; only unbounded replay is stopped.
  2. The function remains SECURITY DEFINER with a fixed search_path and still derives
     the user from the session only.
*/

ALTER TABLE public.ai_usage
  ADD COLUMN IF NOT EXISTS refund_count integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.refund_ai_request()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_today date := (now() AT TIME ZONE 'utc')::date;
  v_max_refunds constant integer := 3;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE ai_usage
  SET request_count = request_count - 1,
      refund_count = refund_count + 1,
      updated_at = now()
  WHERE user_id = v_user
    AND usage_date = v_today
    AND request_count > 0
    AND refund_count < v_max_refunds;
END;
$function$;
