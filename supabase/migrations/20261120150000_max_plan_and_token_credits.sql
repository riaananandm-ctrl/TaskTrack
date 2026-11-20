-- Plans: Free (50 credits), Premium/'pro' (₹499, 500 credits), Max/'max' (₹999, 1,000 credits).
-- Rewrite Coach is Max only. The AI Detector is for Premium and Max (no code needed).
-- Christmas mode stays unlocked by redeem code for everyone.
-- AI credits are charged by real token use: a request costs at least its base price,
-- and bigger requests cost more. Free pays more per token than Premium and Max.

alter table profiles drop constraint if exists profiles_plan_check;
alter table profiles add constraint profiles_plan_check check (plan in ('free', 'pro', 'max'));

insert into plan_limits (plan, daily_ai_messages, max_message_chars, quiz_questions, flashcards,
                         max_uploads_per_month, max_document_bytes, monthly_ai_credits)
select 'max', daily_ai_messages, max_message_chars, quiz_questions, flashcards,
       max_uploads_per_month, max_document_bytes, 1000
from plan_limits where plan = 'pro'
on conflict (plan) do update set monthly_ai_credits = 1000, updated_at = now();

update plan_limits set monthly_ai_credits = 500, updated_at = now() where plan = 'pro';
update plan_limits set monthly_ai_credits = 50, updated_at = now() where plan = 'free';

-- Current plan: 'pro' or 'max' until it expires, then 'free'.
create or replace function public.tasktrack_current_plan(p_user uuid)
returns text language sql stable security definer set search_path to 'public' as $$
  select case
    when p.plan in ('pro', 'max') and (p.plan_expires_at is null or p.plan_expires_at > now()) then p.plan
    else 'free'
  end
  from profiles p where p.id = p_user;
$$;

