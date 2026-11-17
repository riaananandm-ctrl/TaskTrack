/*
  Face age check for students who say they're 18 or older.

  The age estimate runs entirely in the student's browser. No image or video is
  uploaded or stored. The database only keeps:
    - when the student agreed to the scan (separately from the Terms),
    - whether the scan said 18+ or under 18, and when,
    - an attempt counter (3 per day) so nobody can retry until they pass.

  Rules:
    - Estimated 18+  -> age_band 'adult', age_verified_at set.
    - Estimated < 18 -> age_band 'minor'; Group Study then needs a parent's OK,
      using the existing parent link.
    - Group Study for adults now requires a passed scan (age_verified_at).
*/

ALTER TABLE public.user_consents
  ADD COLUMN IF NOT EXISTS face_scan_consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS age_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS age_check_result text CHECK (age_check_result IS NULL OR age_check_result IN ('adult', 'minor')),
  ADD COLUMN IF NOT EXISTS age_check_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS age_check_window_start timestamptz;

-- Saying "18 or older" again must not keep an earlier passed scan from a different claim,
-- and saying "under 18" clears any adult verification.
CREATE OR REPLACE FUNCTION public.tasktrack_accept_terms(p_age_band text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  IF p_age_band NOT IN ('adult', 'minor') THEN RAISE EXCEPTION 'invalid_age'; END IF;

  INSERT INTO public.user_consents (user_id, terms_accepted_at, terms_version, age_band)
  VALUES (v_uid, now(), public.tasktrack_terms_version(), p_age_band)
  ON CONFLICT (user_id) DO UPDATE
    SET terms_accepted_at = now(),
        terms_version = public.tasktrack_terms_version(),
        age_band = EXCLUDED.age_band,
        age_verified_at = CASE WHEN EXCLUDED.age_band = 'adult' THEN user_consents.age_verified_at ELSE NULL END,
        updated_at = now();
END;
$$;

/*
  Records the result of an on-device age estimate. p_estimated_age is the median of
  several camera frames. Returns 'adult' or 'minor'.
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

  v_result := CASE WHEN p_estimated_age >= 18 THEN 'adult' ELSE 'minor' END;

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

REVOKE ALL ON FUNCTION public.tasktrack_record_age_check(boolean, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tasktrack_record_age_check(boolean, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.tasktrack_can_use_group_study()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_consents
     WHERE user_id = auth.uid()
       AND terms_accepted_at IS NOT NULL
       AND ((age_band = 'adult' AND age_verified_at IS NOT NULL) OR parent_consent_at IS NOT NULL)
  );
$$;

CREATE OR REPLACE FUNCTION public.tasktrack_require_group_consent()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  r record;
BEGIN
  SELECT terms_accepted_at, age_band, parent_consent_at, age_verified_at INTO r
    FROM public.user_consents WHERE user_id = auth.uid();
  IF NOT FOUND OR r.terms_accepted_at IS NULL THEN
    RAISE EXCEPTION 'consent_required';
  END IF;
  IF r.parent_consent_at IS NOT NULL THEN RETURN; END IF;
  IF r.age_band = 'minor' THEN RAISE EXCEPTION 'parent_consent_required'; END IF;
  IF r.age_verified_at IS NULL THEN RAISE EXCEPTION 'age_check_required'; END IF;
END;
$$;
