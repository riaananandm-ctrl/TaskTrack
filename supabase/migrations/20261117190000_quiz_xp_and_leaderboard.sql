-- XP for learning, and a leaderboard.
--
-- * Quizzes and flashcard reviews now earn XP. The database gives it out from
--   triggers, so the browser can never choose an amount:
--     - quiz: 5 XP per correct answer, +10 for a perfect score (3+ questions),
--       at most 150 XP a day from quizzes;
--     - flashcards: 3 XP for each card answered correctly, at most 60 XP a day.
-- * Leaderboard: students choose to join with a nickname (never their real name).
--   "This week" and "All time" show the top 20 nicknames. "My groups" shows the
--   students you share a Group Study room with, by the name they already use there.

-- ---------------------------------------------------------------------------
-- Give XP (internal; only the triggers below call it)
-- ---------------------------------------------------------------------------
create or replace function public.tasktrack_grant_xp(p_user uuid, p_amount integer, p_reason text, p_daily_cap integer)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_today timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  v_given integer;
  v_amount integer;
begin
  if p_user is null or p_amount <= 0 then return 0; end if;
  select coalesce(sum((event_data->>'amount')::int), 0) into v_given
    from app_metrics
   where user_id = p_user and event_name = 'xp_awarded'
     and event_data->>'reason' = p_reason and created_at >= v_today;
  v_amount := least(p_amount, greatest(0, p_daily_cap - v_given));
  if v_amount <= 0 then return 0; end if;

  insert into user_xp (user_id, total_xp, level)
  values (p_user, v_amount, greatest(1, floor(sqrt(v_amount) / 5)::int + 1))
  on conflict (user_id) do update
    set total_xp = user_xp.total_xp + v_amount,
        level = greatest(1, floor(sqrt(user_xp.total_xp + v_amount) / 5)::int + 1),
        updated_at = now();

  insert into app_metrics (user_id, event_name, event_data)
  values (p_user, 'xp_awarded', jsonb_build_object('amount', v_amount, 'reason', p_reason));
  return v_amount;
end;
$$;
revoke all on function public.tasktrack_grant_xp(uuid, integer, text, integer) from public, anon, authenticated;

-- Quiz finished -> XP
create or replace function public.tasktrack_quiz_xp()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_total integer := least(greatest(coalesce(new.total, 0), 0), 20);
  v_score integer := least(greatest(coalesce(new.score, 0), 0), v_total);
  v_xp integer;
begin
  v_xp := v_score * 5 + case when v_total >= 3 and v_score = v_total then 10 else 0 end;
  perform tasktrack_grant_xp(new.user_id, v_xp, 'quiz', 150);
  return new;
end;
$$;
drop trigger if exists tasktrack_quiz_xp on public.quiz_attempts;
create trigger tasktrack_quiz_xp after insert on public.quiz_attempts
  for each row execute function public.tasktrack_quiz_xp();

-- Flashcard answered correctly -> XP
create or replace function public.tasktrack_flashcard_xp()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if new.times_correct > old.times_correct
     and new.last_reviewed_at is distinct from old.last_reviewed_at then
    perform tasktrack_grant_xp(new.user_id, 3, 'flashcard', 60);
  end if;
  return new;
end;
$$;
drop trigger if exists tasktrack_flashcard_xp on public.review_cards;
create trigger tasktrack_flashcard_xp after update on public.review_cards
  for each row execute function public.tasktrack_flashcard_xp();

revoke all on function public.tasktrack_quiz_xp() from public, anon, authenticated;
revoke all on function public.tasktrack_flashcard_xp() from public, anon, authenticated;

create index if not exists app_metrics_xp_time_idx
  on public.app_metrics (created_at) where event_name = 'xp_awarded';

-- ---------------------------------------------------------------------------
-- Leaderboard nicknames (opt-in)
-- ---------------------------------------------------------------------------
create table if not exists public.leaderboard_players (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null,
  joined_at timestamptz not null default now()
);
create unique index if not exists leaderboard_players_nickname_key
  on public.leaderboard_players (lower(nickname));