create or replace function public.tasktrack_is_paid(p_user uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce(tasktrack_current_plan(p_user), 'free') in ('pro', 'max');
$$;

-- Rewrite Coach: Max only, 50 runs a day.
create or replace function public.tasktrack_coach_daily_limit(p_user uuid)
returns integer language sql stable security definer set search_path to 'public' as $$
  select case when coalesce(tasktrack_current_plan(p_user), 'free') = 'max' then 50 else 0 end;
$$;

create or replace function public.get_coach_access()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_user uuid := auth.uid();
  v_day date := (now() at time zone 'utc')::date;
  v_used integer;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  select uses into v_used from tool_usage where user_id = v_user and tool = 'coach' and usage_day = v_day;
  return jsonb_build_object(
    'used', coalesce(v_used, 0),
    'limit', tasktrack_coach_daily_limit(v_user),
    'premium', tasktrack_is_paid(v_user),
    'plan', coalesce(tasktrack_current_plan(v_user), 'free')
  );
end;
$$;

create or replace function public.reserve_coach_use()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_user uuid := auth.uid();
  v_day date := (now() at time zone 'utc')::date;
  v_limit integer;
  v_used integer;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if coalesce(tasktrack_current_plan(v_user), 'free') <> 'max' then
    return jsonb_build_object('allowed', false, 'reason', 'max', 'used', 0, 'limit', 0);
  end if;
  v_limit := tasktrack_coach_daily_limit(v_user);
  insert into tool_usage (user_id, tool, usage_day) values (v_user, 'coach', v_day) on conflict do nothing;
  select uses into v_used from tool_usage
    where user_id = v_user and tool = 'coach' and usage_day = v_day for update;
  if v_used >= v_limit then
    return jsonb_build_object('allowed', false, 'reason', 'limit', 'used', v_used, 'limit', v_limit);
  end if;
  update tool_usage set uses = uses + 1, last_reserved_at = now()
    where user_id = v_user and tool = 'coach' and usage_day = v_day;
  return jsonb_build_object('allowed', true, 'used', v_used + 1, 'limit', v_limit);
end;
$$;

-- AI Detector: Premium 15 a day, Max 30 a day, Free none.
create or replace function public.tasktrack_detector_limit(p_user uuid)
returns integer language sql stable security definer set search_path to 'public', 'pg_temp' as $$
  select case coalesce(tasktrack_current_plan(p_user), 'free') when 'max' then 30 when 'pro' then 15 else 0 end;
$$;

create or replace function public.reserve_tool_use(p_tool text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_user uuid := auth.uid();
  v_day date := (now() at time zone 'utc')::date;
  v_limit integer;
  v_used integer;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if p_tool <> 'detector' then return jsonb_build_object('allowed', false, 'reason', 'unknown'); end if;
  if not tasktrack_is_paid(v_user) then
    return jsonb_build_object('allowed', false, 'reason', 'premium');
  end if;
  v_limit := tasktrack_detector_limit(v_user);
  insert into tool_usage (user_id, tool, usage_day) values (v_user, p_tool, v_day) on conflict do nothing;
  select uses into v_used from tool_usage
    where user_id = v_user and tool = p_tool and usage_day = v_day for update;
  if v_used >= v_limit then
    return jsonb_build_object('allowed', false, 'reason', 'limit', 'used', v_used, 'limit', v_limit);
  end if;
  update tool_usage set uses = uses + 1, last_reserved_at = now()
    where user_id = v_user and tool = p_tool and usage_day = v_day;
  return jsonb_build_object('allowed', true, 'used', v_used + 1, 'limit', v_limit);
end;
$$;

create or replace function public.get_tool_access()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_user uuid := auth.uid();
  v_day date := (now() at time zone 'utc')::date;
  v_used integer;
  v_det integer;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  select uses into v_used from polish_usage where user_id = v_user and usage_day = v_day;
  select uses into v_det from tool_usage where user_id = v_user and tool = 'detector' and usage_day = v_day;
  return jsonb_build_object(
    'unlocked', coalesce((select jsonb_agg(tool) from tool_unlocks where user_id = v_user), '[]'::jsonb),
    'premium', tasktrack_is_paid(v_user),
    'plan', coalesce(tasktrack_current_plan(v_user), 'free'),
    'polishUsed', coalesce(v_used, 0),
    'polishLimit', 3,
    'detectorUsed', coalesce(v_det, 0),
    'detectorLimit', tasktrack_detector_limit(v_user),
    'resetsAt', ((v_day + 1)::timestamp at time zone 'utc')
  );
end;
$$;

create or replace function public.reserve_polish_use()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_user uuid := auth.uid();
  v_day date := (now() at time zone 'utc')::date;
  v_used integer;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if not exists (select 1 from tool_unlocks where user_id = v_user and tool = 'polish') then
    return jsonb_build_object('allowed', false, 'reason', 'locked');
  end if;
  if not tasktrack_is_paid(v_user) then
    return jsonb_build_object('allowed', false, 'reason', 'premium');
  end if;
  insert into polish_usage (user_id, usage_day) values (v_user, v_day) on conflict do nothing;
  select uses into v_used from polish_usage where user_id = v_user and usage_day = v_day for update;
  if v_used >= 3 then
    return jsonb_build_object('allowed', false, 'reason', 'limit', 'used', v_used);
  end if;
  update polish_usage set uses = uses + 1, last_reserved_at = now()
    where user_id = v_user and usage_day = v_day;
  return jsonb_build_object('allowed', true, 'used', v_used + 1);
end;
$$;

-- Uploads: use the plan's own limits row (Max gets the same as Premium).
create or replace function public.reserve_document_upload(p_file_name text, p_declared_mime text, p_size_bytes bigint, p_client_request_key uuid)
returns table(document_id uuid, reservation_id uuid, storage_path text, expires_at timestamp with time zone)
language plpgsql security definer set search_path to 'public' as $function$
declare
v_user uuid := auth.uid();
v_month date := (date_trunc('month', now() at time zone 'utc'))::date;
v_plan text; v_limit integer; v_max_bytes bigint; v_ext text;
v_doc documents%rowtype; v_res document_upload_reservations%rowtype;
v_existing uuid;
begin
if v_user is null then raise exception 'not_authenticated'; end if;
if p_client_request_key is null then raise exception 'client_key_required'; end if;

perform lock_user_quota(v_user);

select d.id into v_existing from documents d
where d.owner_id = v_user and d.client_request_key = p_client_request_key;
if v_existing is not null then
select * into v_doc from documents where id = v_existing;
if v_doc.size_bytes <> p_size_bytes or v_doc.file_name <> p_file_name
then raise exception 'request_key_conflict'; end if;
select * into v_res from document_upload_reservations where document_id = v_doc.id;
return query select v_doc.id, v_res.id, v_doc.storage_path, v_res.expires_at;
return;
end if;

v_ext := lower(split_part(p_file_name, '.', -1));
if v_ext not in ('pdf','doc','docx','ppt','pptx','txt','md','png','jpg','jpeg','webp','csv','xlsx')
then raise exception 'unsupported_type'; end if;

v_plan := coalesce(tasktrack_current_plan(v_user), 'free');
select pl.max_uploads_per_month, pl.max_document_bytes
into v_limit, v_max_bytes from plan_limits pl where pl.plan = v_plan;
v_limit := coalesce(v_limit, 7);
v_max_bytes := coalesce(v_max_bytes, 150000000);
if p_size_bytes <= 0 or p_size_bytes > v_max_bytes then raise exception 'size_out_of_range'; end if;
if document_quota_in_force(v_user, v_month) >= v_limit then raise exception 'quota_exceeded'; end if;

insert into documents (owner_id, file_name, declared_mime, size_bytes, storage_path,
charge_month, client_request_key)
values (v_user,
left(regexp_replace(p_file_name, '[^\w .''\-,!*&$@=;:+?()]', '_', 'g'), 255),
p_declared_mime, p_size_bytes, v_user::text || '/' || gen_random_uuid()::text,
v_month, p_client_request_key)
returning * into v_doc;
update documents set storage_path = v_user::text || '/' || v_doc.id::text
where id = v_doc.id returning * into v_doc;

insert into document_upload_reservations (document_id, owner_id, charge_month,
expires_at, max_deadline)
values (v_doc.id, v_user, v_month, now() + interval '15 minutes', now() + interval '24 hours')
returning * into v_res;

return query select v_doc.id, v_res.id, v_doc.storage_path, v_res.expires_at;
end $function$;

-- UPI payments now say which plan they are for.
alter table premium_requests add column if not exists plan text not null default 'pro';
alter table premium_requests drop constraint if exists premium_requests_plan_check;
alter table premium_requests add constraint premium_requests_plan_check check (plan in ('pro', 'max'));
alter table premium_requests alter column amount_inr drop default;
alter table premium_requests drop constraint if exists premium_requests_amount_inr_check;

drop function if exists public.request_premium(text);
create or replace function public.request_premium(p_utr text, p_plan text default 'pro')
returns table(ok boolean, code text, request_id uuid)
language plpgsql security definer set search_path to 'public' as $$
declare
  v_user uuid := auth.uid();
  v_utr text := upper(regexp_replace(coalesce(p_utr, ''), '\s', '', 'g'));
  v_plan text := lower(coalesce(p_plan, 'pro'));
  v_id uuid;
begin
  if v_user is null then
    return query select false, 'auth', null::uuid; return;
  end if;
  if v_plan not in ('pro', 'max') then
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
  insert into premium_requests (user_id, utr, plan, amount_inr)
    values (v_user, v_utr, v_plan, case v_plan when 'max' then 999 else 499 end)
    returning id into v_id;
  return query select true, 'ok', v_id;
end;
$$;
revoke all on function public.request_premium(text, text) from public, anon;
grant execute on function public.request_premium(text, text) to authenticated;

-- Approve: switches on the plan the student paid for, for 3 months. Renewing the same
-- plan adds 3 months to what is left; changing plan starts the 3 months now.
drop function if exists public.approve_premium_request(text);
create or replace function public.approve_premium_request(p_utr text)
returns table(user_id uuid, plan text, plan_expires_at timestamp with time zone)
language plpgsql security definer set search_path to 'public' as $$
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
  select greatest(coalesce(case when tasktrack_current_plan(p.id) = v_req.plan then p.plan_expires_at end, now()), now()) + interval '3 months'
    into v_until from profiles p where p.id = v_req.user_id;
  update profiles set plan = v_req.plan, plan_expires_at = v_until where id = v_req.user_id;
  update premium_requests set status = 'approved', reviewed_at = now() where id = v_req.id;
  return query select v_req.user_id, v_req.plan, v_until;
end;
$$;
revoke all on function public.approve_premium_request(text) from public, anon, authenticated;

-- Charge by real token use, after a successful AI reply (server only).
-- Free: 1 credit per 2,000 tokens. Premium and Max: 1 credit per 3,000 tokens.
-- The base price already reserved counts towards this; only the difference is added,
-- never more than 20 extra and never past the monthly allowance.
create or replace function public.charge_ai_tokens_for(p_user uuid, p_tokens integer, p_base_cost integer)
returns integer language plpgsql security definer set search_path to 'public', 'pg_catalog' as $$
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
  select pl.monthly_ai_credits into v_limit from plan_limits pl where pl.plan = v_plan;
  select u.credits_used into v_used from ai_credit_usage u
    where u.user_id = p_user and u.usage_month = v_month for update;
  if v_used is null then return 0; end if;
  v_extra := least(v_extra, 20, greatest(coalesce(v_limit, 50) - v_used, 0));
  if v_extra <= 0 then return 0; end if;
  update ai_credit_usage set credits_used = credits_used + v_extra, updated_at = now()
    where user_id = p_user and usage_month = v_month;
  return v_extra;
end;
$$;
revoke all on function public.charge_ai_tokens_for(uuid, integer, integer) from public, anon, authenticated;
