-- Auto-complete tasks that are 5 or more days overdue, so finished work stops sitting
-- on the list. ManageBac's calendar feed never says when work is handed in, so a task
-- otherwise stays "overdue" until the student ticks it by hand.
--
-- * auto_completed_at marks our automatic tick, so it is never mistaken for real work:
--   it does not count as a study day, and it is left out of the parent summary.
-- * If the student reopens an auto-ticked task, auto_reopened_at is set and the job
--   never ticks that task again.

alter table public.tasks add column if not exists auto_completed_at timestamptz;
alter table public.tasks add column if not exists auto_reopened_at timestamptz;

-- Reopening (or a manual re-tick) clears the automatic mark.
create or replace function public.tasktrack_tasks_auto_complete_mark()
returns trigger
language plpgsql
set search_path to 'public', 'pg_catalog'
as $$
begin
  if old.auto_completed_at is not null and new.status is distinct from 'completed' then
    new.auto_completed_at := null;
    new.auto_reopened_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists tasktrack_tasks_auto_complete_mark on public.tasks;
create trigger tasktrack_tasks_auto_complete_mark
  before update of status on public.tasks
  for each row execute function public.tasktrack_tasks_auto_complete_mark();

-- An automatic tick is not studying: no study day for it.
create or replace function public.tasktrack_study_day_trigger()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
BEGIN
  IF TG_TABLE_NAME = 'tasks' THEN
    IF NEW.status = 'completed' AND NEW.auto_completed_at IS NULL
       AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'completed') THEN
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
$function$;

-- The parent summary lists only work the student actually ticked.
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.get_parent_summary'::regproc);
  if position('t.auto_completed_at IS NULL' in v_def) = 0 then
    v_def := replace(v_def,
      'WHERE t.user_id = v_uid AND t.status = ''completed'' AND t.completed_at',
      'WHERE t.user_id = v_uid AND t.status = ''completed'' AND t.auto_completed_at IS NULL AND t.completed_at');
    if position('t.auto_completed_at IS NULL' in v_def) = 0 then
      raise exception 'get_parent_summary changed shape; update this migration';
    end if;
    execute v_def;
  end if;
end $$;

-- The job itself. Runs daily; safe to run any number of times.
create or replace function public.tasktrack_auto_complete_overdue()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_ids uuid[];
begin
  with done as (
    update tasks
       set status = 'completed', completed_at = now(), auto_completed_at = now()
     where status <> 'completed'
       and not coalesce(is_archived, false)
       and auto_reopened_at is null
       and due_date is not null
       and due_date <= v_today - 5
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_ids from done;

  -- No more "due" pings for these.
  if cardinality(v_ids) > 0 then
    update reminders set is_enabled = false
     where task_id = any(v_ids) and is_enabled;
  end if;
  return cardinality(v_ids);
end;
$$;
revoke execute on function public.tasktrack_auto_complete_overdue() from public, anon, authenticated;

-- Every day at 00:30 India time (19:00 UTC).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'tasktrack-auto-complete-overdue') then
    perform cron.unschedule('tasktrack-auto-complete-overdue');
  end if;
  perform cron.schedule('tasktrack-auto-complete-overdue', '0 19 * * *', 'select public.tasktrack_auto_complete_overdue();');
end $$;
