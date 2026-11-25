-- Launch changes agreed after the product debate (25 Nov 2026):
--   1. A 1-month Premium option (₹149) next to the 3-month plans.
--   2. A one-time 7-day Premium trial per account.
--   3. An exam-week credit boost: +20 credits once a month when a test or exam is due within 7 days.
--   4. A per-user burst limit on AI requests (protects the free AI quota on launch day).
--   5. Funnel and AI budget reports for the TaskTrack team (not readable by students).

-- 1. One-month plan -----------------------------------------------------------------
alter table public.premium_requests
  add column if not exists months integer not null default 3;
alter table public.premium_requests
  drop constraint if exists premium_requests_months_check;
alter table public.premium_requests
  add constraint premium_requests_months_check check (months in (1, 3));

drop function if exists public.request_premium(text, text);

create or replace function public.request_premium(p_utr text, p_plan text default 'pro', p_months integer default 3)
returns table(ok boolean, code text, request_id uuid)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user uuid := auth.uid();
  v_utr text := upper(regexp_replace(coalesce(p_utr, ''), '\s', '', 'g'));
  v_plan text := lower(coalesce(p_plan, 'pro'));
  v_months integer := coalesce(p_months, 3);
  v_amount integer;
  v_id uuid;
begin
  if v_user is null then
    return query select false, 'auth', null::uuid; return;
  end if;
  -- Prices: Premium ₹149 for 1 month or ₹499 for 3; Max ₹999 for 3.
  v_amount := case
    when v_plan = 'pro' and v_months = 1 then 149
    when v_plan = 'pro' and v_months = 3 then 499
    when v_plan = 'max' and v_months = 3 then 999
  end;
  if v_amount is null then
    return query select false, 'bad_plan', null::uuid; return;
  end if;
  if v_utr !~ '^[0-9A-Z]{6,35}$' then
    return query select false, 'bad_utr', null::uuid; return;
  end if;
  if exists (select 1 from premium_requests where utr = v_utr) then
    return query select false, 'duplicate', null::uuid; return;
  end if;
  if exists (select 1 from premium_requests where user_id = v_user and status = 'pending') then
    return query select false, 'already_pending', null::uuid; return;
  end if;
  if (select count(*) from premium_requests where user_id = v_user and created_at > now() - interval '1 day') >= 5 then
    return query select false, 'too_many', null::uuid; return;
  end if;
  insert into premium_requests (user_id, utr, plan, amount_inr, months)
    values (v_user, v_utr, v_plan, v_amount, v_months)
    returning id into v_id;
  return query select true, 'ok', v_id;
end;
$$;
revoke execute on function public.request_premium(text, text, integer) from public, anon;
grant execute on function public.request_premium(text, text, integer) to authenticated;

-- Approval (run by the team in SQL) now uses the months that were paid for.
create or replace function public.approve_premium_request(p_utr text)
returns table(user_id uuid, plan text, plan_expires_at timestamptz)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_req premium_requests%rowtype;
  v_until timestamptz;
begin
  select * into v_req from premium_requests r
    where r.utr = upper(regexp_replace(p_utr, '\s', '', 'g')) and r.status = 'pending'
    for update;
  if not found then
    raise exception 'No pending request with that UTR';
  end if;
  select greatest(coalesce(case when tasktrack_current_plan(p.id) = v_req.plan then p.plan_expires_at end, now()), now())
         + make_interval(months => coalesce(v_req.months, 3))
    into v_until from profiles p where p.id = v_req.user_id;
  update profiles set plan = v_req.plan, plan_expires_at = v_until where id = v_req.user_id;
  update premium_requests set status = 'approved', reviewed_at = now() where id = v_req.id;
  return query select v_req.user_id, v_req.plan, v_until;
end;
$$;
revoke execute on function public.approve_premium_request(text) from public, anon, authenticated;

-- 2. Seven-day trial ------------------------------------------------------------------
create table if not exists public.premium_trials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  ends_at timestamptz not null
);
alter table public.premium_trials enable row level security;
drop policy if exists "Students see their own trial" on public.premium_trials;
create policy "Students see their own trial" on public.premium_trials
  for select to authenticated using (user_id = auth.uid());
revoke all on table public.premium_trials from anon;
revoke insert, update, delete on table public.premium_trials from authenticated;

