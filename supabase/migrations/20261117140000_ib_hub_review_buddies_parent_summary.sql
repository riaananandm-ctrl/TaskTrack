/*
  IB Hub, real study streaks, streak buddies and the parent weekly summary.

  1. ib_grades       marks per criterion (MYP 0-8) or per assessment (DP 1-7).
  2. ib_exams        mock / final exam dates; ib_revision_sessions is the plan built
                     backwards from them.
  3. ib_projects     EE / IA / TOK projects. Their milestones are ordinary tasks
                     (external_source 'ib_project'), so they show in My Tasks and the
                     calendar and get the usual due-tomorrow reminder.
  4. study_days      one row per day a student studied, written by triggers (task done,
                     flashcard reviewed, AI study message, quiz finished). It drives
                     user_streaks, which nothing updated before.
  5. streak_buddies  two students who share a Group Study room keep a joint streak.
  6. parent_summary_links  an opt-in, revocable read-only weekly summary link.

  Every table has row-level security; students only ever see their own rows. Writes
  that involve another student go through SECURITY DEFINER functions that check
  the relationship.
*/

-- ------------------------------------------------------------------ IB grades

CREATE TABLE IF NOT EXISTS public.ib_grades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  subject_name text NOT NULL CHECK (char_length(btrim(subject_name)) BETWEEN 1 AND 60),
  programme text NOT NULL CHECK (programme IN ('MYP', 'DP')),
  level text CHECK (level IN ('SL', 'HL')),
  assessment text CHECK (assessment IS NULL OR char_length(assessment) <= 120),
  criterion text CHECK (criterion IN ('A', 'B', 'C', 'D')),
  mark integer NOT NULL,
  assessed_on date NOT NULL DEFAULT current_date,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (programme = 'MYP' AND criterion IS NOT NULL AND mark BETWEEN 0 AND 8)
    OR (programme = 'DP' AND criterion IS NULL AND mark BETWEEN 1 AND 7)
  )
);
CREATE INDEX IF NOT EXISTS ib_grades_user_idx ON public.ib_grades (user_id, assessed_on DESC);

-- ------------------------------------------------------------------ exams

CREATE TABLE IF NOT EXISTS public.ib_exams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  subject_name text NOT NULL CHECK (char_length(btrim(subject_name)) BETWEEN 1 AND 60),
  paper text CHECK (paper IS NULL OR char_length(paper) <= 60),
  kind text NOT NULL DEFAULT 'final' CHECK (kind IN ('mock', 'final', 'test')),
  exam_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ib_exams_user_idx ON public.ib_exams (user_id, exam_date);

CREATE TABLE IF NOT EXISTS public.ib_revision_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  exam_id uuid NOT NULL REFERENCES public.ib_exams(id) ON DELETE CASCADE,
  session_date date NOT NULL,
  focus text NOT NULL CHECK (char_length(focus) <= 200),
  minutes integer NOT NULL DEFAULT 45 CHECK (minutes BETWEEN 10 AND 240),
  done boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ib_revision_sessions_user_idx ON public.ib_revision_sessions (user_id, session_date);
CREATE INDEX IF NOT EXISTS ib_revision_sessions_exam_idx ON public.ib_revision_sessions (exam_id);

-- ------------------------------------------------------------------ IA / EE projects

CREATE TABLE IF NOT EXISTS public.ib_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('ee', 'ia', 'tok')),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
  subject_name text CHECK (subject_name IS NULL OR char_length(subject_name) <= 60),
  start_date date NOT NULL,
  due_date date NOT NULL CHECK (due_date > start_date),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ib_projects_user_idx ON public.ib_projects (user_id, due_date);

