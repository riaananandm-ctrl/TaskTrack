-- Where each sign-up came from (?ref=meta, ?ref=poster, ...), for marketing.
--
-- The app keeps the ref from the landing URL in the browser, then reports it once the
-- new account signs in. Students can read their own row's ref but cannot update it;
-- the only way in is record_signup_ref, which writes once, only for an account made in the last hour, and
-- only a short lowercase tag.

alter table public.profiles add column if not exists signup_ref text;

create or replace function public.record_signup_ref(p_ref text)
returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  if p_ref is null or p_ref !~ '^[a-z0-9_-]{1,32}$' then
    return;
  end if;
  update public.profiles
     set signup_ref = p_ref
   where id = auth.uid()
     and signup_ref is null
     and created_at > now() - interval '1 hour';
end;
$$;

revoke execute on function public.record_signup_ref(text) from public, anon;
grant execute on function public.record_signup_ref(text) to authenticated;
