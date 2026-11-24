-- Security hardening after an audit of common attacks.

-- 1. Leaderboard cheating: record_metric let a student insert an 'xp_awarded' row
--    with any amount, and the weekly leaderboard sums those rows. Only the server's
--    XP functions may write XP rows; client metrics are named events with small
--    payloads, capped per hour.
create or replace function public.record_metric(p_event_name text, p_event_data jsonb default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;
  if p_event_name is null
     or p_event_name !~ '^[a-z][a-z0-9_]{1,48}$'
     or p_event_name like 'xp%' then
    raise exception 'invalid_event';
  end if;
  if p_event_data is not null and length(p_event_data::text) > 2000 then
    raise exception 'event_too_large';
  end if;
  if (select count(*) from app_metrics
       where user_id = v_user and created_at > now() - interval '1 hour') >= 300 then
    return; -- quietly drop floods
  end if;
  insert into app_metrics (user_id, event_name, event_data)
  values (v_user, p_event_name, p_event_data);
end;
$$;

-- 2. "Change the ID": these took any user's id and told the caller that person's plan.
--    They are only needed inside other server functions.
revoke execute on function public.tasktrack_is_paid(uuid) from public, anon, authenticated;
revoke execute on function public.tasktrack_current_plan(uuid) from public, anon, authenticated;
revoke execute on function public.tasktrack_apply_premium_grant() from public, anon, authenticated;
grant execute on function public.tasktrack_is_paid(uuid) to service_role;
grant execute on function public.tasktrack_current_plan(uuid) to service_role;

-- 3. Belt and braces: row-level security already blocks these tables, but signed-out
--    visitors have no reason to hold any rights on them at all.
revoke all on table
  public.ai_credit_usage, public.leaderboard_players, public.polish_usage,
  public.premium_requests, public.redeem_attempts, public.redeem_codes,
  public.study_group_members, public.study_group_messages, public.study_group_reports,
  public.study_groups, public.tool_unlocks, public.tool_usage, public.user_consents
from anon;
-- Redeem codes and attempts are only touched through redeem_code().
revoke insert, update, delete on table public.redeem_codes, public.redeem_attempts from authenticated;

-- 4. "Upload something that isn't a photo": the bucket only accepts the types
--    TaskTrack reads, and the declared type must match the file's extension.
update storage.buckets
   set allowed_mime_types = array[
     'application/pdf', 'application/msword',
     'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
     'application/vnd.ms-powerpoint',
     'application/vnd.openxmlformats-officedocument.presentationml.presentation',
     'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
     'text/plain', 'text/markdown', 'text/csv',
     'image/png', 'image/jpeg', 'image/webp'
   ]
 where id = 'study-documents';

create or replace function public.tasktrack_upload_mime_for(p_ext text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select case lower(p_ext)
    when 'pdf' then 'application/pdf'
    when 'doc' then 'application/msword'
    when 'docx' then 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    when 'ppt' then 'application/vnd.ms-powerpoint'
    when 'pptx' then 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    when 'xlsx' then 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    when 'txt' then 'text/plain'
    when 'md' then 'text/markdown'
    when 'csv' then 'text/csv'
    when 'png' then 'image/png'
    when 'jpg' then 'image/jpeg'
    when 'jpeg' then 'image/jpeg'
    when 'webp' then 'image/webp'
  end;
$$;

create or replace function public.tasktrack_check_document_mime()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.declared_mime is distinct from
     tasktrack_upload_mime_for(split_part(new.file_name, '.', -1)) then
    raise exception 'unsupported_type';
  end if;
  return new;
end;
$$;

drop trigger if exists tasktrack_check_document_mime on public.documents;
create trigger tasktrack_check_document_mime
  before insert on public.documents
  for each row execute function public.tasktrack_check_document_mime();
