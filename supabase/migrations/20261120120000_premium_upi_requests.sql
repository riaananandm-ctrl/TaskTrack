-- Premium bought by UPI: the student pays the TaskTrack UPI number, then submits the
-- UPI transaction ID (UTR). The owner checks the payment arrived and approves it
-- (approve_premium_request, service role only), which switches Premium on.

create table if not exists public.premium_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  utr text not null,
  amount_inr integer not null default 699,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  note text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  constraint premium_requests_utr_format check (utr ~ '^[0-9A-Za-z]{6,35}$'),
  constraint premium_requests_utr_unique unique (utr)
);

create index if not exists premium_requests_user_idx on public.premium_requests (user_id, created_at desc);
create index if not exists premium_requests_pending_idx on public.premium_requests (created_at) where status = 'pending';

alter table public.premium_requests enable row level security;

-- Students see only their own requests. Nobody writes directly: requests go through
-- request_premium() and approvals through approve_premium_request().
drop policy if exists "premium_requests_select_own" on public.premium_requests;
create policy "premium_requests_select_own" on public.premium_requests
  for select to authenticated using (user_id = auth.uid());

revoke insert, update, delete on public.premium_requests from anon, authenticated;

-- Submit a UPI payment for checking. One pending request at a time, and at most
-- 5 a day, so the owner's list can't be flooded.
create or replace function public.request_premium(p_utr text)
returns table (ok boolean, code text, request_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_utr text := upper(regexp_replace(coalesce(p_utr, ''), '\s', '', 'g'));
  v_id uuid;
begin
  if v_user is null then
    return query select false, 'auth', null::uuid; return;
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
  insert into premium_requests (user_id, utr) values (v_user, v_utr) returning id into v_id;
  return query select true, 'ok', v_id;
end;
$$;

revoke all on function public.request_premium(text) from public, anon;
grant execute on function public.request_premium(text) to authenticated;

-- Owner only (service role / SQL): approve a checked payment. Premium runs 3 months from
-- approval, or 3 months on top of any Premium time the student still has.
create or replace function public.approve_premium_request(p_utr text)
returns table (user_id uuid, plan_expires_at timestamptz)
language plpgsql
security definer
set search_path = public
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
  select greatest(coalesce(case when p.plan = 'pro' then p.plan_expires_at end, now()), now()) + interval '3 months'
    into v_until from profiles p where p.id = v_req.user_id;
  update profiles set plan = 'pro', plan_expires_at = v_until where id = v_req.user_id;
  update premium_requests set status = 'approved', reviewed_at = now() where id = v_req.id;
  return query select v_req.user_id, v_until;
end;
$$;

revoke all on function public.approve_premium_request(text) from public, anon, authenticated;
