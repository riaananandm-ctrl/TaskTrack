/*
  IA/EE milestone tasks are created by the student in IB Hub, so they shouldn't
  appear in "New Tasks" like imported school tasks do.
*/
CREATE OR REPLACE FUNCTION public.tasktrack_tasks_set_seen_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_catalog AS $$
BEGIN
  IF NEW.external_source IS NULL OR NEW.external_source = 'ib_project' THEN
    NEW.seen_at := COALESCE(NEW.seen_at, now());
  ELSE
    NEW.seen_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;
