-- Christmas presents: about 1 in 100 presents hides a secret redeem code.
--
-- The roll happens here on the server, so the codes never ship in the app and the
-- odds can't be changed from the browser. Which codes can be won is a flag on
-- redeem_codes (the codes themselves stay out of this public migration).
-- Each code can be won once per student, and opens are rate-limited.

ALTER TABLE redeem_codes ADD COLUMN IF NOT EXISTS present_prize boolean NOT NULL DEFAULT false;
UPDATE redeem_codes SET present_prize = true WHERE unlocks IN ('polish', 'detector');

CREATE TABLE IF NOT EXISTS christmas_present_opens (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  won_unlocks text,
  opened_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS christmas_present_opens_user_time
  ON christmas_present_opens (user_id, opened_at DESC);
ALTER TABLE christmas_present_opens ENABLE ROW LEVEL SECURITY;
-- No policies: only the function below touches it.
REVOKE ALL ON christmas_present_opens FROM anon, authenticated;

CREATE OR REPLACE FUNCTION open_christmas_present()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_last timestamptz;
  v_today int;
  v_code text;
  v_unlocks text;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('prize', false);
  END IF;

  -- Presents only fall for students who have Christmas mode.
  IF NOT EXISTS (SELECT 1 FROM tool_unlocks WHERE user_id = v_user AND tool = 'christmas') THEN
    RETURN jsonb_build_object('prize', false);
  END IF;

  SELECT max(opened_at) INTO v_last FROM christmas_present_opens WHERE user_id = v_user;
  SELECT count(*) INTO v_today FROM christmas_present_opens
    WHERE user_id = v_user AND opened_at > now() - interval '1 day';

  -- Faster than a person can tap, or far more than a day of presents: just a note.
  IF (v_last IS NOT NULL AND v_last > now() - interval '1 second') OR v_today >= 300 THEN
    RETURN jsonb_build_object('prize', false);
  END IF;

  IF random() < 0.01 THEN
    SELECT rc.code, rc.unlocks INTO v_code, v_unlocks
    FROM redeem_codes rc
    WHERE rc.present_prize
      AND rc.active
      AND (rc.expires_at IS NULL OR rc.expires_at > now())
      AND (rc.max_redemptions IS NULL OR rc.redeemed_count < rc.max_redemptions)
      AND NOT EXISTS (SELECT 1 FROM tool_unlocks tu WHERE tu.user_id = v_user AND tu.tool = rc.unlocks)
      AND NOT EXISTS (SELECT 1 FROM christmas_present_opens o WHERE o.user_id = v_user AND o.won_unlocks = rc.unlocks)
    ORDER BY random()
    LIMIT 1;
  END IF;

  INSERT INTO christmas_present_opens (user_id, won_unlocks) VALUES (v_user, v_unlocks);

  IF v_code IS NULL THEN
    RETURN jsonb_build_object('prize', false);
  END IF;
  RETURN jsonb_build_object('prize', true, 'code', v_code, 'unlocks', v_unlocks);
END;
$$;

REVOKE ALL ON FUNCTION open_christmas_present() FROM public, anon;
GRANT EXECUTE ON FUNCTION open_christmas_present() TO authenticated;
