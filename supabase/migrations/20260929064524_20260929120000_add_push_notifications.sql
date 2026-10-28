/*
# Push notifications for TaskTrack study reminders

## Purpose
Add opt-in browser push notifications for scheduled study sessions and reminders,
delivered even when TaskTrack is backgrounded or closed, with an opt-in in-app
reminder sound. Everything is off until the student explicitly enables it.

## 1. New tables

### push_subscriptions
One row per browser/device the student enabled notifications on.
- id (uuid, PK)
- user_id (uuid, defaults to the signed-in user, references auth.users, ON DELETE CASCADE)
- endpoint (text, unique) — the push service endpoint for this device
- p256dh (text) — the device's public key for encrypting the payload
- auth (text) — the device's auth secret
- user_agent (text) — what the device reports itself as, for the settings list
- created_at, updated_at
- last_success_at (timestamptz) — last successful delivery
- failure_count (integer) — consecutive failures, used to retire dead devices
- disabled_at (timestamptz) — set when a subscription is retired; such rows are never sent to

### push_config
A single locked row holding the server-only push credentials.
- id (integer, PK, fixed to 1)
- vapid_public (text) — the VAPID public key; safe to hand to the browser
- vapid_private (text) — the VAPID private key; NEVER leaves the server
- cron_secret (text) — shared secret the scheduled job presents to the sender function
- subject (text) — the VAPID contact subject
- updated_at

## 2. Modified tables

### user_settings
- `push_enabled` (boolean, NOT NULL, default false) — whether the student has turned
  TaskTrack notifications on for their account.
- `reminder_sound_enabled` (boolean, NOT NULL, default false) — whether an in-app ding
  plays for due reminders while TaskTrack is open. Off by default.

### reminders
- `push_sent_at` (timestamptz) — set once a push for this reminder has been delivered (or
  deliberately skipped). Null means it is still eligible.
- `push_claimed_at` (timestamptz) — set while a sweep is actively handling this reminder,
  so two overlapping sweeps cannot both send it.
- `push_attempts` (integer, NOT NULL, default 0) — how many delivery attempts have been
  made, so a permanently failing reminder is eventually retired instead of retried forever.

## 3. Security
- RLS is enabled on both new tables.
- `push_subscriptions` is owner-scoped: four separate policies (select/insert/update/delete)
  for the `authenticated` role, each requiring `auth.uid() = user_id`. The browser can only
  ever see and change its own device subscriptions.
- `push_config` has RLS enabled and NO policies at all, which denies every browser request.
  Only the service role (used by the sender function) can read it. This is what keeps the
  VAPID private key and the cron secret out of the client.
- `get_push_vapid_public_key()` is a SECURITY DEFINER function that returns ONLY the public
  key. It is executable by signed-in users and revoked from anonymous callers, so the
  browser can subscribe without ever seeing the private key.
- The sender function only ever sends reminders belonging to the subscription owner, and the
  claim function marks rows before sending so the same reminder is never sent twice.

## 4. Functions
- `claim_due_push_reminders(batch_size)` — SECURITY DEFINER. Atomically selects due,
  unsent reminders, marks them claimed, and returns each one together with its owner's
  active subscription (if any) and task details. Uses FOR UPDATE SKIP LOCKED so concurrent
  sweeps never double-send. Executable by the service role only.
- `get_push_vapid_public_key()` — see above.

## 5. Scheduling
- Enables pg_cron and pg_net and schedules `tasktrack-study-notifications` to run every
  minute. The job calls the `send-study-notifications` Edge Function with the shared cron
  secret, which performs the sweep.

## Notes
- No existing column is dropped, renamed, or retyped; all changes are additive.
- All statements are idempotent and safe to re-run.
*/

-- 1. Additive columns on existing tables
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS push_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS reminder_sound_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.reminders
  ADD COLUMN IF NOT EXISTS push_sent_at timestamptz;
ALTER TABLE public.reminders
  ADD COLUMN IF NOT EXISTS push_claimed_at timestamptz;
ALTER TABLE public.reminders
  ADD COLUMN IF NOT EXISTS push_attempts integer NOT NULL DEFAULT 0;

-- Speeds up the sweep: only unsent, upcoming-or-due reminders are candidates.
CREATE INDEX IF NOT EXISTS idx_reminders_push_due
  ON public.reminders (scheduled_for)
  WHERE push_sent_at IS NULL;

