-- Homepage "Try it" demo: visitors who aren't signed in can make one small AI study
-- set (explanation, flashcards, quiz) from a topic. To keep it cheap and hard to
-- abuse, each visitor gets a few tries a day and there is a daily cap for everyone.
-- Visitors are counted by a salted hash of their IP for that day only; no IP is stored.

create table if not exists public.try_demo_usage (
  day date not null,
  visitor text not null,
  uses integer not null default 0,
  primary key (day, visitor)
);

alter table public.try_demo_usage enable row level security;
-- No policies: only the server (service role) touches this table.
revoke all on public.try_demo_usage from anon, authenticated;

create or replace function public.try_demo_reserve(p_visitor text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  per_visitor constant integer := 5;
  per_day constant integer := 400;
  today date := (now() at time zone 'utc')::date;
  mine integer;
  everyone integer;
begin
  -- Keep only today and yesterday.
  delete from public.try_demo_usage where day < today - 1;

  select coalesce(sum(uses), 0) into everyone from public.try_demo_usage where day = today;
  if everyone >= per_day then
    return 'busy';
  end if;

  insert into public.try_demo_usage (day, visitor, uses)
  values (today, p_visitor, 1)
  on conflict (day, visitor) do update set uses = try_demo_usage.uses + 1
  returning uses into mine;

  if mine > per_visitor then
    return 'limit';
  end if;
  return 'ok';
end;
$$;

revoke all on function public.try_demo_reserve(text) from public, anon, authenticated;
grant execute on function public.try_demo_reserve(text) to service_role;
