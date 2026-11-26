-- CAS AI: 20 requests per student per day (India time), every request logged.
-- Called by the cas-ai edge function with the student's own token before each Groq call.
create or replace function public.cas_ai_reserve(p_endpoint text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user uuid := auth.uid();
  v_used int;
  v_day_start timestamptz := date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
begin
  if v_user is null then return jsonb_build_object('allowed', false, 'error', 'auth'); end if;
  if p_endpoint not in ('coach', 'outcomes', 'vague', 'brief') then
    return jsonb_build_object('allowed', false, 'error', 'bad_endpoint');
  end if;
  -- One student at a time, so two quick clicks cannot both take the 20th slot.
  perform pg_advisory_xact_lock(hashtextextended('cas_ai:' || v_user::text, 0));
  select count(*) into v_used from cas_ai_log where user_id = v_user and created_at >= v_day_start;
  if v_used >= 20 then
    return jsonb_build_object('allowed', false, 'error', 'daily_limit', 'used', v_used);
  end if;
  insert into cas_ai_log (user_id, endpoint) values (v_user, p_endpoint);
  return jsonb_build_object('allowed', true, 'used', v_used + 1, 'limit', 20);
end;
$$;
revoke execute on function public.cas_ai_reserve(text) from public, anon;
grant execute on function public.cas_ai_reserve(text) to authenticated;
