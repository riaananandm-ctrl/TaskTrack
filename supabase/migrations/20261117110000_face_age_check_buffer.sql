/*
  Stricter face age check: pass only when the on-device estimate is 25 or older.
  Anyone else is treated as under 18 (Group Study needs a parent's OK).
*/

CREATE OR REPLACE FUNCTION public.tasktrack_record_age_check(p_consented boolean, p_estimated_age numeric)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid uuid := auth.uid();
  r record;
  v_result text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  IF p_consented IS NOT TRUE THEN RAISE EXCEPTION 'scan_consent_required'; END IF;
  IF p_estimated_age IS NULL OR p_estimated_age < 1 OR p_estimated_age > 110 THEN
    RAISE EXCEPTION 'invalid_estimate';
  END IF;

  SELECT * INTO r FROM public.user_consents WHERE user_id = v_uid FOR UPDATE;
  IF NOT FOUND OR r.terms_accepted_at IS NULL THEN RAISE EXCEPTION 'consent_required'; END IF;

  -- 3 tries per rolling day.
  IF r.age_check_window_start IS NULL OR r.age_check_window_start < now() - interval '1 day' THEN
    r.age_check_attempts := 0;
    r.age_check_window_start := now();
  END IF;
  IF r.age_check_attempts >= 3 THEN RAISE EXCEPTION 'too_many_attempts'; END IF;

  -- Buffer: only a clear 25+ estimate passes. The model often guesses teens as
  -- early 20s, so passing at 18 let younger students through.
  v_result := CASE WHEN p_estimated_age >= 25 THEN 'adult' ELSE 'minor' END;

  UPDATE public.user_consents
     SET face_scan_consent_at = now(),
         age_check_attempts = r.age_check_attempts + 1,
         age_check_window_start = r.age_check_window_start,
         age_check_result = v_result,
         age_band = v_result,
         age_verified_at = CASE WHEN v_result = 'adult' THEN now() ELSE NULL END,
         updated_at = now()
   WHERE user_id = v_uid;

  RETURN v_result;
END;
$$;

