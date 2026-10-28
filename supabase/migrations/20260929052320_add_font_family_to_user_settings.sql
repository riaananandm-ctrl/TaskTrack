/*
# Add font preference to user settings

1. Modified Tables
- `user_settings`
  - `font_family` (text, not null, default 'plus-jakarta-sans')
    Stores the user's chosen app font id. Read on sign-in to apply their
    readable font choice across the app, and written from Settings > Appearance.

2. Security
- No policy changes. The existing owner-scoped RLS policies on `user_settings`
  already restrict read/write to the owning authenticated user.

3. Notes
- Idempotent: uses ADD COLUMN IF NOT EXISTS. Existing rows receive the default.
- No existing columns are dropped, renamed, or retyped; no data is lost.
*/

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS font_family text NOT NULL DEFAULT 'plus-jakarta-sans';
