-- Learn from students' subject corrections.
--
-- ManageBac's calendar feed has no class name, so imported tasks are sorted by guessing
-- from the title and a shortened description. A CAS poster about the environment set by
-- an English teacher got "Individuals & Societies". When a student moves a task to a
-- different subject, this remembers it, and the sorter (ai-tools classify) uses those
-- corrections for the student's later tasks with similar titles.

create table if not exists public.task_subject_corrections (
  user_id uuid not null references auth.users (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  title text not null,
  subject_id uuid not null references public.subjects (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, task_id)
);
create index if not exists task_subject_corrections_subject_id_fk_idx on public.task_subject_corrections (subject_id);
create index if not exists task_subject_corrections_task_id_fk_idx on public.task_subject_corrections (task_id);

alter table public.task_subject_corrections enable row level security;
revoke all on table public.task_subject_corrections from anon;
grant select, delete on table public.task_subject_corrections to authenticated;

drop policy if exists "Students read their own subject corrections" on public.task_subject_corrections;
create policy "Students read their own subject corrections"
  on public.task_subject_corrections for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Students delete their own subject corrections" on public.task_subject_corrections;
create policy "Students delete their own subject corrections"
  on public.task_subject_corrections for delete to authenticated
  using (user_id = (select auth.uid()));

-- Only a change from one subject to another, made by the student themself, counts as a
-- correction. The sorter only ever fills in a blank subject, so it never triggers this.
create or replace function public.tasktrack_record_subject_correction()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.subject_id is null or old.subject_id is null or new.subject_id = old.subject_id then
    return new;
  end if;
  if (select auth.uid()) is distinct from new.user_id then
    return new;
  end if;
  insert into task_subject_corrections (user_id, task_id, title, subject_id)
  values (new.user_id, new.id, left(new.title, 300), new.subject_id)
  on conflict (user_id, task_id)
  do update set subject_id = excluded.subject_id, title = excluded.title, created_at = now();
  return new;
exception when others then
  -- Never block saving a task because of this.
  return new;
end;
$$;
revoke execute on function public.tasktrack_record_subject_correction() from public, anon, authenticated;

drop trigger if exists tasktrack_subject_correction on public.tasks;
create trigger tasktrack_subject_correction
  after update of subject_id on public.tasks
  for each row execute function public.tasktrack_record_subject_correction();
