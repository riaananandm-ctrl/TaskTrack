/*
  Google Classroom import.

  A student connects their Google account with read-only Classroom access. The
  `google-classroom` Edge Function handles the whole OAuth flow, keeps the Google refresh
  token encrypted (same AES-GCM key as ManageBac, in integration_secrets), and imports
  assignments that have a due date as TaskTrack tasks (external_source 'google_classroom').

  Tables
  - google_classroom_connections: one per student. Owner can read status only; all writes
    go through the Edge Function (service role). The token is stored only as ciphertext.
  - google_classroom_oauth_states: short-lived OAuth "state" values that tie Google's
    redirect back to the student who started it. Service role only.
  - google_classroom_items: one row per imported Classroom assignment, remembering what was
    last imported so a later sync only changes fields the student has not edited, and
    never re-creates a task the student deleted.

  A cron job syncs every connected student every 30 minutes.
  Additive and idempotent.
*/

CREATE TABLE IF NOT EXISTS public.google_classroom_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  google_email text,
  enc_refresh_token text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'reconnect')),
  last_sync_at timestamptz,
  last_sync_status text,
  last_sync_error text,
  last_sync_imported integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.google_classroom_connections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "select_own_classroom_connection" ON public.google_classroom_connections;
CREATE POLICY "select_own_classroom_connection" ON public.google_classroom_connections
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
REVOKE ALL ON public.google_classroom_connections FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.google_classroom_connections FROM authenticated;
-- The browser never needs the ciphertext: only status columns are readable.
REVOKE SELECT ON public.google_classroom_connections FROM authenticated;
GRANT SELECT (id, user_id, google_email, status, last_sync_at, last_sync_status, last_sync_error,
  last_sync_imported, created_at, updated_at) ON public.google_classroom_connections TO authenticated;

CREATE TABLE IF NOT EXISTS public.google_classroom_oauth_states (
  state text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.google_classroom_oauth_states ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.google_classroom_oauth_states FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.google_classroom_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id text NOT NULL,
  course_work_id text NOT NULL,
  course_name text,
  task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  imported_title text,
  imported_due_date date,
  imported_due_time text,
  content_hash text,
  turned_in boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, course_id, course_work_id)
);
ALTER TABLE public.google_classroom_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "select_own_classroom_items" ON public.google_classroom_items;
CREATE POLICY "select_own_classroom_items" ON public.google_classroom_items
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
REVOKE ALL ON public.google_classroom_items FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.google_classroom_items FROM authenticated;
CREATE INDEX IF NOT EXISTS idx_classroom_items_user ON public.google_classroom_items (user_id);

-- Sync every connected student every 30 minutes.
DO $$
BEGIN
  PERFORM cron.unschedule('tasktrack-classroom-sync');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'tasktrack-classroom-sync',
  '*/30 * * * *',
  $job$
  SELECT net.http_post(
    url := 'https://pjhaomrgjiusgfasmkcy.supabase.co/functions/v1/google-classroom',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', (SELECT sync_cron_secret FROM public.integration_secrets WHERE id = 1)
    ),
    body := '{"action":"scheduled"}'::jsonb,
    timeout_milliseconds := 120000
  );
  $job$
);
