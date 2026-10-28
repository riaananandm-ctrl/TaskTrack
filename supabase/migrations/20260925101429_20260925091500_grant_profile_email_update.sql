/*
# Allow profile email upsert (column grant follow-up)

## Purpose
The sign-up flow upserts a profile row including `email`, which needs UPDATE
privilege on that column. The previous migration granted UPDATE only on the
user-owned profile columns, so this adds `email`.

## Why email is safe to grant
`email` is a display field, not a privilege-bearing one. A user editing their own
display email does not change their authentication identity or grant any
entitlement. `plan` and `plan_expires_at` remain ungranted and therefore stay
server-only.

## Security
No policy changes. Column-level grants only.
*/

GRANT UPDATE (email) ON profiles TO authenticated;
