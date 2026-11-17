-- The AI Detector was Premium-only, but Premium can't be bought yet, so it was off for
-- everyone. Now a student who unlocks it with a code can use it: 5 checks a day on the
-- Free plan, 15 on Premium.

create or replace function public.tasktrack_detector_limit(p_user uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when coalesce(tasktrack_current_plan(p_user), 'free') = 'pro' then 15 else 5 end;
$$;
revoke all on function public.tasktrack_detector_limit(uuid) from public, anon, authenticated;

create or replace function public.reserve_tool_use(p_tool text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_day date := (now() at time zone 'utc')::date;
  v_limit integer;
  v_used integer;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if p_tool <> 'detector' then return jsonb_build_object('allowed', false, 'reason', 'unknown'); end if;
  if not exists (select 1 from tool_unlocks where user_id = v_user and tool = p_tool) then
    return jsonb_build_object('allowed', false, 'reason', 'locked');
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
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
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
    'premium', coalesce(tasktrack_current_plan(v_user), 'free') = 'pro',
    'polishUsed', coalesce(v_used, 0),
    'polishLimit', 3,
    'detectorUsed', coalesce(v_det, 0),
    'detectorLimit', tasktrack_detector_limit(v_user),
    'resetsAt', ((v_day + 1)::timestamp at time zone 'utc')
  );
end;
$$;