-- Owner-only access for the four tables above.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ib_grades', 'ib_exams', 'ib_revision_sessions', 'ib_projects'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('DROP POLICY IF EXISTS "own rows select" ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "own rows insert" ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "own rows update" ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "own rows delete" ON public.%I', t);
    EXECUTE format('CREATE POLICY "own rows select" ON public.%I FOR SELECT TO authenticated USING ((select auth.uid()) = user_id)', t);
    EXECUTE format('CREATE POLICY "own rows insert" ON public.%I FOR INSERT TO authenticated WITH CHECK ((select auth.uid()) = user_id)', t);
    EXECUTE format('CREATE POLICY "own rows update" ON public.%I FOR UPDATE TO authenticated USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id)', t);
    EXECUTE format('CREATE POLICY "own rows delete" ON public.%I FOR DELETE TO authenticated USING ((select auth.uid()) = user_id)', t);
  END LOOP;
END $$;

-- A revision session must belong to one of the student's own exams.
DROP POLICY IF EXISTS "own rows insert" ON public.ib_revision_sessions;
CREATE POLICY "own rows insert" ON public.ib_revision_sessions FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid()) = user_id
    AND EXISTS (SELECT 1 FROM public.ib_exams e WHERE e.id = exam_id AND e.user_id = (select auth.uid())));

-- Limits so one account can't fill the database.
CREATE OR REPLACE FUNCTION public.tasktrack_row_cap()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_cap integer := TG_ARGV[0]::integer;
  v_count integer;
BEGIN
  EXECUTE format('SELECT count(*) FROM public.%I WHERE user_id = $1', TG_TABLE_NAME) INTO v_count USING NEW.user_id;
  IF v_count >= v_cap THEN RAISE EXCEPTION 'too_many_rows'; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.tasktrack_row_cap() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS ib_grades_cap ON public.ib_grades;
CREATE TRIGGER ib_grades_cap BEFORE INSERT ON public.ib_grades FOR EACH ROW EXECUTE FUNCTION public.tasktrack_row_cap('1000');
DROP TRIGGER IF EXISTS ib_exams_cap ON public.ib_exams;
CREATE TRIGGER ib_exams_cap BEFORE INSERT ON public.ib_exams FOR EACH ROW EXECUTE FUNCTION public.tasktrack_row_cap('60');
DROP TRIGGER IF EXISTS ib_revision_sessions_cap ON public.ib_revision_sessions;
CREATE TRIGGER ib_revision_sessions_cap BEFORE INSERT ON public.ib_revision_sessions FOR EACH ROW EXECUTE FUNCTION public.tasktrack_row_cap('1500');
DROP TRIGGER IF EXISTS ib_projects_cap ON public.ib_projects;
CREATE TRIGGER ib_projects_cap BEFORE INSERT ON public.ib_projects FOR EACH ROW EXECUTE FUNCTION public.tasktrack_row_cap('20');

-- ------------------------------------------------------------------ study days + streaks

CREATE TABLE IF NOT EXISTS public.study_days (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day date NOT NULL,
  PRIMARY KEY (user_id, day)
);
ALTER TABLE public.study_days ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.study_days FROM anon;
GRANT SELECT ON public.study_days TO authenticated;
DROP POLICY IF EXISTS "own study days" ON public.study_days;
CREATE POLICY "own study days" ON public.study_days FOR SELECT TO authenticated USING ((select auth.uid()) = user_id);

/** The student's local date, using their profile timezone (UTC if unknown). */
CREATE OR REPLACE FUNCTION public.tasktrack_local_date(p_user uuid)
RETURNS date LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_tz text;
BEGIN
  SELECT timezone INTO v_tz FROM public.profiles WHERE id = p_user;
  BEGIN
    RETURN (now() AT TIME ZONE coalesce(nullif(v_tz, ''), 'UTC'))::date;
  EXCEPTION WHEN others THEN
    RETURN (now() AT TIME ZONE 'UTC')::date;
  END;
END;
$$;
REVOKE ALL ON FUNCTION public.tasktrack_local_date(uuid) FROM PUBLIC, anon, authenticated;

