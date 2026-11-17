/*
  Close two loopholes.

  1. Refunds. refund_ai_credits / refund_tool_use / refund_polish_use were callable by
     signed-in students, so anyone could use an AI feature and then refund it from the
     browser for unlimited free use. Refunds now go through *_for(p_user, ...) functions
     that only the service role (TaskTrack's own server functions) can call, and the
     old student-callable versions are revoked.

  2. XP. award_xp could be called repeatedly (e.g. task_completed) to farm XP. One-time
     rewards now pay out once per student ever, and repeatable rewards have a daily cap.
*/

-- ---------------------------------------------------------------- refunds

CREATE OR REPLACE FUNCTION public.refund_ai_credits_for(p_user uuid, p_cost integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_month date := date_trunc('month', now() AT TIME ZONE 'utc')::date;
BEGIN
  IF p_user IS NULL THEN RETURN; END IF;
  UPDATE ai_credit_usage
     SET credits_used = GREATEST(credits_used - LEAST(last_cost, GREATEST(COALESCE(p_cost, 1), 1)), 0),
         refund_count = refund_count + 1, last_cost = 0, updated_at = now()
   WHERE user_id = p_user AND usage_month = v_month
     AND last_cost > 0 AND last_reserved_at > now() - interval '5 minutes';
END;
$$;

CREATE OR REPLACE FUNCTION public.refund_tool_use_for(p_user uuid, p_tool text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_day date := (now() AT TIME ZONE 'utc')::date;
BEGIN
  IF p_user IS NULL THEN RETURN; END IF;
  UPDATE tool_usage SET uses = uses - 1, last_reserved_at = NULL
   WHERE user_id = p_user AND tool = p_tool AND usage_day = v_day AND uses > 0
     AND last_reserved_at > now() - interval '5 minutes';
END;
$$;

CREATE OR REPLACE FUNCTION public.refund_polish_use_for(p_user uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_day date := (now() AT TIME ZONE 'utc')::date;
BEGIN
  IF p_user IS NULL THEN RETURN; END IF;
  UPDATE polish_usage SET uses = uses - 1, last_reserved_at = NULL
   WHERE user_id = p_user AND usage_day = v_day AND uses > 0
     AND last_reserved_at > now() - interval '5 minutes';
END;
$$;

REVOKE ALL ON FUNCTION public.refund_ai_credits_for(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refund_tool_use_for(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refund_polish_use_for(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_ai_credits_for(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.refund_tool_use_for(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.refund_polish_use_for(uuid) TO service_role;

-- The old student-callable refunds are revoked in the next migration, after the
-- server functions have switched to the *_for versions.

-- ---------------------------------------------------------------- XP

CREATE INDEX IF NOT EXISTS app_metrics_user_event_time_idx
  ON public.app_metrics (user_id, event_name, created_at DESC);

CREATE OR REPLACE FUNCTION public.award_xp(p_amount integer, p_reason text, p_badge_key text DEFAULT NULL::text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_amount integer;
  v_badge text;
  v_once boolean;
  v_daily_cap integer;
  v_given integer;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

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

  -- One-time rewards pay out once ever; repeatable ones are capped per day (UTC).
  v_once := p_reason IN ('onboarding_completed', 'managebac_connected',
                         'first_task_imported_from_managebac', 'first_ai_study_session');
  v_daily_cap := CASE p_reason
    WHEN 'task_added' THEN 15
    WHEN 'task_completed' THEN 15
    WHEN 'focus_session_25m' THEN 8
    WHEN 'planned_day' THEN 1
    ELSE NULL
  END;

  IF v_amount > 0 AND (v_once OR v_daily_cap IS NOT NULL) THEN
    SELECT count(*) INTO v_given
      FROM app_metrics
     WHERE user_id = v_user
       AND event_name = 'xp_awarded'
       AND event_data->>'reason' = p_reason
       AND (event_data->>'amount')::int > 0
       AND (v_once OR created_at >= date_trunc('day', now() AT TIME ZONE 'utc') AT TIME ZONE 'utc');
    IF (v_once AND v_given >= 1) OR (NOT v_once AND v_given >= v_daily_cap) THEN
      v_amount := 0;
    END IF;
  END IF;

  v_badge := CASE p_badge_key
    WHEN 'managebac_connected' THEN p_badge_key
    WHEN 'first_ai_study_session' THEN p_badge_key
    WHEN 'first_task_added' THEN p_badge_key
    WHEN 'first_task_completed' THEN p_badge_key
    WHEN 'first_focus_session' THEN p_badge_key
    WHEN 'onboarding_completed' THEN p_badge_key
    ELSE NULL
  END;

  IF v_amount > 0 THEN
    INSERT INTO user_xp (user_id, total_xp, level)
    VALUES (v_user, v_amount, GREATEST(1, FLOOR(SQRT(v_amount) / 5)::int + 1))
    ON CONFLICT (user_id) DO UPDATE
      SET total_xp = user_xp.total_xp + v_amount,
          level = GREATEST(1, FLOOR(SQRT(user_xp.total_xp + v_amount) / 5)::int + 1),
          updated_at = now();

    INSERT INTO app_metrics (user_id, event_name, event_data)
    VALUES (v_user, 'xp_awarded', jsonb_build_object('amount', v_amount, 'reason', p_reason, 'badge', v_badge));
  END IF;

  IF v_badge IS NOT NULL THEN
    INSERT INTO user_badges (user_id, badge_key)
    VALUES (v_user, v_badge)
    ON CONFLICT (user_id, badge_key) DO NOTHING;
  END IF;
END;
$$;
