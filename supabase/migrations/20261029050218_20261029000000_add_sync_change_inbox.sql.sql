/*
# Sync change inbox for ManageBac calendar imports

1. Plain-English explanation
- Today the sync overwrites imported tasks silently; the student only sees counts
  ("3 new, 2 updated") after the fact. This migration adds a per-student "change
  inbox": every time a sync detects that a calendar entry is new or has changed,
  one row is written describing what changed, with the previous value and the new
  value for each field the feed actually exposes.

2. New Tables
- `sync_change_inbox`
  - `id` (uuid, primary key)
  - `user_id` (uuid, not null, references auth.users, cascade delete)
  - `connection_id` (uuid, nullable, references managebac_calendar_connections,
    cascade delete — nullable so records survive a disconnect for review)
  - `external_uid` (text, not null) — the feed's stable entry UID
  - `task_id` (uuid, nullable) — the linked imported task, when one exists
  - `change_kind` (text, not null, check in 'new' | 'edited')
    - 'new': first time this UID appeared in the feed
    - 'edited': a previously seen UID whose content hash changed
    - Cancellations are NOT recorded: an iCalendar feed does not distinguish
      "cancelled" from "temporarily missing", and the app never deletes on absence.
  - `changes` (jsonb, not null) — array of field-level entries:
    { field, label, previous, next } for title, description, due, starts, ends,
    location. 'new' rows carry a single entry with previous = null.
  - `detected_at` (timestamptz, not null, default now())
  - `is_read` (boolean, not null, default false)
  - Unique index on (user_id, external_uid, change_kind, detected_at) so a retried
    sync run cannot write the same detection twice.

3. Modified Tables
- none.

4. Security
- RLS enabled; owner-scoped CRUD for authenticated users only (auth.uid() = user_id).
- Grants: SELECT, UPDATE (is_read only), DELETE to authenticated; INSERT/UPDATE of
  content is reserved for the sync edge function via service_role.

5. Important notes
- Non-destructive: additive only, no existing table or column is altered.
- Idempotent: safe to re-apply (IF NOT EXISTS / DROP POLICY IF EXISTS).
*/

CREATE TABLE IF NOT EXISTS sync_change_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  connection_id uuid REFERENCES managebac_calendar_connections(id) ON DELETE SET NULL,
  external_uid text NOT NULL,
  task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  change_kind text NOT NULL CHECK (change_kind IN ('new', 'edited')),
  changes jsonb NOT NULL DEFAULT '[]'::jsonb,
  detected_at timestamptz NOT NULL DEFAULT now(),
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sync_change_inbox_user_recent
  ON sync_change_inbox (user_id, detected_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sync_change_inbox_detection
  ON sync_change_inbox (user_id, external_uid, change_kind, detected_at);

ALTER TABLE sync_change_inbox ENABLE ROW LEVEL SECURITY;

GRANT SELECT, DELETE ON sync_change_inbox TO authenticated;
GRANT UPDATE (is_read) ON sync_change_inbox TO authenticated;
GRANT INSERT, UPDATE, DELETE ON sync_change_inbox TO service_role;

DROP POLICY IF EXISTS "select_own_sync_changes" ON sync_change_inbox;
CREATE POLICY "select_own_sync_changes" ON sync_change_inbox
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_sync_change_read" ON sync_change_inbox;
CREATE POLICY "update_own_sync_change_read" ON sync_change_inbox
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_sync_changes" ON sync_change_inbox;
CREATE POLICY "delete_own_sync_changes" ON sync_change_inbox
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
