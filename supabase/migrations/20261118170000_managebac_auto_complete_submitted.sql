-- ManageBac's calendar feed has no "submitted" field: a task simply drops out of the
-- feed once the student hands it in. The sync now notices that and marks the linked
-- TaskTrack task done, and reopens it if the entry ever comes back.

ALTER TABLE managebac_calendar_events
  ADD COLUMN IF NOT EXISTS left_feed_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_completed_at timestamptz;

ALTER TABLE sync_change_inbox DROP CONSTRAINT IF EXISTS sync_change_inbox_change_kind_check;
ALTER TABLE sync_change_inbox
  ADD CONSTRAINT sync_change_inbox_change_kind_check
  CHECK (change_kind = ANY (ARRAY['new'::text, 'edited'::text, 'submitted'::text]));
