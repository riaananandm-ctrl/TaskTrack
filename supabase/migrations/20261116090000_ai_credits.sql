-- AI credits replace the daily message count.
--
-- Each plan gets a monthly credit allowance (reset on the 1st, UTC). Each AI action
-- costs credits by how much work it is: chat 1, quiz/flashcards/plan 2, slides 3,
-- AI Grader 5. The cost is decided by the server-side function, never the browser.

ALTER TABLE plan_limits ADD COLUMN IF NOT EXISTS monthly_ai_credits integer;
UPDATE plan_limits SET monthly_ai_credits = 100 WHERE plan = 'free';
UPDATE plan_limits SET monthly_ai_credits = 2000 WHERE plan = 'pro';

CREATE TABLE IF NOT EXISTS ai_credit_usage (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  usage_month date NOT NULL,
  credits_used integer NOT NULL DEFAULT 0 CHECK (credits_used >= 0),
  refund_count integer NOT NULL DEFAULT 0,
  -- What the latest request spent, so a failed request can be refunded exactly once.
  last_cost integer NOT NULL DEFAULT 0,
  last_reserved_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, usage_month)
);

ALTER TABLE ai_credit_usage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Students read their own credit usage" ON ai_credit_usage;
CREATE POLICY "Students read their own credit usage" ON ai_credit_usage
  FOR SELECT TO authenticated USING (user_id = auth.uid());
-- No insert/update/delete policies: only the functions below change usage.

/** The plan the student is really on (an expired Pro counts as Free). */
CREATE OR REPLACE FUNCTION tasktrack_current_plan(p_user uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN p.plan = 'pro' AND (p.plan_expires_at IS NULL OR p.plan_expires_at > now()) THEN 'pro'
    ELSE 'free'
  END
  FROM profiles p WHERE p.id = p_user;
$$;

/** Credits used, allowance, what is left and when it refills. */
CREATE OR REPLACE FUNCTION get_ai_credits()
RETURNS TABLE(used integer, credit_limit integer, remaining integer, resets_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_month date := date_trunc('month', now() AT TIME ZONE 'utc')::date;
  v_limit integer;
  v_used integer;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT pl.monthly_ai_credits INTO v_limit FROM plan_limits pl
    WHERE pl.plan = COALESCE(tasktrack_current_plan(v_user), 'free');
  v_limit := COALESCE(v_limit, 100);
  SELECT u.credits_used INTO v_used FROM ai_credit_usage u WHERE u.user_id = v_user AND u.usage_month = v_month;
  v_used := COALESCE(v_used, 0);
  RETURN QUERY SELECT v_used, v_limit, GREATEST(v_limit - v_used, 0),
    ((v_month + interval '1 month')::timestamp AT TIME ZONE 'utc');
END;
$$;

/** Take p_cost credits if the student has enough. Locks the row so two requests can't overspend. */
CREATE OR REPLACE FUNCTION reserve_ai_credits(p_cost integer)
RETURNS TABLE(allowed boolean, used integer, credit_limit integer, remaining integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_month date := date_trunc('month', now() AT TIME ZONE 'utc')::date;
  v_cost integer := LEAST(GREATEST(COALESCE(p_cost, 1), 1), 20);
  v_limit integer;
  v_used integer;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT pl.monthly_ai_credits INTO v_limit FROM plan_limits pl
    WHERE pl.plan = COALESCE(tasktrack_current_plan(v_user), 'free');
  v_limit := COALESCE(v_limit, 100);

  INSERT INTO ai_credit_usage (user_id, usage_month) VALUES (v_user, v_month)
    ON CONFLICT (user_id, usage_month) DO NOTHING;
  SELECT u.credits_used INTO v_used FROM ai_credit_usage u
    WHERE u.user_id = v_user AND u.usage_month = v_month FOR UPDATE;

  IF v_used + v_cost > v_limit THEN
    RETURN QUERY SELECT false, v_used, v_limit, GREATEST(v_limit - v_used, 0);
    RETURN;
  END IF;

  UPDATE ai_credit_usage
    SET credits_used = credits_used + v_cost, last_cost = v_cost, last_reserved_at = now(), updated_at = now()
    WHERE user_id = v_user AND usage_month = v_month;
  RETURN QUERY SELECT true, v_used + v_cost, v_limit, v_limit - v_used - v_cost;
END;
$$;

/**
 * Give back what the student's latest request spent when the AI failed. Only that
 * request, only once, and only within 5 minutes, so credits can't be farmed by
 * calling this directly.
 */
CREATE OR REPLACE FUNCTION refund_ai_credits(p_cost integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_month date := date_trunc('month', now() AT TIME ZONE 'utc')::date;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  UPDATE ai_credit_usage
    SET credits_used = GREATEST(credits_used - LEAST(last_cost, GREATEST(COALESCE(p_cost, 1), 1)), 0),
        refund_count = refund_count + 1, last_cost = 0, updated_at = now()
    WHERE user_id = v_user AND usage_month = v_month
      AND last_cost > 0 AND last_reserved_at > now() - interval '5 minutes';
END;
$$;

-- The old one-message functions now spend one credit, so anything still calling them
-- keeps working. `daily_limit` carries the monthly credit allowance.
CREATE OR REPLACE FUNCTION reserve_ai_request()
RETURNS TABLE(allowed boolean, used integer, daily_limit integer)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT r.allowed, r.used, r.credit_limit FROM reserve_ai_credits(1) r;
$$;

CREATE OR REPLACE FUNCTION refund_ai_request()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT refund_ai_credits(1);
$$;

REVOKE ALL ON FUNCTION reserve_ai_credits(integer), refund_ai_credits(integer), get_ai_credits(),
  tasktrack_current_plan(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION reserve_ai_credits(integer), refund_ai_credits(integer), get_ai_credits()
  TO authenticated;
