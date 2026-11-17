-- Rewrite Coach: suggests edits to a student's OWN draft for a task. The student
-- accepts or rejects each edit and can save the result to the task. The original
-- draft is kept and can always be restored.
--
-- Privacy: a draft is stored only when the student saves it. It is deleted with its
-- task, on request, or automatically 30 days after the task is completed/archived.

CREATE TABLE IF NOT EXISTS task_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  original_text text NOT NULL CHECK (char_length(original_text) BETWEEN 1 AND 20000),
  revised_text text NOT NULL CHECK (char_length(revised_text) BETWEEN 1 AND 20000),
  permission_confirmed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_task_drafts_user ON task_drafts(user_id);
ALTER TABLE task_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Students read their own drafts" ON task_drafts;
CREATE POLICY "Students read their own drafts" ON task_drafts
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Students add drafts to their own tasks" ON task_drafts;
CREATE POLICY "Students add drafts to their own tasks" ON task_drafts
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_id AND t.user_id = auth.uid()));

DROP POLICY IF EXISTS "Students update their own drafts" ON task_drafts;
CREATE POLICY "Students update their own drafts" ON task_drafts
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Students delete their own drafts" ON task_drafts;
CREATE POLICY "Students delete their own drafts" ON task_drafts
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- The original is never overwritten: only the revised text can be updated.
REVOKE ALL ON task_drafts FROM anon;
REVOKE UPDATE ON task_drafts FROM authenticated;
GRANT SELECT, INSERT, DELETE ON task_drafts TO authenticated;
GRANT UPDATE (revised_text, updated_at) ON task_drafts TO authenticated;

CREATE OR REPLACE FUNCTION task_drafts_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS task_drafts_touch ON task_drafts;
CREATE TRIGGER task_drafts_touch BEFORE UPDATE ON task_drafts
  FOR EACH ROW EXECUTE FUNCTION task_drafts_touch();

-- Daily limit: everyone can use it; Premium gets more. Tracked in tool_usage.
CREATE OR REPLACE FUNCTION tasktrack_coach_daily_limit(p_user uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN coalesce(tasktrack_current_plan(p_user), 'free') = 'pro' THEN 20 ELSE 5 END;
$$;
REVOKE ALL ON FUNCTION tasktrack_coach_daily_limit(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION reserve_coach_use()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_day date := (now() AT TIME ZONE 'utc')::date;
  v_limit integer;
  v_used integer;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  v_limit := tasktrack_coach_daily_limit(v_user);
  INSERT INTO tool_usage (user_id, tool, usage_day) VALUES (v_user, 'coach', v_day) ON CONFLICT DO NOTHING;
  SELECT uses INTO v_used FROM tool_usage
    WHERE user_id = v_user AND tool = 'coach' AND usage_day = v_day FOR UPDATE;
  IF v_used >= v_limit THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'limit', 'used', v_used, 'limit', v_limit);
  END IF;
  UPDATE tool_usage SET uses = uses + 1, last_reserved_at = now()
    WHERE user_id = v_user AND tool = 'coach' AND usage_day = v_day;
  RETURN jsonb_build_object('allowed', true, 'used', v_used + 1, 'limit', v_limit);
END;
$$;

CREATE OR REPLACE FUNCTION get_coach_access()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_day date := (now() AT TIME ZONE 'utc')::date;
  v_used integer;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT uses INTO v_used FROM tool_usage WHERE user_id = v_user AND tool = 'coach' AND usage_day = v_day;
  RETURN jsonb_build_object(
    'used', coalesce(v_used, 0),
    'limit', tasktrack_coach_daily_limit(v_user),
    'premium', coalesce(tasktrack_current_plan(v_user), 'free') = 'pro'
  );
END;
$$;

REVOKE ALL ON FUNCTION reserve_coach_use() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION get_coach_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION reserve_coach_use() TO authenticated;
GRANT EXECUTE ON FUNCTION get_coach_access() TO authenticated;

-- Nightly clean-up: drafts for tasks completed or archived more than 30 days ago.
CREATE OR REPLACE FUNCTION purge_old_task_drafts()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM task_drafts d
  USING tasks t
  WHERE t.id = d.task_id
    AND (
      (t.completed_at IS NOT NULL AND t.completed_at < now() - interval '30 days')
      OR (t.is_archived AND d.updated_at < now() - interval '30 days')
    );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION purge_old_task_drafts() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'purge-old-task-drafts';
    PERFORM cron.schedule('purge-old-task-drafts', '17 3 * * *', 'SELECT public.purge_old_task_drafts();');
  END IF;
END;
$$;
