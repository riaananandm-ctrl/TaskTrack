-- Pen-and-paper tests are sat in class, so once the test's time has passed there is
-- nothing left to hand in: tick them automatically. Same marks as the 5-day rule
-- (auto_completed_at, never re-ticked after the student reopens it).
-- The job now runs every 15 minutes so a test clears soon after it ends.

create or replace function public.tasktrack_is_pen_paper(p_title text, p_description text)
returns boolean
language sql
immutable
as $$
  select (coalesce(p_title, '') || ' ' || coalesce(p_description, ''))
         ~* 'pen[[:space:]-]*(and|&|n|/)[[:space:]-]*paper';
$$;

create or replace function public.tasktrack_auto_complete_overdue()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  v_now_local timestamp := now() at time zone 'Asia/Kolkata';
  v_today date := v_now_local::date;
  v_ids uuid[];
begin
  with done as (
    update tasks
       set status = 'completed', completed_at = now(), auto_completed_at = now()
     where status <> 'completed'
       and not coalesce(is_archived, false)
       and auto_reopened_at is null
       and due_date is not null
       and (
         -- 5 or more days overdue
         due_date <= v_today - 5
         -- a pen-and-paper test whose time has passed (end of day if no time is set)
         or (tasktrack_is_pen_paper(title, description)
             and due_date + case when due_time ~ '^\d{1,2}:\d{2}(:\d{2})?$' then due_time::time
                                 else time '23:59:59' end < v_now_local)
       )
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_ids from done;

  if cardinality(v_ids) > 0 then
    update reminders set is_enabled = false
     where task_id = any(v_ids) and is_enabled;
  end if;
  return cardinality(v_ids);
end;
$$;
revoke execute on function public.tasktrack_auto_complete_overdue() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'tasktrack-auto-complete-overdue') then
    perform cron.unschedule('tasktrack-auto-complete-overdue');
  end if;
  perform cron.schedule('tasktrack-auto-complete-overdue', '*/15 * * * *', 'select public.tasktrack_auto_complete_overdue();');
end $$;
