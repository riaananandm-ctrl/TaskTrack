/*
  # Terms, age and parental consent; Group Study reports

  Why
  - India's Digital Personal Data Protection Act treats everyone under 18 as a child
    and asks for a parent's or guardian's consent. Many TaskTrack students are minors.
  - Group Study lets students talk to each other, so they need a way to report messages.

  1. user_consents (one row per student)
     - terms_accepted_at / terms_version: when the student agreed to the Terms and
       Privacy Policy, and which version.
     - age_band: 'adult' (18+) or 'minor' (under 18).
     - parent_name / parent_consent_at: filled in when a parent or guardian confirms
       through the consent link.
     - parent_token_hash / parent_token_expires_at: SHA-256 of the one-time consent
       link. The link itself is never stored.
     Students can only READ their own row. Every write goes through the functions
     below, so nobody can mark themselves as "parent approved".

  2. Functions
     - tasktrack_accept_terms(p_age_band): records agreement and age. A minor's
       existing parent consent is kept.
     - tasktrack_create_parent_link(): makes a new consent link (valid 14 days) for
       a minor. Returns the token to put in the link.
     - tasktrack_parent_link_info(p_token): for the parent's page; returns only the
       student's first name and whether the link is valid. Works signed out.
     - tasktrack_confirm_parent_consent(p_token, p_parent_name): the parent's
       confirmation. Works signed out. The link stops working once used.
     - tasktrack_can_use_group_study(): true for adults and for minors whose parent
       has confirmed.

  3. Group Study needs consent
     create_study_group and join_study_group now refuse with "consent_required"
     until the student has accepted the terms, and with "parent_consent_required"
     for a minor without a parent's confirmation.

  4. study_group_reports
     A member can report a message in a room they belong to (not their own). Reports
     are private: students can't read them; they are reviewed from the Supabase
     dashboard.
*/

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.user_consents (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  terms_accepted_at timestamptz,
  terms_version text,
  age_band text CHECK (age_band IN ('adult', 'minor')),
  parent_name text CHECK (parent_name IS NULL OR char_length(parent_name) BETWEEN 2 AND 80),
  parent_consent_at timestamptz,
  parent_token_hash text,
  parent_token_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_consents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Students can view their own consent" ON public.user_consents;
CREATE POLICY "Students can view their own consent" ON public.user_consents
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE UNIQUE INDEX IF NOT EXISTS user_consents_token_idx
  ON public.user_consents (parent_token_hash) WHERE parent_token_hash IS NOT NULL;

-- Current version of the Terms and Privacy Policy. Bump when they change.
CREATE OR REPLACE FUNCTION public.tasktrack_terms_version()
RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT '2026-11-13' $$;

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
        updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.tasktrack_create_parent_link()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_catalog
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_token text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_consents WHERE user_id = v_uid AND age_band = 'minor') THEN
    RAISE EXCEPTION 'not_a_minor';
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

CREATE OR REPLACE FUNCTION public.tasktrack_parent_link_info(p_token text)
RETURNS TABLE (student_first_name text, valid boolean, already_confirmed boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_catalog
AS $$
DECLARE
  r record;
BEGIN
  SELECT c.user_id, c.parent_token_expires_at, c.parent_consent_at,
         split_part(btrim(coalesce(p.full_name, '')), ' ', 1) AS first_name
    INTO r
    FROM public.user_consents c
    LEFT JOIN public.profiles p ON p.id = c.user_id
   WHERE c.parent_token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex');

  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::text, false, false;
    RETURN;
  END IF;

  RETURN QUERY SELECT nullif(r.first_name, ''), r.parent_token_expires_at > now(), r.parent_consent_at IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.tasktrack_confirm_parent_consent(p_token text, p_parent_name text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_catalog
AS $$
DECLARE
  v_name text := left(btrim(coalesce(p_parent_name, '')), 80);
BEGIN
  IF char_length(v_name) < 2 THEN RAISE EXCEPTION 'name_required'; END IF;

  UPDATE public.user_consents
     SET parent_consent_at = now(),
         parent_name = v_name,
         parent_token_hash = NULL,
         parent_token_expires_at = NULL,
         updated_at = now()
   WHERE parent_token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex')
     AND parent_token_expires_at > now();
  RETURN FOUND;
END;
$$;

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
       AND (age_band = 'adult' OR parent_consent_at IS NOT NULL)
  );
$$;

-- Raises the right error when a student may not use Group Study yet.
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
  SELECT terms_accepted_at, age_band, parent_consent_at INTO r
    FROM public.user_consents WHERE user_id = auth.uid();
  IF NOT FOUND OR r.terms_accepted_at IS NULL THEN
    RAISE EXCEPTION 'consent_required';
  END IF;
  IF r.age_band = 'minor' AND r.parent_consent_at IS NULL THEN
    RAISE EXCEPTION 'parent_consent_required';
  END IF;
END;
$$;

-- Group Study: same functions as before, now with the consent check first.
CREATE OR REPLACE FUNCTION public.create_study_group(p_name text, p_topic text DEFAULT NULL)
RETURNS TABLE (id uuid, join_code text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_code text;
  v_id uuid;
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_name text := left(btrim(coalesce(p_name, '')), 80);
  v_topic text := nullif(left(btrim(coalesce(p_topic, '')), 300), '');
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  PERFORM public.tasktrack_require_group_consent();
  IF v_name = '' THEN RAISE EXCEPTION 'name_required'; END IF;
  IF (SELECT count(*) FROM public.study_groups g WHERE g.host_id = v_uid AND g.ended_at IS NULL) >= 5 THEN
    RAISE EXCEPTION 'too_many_groups';
  END IF;

  LOOP
    SELECT string_agg(substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1), '')
      INTO v_code FROM generate_series(1, 6);
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.study_groups g WHERE g.join_code = v_code);
  END LOOP;

  INSERT INTO public.study_groups (host_id, name, topic, join_code)
  VALUES (v_uid, v_name, v_topic, v_code)
  RETURNING study_groups.id INTO v_id;

  INSERT INTO public.study_group_members (group_id, user_id, display_name)
  VALUES (v_id, v_uid, public.tasktrack_study_display_name());

  RETURN QUERY SELECT v_id, v_code;
