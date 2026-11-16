-- Redeem codes (posted on @task.track) that unlock hidden tools, and the usage limit
-- for the first one: "Polish my writing" (Premium only, 3 polishes a day).
--
-- Codes live only in the database. Students never read the codes table; they can only
-- call redeem_code(), which checks a code on the server and rate-limits guessing.
-- The codes themselves are inserted separately (not in this public migration).

CREATE TABLE IF NOT EXISTS redeem_codes (
  code text PRIMARY KEY CHECK (code = upper(code) AND length(code) BETWEEN 4 AND 40),
  unlocks text NOT NULL CHECK (unlocks IN ('polish')),
  active boolean NOT NULL DEFAULT true,
  max_redemptions integer CHECK (max_redemptions IS NULL OR max_redemptions > 0),
  redeemed_count integer NOT NULL DEFAULT 0,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE redeem_codes ENABLE ROW LEVEL SECURITY;
-- No policies: only security-definer functions and the service role touch codes.

CREATE TABLE IF NOT EXISTS tool_unlocks (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tool text NOT NULL,
  code text,
  unlocked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tool)
);
ALTER TABLE tool_unlocks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Students read their own unlocks" ON tool_unlocks;
CREATE POLICY "Students read their own unlocks" ON tool_unlocks
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS redeem_attempts (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  success boolean NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS redeem_attempts_user_time ON redeem_attempts (user_id, attempted_at DESC);
ALTER TABLE redeem_attempts ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS polish_usage (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  usage_day date NOT NULL,
  uses integer NOT NULL DEFAULT 0 CHECK (uses >= 0),
  last_reserved_at timestamptz,
  PRIMARY KEY (user_id, usage_day)
);
ALTER TABLE polish_usage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Students read their own polish usage" ON polish_usage;
CREATE POLICY "Students read their own polish usage" ON polish_usage
  FOR SELECT TO authenticated USING (user_id = auth.uid());

/** Redeem a code. Max 10 wrong guesses per hour per student. */
CREATE OR REPLACE FUNCTION redeem_code(p_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '\s+', '', 'g'));
  v_row redeem_codes%ROWTYPE;
  v_fails integer;
  v_inserted integer;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT count(*) INTO v_fails FROM redeem_attempts
    WHERE user_id = v_user AND NOT success AND attempted_at > now() - interval '1 hour';
  IF v_fails >= 10 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rate_limited');
  END IF;

  SELECT * INTO v_row FROM redeem_codes WHERE code = v_code FOR UPDATE;
  IF NOT FOUND OR NOT v_row.active
     OR (v_row.expires_at IS NOT NULL AND v_row.expires_at <= now())
     OR (v_row.max_redemptions IS NOT NULL AND v_row.redeemed_count >= v_row.max_redemptions) THEN
    INSERT INTO redeem_attempts (user_id, success) VALUES (v_user, false);
    RETURN jsonb_build_object('ok', false, 'error', 'invalid');
  END IF;

  INSERT INTO tool_unlocks (user_id, tool, code) VALUES (v_user, v_row.unlocks, v_code)
    ON CONFLICT (user_id, tool) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted > 0 THEN
    UPDATE redeem_codes SET redeemed_count = redeemed_count + 1 WHERE code = v_code;
  END IF;
  INSERT INTO redeem_attempts (user_id, success) VALUES (v_user, true);
  RETURN jsonb_build_object('ok', true, 'tool', v_row.unlocks, 'already', v_inserted = 0);
END;
$$;

/** What the student has: unlocked tools, Premium, and today's polish usage. */
CREATE OR REPLACE FUNCTION get_tool_access()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_day date := (now() AT TIME ZONE 'utc')::date;
  v_used integer;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT uses INTO v_used FROM polish_usage WHERE user_id = v_user AND usage_day = v_day;
  RETURN jsonb_build_object(
    'unlocked', coalesce((SELECT jsonb_agg(tool) FROM tool_unlocks WHERE user_id = v_user), '[]'::jsonb),
    'premium', coalesce(tasktrack_current_plan(v_user), 'free') = 'pro',
    'polishUsed', coalesce(v_used, 0),
    'polishLimit', 3,
    'resetsAt', ((v_day + 1)::timestamp AT TIME ZONE 'utc')
  );
END;
$$;

/** Take one polish if the student unlocked it, is Premium and has some left today. */
CREATE OR REPLACE FUNCTION reserve_polish_use()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_day date := (now() AT TIME ZONE 'utc')::date;
  v_used integer;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT EXISTS (SELECT 1 FROM tool_unlocks WHERE user_id = v_user AND tool = 'polish') THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'locked');
  END IF;
  IF coalesce(tasktrack_current_plan(v_user), 'free') <> 'pro' THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'premium');
  END IF;
  INSERT INTO polish_usage (user_id, usage_day) VALUES (v_user, v_day) ON CONFLICT DO NOTHING;
  SELECT uses INTO v_used FROM polish_usage WHERE user_id = v_user AND usage_day = v_day FOR UPDATE;
  IF v_used >= 3 THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'limit', 'used', v_used);
  END IF;
  UPDATE polish_usage SET uses = uses + 1, last_reserved_at = now()
    WHERE user_id = v_user AND usage_day = v_day;
  RETURN jsonb_build_object('allowed', true, 'used', v_used + 1);
END;
$$;

/** Give back today's latest polish when the AI failed (within 5 minutes, once). */
CREATE OR REPLACE FUNCTION refund_polish_use()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_day date := (now() AT TIME ZONE 'utc')::date;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  UPDATE polish_usage SET uses = uses - 1, last_reserved_at = NULL
    WHERE user_id = v_user AND usage_day = v_day AND uses > 0
      AND last_reserved_at > now() - interval '5 minutes';
END;
$$;

REVOKE ALL ON FUNCTION redeem_code(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION get_tool_access() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION reserve_polish_use() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION refund_polish_use() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION redeem_code(text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_tool_access() TO authenticated;
GRANT EXECUTE ON FUNCTION reserve_polish_use() TO authenticated;
GRANT EXECUTE ON FUNCTION refund_polish_use() TO authenticated;