-- 2. push_subscriptions
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  last_success_at timestamptz,
  failure_count integer NOT NULL DEFAULT 0,
  disabled_at timestamptz,
  UNIQUE (endpoint)
);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_push_subscriptions" ON public.push_subscriptions;
CREATE POLICY "select_own_push_subscriptions" ON public.push_subscriptions FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_push_subscriptions" ON public.push_subscriptions;
CREATE POLICY "insert_own_push_subscriptions" ON public.push_subscriptions FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_push_subscriptions" ON public.push_subscriptions;
CREATE POLICY "update_own_push_subscriptions" ON public.push_subscriptions FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_push_subscriptions" ON public.push_subscriptions;
CREATE POLICY "delete_own_push_subscriptions" ON public.push_subscriptions FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user
  ON public.push_subscriptions (user_id)
  WHERE disabled_at IS NULL;

-- 3. push_config — server-only credentials, no client policies at all
CREATE TABLE IF NOT EXISTS public.push_config (
  id integer PRIMARY KEY DEFAULT 1,
  vapid_public text NOT NULL,
  vapid_private text NOT NULL,
  cron_secret text NOT NULL,
  subject text NOT NULL DEFAULT 'mailto:notifications@tasktrack.app',
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT push_config_singleton CHECK (id = 1)
);

ALTER TABLE public.push_config ENABLE ROW LEVEL SECURITY;
-- Deliberately no policies: RLS denies every anon/authenticated request. Only the
-- service role (used by the sender Edge Function) can read these values.

INSERT INTO public.push_config (id, vapid_public, vapid_private, cron_secret, subject)
VALUES (
  1,
  'BG-E84TSDloK7E2I-6rMGlMGTElPvsij8YvUQGRcLpNJNrZrjsLmJu507fwVR7mpup3H0omrPvaWIxkmiuxl-yk',
  'WohzAZx9sGEUN9iJXzjnTFy3JI4uukxifLk-VKlQMoE',
  'ab88f9dddff7916de84b55b1ffee5fa0c9a08fd510d2b4d2d05b621fb21ddc64',
  'mailto:notifications@tasktrack.app'
)
ON CONFLICT (id) DO NOTHING;

-- 4. Public key accessor — exposes ONLY the public key, to signed-in users only
CREATE OR REPLACE FUNCTION public.get_push_vapid_public_key()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT vapid_public FROM push_config WHERE id = 1;
$$;

REVOKE EXECUTE ON FUNCTION public.get_push_vapid_public_key() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_push_vapid_public_key() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_push_vapid_public_key() TO authenticated;

-- 5. Atomic claim of due reminders
CREATE OR REPLACE FUNCTION public.claim_due_push_reminders(batch_size integer DEFAULT 25)
RETURNS TABLE(
  reminder_id uuid,
  user_id uuid,
  title text,
  message text,
  scheduled_for timestamptz,
  task_id uuid,
  session_id uuid,
  task_title text,
  duration_minutes integer,
  reminder_type text,
  push_enabled boolean,
  endpoint text,
  p256dh text,
  sub_auth text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT r.id
    FROM reminders r
    WHERE r.is_enabled = true
      AND r.push_sent_at IS NULL
      AND r.push_claimed_at IS NULL
      AND r.push_attempts < 5
      AND r.scheduled_for <= now()
      AND r.scheduled_for > now() - interval '6 hours'
    ORDER BY r.scheduled_for
    LIMIT batch_size
    FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE reminders r
    SET push_claimed_at = now(),
        push_attempts = r.push_attempts + 1
    WHERE r.id IN (SELECT id FROM due)
    RETURNING r.id, r.user_id, r.title, r.message, r.scheduled_for,
              r.task_id, r.session_id, r.duration_minutes, r.reminder_type
  )
  SELECT
    c.id, c.user_id, c.title, c.message, c.scheduled_for,
    c.task_id, c.session_id, t.title, c.duration_minutes, c.reminder_type,
    COALESCE(us.push_enabled, false),
    ps.endpoint, ps.p256dh, ps.auth
  FROM claimed c
  LEFT JOIN tasks t ON t.id = c.task_id
  LEFT JOIN user_settings us ON us.user_id = c.user_id
  LEFT JOIN push_subscriptions ps
    ON ps.user_id = c.user_id AND ps.disabled_at IS NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_due_push_reminders(integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_due_push_reminders(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_due_push_reminders(integer) TO service_role;

-- 6. Scheduler: sweep every minute via pg_net, authenticating with the cron secret
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  PERFORM cron.unschedule('tasktrack-study-notifications');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'tasktrack-study-notifications',
  '* * * * *',
  $job$
  SELECT net.http_post(
    url := 'https://pjhaomrgjiusgfasmkcy.supabase.co/functions/v1/send-study-notifications',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT cron_secret FROM public.push_config WHERE id = 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
  $job$
);