create or replace function public.start_premium_trial()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user uuid := auth.uid();
  v_until timestamptz := now() + interval '7 days';
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'auth');
  end if;
  if exists (select 1 from premium_trials where user_id = v_user) then
    return jsonb_build_object('ok', false, 'error', 'used');
  end if;
  if tasktrack_current_plan(v_user) <> 'free'
     or exists (select 1 from premium_requests where user_id = v_user and status = 'approved') then
    return jsonb_build_object('ok', false, 'error', 'already_paid');
  end if;
  insert into premium_trials (user_id, ends_at) values (v_user, v_until);
  update profiles set plan = 'pro', plan_expires_at = v_until where id = v_user;
  insert into app_metrics (user_id, event_name) values (v_user, 'trial_started');
  return jsonb_build_object('ok', true, 'ends_at', v_until);
end;
$$;
revoke execute on function public.start_premium_trial() from public, anon;
grant execute on function public.start_premium_trial() to authenticated;

-- 3. Exam-week boost --------------------------------------------------------------------
create table if not exists public.exam_boost_claims (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_month date not null,
  claimed_at timestamptz not null default now(),
  primary key (user_id, usage_month)
);
alter table public.exam_boost_claims enable row level security;
drop policy if exists "Students see their own boosts" on public.exam_boost_claims;
create policy "Students see their own boosts" on public.exam_boost_claims
  for select to authenticated using (user_id = auth.uid());
revoke all on table public.exam_boost_claims from anon;
revoke insert, update, delete on table public.exam_boost_claims from authenticated;

-- The soonest test or exam due in the next 7 days, if the boost can be claimed.
create or replace function public.exam_boost_status()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_user uuid := auth.uid();
  v_month date := date_trunc('month', now() at time zone 'utc')::date;
  v_task record;
begin
  if v_user is null then return jsonb_build_object('eligible', false); end if;
  if exists (select 1 from exam_boost_claims where user_id = v_user and usage_month = v_month) then
    return jsonb_build_object('eligible', false, 'claimed', true);
  end if;
  select t.id, t.title, t.due_date into v_task from tasks t
    where t.user_id = v_user
      and not t.is_archived
      and t.status <> 'completed'
      and t.category in ('test', 'quiz', 'summative_assessment', 'final_exam', 'mock_exam')
      and t.due_date >= (now() at time zone 'Asia/Kolkata')::date
      and t.due_date <= (now() at time zone 'Asia/Kolkata')::date + 7
    order by t.due_date
    limit 1;
  if not found then
    return jsonb_build_object('eligible', false);
  end if;
  return jsonb_build_object('eligible', true, 'task_title', v_task.title, 'due_date', v_task.due_date, 'credits', 20);
end;
$$;
revoke execute on function public.exam_boost_status() from public, anon;
grant execute on function public.exam_boost_status() to authenticated;

create or replace function public.claim_exam_boost()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user uuid := auth.uid();
  v_month date := date_trunc('month', now() at time zone 'utc')::date;
  v_status jsonb;
begin
  if v_user is null then return jsonb_build_object('ok', false, 'error', 'auth'); end if;
  v_status := exam_boost_status();
  if not coalesce((v_status->>'eligible')::boolean, false) then
    return jsonb_build_object('ok', false, 'error', case when v_status ? 'claimed' then 'claimed' else 'no_exam' end);
  end if;
  insert into exam_boost_claims (user_id, usage_month) values (v_user, v_month)
    on conflict do nothing;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'claimed');
  end if;
  perform tasktrack_grant_bonus_credits(v_user, 20);
  insert into app_metrics (user_id, event_name) values (v_user, 'exam_boost_claimed');
  return jsonb_build_object('ok', true, 'credits', 20);
end;
$$;
revoke execute on function public.claim_exam_boost() from public, anon;
grant execute on function public.claim_exam_boost() to authenticated;

