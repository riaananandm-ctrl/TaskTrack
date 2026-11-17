/*
  AI Detector: 15 checks a day for Premium students (was 5, which ran out quickly).
  Also pins search_path on three small functions flagged by the security advisor.
*/
CREATE OR REPLACE FUNCTION public.tasktrack_tool_daily_limit(p_tool text)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = public, pg_catalog AS $$
  SELECT CASE p_tool WHEN 'detector' THEN 15 ELSE 0 END;
$$;

ALTER FUNCTION public.tasktrack_terms_version() SET search_path = public, pg_catalog;
ALTER FUNCTION public.task_drafts_touch() SET search_path = public, pg_catalog;
