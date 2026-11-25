-- Speed fixes from the Supabase performance advisor. Neither changes who can see what.
--
-- 1. Row-level security policies that call auth.uid() directly re-evaluate it for
--    every row. Wrapping it as (select auth.uid()) lets Postgres evaluate it once per
--    query. Policies are rewritten in place from their current definitions, so this
--    picks up every policy without retyping them by hand.
-- 2. Foreign keys without a covering index make deletes on the parent table (and
--    joins on the key) scan the child table. Each single-column one gets an index.

do $$
declare
  p record;
  v_qual text;
  v_check text;
  v_sql text;
begin
  for p in
    select schemaname, tablename, policyname, qual, with_check
      from pg_policies
     where schemaname = 'public'
       and (qual ~ 'auth\.uid\(\)' or with_check ~ 'auth\.uid\(\)')
  loop
    -- Protect calls that are already wrapped, wrap the rest, then restore.
    v_qual := p.qual;
    v_check := p.with_check;
    if v_qual is not null then
      v_qual := regexp_replace(v_qual, '\(\s*SELECT auth\.uid\(\) AS uid\)', '@@UID@@', 'gi');
      v_qual := replace(v_qual, 'auth.uid()', '(select auth.uid())');
      v_qual := replace(v_qual, '@@UID@@', '(select auth.uid())');
    end if;
    if v_check is not null then
      v_check := regexp_replace(v_check, '\(\s*SELECT auth\.uid\(\) AS uid\)', '@@UID@@', 'gi');
      v_check := replace(v_check, 'auth.uid()', '(select auth.uid())');
      v_check := replace(v_check, '@@UID@@', '(select auth.uid())');
    end if;

    v_sql := format('alter policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    if v_qual is not null then v_sql := v_sql || format(' using (%s)', v_qual); end if;
    if v_check is not null then v_sql := v_sql || format(' with check (%s)', v_check); end if;
    execute v_sql;
  end loop;
end $$;

do $$
declare
  fk record;
begin
  for fk in
    select c.conrelid::regclass as tbl,
           cl.relname as table_name,
           a.attname as col
      from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid
      join pg_namespace n on n.oid = cl.relnamespace
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f'
       and n.nspname = 'public'
       and array_length(c.conkey, 1) = 1
       and not exists (
         select 1 from pg_index i
          where i.indrelid = c.conrelid
            and i.indkey[0] = c.conkey[1]
       )
  loop
    execute format('create index if not exists %I on %s (%I)',
                   left(fk.table_name || '_' || fk.col || '_fk_idx', 63), fk.tbl, fk.col);
  end loop;
end $$;
