-- Run the ManageBac calendar sync every 10 minutes instead of every 2 hours, so a
-- new assignment posted on ManageBac shows up in TaskTrack within about 10 minutes.
-- Only the schedule changes; the job's command (URL, secret header, body) is untouched.
-- ManageBac calendar subscriptions are pull-only (no push/webhook), so polling is the
-- fastest option available.

SELECT cron.alter_job(
  job_id := (SELECT jobid FROM cron.job WHERE jobname = 'tasktrack-managebac-sync'),
  schedule := '*/10 * * * *'
);