/** Consecutive study days ending today, or yesterday if today isn't done yet. */
CREATE OR REPLACE FUNCTION public.tasktrack_streak_for(p_user uuid)
RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_today date := public.tasktrack_local_date(p_user);
  v_day date;
  v_n integer := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM public.study_days WHERE user_id = p_user AND day = v_today) THEN
    v_day := v_today;
  ELSE
    v_day := v_today - 1;
  END IF;
  WHILE EXISTS (SELECT 1 FROM public.study_days WHERE user_id = p_user AND day = v_day) AND v_n < 3650 LOOP
    v_n := v_n + 1;
    v_day := v_day - 1;
  END LOOP;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.tasktrack_streak_for(uuid) FROM PUBLIC, anon, authenticated;

/** Record that a student studied today and refresh their streak. */
CREATE OR REPLACE FUNCTION public.tasktrack_log_study_day(p_user uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_today date;
  v_streak integer;
BEGIN
  IF p_user IS NULL THEN RETURN; END IF;
  v_today := public.tasktrack_local_date(p_user);
  INSERT INTO public.study_days (user_id, day) VALUES (p_user, v_today) ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN RETURN; END IF; -- already counted today
  v_streak := public.tasktrack_streak_for(p_user);
  INSERT INTO public.user_streaks (user_id, current_streak, longest_streak, last_study_date, updated_at)
  VALUES (p_user, v_streak, v_streak, v_today, now())
  ON CONFLICT (user_id) DO UPDATE
    SET current_streak = EXCLUDED.current_streak,
        longest_streak = GREATEST(user_streaks.longest_streak, EXCLUDED.current_streak),
        last_study_date = EXCLUDED.last_study_date,
        updated_at = now();
END;
$$;
REVOKE ALL ON FUNCTION public.tasktrack_log_study_day(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tasktrack_study_day_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  IF TG_TABLE_NAME = 'tasks' THEN
    IF NEW.status = 'completed' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'completed') THEN
      PERFORM public.tasktrack_log_study_day(NEW.user_id);
    END IF;
  ELSIF TG_TABLE_NAME = 'study_session_messages' THEN
    IF NEW.role = 'user' THEN PERFORM public.tasktrack_log_study_day(NEW.user_id); END IF;
  ELSIF TG_TABLE_NAME = 'ib_revision_sessions' THEN
    IF NEW.done AND OLD.done IS DISTINCT FROM true THEN PERFORM public.tasktrack_log_study_day(NEW.user_id); END IF;
  ELSE
    PERFORM public.tasktrack_log_study_day(NEW.user_id);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.tasktrack_study_day_trigger() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tasktrack_study_day ON public.tasks;
CREATE TRIGGER tasktrack_study_day AFTER INSERT OR UPDATE OF status ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasktrack_study_day_trigger();
DROP TRIGGER IF EXISTS tasktrack_study_day ON public.review_log;
CREATE TRIGGER tasktrack_study_day AFTER INSERT ON public.review_log
  FOR EACH ROW EXECUTE FUNCTION public.tasktrack_study_day_trigger();
DROP TRIGGER IF EXISTS tasktrack_study_day ON public.study_session_messages;
CREATE TRIGGER tasktrack_study_day AFTER INSERT ON public.study_session_messages
  FOR EACH ROW EXECUTE FUNCTION public.tasktrack_study_day_trigger();
DROP TRIGGER IF EXISTS tasktrack_study_day ON public.quiz_attempts;
CREATE TRIGGER tasktrack_study_day AFTER INSERT ON public.quiz_attempts
  FOR EACH ROW EXECUTE FUNCTION public.tasktrack_study_day_trigger();
DROP TRIGGER IF EXISTS tasktrack_study_day ON public.ib_revision_sessions;
CREATE TRIGGER tasktrack_study_day AFTER UPDATE OF done ON public.ib_revision_sessions
  FOR EACH ROW EXECUTE FUNCTION public.tasktrack_study_day_trigger();

/** The streak shown in the app, recomputed so a missed day shows as 0, not a stale number. */
CREATE OR REPLACE FUNCTION public.get_my_streak()
RETURNS TABLE (current_streak integer, longest_streak integer, studied_today boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_cur integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  v_cur := public.tasktrack_streak_for(v_uid);
  RETURN QUERY SELECT v_cur,
    GREATEST(v_cur, coalesce((SELECT s.longest_streak FROM public.user_streaks s WHERE s.user_id = v_uid), 0)),
    EXISTS (SELECT 1 FROM public.study_days d WHERE d.user_id = v_uid AND d.day = public.tasktrack_local_date(v_uid));
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_streak() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_streak() TO authenticated;

-- Backfill: days with a completed task, a review or an AI study message count.
INSERT INTO public.study_days (user_id, day)
SELECT DISTINCT user_id, (completed_at AT TIME ZONE 'UTC')::date FROM public.tasks
 WHERE status = 'completed' AND completed_at IS NOT NULL AND user_id IS NOT NULL
UNION
SELECT DISTINCT user_id, (reviewed_at AT TIME ZONE 'UTC')::date FROM public.review_log WHERE user_id IS NOT NULL
UNION
SELECT DISTINCT user_id, (created_at AT TIME ZONE 'UTC')::date FROM public.study_session_messages
 WHERE role = 'user' AND user_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO public.user_streaks (user_id, current_streak, longest_streak, last_study_date, updated_at)
SELECT u.user_id, public.tasktrack_streak_for(u.user_id), public.tasktrack_streak_for(u.user_id), max(d.day), now()
  FROM (SELECT DISTINCT user_id FROM public.study_days) u
  JOIN public.study_days d ON d.user_id = u.user_id
 GROUP BY u.user_id
ON CONFLICT (user_id) DO UPDATE
  SET current_streak = EXCLUDED.current_streak,
      longest_streak = GREATEST(user_streaks.longest_streak, EXCLUDED.current_streak),
      last_study_date = EXCLUDED.last_study_date,
      updated_at = now();

-- ------------------------------------------------------------------ streak buddies

CREATE TABLE IF NOT EXISTS public.streak_buddies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  addressee uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active')),
  created_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  CHECK (requester <> addressee)
);
CREATE UNIQUE INDEX IF NOT EXISTS streak_buddies_pair_idx
  ON public.streak_buddies (LEAST(requester, addressee), GREATEST(requester, addressee));
CREATE INDEX IF NOT EXISTS streak_buddies_addressee_idx ON public.streak_buddies (addressee);
ALTER TABLE public.streak_buddies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.streak_buddies FROM anon, authenticated;
GRANT SELECT ON public.streak_buddies TO authenticated;
DROP POLICY IF EXISTS "see own buddy links" ON public.streak_buddies;
CREATE POLICY "see own buddy links" ON public.streak_buddies FOR SELECT TO authenticated
  USING ((select auth.uid()) IN (requester, addressee));

/** True when both students are members of at least one of the same study groups. */
CREATE OR REPLACE FUNCTION public.tasktrack_share_group(p_a uuid, p_b uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.study_group_members a
      JOIN public.study_group_members b ON b.group_id = a.group_id
     WHERE a.user_id = p_a AND b.user_id = p_b
  );
$$;
REVOKE ALL ON FUNCTION public.tasktrack_share_group(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tasktrack_first_name(p_user uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT left(coalesce(nullif(split_part(btrim(full_name), ' ', 1), ''), 'Student'), 40)
    FROM public.profiles WHERE id = p_user;
$$;
REVOKE ALL ON FUNCTION public.tasktrack_first_name(uuid) FROM PUBLIC, anon, authenticated;

/** People the student has studied with in Group Study, who could be a buddy. */
CREATE OR REPLACE FUNCTION public.buddy_candidates()
RETURNS TABLE (user_id uuid, first_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  PERFORM public.tasktrack_require_group_consent();
  RETURN QUERY
    SELECT DISTINCT b.user_id, public.tasktrack_first_name(b.user_id)
      FROM public.study_group_members a
      JOIN public.study_group_members b ON b.group_id = a.group_id AND b.user_id <> v_uid
     WHERE a.user_id = v_uid
       AND NOT EXISTS (
         SELECT 1 FROM public.streak_buddies s
          WHERE LEAST(s.requester, s.addressee) = LEAST(v_uid, b.user_id)
            AND GREATEST(s.requester, s.addressee) = GREATEST(v_uid, b.user_id))
     LIMIT 50;
END;
$$;

CREATE OR REPLACE FUNCTION public.request_streak_buddy(p_user uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  PERFORM public.tasktrack_require_group_consent();
  IF p_user IS NULL OR p_user = v_uid OR NOT public.tasktrack_share_group(v_uid, p_user) THEN
    RAISE EXCEPTION 'not_in_your_groups';
  END IF;
  IF (SELECT count(*) FROM public.streak_buddies WHERE v_uid IN (requester, addressee)) >= 10 THEN
    RAISE EXCEPTION 'too_many_buddies';
  END IF;
  INSERT INTO public.streak_buddies (requester, addressee) VALUES (v_uid, p_user) ON CONFLICT DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.respond_streak_buddy(p_id uuid, p_accept boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  IF p_accept THEN
    UPDATE public.streak_buddies SET status = 'active', accepted_at = now()
     WHERE id = p_id AND addressee = v_uid AND status = 'pending';
  ELSE
    DELETE FROM public.streak_buddies WHERE id = p_id AND addressee = v_uid AND status = 'pending';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_streak_buddy(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  DELETE FROM public.streak_buddies WHERE id = p_id AND auth.uid() IN (requester, addressee);
END;
$$;

/**
 * The student's buddies. For each: first name, whether each of you studied today,
 * and the joint streak (consecutive days you BOTH studied). Nothing else about the
 * other student is shared.
 */
CREATE OR REPLACE FUNCTION public.my_streak_buddies()
RETURNS TABLE (id uuid, first_name text, status text, incoming boolean, me_today boolean,
               buddy_today boolean, shared_streak integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_uid uuid := auth.uid();
  r record;
  v_other uuid;
  v_today date;
  v_day date;
  v_n integer;
  v_me boolean;
  v_them boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  v_today := public.tasktrack_local_date(v_uid);
  FOR r IN SELECT * FROM public.streak_buddies s WHERE v_uid IN (s.requester, s.addressee) ORDER BY s.created_at LOOP
    v_other := CASE WHEN r.requester = v_uid THEN r.addressee ELSE r.requester END;
    v_me := EXISTS (SELECT 1 FROM public.study_days d WHERE d.user_id = v_uid AND d.day = v_today);
    v_them := EXISTS (SELECT 1 FROM public.study_days d WHERE d.user_id = v_other AND d.day = v_today);
    v_n := 0;
    IF r.status = 'active' THEN
      v_day := CASE WHEN v_me AND v_them THEN v_today ELSE v_today - 1 END;
      WHILE v_n < 3650
        AND EXISTS (SELECT 1 FROM public.study_days d WHERE d.user_id = v_uid AND d.day = v_day)
        AND EXISTS (SELECT 1 FROM public.study_days d WHERE d.user_id = v_other AND d.day = v_day) LOOP
        v_n := v_n + 1;
        v_day := v_day - 1;
      END LOOP;
    END IF;
    id := r.id;
    first_name := public.tasktrack_first_name(v_other);
    status := r.status;
    incoming := r.addressee = v_uid AND r.status = 'pending';
    me_today := v_me;
    buddy_today := CASE WHEN r.status = 'active' THEN v_them ELSE false END;
    shared_streak := v_n;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.buddy_candidates() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.request_streak_buddy(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.respond_streak_buddy(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.remove_streak_buddy(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_streak_buddies() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.buddy_candidates() TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_streak_buddy(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_streak_buddy(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_streak_buddy(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_streak_buddies() TO authenticated;

-- ------------------------------------------------------------------ parent weekly summary

CREATE TABLE IF NOT EXISTS public.parent_summary_links (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.parent_summary_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.parent_summary_links FROM anon, authenticated;
GRANT SELECT (user_id, created_at) ON public.parent_summary_links TO authenticated;
DROP POLICY IF EXISTS "see own summary link" ON public.parent_summary_links;
CREATE POLICY "see own summary link" ON public.parent_summary_links FOR SELECT TO authenticated
  USING ((select auth.uid()) = user_id);

/** Turn the summary link on (or make a new one, which stops the old link working). */
CREATE OR REPLACE FUNCTION public.create_parent_summary_link()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_catalog AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_token text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  v_token := encode(gen_random_bytes(24), 'hex');
  INSERT INTO public.parent_summary_links (user_id, token_hash)
  VALUES (v_uid, encode(digest(v_token, 'sha256'), 'hex'))
  ON CONFLICT (user_id) DO UPDATE SET token_hash = EXCLUDED.token_hash, created_at = now();
  RETURN v_token;
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_parent_summary_link()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  DELETE FROM public.parent_summary_links WHERE user_id = auth.uid();
$$;

/**
 * What a parent sees: the student's first name, tasks finished in the last 7 days,
 * tasks due in the next 7 days (title, subject, date only), and the study streak.
 * No notes, descriptions, chats or grades.
 */
CREATE OR REPLACE FUNCTION public.get_parent_summary(p_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions, pg_catalog AS $$
DECLARE
  v_uid uuid;
  v_today date;
BEGIN
  SELECT user_id INTO v_uid FROM public.parent_summary_links
   WHERE token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex');
  IF v_uid IS NULL THEN RETURN NULL; END IF;
  v_today := public.tasktrack_local_date(v_uid);
  RETURN jsonb_build_object(
    'first_name', public.tasktrack_first_name(v_uid),
    'today', v_today,
    'streak', public.tasktrack_streak_for(v_uid),
    'study_days', (SELECT count(*) FROM public.study_days d WHERE d.user_id = v_uid AND d.day > v_today - 7),
    'done', coalesce((
      SELECT jsonb_agg(x ORDER BY x->>'date' DESC) FROM (
        SELECT jsonb_build_object('title', left(t.title, 120), 'subject', s.name,
                                  'date', (t.completed_at AT TIME ZONE 'UTC')::date) x
          FROM public.tasks t LEFT JOIN public.subjects s ON s.id = t.subject_id
         WHERE t.user_id = v_uid AND t.status = 'completed' AND t.completed_at > now() - interval '7 days'
         ORDER BY t.completed_at DESC LIMIT 25) q), '[]'::jsonb),
    'upcoming', coalesce((
      SELECT jsonb_agg(x ORDER BY x->>'date') FROM (
        SELECT jsonb_build_object('title', left(t.title, 120), 'subject', s.name, 'date', t.due_date) x
          FROM public.tasks t LEFT JOIN public.subjects s ON s.id = t.subject_id
         WHERE t.user_id = v_uid AND t.status <> 'completed' AND coalesce(t.is_archived, false) = false
           AND t.due_date BETWEEN v_today AND v_today + 7
         ORDER BY t.due_date LIMIT 25) q), '[]'::jsonb),
    'exams', coalesce((
      SELECT jsonb_agg(x ORDER BY x->>'date') FROM (
        SELECT jsonb_build_object('subject', e.subject_name, 'paper', e.paper, 'kind', e.kind, 'date', e.exam_date) x
          FROM public.ib_exams e
         WHERE e.user_id = v_uid AND e.exam_date BETWEEN v_today AND v_today + 30
         ORDER BY e.exam_date LIMIT 10) q), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_parent_summary_link() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_parent_summary_link() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_parent_summary_link() TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_parent_summary_link() TO authenticated;
-- Parents open the link without an account, so this one is callable by anyone with the token.
REVOKE ALL ON FUNCTION public.get_parent_summary(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_parent_summary(text) TO anon, authenticated;
