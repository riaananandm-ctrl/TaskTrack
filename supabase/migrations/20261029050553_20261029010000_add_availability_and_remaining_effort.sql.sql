/*
# Weekly availability and remaining effort (Stage 2)

1. Plain-English explanation
- The planning page currently assumes a hardcoded 6 hours of study time every day.
  This migration lets each student save their own available study time per weekday
  (including "not available at all"), and track how much work remains on each task
  separately from the original estimate. Planning warnings then compare real
  remaining work against real available time.

2. New Tables
- `weekly_availability`
  - `id` (uuid, primary key)
  - `user_id` (uuid, not null, references auth.users, cascade delete)
  - `weekday` (smallint, not null, 0=Sunday..6=Saturday, matching JS getDay())
  - `available_minutes` (integer, not null, default 360) — study minutes the student
    has for that weekday. Ignored when is_unavailable is true.
  - `is_unavailable` (boolean, not null, default false) — e.g. school trips, exams week
  - `created_at`, `updated_at` (timestamptz)
  - Unique index on (user_id, weekday): one row per weekday per student.

3. Modified Tables
- `tasks`: ADD COLUMN `remaining_minutes` (integer, nullable). Null falls back to
  `estimated_minutes` in the app. The sync function never writes it, so imported
  tasks keep their feed-derived estimate until the student or the app adjusts it.
  Additive only; no existing column is touched.

4. Security
- `weekly_availability`: RLS enabled, owner-scoped CRUD for authenticated users
  (auth.uid() = user_id), grants for SELECT/INSERT/UPDATE/DELETE to authenticated.
  No service_role grant needed: only the student's own client reads/writes it.
- `tasks.remaining_minutes`: inherits the existing hardened task grants/policies.
  Students may already UPDATE tasks rows, and the column-level grant model used for
  tasks is table-wide, so no new grant is required.

5. Important notes
- Non-destructive: additive only, idempotent (IF NOT EXISTS / DROP POLICY IF EXISTS).
*/

CREATE TABLE IF NOT EXISTS weekly_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  available_minutes integer NOT NULL DEFAULT 360 CHECK (available_minutes BETWEEN 0 AND 1440),
  is_unavailable boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, weekday)
);

ALTER TABLE weekly_availability ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON weekly_availability TO authenticated;

DROP POLICY IF EXISTS "select_own_availability" ON weekly_availability;
CREATE POLICY "select_own_availability" ON weekly_availability
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_availability" ON weekly_availability;
CREATE POLICY "insert_own_availability" ON weekly_availability
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_availability" ON weekly_availability;
CREATE POLICY "update_own_availability" ON weekly_availability
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_availability" ON weekly_availability;
CREATE POLICY "delete_own_availability" ON weekly_availability
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS remaining_minutes integer;
