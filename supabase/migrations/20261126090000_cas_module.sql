-- CAS (Creativity, Activity, Service) module.
-- Students read and write only their own rows. Supervisor verifications are reached
-- only through their secret token, via the security-definer functions at the bottom.

create table if not exists public.cas_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade default auth.uid(),
  start_date date,
  end_date date,
  supervisor_name text,
  supervisor_email text,
  target_hours_creativity integer not null default 50 check (target_hours_creativity between 0 and 1000),
  target_hours_activity integer not null default 50 check (target_hours_activity between 0 and 1000),
  target_hours_service integer not null default 50 check (target_hours_service between 0 and 1000),
  created_at timestamptz not null default now()
);

create table if not exists public.cas_experiences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  title text not null check (length(title) between 1 and 200),
  description text check (length(description) <= 5000),
  strands text[] not null check (
    cardinality(strands) between 1 and 3
    and strands <@ array['creativity', 'activity', 'service']::text[]
  ),
  start_date date not null,
  end_date date,
  hours numeric(6,2) not null default 0 check (hours >= 0 and hours <= 1000),
  supervisor_name text check (length(supervisor_name) <= 200),
  supervisor_email text check (length(supervisor_email) <= 320),
  evidence_url text check (length(evidence_url) <= 1000),
  verification_status text not null default 'pending' check (verification_status in ('pending', 'confirmed', 'queried')),
  created_at timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);
create index if not exists cas_experiences_user_idx on public.cas_experiences (user_id, start_date desc);

create table if not exists public.cas_reflections (
  id uuid primary key default gen_random_uuid(),
  experience_id uuid not null references public.cas_experiences(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  what_i_did text check (length(what_i_did) <= 10000),
  what_i_learned text check (length(what_i_learned) <= 10000),
  outcome_evidence text check (length(outcome_evidence) <= 10000),
  outcomes integer[] not null default '{}' check (outcomes <@ array[1,2,3,4,5,6,7]),
  ai_flags jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (experience_id)
);

create table if not exists public.cas_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  title text not null check (length(title) between 1 and 200),
  description text check (length(description) <= 5000),
  strands text[] not null default '{}' check (strands <@ array['creativity', 'activity', 'service']::text[]),
  start_date date,
  end_date date,
  collaborators text[] not null default '{}',
  status text not null default 'planning' check (status in ('planning', 'in_progress', 'completed')),
  milestones jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create table if not exists public.cas_interviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  type text not null check (type in ('initial', 'interim', 'final')),
  scheduled_for timestamptz,
  notes text check (length(notes) <= 10000),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, type)
);

create table if not exists public.cas_verifications (
  id uuid primary key default gen_random_uuid(),
  experience_id uuid not null references public.cas_experiences(id) on delete cascade,
  token uuid not null unique default gen_random_uuid(),
  supervisor_email text,
  responded_at timestamptz,
  response text check (response in ('confirmed', 'queried')),
  query_note text check (length(query_note) <= 2000),
  created_at timestamptz not null default now()
);

-- Every CAS AI request, for the audit trail and the 20-a-day limit.
create table if not exists public.cas_ai_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  ok boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists cas_ai_log_user_day_idx on public.cas_ai_log (user_id, created_at desc);

-- Row-level security ------------------------------------------------------------------
alter table public.cas_profiles enable row level security;
alter table public.cas_experiences enable row level security;
alter table public.cas_reflections enable row level security;
alter table public.cas_projects enable row level security;
alter table public.cas_interviews enable row level security;
alter table public.cas_verifications enable row level security;
alter table public.cas_ai_log enable row level security;

do $$
declare t text;
begin
  foreach t in array array['cas_profiles', 'cas_experiences', 'cas_reflections', 'cas_projects', 'cas_interviews'] loop
    execute format('drop policy if exists "Own rows" on public.%I', t);
    execute format(
      'create policy "Own rows" on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())',
      t);
    execute format('revoke all on table public.%I from anon', t);
  end loop;
end $$;

-- A reflection must belong to one of the student's own experiences.
drop policy if exists "Own rows" on public.cas_reflections;
create policy "Own rows" on public.cas_reflections for all to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.cas_experiences e where e.id = experience_id and e.user_id = auth.uid())
  );

-- Students cannot mark their own experiences as verified: only the security-definer
-- verification functions (running as the table owner) may change the status.
create or replace function public.cas_guard_verification_status()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.verification_status := 'pending';
    elsif new.verification_status is distinct from old.verification_status then
      new.verification_status := old.verification_status;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists cas_guard_verification_status on public.cas_experiences;
create trigger cas_guard_verification_status
  before insert or update on public.cas_experiences
  for each row execute function public.cas_guard_verification_status();

