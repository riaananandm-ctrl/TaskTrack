-- Summatives are exams. Every task that is a summative (by category or title) or
-- has Urgent priority now shows in IB Hub > Exams with a countdown, and gets a
-- revision plan. The exam follows its task: change the date and the exam moves;
-- complete, archive or delete the task (or lower its priority) and it goes away.

alter table public.ib_exams add column if not exists task_id uuid references public.tasks(id) on delete cascade;
create unique index if not exists ib_exams_task_key on public.ib_exams (task_id) where task_id is not null;

alter table public.ib_exams drop constraint if exists ib_exams_kind_check;
alter table public.ib_exams add constraint ib_exams_kind_check
  check (kind in ('mock', 'final', 'test', 'summative'));

create or replace function public.tasktrack_task_is_exam(p_category text, p_priority text, p_title text)
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$
  select coalesce(p_category = 'summative_assessment', false)
      or coalesce(p_priority = 'urgent', false)
      or coalesce(p_title ~* '\msummative\M', false);
$$;

-- Creates, updates or removes the exam for one task.
create or replace function public.tasktrack_sync_exam_for_task(p_task uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  t record;
  v_subject text;
  v_paper text;
begin
  select * into t from tasks where id = p_task;
  if not found
     or t.due_date is null
     or t.status in ('completed', 'archived')
     or coalesce(t.is_archived, false)
     or not tasktrack_task_is_exam(t.category, t.priority, t.title) then
    delete from ib_exams where task_id = p_task;
    return;
  end if;

  select left(btrim(name), 60) into v_subject from subjects where id = t.subject_id;
  v_paper := nullif(left(btrim(coalesce(t.title, '')), 60), '');
  if nullif(v_subject, '') is null then
    -- No subject: the task title becomes the name.
    v_subject := coalesce(v_paper, 'Summative');
    v_paper := null;
  end if;

  begin
    insert into ib_exams (user_id, subject_name, paper, kind, exam_date, task_id)
    values (t.user_id, v_subject, v_paper, 'summative', t.due_date, t.id)
    on conflict (task_id) where task_id is not null do update
      set subject_name = excluded.subject_name,
          paper = excluded.paper,
          exam_date = excluded.exam_date;
  exception when others then
    -- e.g. the 60-exam limit. Never block saving the task itself.
    null;
  end;
end;
$$;
revoke all on function public.tasktrack_sync_exam_for_task(uuid) from public, anon, authenticated;

create or replace function public.tasktrack_sync_task_exam()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'UPDATE'
     and new.due_date is not distinct from old.due_date
     and new.title is not distinct from old.title
     and new.subject_id is not distinct from old.subject_id
     and new.category is not distinct from old.category
     and new.priority is not distinct from old.priority
     and new.status is not distinct from old.status
     and new.is_archived is not distinct from old.is_archived then
    return new;
  end if;
  perform tasktrack_sync_exam_for_task(new.id);
  return new;
end;
$$;
revoke all on function public.tasktrack_sync_task_exam() from public, anon, authenticated;

drop trigger if exists tasktrack_sync_task_exam on public.tasks;
create trigger tasktrack_sync_task_exam after insert or update on public.tasks
  for each row execute function public.tasktrack_sync_task_exam();

-- Existing upcoming summatives and urgent tasks (and refresh any already synced).
select public.tasktrack_sync_exam_for_task(t.id)
  from public.tasks t
 where (t.due_date >= current_date
        and t.status not in ('completed', 'archived')
        and not coalesce(t.is_archived, false)
        and public.tasktrack_task_is_exam(t.category, t.priority, t.title))
    or t.id in (select task_id from public.ib_exams where task_id is not null);
