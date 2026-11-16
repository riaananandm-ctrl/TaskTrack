-- Second hidden tool: AI Detector (unlocked by a redeem code, Premium only,
-- up to 1000 words, 5 checks a day). Usage is tracked per tool in tool_usage.

ALTER TABLE redeem_codes DROP CONSTRAINT IF EXISTS redeem_codes_unlocks_check;
ALTER TABLE redeem_codes ADD CONSTRAINT redeem_codes_unlocks_check CHECK (unlocks IN ('polish', 'detector'));

CREATE TABLE IF NOT EXISTS tool_usage (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tool text NOT NULL,
  usage_day date NOT NULL,
  uses integer NOT NULL DEFAULT 0 CHECK (uses >= 0),
  last_reserved_at timestamptz,
  PRIMARY KEY (user_id, tool, usage_day)
);
ALTER TABLE tool_usage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Students read their own tool usage" ON tool_usage;
CREATE POLICY "Students read their own tool usage" ON tool_usage
  FOR SELECT TO authenticated USING (user_id = auth.uid());

/** Daily limit per hidden tool (other than polish, which keeps its own table). */
CREATE OR REPLACE FUNCTION tasktrack_tool_daily_limit(p_tool text)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_tool WHEN 'detector' THEN 5 ELSE 0 END;
$$;

CREATE OR REPLACE FUNCTION reserve_tool_use(p_tool text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_day date := (now() AT TIME ZONE 'utc')::date;
  v_limit integer := tasktrack_tool_daily_limit(p_tool);
  v_used integer;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_limit <= 0 THEN RETURN jsonb_build_object('allowed', false, 'reason', 'unknown'); END IF;
  IF NOT EXISTS (SELECT 1 FROM tool_unlocks WHERE user_id = v_user AND tool = p_tool) THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'locked');
  END IF;
  IF coalesce(tasktrack_current_plan(v_user), 'free') <> 'pro' THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'premium');
  END IF;
  INSERT INTO tool_usage (user_id, tool, usage_day) VALUES (v_user, p_tool, v_day) ON CONFLICT DO NOTHING;
  SELECT uses INTO v_used FROM tool_usage
    WHERE user_id = v_user AND tool = p_tool AND usage_day = v_day FOR UPDATE;
  IF v_used >= v_limit THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'limit', 'used', v_used, 'limit', v_limit);
  END IF;
  UPDATE tool_usage SET uses = uses + 1, last_reserved_at = now()
    WHERE user_id = v_user AND tool = p_tool AND usage_day = v_day;
  RETURN jsonb_build_object('allowed', true, 'used', v_used + 1, 'limit', v_limit);
END;
$$;

CREATE OR REPLACE FUNCTION refund_tool_use(p_tool text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_day date := (now() AT TIME ZONE 'utc')::date;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  UPDATE tool_usage SET uses = uses - 1, last_reserved_at = NULL
    WHERE user_id = v_user AND tool = p_tool AND usage_day = v_day AND uses > 0
      AND last_reserved_at > now() - interval '5 minutes';
END;
$$;

CREATE OR REPLACE FUNCTION get_tool_access()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_day date := (now() AT TIME ZONE 'utc')::date;
  v_used integer;
  v_det integer;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT uses INTO v_used FROM polish_usage WHERE user_id = v_user AND usage_day = v_day;
  SELECT uses INTO v_det FROM tool_usage WHERE user_id = v_user AND tool = 'detector' AND usage_day = v_day;
  RETURN jsonb_build_object(
    'unlocked', coalesce((SELECT jsonb_agg(tool) FROM tool_unlocks WHERE user_id = v_user), '[]'::jsonb),
    'premium', coalesce(tasktrack_current_plan(v_user), 'free') = 'pro',
    'polishUsed', coalesce(v_used, 0),
    'polishLimit', 3,
    'detectorUsed', coalesce(v_det, 0),
    'detectorLimit', tasktrack_tool_daily_limit('detector'),
    'resetsAt', ((v_day + 1)::timestamp AT TIME ZONE 'utc')
  );
END;
$$;

REVOKE ALL ON FUNCTION reserve_tool_use(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION refund_tool_use(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION reserve_tool_use(text) TO authenticated;
GRANT EXECUTE ON FUNCTION refund_tool_use(text) TO authenticated;