-- 4. Burst limit on AI requests ---------------------------------------------------------
-- At most 8 AI requests a minute per student. Over that, the reservation fails and the
-- chat shows "try again" instead of using up credits or the shared free AI quota.
alter table public.ai_credit_usage
  add column if not exists burst_started_at timestamptz,
  add column if not exists burst_count integer not null default 0;

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
  v_burst_start timestamptz;
  v_burst integer;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;

  insert into ai_credit_usage (user_id, usage_month) values (v_user, v_month)
    on conflict (user_id, usage_month) do nothing;
  select u.credits_used, u.burst_started_at, u.burst_count
    into v_used, v_burst_start, v_burst
    from ai_credit_usage u
    where u.user_id = v_user and u.usage_month = v_month for update;

  if v_burst_start is null or v_burst_start < now() - interval '1 minute' then
    v_burst_start := now();
    v_burst := 0;
  end if;
  if v_burst >= 8 then
    raise exception 'rate_limited: too many AI requests this minute';
  end if;

  v_limit := tasktrack_credit_limit(v_user, v_month);

  if v_used + v_cost > v_limit then
    return query select false, v_used, v_limit, greatest(v_limit - v_used, 0);
    return;
  end if;

  update ai_credit_usage
    set credits_used = credits_used + v_cost, last_cost = v_cost, last_reserved_at = now(), updated_at = now(),
        burst_started_at = v_burst_start, burst_count = v_burst + 1
    where user_id = v_user and usage_month = v_month;
  return query select true, v_used + v_cost, v_limit, v_limit - v_used - v_cost;
end;
$$;

-- 5. Team-only reports ------------------------------------------------------------------
-- Funnel: signup → ManageBac → first AI use → came back on day 7 / day 30 → saw upgrade → asked to pay → paid.
-- "Came back" = any task, AI message or metric on or after that day.
create or replace function public.tasktrack_funnel_report(p_since timestamptz default now() - interval '90 days')
returns table(step text, students bigint)
language sql
stable
security definer
set search_path to 'public'
as $$
  with cohort as (
    select p.id, p.created_at from profiles p where p.created_at >= p_since
  ),
  activity as (
    select user_id, created_at from app_metrics
    union all select user_id, created_at from study_session_messages where role = 'user'
    union all select user_id, created_at from tasks
  )
  select * from (values
    ('1 signed up', (select count(*) from cohort)),
    ('2 linked ManageBac', (select count(*) from cohort c where exists (select 1 from managebac_calendar_connections m where m.user_id = c.id))),
    ('3 used AI', (select count(*) from cohort c where exists (select 1 from study_session_messages s where s.user_id = c.id and s.role = 'user'))),
    ('4 back on day 7+', (select count(*) from cohort c where exists (select 1 from activity a where a.user_id = c.id and a.created_at >= c.created_at + interval '7 days'))),
    ('5 back on day 30+', (select count(*) from cohort c where exists (select 1 from activity a where a.user_id = c.id and a.created_at >= c.created_at + interval '30 days'))),
    ('6 saw upgrade', (select count(distinct m.user_id) from app_metrics m join cohort c on c.id = m.user_id where m.event_name = 'upgrade_viewed')),
    ('7 started trial', (select count(*) from premium_trials t join cohort c on c.id = t.user_id)),
    ('8 sent a payment', (select count(distinct r.user_id) from premium_requests r join cohort c on c.id = r.user_id)),
    ('9 paid (approved)', (select count(distinct r.user_id) from premium_requests r join cohort c on c.id = r.user_id where r.status = 'approved'))
  ) as f(step, students);
$$;
revoke execute on function public.tasktrack_funnel_report(timestamptz) from public, anon, authenticated;

-- AI budget: credits used this month and in the last 24 hours, against a monthly budget.
create table if not exists public.tasktrack_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
alter table public.tasktrack_settings enable row level security;
revoke all on table public.tasktrack_settings from anon, authenticated;
insert into public.tasktrack_settings (key, value) values ('ai_monthly_credit_budget', '20000')
  on conflict (key) do nothing;

create or replace function public.tasktrack_ai_budget_report()
returns table(month date, credits_used bigint, credit_budget integer, percent_used numeric, students_using_ai bigint,
              heaviest_student_credits integer, requests_last_24h bigint)
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    date_trunc('month', now() at time zone 'utc')::date,
    coalesce(sum(u.credits_used), 0),
    (select value::integer from tasktrack_settings where key = 'ai_monthly_credit_budget'),
    round(100.0 * coalesce(sum(u.credits_used), 0)
          / nullif((select value::integer from tasktrack_settings where key = 'ai_monthly_credit_budget'), 0), 1),
    count(*) filter (where u.credits_used > 0),
    coalesce(max(u.credits_used), 0),
    (select count(*) from study_session_messages m where m.role = 'assistant' and m.created_at > now() - interval '24 hours')
  from ai_credit_usage u
  where u.usage_month = date_trunc('month', now() at time zone 'utc')::date;
$$;
revoke execute on function public.tasktrack_ai_budget_report() from public, anon, authenticated;
