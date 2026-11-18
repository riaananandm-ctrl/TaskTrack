-- Premium promised to someone who hasn't signed up yet. When an account is created
-- with a listed email, its new profile gets Premium for that long, once.
-- Emails are added with SQL only (never in this public repo).

CREATE TABLE IF NOT EXISTS premium_grants (
  email text PRIMARY KEY CHECK (email = lower(email)),
  duration interval NOT NULL DEFAULT interval '1 year',
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz,
  applied_user uuid
);
ALTER TABLE premium_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON premium_grants FROM anon, authenticated;

CREATE OR REPLACE FUNCTION tasktrack_apply_premium_grant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
  v_duration interval;
BEGIN
  SELECT lower(email) INTO v_email FROM auth.users WHERE id = NEW.id;
  IF v_email IS NULL THEN RETURN NEW; END IF;

  UPDATE premium_grants
     SET applied_at = now(), applied_user = NEW.id
   WHERE email = v_email AND applied_at IS NULL
  RETURNING duration INTO v_duration;

  IF v_duration IS NOT NULL THEN
    UPDATE profiles SET plan = 'pro', plan_expires_at = now() + v_duration WHERE id = NEW.id;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block a sign-up because of a promo.
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tasktrack_premium_grant_on_signup ON profiles;
CREATE TRIGGER tasktrack_premium_grant_on_signup
  AFTER INSERT ON profiles
  FOR EACH ROW EXECUTE FUNCTION tasktrack_apply_premium_grant();
