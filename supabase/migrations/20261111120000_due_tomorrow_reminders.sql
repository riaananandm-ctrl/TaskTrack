/*
  "Due tomorrow" reminders.

  Every task with a due date gets one reminder on the day before it is due, at the
  student's preferred reminder time (user_settings.preferred_reminder_time, default
  08:00) in their own timezone. The existing send-study-notifications sweep delivers it
  as a push notification and, when configured, an email.

  - Created automatically by a trigger, so it covers every way a task is made: the task
    dialog, ManageBac imports, duplicates and onboarding.
  - Rescheduled when the due date changes; cancelled when the task is completed,
    archived, deleted, or given no due date.
  - If a task due tomorrow is added after the reminder time has passed, the reminder is
    sent straight away instead of being skipped.
  - One reminder per task (dedupe key 'due-tomorrow:<task id>'), so it is never duplicated.
*/

-- 1. Columns -------------------------------------------------------------------------

ALTER TABLE public.reminders ADD COLUMN IF NOT EXISTS email_sent_at timestamptz;

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS email_reminders_enabled boolean NOT NULL DEFAULT true;

-- 2. Timezone resolution ---------------------------------------------------------------
-- profiles.timezone is free text (values like 'IST', 'UTC +05:30'). Valid IANA names
-- are used as-is; the common Indian variants and the untouched 'UTC' default map to
-- Asia/Kolkata. The app now also saves the browser's real timezone (see app-chrome).

CREATE OR REPLACE FUNCTION public.tasktrack_resolve_timezone(p_tz text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT CASE
    WHEN p_tz IS NULL OR btrim(p_tz) = '' THEN 'Asia/Kolkata'
    WHEN lower(regexp_replace(p_tz, '\s', '', 'g')) IN
      ('utc', 'gmt', 'ist', 'itc', 'ict', 'utcist', 'utc+05:30', 'utc+5:30', 'gmt+05:30', 'gmt+5:30', 'india')
      THEN 'Asia/Kolkata'
    WHEN EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = btrim(p_tz)) THEN btrim(p_tz)
    ELSE 'Asia/Kolkata'
  END;
$$;

-- 3. Create / reschedule / cancel one task's reminder -------------------------------------

CREATE OR REPLACE FUNCTION public.tasktrack_sync_due_tomorrow_reminder(p_task public.tasks)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_key text := 'due-tomorrow:' || p_task.id;
  v_tz text;
  v_time time;
  v_enabled boolean;
  v_local_today date;
  v_remind_at timestamptz;
BEGIN
  SELECT public.tasktrack_resolve_timezone(p.timezone) INTO v_tz
  FROM public.profiles p WHERE p.id = p_task.user_id;
  v_tz := COALESCE(v_tz, 'Asia/Kolkata');

  SELECT COALESCE(us.task_reminders_enabled, true),
         CASE WHEN us.preferred_reminder_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
              THEN us.preferred_reminder_time::time ELSE time '08:00' END
    INTO v_enabled, v_time
  FROM public.user_settings us WHERE us.user_id = p_task.user_id
  LIMIT 1;
  v_enabled := COALESCE(v_enabled, true);
  v_time := COALESCE(v_time, time '08:00');

  v_local_today := (now() AT TIME ZONE v_tz)::date;

  -- No reminder needed: cancel any unsent one.
  IF p_task.due_date IS NULL
     OR p_task.status = 'completed'
     OR p_task.is_archived
     OR NOT v_enabled
     OR p_task.due_date < v_local_today + 1 THEN
    UPDATE public.reminders
       SET is_enabled = false, updated_at = now()
     WHERE user_id = p_task.user_id
       AND dedupe_key = v_key
       AND push_sent_at IS NULL
       AND is_enabled;
    RETURN;
  END IF;

  -- The day before the due date, at the preferred time, in the student's timezone.
  v_remind_at := ((p_task.due_date - 1) + v_time) AT TIME ZONE v_tz;
  -- Only possible when the task is due tomorrow and the time has passed: send now.
  IF v_remind_at < now() THEN
    v_remind_at := now();
  END IF;

  INSERT INTO public.reminders AS r
    (user_id, task_id, title, message, reminder_type, scheduled_for,
     repeat_rule, is_enabled, is_read, dedupe_key)
  VALUES
    (p_task.user_id, p_task.id, 'Due tomorrow: ' || p_task.title,
     'Due ' || to_char(p_task.due_date, 'FMDay, FMMonth FMDD'),
     'task_due_tomorrow', v_remind_at, 'none', true, false, v_key)
  ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO UPDATE
    SET title = EXCLUDED.title,
        message = EXCLUDED.message,
        task_id = EXCLUDED.task_id,
        is_enabled = true,
        updated_at = now(),
        -- Unsent reminders always follow the latest schedule. A sent one is only
        -- re-armed when the due date itself moved.
        scheduled_for = CASE
          WHEN r.push_sent_at IS NULL
            OR (r.scheduled_for AT TIME ZONE v_tz)::date <> p_task.due_date - 1
          THEN EXCLUDED.scheduled_for ELSE r.scheduled_for END,
        push_sent_at = CASE
          WHEN (r.scheduled_for AT TIME ZONE v_tz)::date <> p_task.due_date - 1
          THEN NULL ELSE r.push_sent_at END,
        push_claimed_at = CASE
          WHEN (r.scheduled_for AT TIME ZONE v_tz)::date <> p_task.due_date - 1
          THEN NULL ELSE r.push_claimed_at END,
        push_attempts = CASE
          WHEN (r.scheduled_for AT TIME ZONE v_tz)::date <> p_task.due_date - 1
          THEN 0 ELSE r.push_attempts END,
        email_sent_at = CASE
          WHEN (r.scheduled_for AT TIME ZONE v_tz)::date <> p_task.due_date - 1
          THEN NULL ELSE r.email_sent_at END,
        is_read = CASE
          WHEN (r.scheduled_for AT TIME ZONE v_tz)::date <> p_task.due_date - 1
          THEN false ELSE r.is_read END;