END;
$$;

CREATE OR REPLACE FUNCTION public.join_study_group(p_code text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_group uuid;
  v_name text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  PERFORM public.tasktrack_require_group_consent();

  SELECT g.id INTO v_group FROM public.study_groups g
   WHERE g.join_code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'))
     AND g.ended_at IS NULL;
  IF v_group IS NULL THEN RAISE EXCEPTION 'group_not_found'; END IF;

  IF EXISTS (SELECT 1 FROM public.study_group_members m WHERE m.group_id = v_group AND m.user_id = v_uid) THEN
    RETURN v_group;
  END IF;

  IF (SELECT count(*) FROM public.study_group_members m WHERE m.group_id = v_group) >= 8 THEN
    RAISE EXCEPTION 'group_full';
  END IF;

  v_name := public.tasktrack_study_display_name();
  INSERT INTO public.study_group_members (group_id, user_id, display_name) VALUES (v_group, v_uid, v_name);
  INSERT INTO public.study_group_messages (group_id, user_id, display_name, kind, content)
  VALUES (v_group, v_uid, v_name, 'system', v_name || ' joined the group');
  RETURN v_group;
END;
$$;

-- Reports
CREATE TABLE IF NOT EXISTS public.study_group_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.study_groups(id) ON DELETE CASCADE,
  message_id uuid REFERENCES public.study_group_messages(id) ON DELETE SET NULL,
  reporter_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (reason IN ('bullying', 'inappropriate', 'personal_info', 'spam', 'other')),
  details text CHECK (details IS NULL OR char_length(details) <= 500),
  message_snapshot text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, reporter_id)
);

ALTER TABLE public.study_group_reports ENABLE ROW LEVEL SECURITY;
-- No SELECT/INSERT policies: reports are private and only written through the function below.

CREATE OR REPLACE FUNCTION public.report_study_message(p_message uuid, p_reason text, p_details text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid uuid := auth.uid();
  m record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  SELECT id, group_id, user_id, content INTO m FROM public.study_group_messages WHERE id = p_message;
  IF NOT FOUND OR NOT public.is_study_group_member(m.group_id) THEN RAISE EXCEPTION 'message_not_found'; END IF;
  IF m.user_id = v_uid THEN RAISE EXCEPTION 'own_message'; END IF;
  IF p_reason NOT IN ('bullying', 'inappropriate', 'personal_info', 'spam', 'other') THEN RAISE EXCEPTION 'invalid_reason'; END IF;

  INSERT INTO public.study_group_reports (group_id, message_id, reporter_id, reason, details, message_snapshot)
  VALUES (m.group_id, m.id, v_uid, p_reason, nullif(left(btrim(coalesce(p_details, '')), 500), ''), left(m.content, 2000))
  ON CONFLICT (message_id, reporter_id) DO NOTHING;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.tasktrack_accept_terms(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tasktrack_create_parent_link() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tasktrack_can_use_group_study() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tasktrack_require_group_consent() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.report_study_message(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tasktrack_parent_link_info(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tasktrack_confirm_parent_consent(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tasktrack_accept_terms(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tasktrack_create_parent_link() TO authenticated;
GRANT EXECUTE ON FUNCTION public.tasktrack_can_use_group_study() TO authenticated;
GRANT EXECUTE ON FUNCTION public.report_study_message(uuid, text, text) TO authenticated;
-- The parent is usually not signed in.
GRANT EXECUTE ON FUNCTION public.tasktrack_parent_link_info(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tasktrack_confirm_parent_consent(text, text) TO anon, authenticated;
