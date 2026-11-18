-- ManageBac calendars now sync every 5 minutes (was every 10).
SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'tasktrack-managebac-sync'),
  schedule := '*/5 * * * *'
);
