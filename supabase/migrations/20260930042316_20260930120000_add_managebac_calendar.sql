/*
# ManageBac calendar subscription integration

## Purpose
Let a student connect their own ManageBac iCalendar subscription feed so school
deadlines and calendar events import into TaskTrack. The feed URL is private (it can
grant access to the student's calendar), so it is stored encrypted server-side and is
never returned to any browser. The browser only ever tells the server "sync", and the
server does the fetching.

## 1. New tables

### integration_secrets
A single locked row holding the server-only encryption key and the periodic-sync secret.
- id (integer, PK, fixed to 1)
- enc_key (text) — base64 32-byte AES-GCM key used to encrypt feed URLs
- sync_cron_secret (text) — shared secret the periodic sync job presents
- updated_at

### managebac_calendar_connections
One row per student who has connected a ManageBac calendar.
- id (uuid, PK)
- user_id (uuid, PK-partner, defaults to the signed-in user, references auth.users, ON DELETE CASCADE)
- enc_feed_url (text) — the feed URL, AES-GCM encrypted with a per-connection random IV.
  The ciphertext and IV are combined; plaintext never touches the database.
- last_sync_at (timestamptz) — when the last sync attempt finished
- last_sync_status (text) — 'success' | 'error' | 'partial' | null
- last_sync_error (text) — a short, safe, user-facing reason (never the raw response)
- last_sync_imported (integer) — how many entries the last sync created or updated
- created_at, updated_at
- Unique on user_id: one ManageBac connection per student.

### managebac_calendar_events
One row per imported calendar entry, kept so a second sync updates instead of duplicating.
- id (uuid, PK)
- user_id (uuid, defaults to signed-in user, references auth.users, ON DELETE CASCADE)
- connection_id (uuid, references managebac_calendar_connections, ON DELETE CASCADE)
- external_uid (text) — the feed's UID for the entry
- summary, description, location (text) — from the feed
- start_at, end_at, due_at (timestamptz) — dates from the feed
- last_modified_at (timestamptz) — the feed's LAST-MODIFIED, when present
- task_id (uuid, references tasks, ON DELETE SET NULL) — the task created for it, when imported
- disposition (text) — 'task' | 'event' | 'ignored'
- content_hash (text) — hash of the imported fields, so a sync can tell whether the feed
  actually changed and therefore avoid overwriting anything the student edited locally
- created_at, updated_at
- Unique on (user_id, external_uid): one row per entry per student.

## 2. Modified table: tasks (provenance, so imports are distinguishable)
- `external_source` (text) — e.g. 'managebac_calendar'; null for hand-made tasks.
- `external_uid` (text) — the feed's UID for this task.
- `external_hash` (text) — hash of the imported fields as last written by a sync. When a
  later feed change arrives, the sync only overwrites fields the student has not edited.
A partial unique index on (user_id, external_source, external_uid) prevents a second
import of the same entry.

## 3. Security
- RLS is enabled on all three new tables.
- `integration_secrets`: RLS on, NO policies, and ALL privileges revoked from anon and
  authenticated at the table level. Only the service role can read the encryption key.
- `managebac_calendar_connections`: students get a SELECT policy for their own row only,
  so the settings page can show connection status and sync history. There are deliberately
  NO INSERT/UPDATE/DELETE policies: connecting, disconnecting and deleting all run through
  the Edge Function with the service role, which is also what encrypts the URL. That keeps
  the ciphertext and the key entirely out of the browser.
- `managebac_calendar_events`: four owner-scoped policies (select/insert/update/delete) so
  the Calendar screen can read imported events and a student can set an entry's disposition.
  Rows are always scoped to auth.uid() = user_id.
- The `tasks` table keeps its existing owner-scoped policies; the two new provenance columns
  are granted to authenticated for UPDATE so editing a task does not fail, but the sync
  itself writes with the service role.

## 4. Scheduling
- Schedules `tasktrack-managebac-sync` to run every two hours. It calls the
  `sync-managebac-calendar` Edge Function with the shared secret, which syncs every
  connected student's calendar. Unscheduled first, so re-running is safe.

## Notes
- Additive only: no column is dropped, renamed, or retyped, and no existing row is altered.
- Idempotent: safe to re-run.
*/

