/*
# Document uploads: scheduled sweep job

1. Plain-English summary
   Schedules a pg_cron job that calls the documents-worker edge function in
   sweep mode every 5 minutes. The sweep releases expired upload reservations
   (freeing quota slots abandoned mid-transfer), cancels documents whose file
   never arrived, and fails documents whose processing lease timed out. The
   request carries the shared secret from document_upload_config.

2. Changes
   - cron job tasktrack-document-sweep running every 5 minutes.
   - Unschedules first so re-running cannot duplicate the job.
*/

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  PERFORM cron.unschedule('tasktrack-document-sweep');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'tasktrack-document-sweep',
  '*/5 * * * *',
  $job$
  SELECT net.http_post(
    url := 'https://pjhaomrgjiusgfasmkcy.supabase.co/functions/v1/documents-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sweep-secret', (SELECT sweep_cron_secret FROM public.document_upload_config WHERE id = 1)
    ),
    body := '{"action":"sweep"}'::jsonb,
    timeout_milliseconds := 60000
  );
  $job$
);
