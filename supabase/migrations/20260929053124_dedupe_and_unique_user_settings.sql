/*
# Fix duplicate user_settings rows and enforce one row per user

1. Problem
- `user_settings` had no unique constraint on `user_id`. Every "Save" used
  upsert keyed on the generated primary key, so it INSERTED a new row each time
  instead of updating. Several users accumulated duplicate settings rows.
- Duplicates also broke settings loading, which expects a single row per user.

2. Data cleanup
- Removes duplicate `user_settings` rows, keeping the most recently updated row
  for each user (ties broken by the newest id). No other table is touched.

3. Schema
- Adds a unique index `user_settings_user_id_key` on `(user_id)`, so there can
  only ever be one settings row per user going forward.

4. Security
- No policy changes. Existing owner-scoped RLS policies are unchanged: each user
  can still only read/write their own settings row.

5. Notes
- Idempotent and safe to re-run. Nothing else about the table is altered.
*/

DELETE FROM public.user_settings a
USING public.user_settings b
WHERE a.user_id = b.user_id
  AND a.id <> b.id
  AND (a.updated_at < b.updated_at OR (a.updated_at = b.updated_at AND a.id < b.id));

CREATE UNIQUE INDEX IF NOT EXISTS user_settings_user_id_key
  ON public.user_settings (user_id);
