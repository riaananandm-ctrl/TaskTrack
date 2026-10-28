/*
# Lock down the signup trigger function and pin its search path

## Purpose
`handle_new_user()` was created as SECURITY DEFINER by the original schema. By
default every function is executable by PUBLIC, so the anon role could invoke it
through /rest/v1/rpc/handle_new_user. It is a trigger function with no legitimate
direct caller, so EXECUTE is revoked from PUBLIC, anon and authenticated. The
trigger still fires because triggers run with the privileges of the table owner,
not the caller.

It also ran with a mutable search_path; pinning it to `public` removes the
possibility of a caller-controlled path shadowing the objects it references.

`update_updated_at_column()` is corrected the same way (search path only). It
performs no privileged work, so its grants are left alone.

## Security
Function attributes and grants only. Bodies are unchanged.
*/

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO profiles (id, full_name, email)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name', NEW.email);
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION handle_new_user() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
