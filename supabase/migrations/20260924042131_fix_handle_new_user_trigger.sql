/*
# Fix handle_new_user trigger function

## Problem
The `handle_new_user()` trigger function that auto-creates a profile on signup
was failing with "Database error saving new user" because:
1. It did not set `search_path` — SECURITY DEFINER functions without an explicit
   search_path can fail in newer Supabase versions.
2. If `full_name` was missing from metadata, the NOT NULL constraint on
   `profiles.full_name` would be violated, rolling back the entire signup.

## Changes
- Recreate `handle_new_user()` with `SET search_path = public` and a safe
  COALESCE for full_name (falls back to email if missing).
- No data changes. No table structure changes. No policy changes.
*/

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    NEW.email
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();