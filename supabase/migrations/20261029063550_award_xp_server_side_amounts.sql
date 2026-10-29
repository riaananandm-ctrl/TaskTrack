/*
# Compute XP server-side instead of trusting the client

1. Problem
  - `public.award_xp(p_amount, p_reason, p_badge_key)` added the caller-supplied
    `p_amount` straight into `user_xp.total_xp`, and accepted any badge key, so any
    signed-in user could POST to the RPC and grant themselves arbitrary XP, levels
    and badges.

2. Security changes
  - `award_xp` now derives the amount from a fixed server-side table keyed on
    `p_reason` (mirroring the app's XP rules) and ignores `p_amount` entirely.
    The parameter is kept so existing client calls continue to work.
  - Unknown reasons award 0 XP instead of an attacker-chosen amount.
  - Badge keys are restricted to the six known badges; anything else is ignored.
  - EXECUTE on `award_xp` and `record_metric` is revoked from `anon` (both already
    rejected anonymous callers at runtime; the grant was simply unnecessary).

3. Notes
  1. Legitimate awards (onboarding steps, task added/completed, focus sessions)
     keep their existing values, so progress in the app is unchanged.
  2. The function remains SECURITY DEFINER with a fixed search_path and takes the
     user from the session only.
*/

CREATE OR REPLACE FUNCTION public.award_xp(p_amount integer, p_reason text, p_badge_key text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_amount integer;
  v_badge text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Authoritative XP values. The client-supplied p_amount is deliberately ignored.
  v_amount := CASE p_reason
    WHEN 'onboarding_completed' THEN 50
    WHEN 'managebac_connected' THEN 30
    WHEN 'first_task_imported_from_managebac' THEN 20
    WHEN 'first_ai_study_session' THEN 30
    WHEN 'task_added' THEN 10
    WHEN 'task_completed' THEN 20
    WHEN 'focus_session_25m' THEN 30
    WHEN 'planned_day' THEN 10
    ELSE 0
  END;

  v_badge := CASE p_badge_key
    WHEN 'managebac_connected' THEN p_badge_key
    WHEN 'first_ai_study_session' THEN p_badge_key
    WHEN 'first_task_added' THEN p_badge_key
    WHEN 'first_task_completed' THEN p_badge_key
    WHEN 'first_focus_session' THEN p_badge_key
    WHEN 'onboarding_completed' THEN p_badge_key
    ELSE NULL
  END;

  INSERT INTO user_xp (user_id, total_xp, level)
  VALUES (v_user, v_amount, GREATEST(1, FLOOR(SQRT(v_amount) / 5)::int + 1))
  ON CONFLICT (user_id) DO UPDATE
  SET total_xp = user_xp.total_xp + v_amount,
      level = GREATEST(1, FLOOR(SQRT(user_xp.total_xp + v_amount) / 5)::int + 1),
      updated_at = now();

  IF v_badge IS NOT NULL THEN
    INSERT INTO user_badges (user_id, badge_key)
    VALUES (v_user, v_badge)
    ON CONFLICT (user_id, badge_key) DO NOTHING;
  END IF;

  INSERT INTO app_metrics (user_id, event_name, event_data)
  VALUES (v_user, 'xp_awarded', jsonb_build_object('amount', v_amount, 'reason', p_reason, 'badge', v_badge));
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.award_xp(integer, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.record_metric(text, jsonb) FROM anon;
