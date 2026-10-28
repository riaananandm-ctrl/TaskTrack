/*
# Profile trigger: also capture year group and school name

1. Problem
- With email confirmation enabled, no session exists right after signup, so the
  client can no longer write the extra profile fields it collected on the form.
- The `handle_new_user()` trigger only stored `full_name` and `email`, so the
  chosen year group and school name were lost for new accounts.

2. Changes
- Recreate `public.handle_new_user()` to also read `year_group` and
  `school_name` from the signup metadata (`raw_user_meta_data`), storing empty
  strings as NULL. `full_name` keeps its safe email fallback and the insert
  still ignores an existing profile row.

3. Security
- Function remains SECURITY DEFINER with an explicit `search_path = public`,
  and is unchanged in scope. No table, column, or policy changes.

4. Notes
- Idempotent and safe to re-run. Existing profiles are untouched
  (`ON CONFLICT (id) DO NOTHING`).
*/

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, year_group, school_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    NEW.email,
    NULLIF(NEW.raw_user_meta_data->>'year_group', ''),
    NULLIF(NEW.raw_user_meta_data->>'school_name', '')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
