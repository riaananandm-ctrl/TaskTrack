-- One-time backfill of keyword priorities for existing tasks.
-- Same rules as lib/auto-priority.ts (highest match wins):
--   title mentions "Summative" -> urgent
--   title mentions "Formative" -> high
--   title mentions "Task 3"    -> medium (already the default, so no change needed)
-- Only tasks still on the default 'medium' are touched, so any priority a student
-- chose themselves is left alone.

update public.tasks
set priority = case
      when title ~* '\msummative\M' then 'urgent'
      else 'high'
    end,
    updated_at = now()
where is_archived = false
  and priority = 'medium'
  and (title ~* '\msummative\M' or title ~* '\mformative\M');