-- 1. Server-only secrets
CREATE TABLE IF NOT EXISTS public.integration_secrets (
  id integer PRIMARY KEY DEFAULT 1,
  enc_key text NOT NULL,
  sync_cron_secret text NOT NULL,
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT integration_secrets_singleton CHECK (id = 1)
);

ALTER TABLE public.integration_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.integration_secrets FROM anon;
REVOKE ALL ON public.integration_secrets FROM authenticated;

-- Secrets are generated inside the database, never written into source control.
-- (The live project already has its row; ON CONFLICT keeps those values untouched.)
INSERT INTO public.integration_secrets (id, enc_key, sync_cron_secret)
VALUES (
  1,
  encode(gen_random_bytes(32), 'base64'),
  encode(gen_random_bytes(32), 'hex')
)
ON CONFLICT (id) DO NOTHING;

-- 2. Tasks: provenance columns
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS external_source text;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS external_uid text;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS external_hash text;

CREATE UNIQUE INDEX IF NOT EXISTS tasks_external_uid_key
  ON public.tasks (user_id, external_source, external_uid)
  WHERE external_uid IS NOT NULL;

-- 3. Connections
CREATE TABLE IF NOT EXISTS public.managebac_calendar_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  enc_feed_url text NOT NULL,
  last_sync_at timestamptz,
  last_sync_status text,
  last_sync_error text,
  last_sync_imported integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (user_id)
);

ALTER TABLE public.managebac_calendar_connections ENABLE ROW LEVEL SECURITY;

-- Read-only to the owner so the card can show status. All writes go through the
-- Edge Function with the service role, which owns the encryption.
DROP POLICY IF EXISTS "select_own_managebac_connection" ON public.managebac_calendar_connections;
CREATE POLICY "select_own_managebac_connection" ON public.managebac_calendar_connections FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

REVOKE ALL ON public.managebac_calendar_connections FROM anon;

-- 4. Imported events
CREATE TABLE IF NOT EXISTS public.managebac_calendar_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  connection_id uuid REFERENCES public.managebac_calendar_connections(id) ON DELETE CASCADE,
  external_uid text NOT NULL,
  summary text,
  description text,
  location text,
  start_at timestamptz,
  end_at timestamptz,
  due_at timestamptz,
  last_modified_at timestamptz,
  task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  disposition text NOT NULL DEFAULT 'task',
  content_hash text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (user_id, external_uid)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'managebac_events_disposition_check') THEN
    ALTER TABLE public.managebac_calendar_events
      ADD CONSTRAINT managebac_events_disposition_check
      CHECK (disposition IN ('task', 'event', 'ignored'));
  END IF;
END $$;

ALTER TABLE public.managebac_calendar_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_managebac_events" ON public.managebac_calendar_events;
CREATE POLICY "select_own_managebac_events" ON public.managebac_calendar_events FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_managebac_events" ON public.managebac_calendar_events;
CREATE POLICY "insert_own_managebac_events" ON public.managebac_calendar_events FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_managebac_events" ON public.managebac_calendar_events;
CREATE POLICY "update_own_managebac_events" ON public.managebac_calendar_events FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_managebac_events" ON public.managebac_calendar_events;
CREATE POLICY "delete_own_managebac_events" ON public.managebac_calendar_events FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

REVOKE ALL ON public.managebac_calendar_events FROM anon;

CREATE INDEX IF NOT EXISTS idx_managebac_events_user ON public.managebac_calendar_events (user_id);
CREATE INDEX IF NOT EXISTS idx_managebac_events_due ON public.managebac_calendar_events (user_id, due_at);

-- A student may set only the disposition of their own imported events directly; every
-- other column is written by the sync function under the service role.
REVOKE UPDATE ON public.managebac_calendar_events FROM authenticated;
GRANT UPDATE (disposition) ON public.managebac_calendar_events TO authenticated;

-- 5. Periodic sync (every two hours). Unscheduled first so re-running cannot duplicate.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  PERFORM cron.unschedule('tasktrack-managebac-sync');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'tasktrack-managebac-sync',
  '0 */2 * * *',
  $job$
  SELECT net.http_post(
    url := 'https://pjhaomrgjiusgfasmkcy.supabase.co/functions/v1/sync-managebac-calendar',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', (SELECT sync_cron_secret FROM public.integration_secrets WHERE id = 1)
    ),
    body := '{"action":"scheduled"}'::jsonb,
    timeout_milliseconds := 60000
  );
  $job$
);
