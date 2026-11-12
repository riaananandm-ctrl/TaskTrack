/*
  # Track which tasks the student has looked at

  Powers the "New tasks" page: tasks that arrived (for example from ManageBac) and
  the student has not opened yet.

  - `tasks.seen_at`: when the student first opened the task. NULL means not seen yet.
  - Tasks the student creates themselves are seen the moment they are made. Imported
    tasks (external_source set) start unseen. A BEFORE INSERT trigger handles this,
    so every insert path (app, starter page, ManageBac sync) behaves the same.
  - Existing tasks from before today are marked seen (at their creation time), so the
    page does not open with the whole backlog. Tasks created today stay unseen.

  The ManageBac sync detects student edits with `external_hash`, not `updated_at`,
  so setting `seen_at` never stops a task from receiving ManageBac updates.
*/

ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS seen_at timestamptz;

UPDATE public.tasks
   SET seen_at = created_at
 WHERE seen_at IS NULL
   AND created_at < date_trunc('day', now());

-- Tasks the student made themselves were seen by them already.
UPDATE public.tasks
   SET seen_at = created_at
 WHERE seen_at IS NULL
   AND external_source IS NULL;

CREATE OR REPLACE FUNCTION public.tasktrack_tasks_set_seen_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NEW.external_source IS NULL THEN
    NEW.seen_at := COALESCE(NEW.seen_at, now());
  ELSE
    NEW.seen_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tasktrack_tasks_set_seen_at() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tasktrack_tasks_set_seen_at ON public.tasks;
CREATE TRIGGER tasktrack_tasks_set_seen_at
  BEFORE INSERT ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasktrack_tasks_set_seen_at();

CREATE INDEX IF NOT EXISTS tasks_user_unseen_idx
  ON public.tasks (user_id)
  WHERE seen_at IS NULL;
