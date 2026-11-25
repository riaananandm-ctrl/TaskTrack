-- Launch thank-you: the next 5 students to make an account get Pro free for 1 month,
-- plus a thank-you message (in-app notification, push if they have a device, and email
-- when an email provider is set on send-study-notifications).
--
-- Runs after tasktrack_premium_grant_on_signup (triggers fire in name order), so a
-- student who was already promised Pro by email keeps that grant and doesn't use a slot.
-- Slots are counted under a lock, so two sign-ups at the same moment can't both be #5.

create table if not exists public.welcome_pro_awards (
  user_id uuid primary key references auth.users (id) on delete cascade,
  awarded_at timestamptz not null default now()
);
alter table public.welcome_pro_awards enable row level security;
revoke all on table public.welcome_pro_awards from anon, authenticated;

create or replace function public.tasktrack_welcome_pro()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_slots constant integer := 5;
  v_plan text;
begin
  perform pg_advisory_xact_lock(hashtext('tasktrack_welcome_pro'));
  if (select count(*) from welcome_pro_awards) >= v_slots then
    return new;
  end if;

  select p.plan into v_plan from profiles p where p.id = new.id;
  if v_plan in ('pro', 'max') then
    return new;
  end if;

  insert into welcome_pro_awards (user_id) values (new.id) on conflict do nothing;
  if not found then
    return new;
  end if;

  update profiles set plan = 'pro', plan_expires_at = now() + interval '1 month' where id = new.id;

  insert into reminders (user_id, title, message, reminder_type, scheduled_for, dedupe_key)
  values (
    new.id,
    'Thank you for joining TaskTrack!',
    'You''re one of our first 50 students and we''re really grateful. As a thank-you, '
      || 'we''ve given you the Pro plan free for 1 month. Thanks for using TaskTrack!',
    'announcement',
    now(),
    'welcome-pro'
  );
  return new;
exception when others then
  -- Never block a sign-up because of a promo.
  return new;
end;
$$;
revoke execute on function public.tasktrack_welcome_pro() from public, anon, authenticated;

drop trigger if exists tasktrack_welcome_pro_on_signup on public.profiles;
create trigger tasktrack_welcome_pro_on_signup
  after insert on public.profiles
  for each row execute function public.tasktrack_welcome_pro();
