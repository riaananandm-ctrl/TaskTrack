/*
# Server-side subject-name validation

## Purpose
The subjects table had no CHECK on `name`. A student could save any string. This adds
a constraint that mirrors the frontend rules in lib/subject-validation.ts:
  - 1–60 characters (after trimming)
  - 1–5 words
  - only letters, numbers, spaces, hyphens, apostrophes, ampersands, periods, parentheses
  - no angle brackets (HTML/script) or control characters

The constraint is a regex CHECK so it is enforced on every INSERT and UPDATE, regardless
of how the row is written. Existing rows that already satisfy the rule are unaffected.

## Notes
- Additive: no column is dropped or retyped.
- Idempotent: safe to re-run.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'subjects_name_format_check'
  ) THEN
    ALTER TABLE public.subjects
      ADD CONSTRAINT subjects_name_format_check
      CHECK (
        length(btrim(name)) BETWEEN 1 AND 60
        AND array_length(string_to_array(btrim(regexp_replace(name, '\s+', ' ', 'g')), ' '), 1) BETWEEN 1 AND 5
        AND name ~ '^[\w\s\-''.&()]+$'
        AND name !~ '<[[:alnum:]\/!?]+>'
      );
  END IF;
END $$;
