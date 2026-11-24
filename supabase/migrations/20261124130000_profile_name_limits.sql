-- Edge cases: a 5,000-word "name", a name made only of spaces, or a huge school name
-- sent straight to the API (skipping the app's own checks).

-- New accounts: tidy and cap whatever the signup form (or a script) sent.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_name text := left(btrim(regexp_replace(coalesce(new.raw_user_meta_data->>'full_name', ''), '\s+', ' ', 'g')), 80);
  v_school text := left(btrim(regexp_replace(coalesce(new.raw_user_meta_data->>'school_name', ''), '\s+', ' ', 'g')), 120);
begin
  insert into public.profiles (id, full_name, email, year_group, school_name)
  values (
    new.id,
    coalesce(nullif(v_name, ''), left(new.email, 80)),
    new.email,
    left(nullif(new.raw_user_meta_data->>'year_group', ''), 40),
    nullif(v_school, '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Later edits: the same limits, enforced by the database.
alter table public.profiles
  drop constraint if exists profiles_full_name_sane,
  add constraint profiles_full_name_sane
    check (full_name is null or (length(full_name) <= 100 and full_name !~ '^\s*$')),
  drop constraint if exists profiles_school_name_sane,
  add constraint profiles_school_name_sane
    check (school_name is null or length(school_name) <= 150);