alter table public.leaderboard_players enable row level security;
drop policy if exists "select_own_leaderboard_player" on public.leaderboard_players;
create policy "select_own_leaderboard_player" on public.leaderboard_players
  for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete on public.leaderboard_players from anon, authenticated;

create or replace function public.join_leaderboard(p_nickname text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_user uuid := auth.uid();
  v_nick text := btrim(regexp_replace(coalesce(p_nickname, ''), '\s+', ' ', 'g'));
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if char_length(v_nick) < 3 or char_length(v_nick) > 20 or v_nick !~ '^[A-Za-z0-9 _.-]+$' then
    return jsonb_build_object('ok', false, 'error', 'Use 3 to 20 letters, numbers, spaces, dots, dashes or underscores.');
  end if;
  if tasktrack_mask_profanity(v_nick) is distinct from v_nick then
    return jsonb_build_object('ok', false, 'error', 'Please pick a different nickname.');
  end if;
  if exists (select 1 from leaderboard_players where lower(nickname) = lower(v_nick) and user_id <> v_user) then
    return jsonb_build_object('ok', false, 'error', 'That nickname is taken. Try another one.');
  end if;
  insert into leaderboard_players (user_id, nickname) values (v_user, v_nick)
  on conflict (user_id) do update set nickname = excluded.nickname;
  return jsonb_build_object('ok', true, 'nickname', v_nick);
end;
$$;

create or replace function public.leave_leaderboard()
returns void
language sql
security definer
set search_path = public, pg_catalog
as $$
  delete from leaderboard_players where user_id = auth.uid();
$$;

-- p_scope: 'week' | 'all' | 'groups'
create or replace function public.get_leaderboard(p_scope text default 'week')
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_user uuid := auth.uid();
  v_week timestamptz := date_trunc('week', now() at time zone 'utc') at time zone 'utc';
  v_nick text;
  v_rows jsonb;
  v_me jsonb;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  select nickname into v_nick from leaderboard_players where user_id = v_user;

  with weekly as (
    select user_id, sum((event_data->>'amount')::int)::int as xp
      from app_metrics
     where event_name = 'xp_awarded' and created_at >= v_week
     group by user_id
  ),
  pool as (
    -- who is on this board, and the name shown for them
    select lp.user_id, lp.nickname as name
      from leaderboard_players lp
     where p_scope in ('week', 'all')
    union
    select m.user_id, min(m.display_name) as name
      from study_group_members m
      join study_groups g on g.id = m.group_id and g.ended_at is null
     where p_scope = 'groups'
       and m.group_id in (select group_id from study_group_members where user_id = v_user)
     group by m.user_id
  ),
  scored as (
    select p.user_id, p.name,
           case when p_scope = 'all' then coalesce(x.total_xp, 0) else coalesce(w.xp, 0) end as xp,
           greatest(1, floor(sqrt(coalesce(x.total_xp, 0)) / 5)::int + 1) as level
      from pool p
      left join weekly w on w.user_id = p.user_id
      left join user_xp x on x.user_id = p.user_id
  ),
  ranked as (
    select *, rank() over (order by xp desc) as pos from scored
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'rank', pos, 'name', name, 'xp', xp, 'level', level, 'me', user_id = v_user)
           order by pos, name) filter (where pos <= 20), '[]'::jsonb),
         (select jsonb_build_object('rank', r.pos, 'xp', r.xp) from ranked r where r.user_id = v_user)
    into v_rows, v_me
    from ranked;

  return jsonb_build_object(
    'scope', p_scope,
    'nickname', v_nick,
    'rows', v_rows,
    'me', v_me,
    'myWeekXp', coalesce((select sum((event_data->>'amount')::int) from app_metrics
                           where user_id = v_user and event_name = 'xp_awarded' and created_at >= v_week), 0),
    'resetsAt', v_week + interval '7 days'
  );
end;
$$;

revoke all on function public.join_leaderboard(text) from public, anon;
revoke all on function public.leave_leaderboard() from public, anon;
revoke all on function public.get_leaderboard(text) from public, anon;
grant execute on function public.join_leaderboard(text) to authenticated;
grant execute on function public.leave_leaderboard() to authenticated;
grant execute on function public.get_leaderboard(text) to authenticated;