-- Verifications and the AI log: no direct table access at all.
revoke all on table public.cas_verifications from anon, authenticated;
revoke all on table public.cas_ai_log from anon, authenticated;

-- Evidence uploads: a private bucket, each student only touches their own folder.
insert into storage.buckets (id, name, public, file_size_limit)
values ('cas-evidence', 'cas-evidence', false, 10000000)
on conflict (id) do nothing;
update storage.buckets
  set allowed_mime_types = array['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/heic']
  where id = 'cas-evidence';

drop policy if exists "CAS evidence own folder read" on storage.objects;
create policy "CAS evidence own folder read" on storage.objects for select to authenticated
  using (bucket_id = 'cas-evidence' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "CAS evidence own folder write" on storage.objects;
create policy "CAS evidence own folder write" on storage.objects for insert to authenticated
  with check (bucket_id = 'cas-evidence' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "CAS evidence own folder delete" on storage.objects;
create policy "CAS evidence own folder delete" on storage.objects for delete to authenticated
  using (bucket_id = 'cas-evidence' and (storage.foldername(name))[1] = auth.uid()::text);

-- Verification functions ------------------------------------------------------------------

-- Student: create (or reuse) the supervisor link for one of their experiences.
create or replace function public.cas_request_verification(p_experience_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user uuid := auth.uid();
  v_exp cas_experiences%rowtype;
  v_token uuid;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  select * into v_exp from cas_experiences where id = p_experience_id and user_id = v_user;
  if not found then raise exception 'not_found'; end if;
  select token into v_token from cas_verifications
    where experience_id = p_experience_id and responded_at is null
    order by created_at desc limit 1;
  if v_token is null then
    insert into cas_verifications (experience_id, supervisor_email)
      values (p_experience_id, v_exp.supervisor_email)
      returning token into v_token;
    update cas_experiences set verification_status = 'pending' where id = p_experience_id;
  end if;
  return v_token;
end;
$$;
revoke execute on function public.cas_request_verification(uuid) from public, anon;
grant execute on function public.cas_request_verification(uuid) to authenticated;

-- Supervisor (no account): what the link shows. Only the experience and its reflection.
create or replace function public.cas_verification_view(p_token uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select jsonb_build_object(
    'student', coalesce(nullif(split_part(p.full_name, ' ', 1), ''), 'A student'),
    'title', e.title,
    'description', e.description,
    'strands', e.strands,
    'start_date', e.start_date,
    'end_date', e.end_date,
    'hours', e.hours,
    'supervisor_name', e.supervisor_name,
    'what_i_did', r.what_i_did,
    'what_i_learned', r.what_i_learned,
    'outcome_evidence', r.outcome_evidence,
    'responded_at', v.responded_at,
    'response', v.response
  )
  from cas_verifications v
  join cas_experiences e on e.id = v.experience_id
  left join cas_reflections r on r.experience_id = e.id
  left join profiles p on p.id = e.user_id
  where v.token = p_token;
$$;
revoke execute on function public.cas_verification_view(uuid) from public;
grant execute on function public.cas_verification_view(uuid) to anon, authenticated;

-- Supervisor: confirm or query, once.
create or replace function public.cas_verification_respond(p_token uuid, p_response text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row cas_verifications%rowtype;
begin
  if p_response not in ('confirmed', 'queried') then
    return jsonb_build_object('ok', false, 'error', 'bad_response');
  end if;
  select * into v_row from cas_verifications where token = p_token for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if v_row.responded_at is not null then
    return jsonb_build_object('ok', false, 'error', 'already_answered', 'response', v_row.response);
  end if;
  update cas_verifications
    set responded_at = now(), response = p_response, query_note = left(nullif(trim(p_note), ''), 2000)
    where id = v_row.id;
  update cas_experiences set verification_status = p_response where id = v_row.experience_id;
  return jsonb_build_object('ok', true, 'response', p_response);
end;
$$;
revoke execute on function public.cas_verification_respond(uuid, text, text) from public;
grant execute on function public.cas_verification_respond(uuid, text, text) to anon, authenticated;

-- Student: verification state of their own experiences (never the token of others).
create or replace function public.cas_my_verifications()
returns table(experience_id uuid, token uuid, responded_at timestamptz, response text, query_note text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select distinct on (v.experience_id) v.experience_id, v.token, v.responded_at, v.response, v.query_note
  from cas_verifications v
  join cas_experiences e on e.id = v.experience_id
  where e.user_id = auth.uid()
  order by v.experience_id, v.created_at desc;
$$;
revoke execute on function public.cas_my_verifications() from public, anon;
grant execute on function public.cas_my_verifications() to authenticated;