END;
$$;

-- 4. Re-run for all of one student's upcoming tasks (timezone or settings changed) -------

CREATE OR REPLACE FUNCTION public.tasktrack_refresh_due_tomorrow_reminders(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  t public.tasks;
BEGIN
  FOR t IN
    SELECT * FROM public.tasks
    WHERE user_id = p_user_id AND due_date IS NOT NULL AND due_date >= current_date - 1
  LOOP
    PERFORM public.tasktrack_sync_due_tomorrow_reminder(t);
  END LOOP;
END;
$$;

-- 5. Triggers ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tasktrack_tasks_due_tomorrow_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.reminders
     WHERE user_id = OLD.user_id AND dedupe_key = 'due-tomorrow:' || OLD.id;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.due_date IS NOT DISTINCT FROM OLD.due_date
     AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.is_archived IS NOT DISTINCT FROM OLD.is_archived
     AND NEW.title IS NOT DISTINCT FROM OLD.title THEN
    RETURN NEW;
  END IF;

  PERFORM public.tasktrack_sync_due_tomorrow_reminder(NEW);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tasktrack_due_tomorrow_reminder ON public.tasks;
CREATE TRIGGER tasktrack_due_tomorrow_reminder
  AFTER INSERT OR UPDATE OR DELETE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasktrack_tasks_due_tomorrow_trigger();

CREATE OR REPLACE FUNCTION public.tasktrack_settings_due_tomorrow_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF TG_TABLE_NAME = 'profiles' THEN
    IF NEW.timezone IS DISTINCT FROM OLD.timezone THEN
      PERFORM public.tasktrack_refresh_due_tomorrow_reminders(NEW.id);
    END IF;
  ELSIF NEW.preferred_reminder_time IS DISTINCT FROM OLD.preferred_reminder_time
     OR NEW.task_reminders_enabled IS DISTINCT FROM OLD.task_reminders_enabled THEN
    PERFORM public.tasktrack_refresh_due_tomorrow_reminders(NEW.user_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tasktrack_due_tomorrow_on_timezone ON public.profiles;
CREATE TRIGGER tasktrack_due_tomorrow_on_timezone
  AFTER UPDATE OF timezone ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.tasktrack_settings_due_tomorrow_trigger();

DROP TRIGGER IF EXISTS tasktrack_due_tomorrow_on_settings ON public.user_settings;
CREATE TRIGGER tasktrack_due_tomorrow_on_settings
  AFTER UPDATE OF preferred_reminder_time, task_reminders_enabled ON public.user_settings
  FOR EACH ROW EXECUTE FUNCTION public.tasktrack_settings_due_tomorrow_trigger();

-- 6. Lock down: these run only from triggers and the service role ------------------------

REVOKE ALL ON FUNCTION public.tasktrack_sync_due_tomorrow_reminder(public.tasks) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tasktrack_refresh_due_tomorrow_reminders(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tasktrack_tasks_due_tomorrow_trigger() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tasktrack_settings_due_tomorrow_trigger() FROM PUBLIC, anon, authenticated;

-- 7. Backfill: give every existing upcoming task its reminder -----------------------------

DO $$
DECLARE
  u uuid;
BEGIN
  FOR u IN
    SELECT DISTINCT user_id FROM public.tasks
    WHERE due_date IS NOT NULL AND due_date >= current_date - 1
  LOOP
    PERFORM public.tasktrack_refresh_due_tomorrow_reminders(u);
  END LOOP;
END;
$$;
