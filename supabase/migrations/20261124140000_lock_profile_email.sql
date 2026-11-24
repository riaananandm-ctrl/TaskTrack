-- Supabase security re-check.

-- 1. Reminder emails go to profiles.email. Students could edit that column, so anyone
--    could point TaskTrack's emails (with their own task titles in them) at any inbox.
--    The address now only ever comes from the student's verified login email.
revoke update (email) on table public.profiles from authenticated, anon;

create or replace function public.tasktrack_sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = new.email where id = new.id;
  end if;
  return new;
end;
$$;
revoke execute on function public.tasktrack_sync_profile_email() from public, anon, authenticated;

drop trigger if exists tasktrack_sync_profile_email on auth.users;
create trigger tasktrack_sync_profile_email
  after update of email on auth.users
  for each row execute function public.tasktrack_sync_profile_email();

-- 2. Signed-out visitors held table rights on the core tables. Row-level security
--    already blocked every row; now they have no rights at all.
revoke all on table
  public.profiles, public.reminders, public.study_session_messages, public.study_sessions,
  public.subjects, public.tasks, public.user_settings, public.weekly_plans
from anon;
