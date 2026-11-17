/*
  Group Study: every student needs a parent or guardian's OK. The camera age check is
  retired because it could not reliably tell a 16-year-old from an adult.

  - can_use_group_study / require_group_consent now only accept parent consent.
  - Any student (not just under-18s) can make a parent link.
  - The face age check function is no longer callable, and its stored results are cleared.
*/

CREATE OR REPLACE FUNCTION public.tasktrack_can_use_group_study()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_consents
     WHERE user_id = auth.uid()
       AND terms_accepted_at IS NOT NULL
       AND parent_consent_at IS NOT NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.tasktrack_require_group_consent()
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  r record;
BEGIN
  SELECT terms_accepted_at, parent_consent_at INTO r
    FROM public.user_consents WHERE user_id = auth.uid();
  IF NOT FOUND OR r.terms_accepted_at IS NULL THEN RAISE EXCEPTION 'consent_required'; END IF;
  IF r.parent_consent_at IS NULL THEN RAISE EXCEPTION 'parent_consent_required'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.tasktrack_create_parent_link()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_catalog AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_token text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_consents WHERE user_id = v_uid AND terms_accepted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'consent_required';
  END IF;

  v_token := encode(gen_random_bytes(24), 'hex');
  UPDATE public.user_consents
     SET parent_token_hash = encode(digest(v_token, 'sha256'), 'hex'),
         parent_token_expires_at = now() + interval '14 days',
         updated_at = now()
   WHERE user_id = v_uid;
  RETURN v_token;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.tasktrack_record_age_check(boolean, numeric) FROM PUBLIC, anon, authenticated;

UPDATE public.user_consents
   SET face_scan_consent_at = NULL, age_verified_at = NULL, age_check_result = NULL,
       age_check_attempts = 0, age_check_window_start = NULL
 WHERE face_scan_consent_at IS NOT NULL OR age_verified_at IS NOT NULL OR age_check_result IS NOT NULL
    OR age_check_attempts <> 0 OR age_check_window_start IS NOT NULL;
