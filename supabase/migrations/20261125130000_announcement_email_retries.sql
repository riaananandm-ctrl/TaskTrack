-- Retry announcement emails (such as the launch thank-you) that the email provider
-- refused, for example while a new Brevo account is still waiting for activation.
--
-- The first try happens with the push in the normal sweep. If it fails, the sender
-- records the attempt here, and later sweeps retry it every 15 minutes for 24 hours.

alter table public.reminders add column if not exists email_attempts integer not null default 0;
alter table public.reminders add column if not exists email_last_attempt_at timestamptz;

-- Claims announcements whose email failed and is due another try. Claiming bumps the
-- attempt time first, so two overlapping sweeps can't both send the same email.
create or replace function public.claim_announcement_email_retries(batch_size integer default 10)
returns table(reminder_id uuid, user_id uuid, title text, message text)
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  return query
  with due as (
    select r.id
      from reminders r
     where r.reminder_type = 'announcement'
       and r.is_enabled
       and r.email_sent_at is null
       and r.email_attempts between 1 and 99
       and r.email_last_attempt_at < now() - interval '15 minutes'
       and r.created_at > now() - interval '24 hours'
     order by r.created_at
     limit batch_size
     for update skip locked
  )
  update reminders r
     set email_attempts = r.email_attempts + 1,
         email_last_attempt_at = now()
   where r.id in (select id from due)
  returning r.id, r.user_id, r.title, r.message;
end;
$$;
revoke execute on function public.claim_announcement_email_retries(integer) from public, anon, authenticated;
grant execute on function public.claim_announcement_email_retries(integer) to service_role;
