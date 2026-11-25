-- Invite a friend: both students get 50 extra AI credits this month.
--
-- Each student gets a short invite code (lazily, via get_my_invite). Their link is
-- /?ref=i-<code>, which the existing signup-ref flow already saves in the browser and
-- reports through record_signup_ref once the friend's brand-new account signs in.
-- record_signup_ref now also pays the reward when the ref is an invite code.
--
-- Limits: never for inviting yourself, once per invited account (the ref is written
-- once, only within an hour of the account being made), and at most 20 rewarded
-- invites per inviter, so a pile of throwaway accounts can't farm credits.
--
-- Bonus credits sit on that month's ai_credit_usage row and raise that month's limit.
-- They end with the month, like the normal allowance.

alter table public.profiles add column if not exists invite_code text unique;

alter table public.ai_credit_usage add column if not exists bonus_credits integer not null default 0;

create table if not exists public.referrals (
  invitee_id uuid primary key references auth.users (id) on delete cascade,
  inviter_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists referrals_inviter_idx on public.referrals (inviter_id);
alter table public.referrals enable row level security;
revoke all on table public.referrals from anon, authenticated;

-- This month's limit: the plan's allowance plus any invite bonus.
create or replace function public.tasktrack_credit_limit(p_user uuid, p_month date)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce((select pl.monthly_ai_credits from plan_limits pl
                    where pl.plan = coalesce(tasktrack_current_plan(p_user), 'free')), 100)
       + coalesce((select u.bonus_credits from ai_credit_usage u
                    where u.user_id = p_user and u.usage_month = p_month), 0);
$$;
revoke execute on function public.tasktrack_credit_limit(uuid, date) from public, anon, authenticated;

create or replace function public.tasktrack_grant_bonus_credits(p_user uuid, p_credits integer)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_month date := date_trunc('month', now() at time zone 'utc')::date;
begin
  insert into ai_credit_usage (user_id, usage_month, bonus_credits)
    values (p_user, v_month, p_credits)
  on conflict (user_id, usage_month)
    do update set bonus_credits = ai_credit_usage.bonus_credits + excluded.bonus_credits,
                  updated_at = now();
end;
$$;
revoke execute on function public.tasktrack_grant_bonus_credits(uuid, integer) from public, anon, authenticated;

-- The three places that read the limit now include the bonus.
create or replace function public.get_ai_credits()
returns table(used integer, credit_limit integer, remaining integer, resets_at timestamp with time zone)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_user uuid := auth.uid();
  v_month date := date_trunc('month', now() at time zone 'utc')::date;
  v_limit integer;
  v_used integer;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  v_limit := tasktrack_credit_limit(v_user, v_month);
  select u.credits_used into v_used from ai_credit_usage u where u.user_id = v_user and u.usage_month = v_month;
  v_used := coalesce(v_used, 0);
  return query select v_used, v_limit, greatest(v_limit - v_used, 0),
    ((v_month + interval '1 month')::timestamp at time zone 'utc');
end;
$$;

create or replace function public.reserve_ai_credits(p_cost integer)
returns table(allowed boolean, used integer, credit_limit integer, remaining integer)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user uuid := auth.uid();
  v_month date := date_trunc('month', now() at time zone 'utc')::date;
  v_cost integer := least(greatest(coalesce(p_cost, 1), 1), 20);
  v_limit integer;
  v_used integer;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;

  insert into ai_credit_usage (user_id, usage_month) values (v_user, v_month)
    on conflict (user_id, usage_month) do nothing;
  select u.credits_used into v_used from ai_credit_usage u
    where u.user_id = v_user and u.usage_month = v_month for update;
  v_limit := tasktrack_credit_limit(v_user, v_month);

  if v_used + v_cost > v_limit then
    return query select false, v_used, v_limit, greatest(v_limit - v_used, 0);
    return;
  end if;

  update ai_credit_usage
    set credits_used = credits_used + v_cost, last_cost = v_cost, last_reserved_at = now(), updated_at = now()
    where user_id = v_user and usage_month = v_month;
  return query select true, v_used + v_cost, v_limit, v_limit - v_used - v_cost;
end;
$$;

create or replace function public.charge_ai_tokens_for(p_user uuid, p_tokens integer, p_base_cost integer)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  v_month date := date_trunc('month', now() at time zone 'utc')::date;
  v_plan text;
  v_per integer;
  v_limit integer;
  v_used integer;
  v_extra integer;
begin
  if p_user is null or coalesce(p_tokens, 0) <= 0 then return 0; end if;
  v_plan := coalesce(tasktrack_current_plan(p_user), 'free');
  v_per := case when v_plan in ('pro', 'max') then 3000 else 2000 end;
  v_extra := ceil(p_tokens::numeric / v_per)::integer - greatest(coalesce(p_base_cost, 1), 1);
  if v_extra <= 0 then return 0; end if;
  select u.credits_used into v_used from ai_credit_usage u
    where u.user_id = p_user and u.usage_month = v_month for update;
  if v_used is null then return 0; end if;
  v_limit := tasktrack_credit_limit(p_user, v_month);
  v_extra := least(v_extra, 20, greatest(v_limit - v_used, 0));
  if v_extra <= 0 then return 0; end if;
  update ai_credit_usage set credits_used = credits_used + v_extra, updated_at = now()
    where user_id = p_user and usage_month = v_month;
  return v_extra;
end;
$$;

-- The student's own invite code (made on first use) and how many friends joined.
create or replace function public.get_my_invite()
returns table(code text, friends_joined integer, max_rewarded integer, reward_credits integer)
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_user uuid := auth.uid();
  v_code text;
  v_try integer := 0;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  select p.invite_code into v_code from public.profiles p where p.id = v_user;
  while v_code is null and v_try < 5 loop
    v_try := v_try + 1;
    -- 7 characters from an alphabet without look-alikes (no 0/o, 1/l/i).
    v_code := (
      select string_agg(substr('abcdefghjkmnpqrstuvwxyz23456789', 1 + floor(random() * 31)::int, 1), '')
      from generate_series(1, 7)
    );
    begin
      update public.profiles set invite_code = v_code where id = v_user and invite_code is null;
      if not found then
        select p.invite_code into v_code from public.profiles p where p.id = v_user;
      end if;
    exception when unique_violation then
      v_code := null;
    end;
  end loop;
  return query select v_code,
    (select count(*)::integer from public.referrals r where r.inviter_id = v_user),
    20, 50;
end;
$$;
revoke execute on function public.get_my_invite() from public, anon;
grant execute on function public.get_my_invite() to authenticated;

-- Saves where the sign-up came from, and pays the invite reward when it was a friend.
create or replace function public.record_signup_ref(p_ref text)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_user uuid := auth.uid();
  v_inviter uuid;
begin
  if v_user is null or p_ref is null or p_ref !~ '^[a-z0-9_-]{1,32}$' then
    return;
  end if;
  update public.profiles
     set signup_ref = p_ref
   where id = v_user
     and signup_ref is null
     and created_at > now() - interval '1 hour';
  if not found or p_ref not like 'i-%' then
    return;
  end if;

  select p.id into v_inviter from public.profiles p where p.invite_code = substr(p_ref, 3);
  if v_inviter is null or v_inviter = v_user then
    return;
  end if;
  if (select count(*) from public.referrals r where r.inviter_id = v_inviter) >= 20 then
    return;
  end if;

  insert into public.referrals (invitee_id, inviter_id) values (v_user, v_inviter)
    on conflict (invitee_id) do nothing;
  if found then
    perform public.tasktrack_grant_bonus_credits(v_user, 50);
    perform public.tasktrack_grant_bonus_credits(v_inviter, 50);
  end if;
end;
$$;
revoke execute on function public.record_signup_ref(text) from public, anon;
grant execute on function public.record_signup_ref(text) to authenticated;
