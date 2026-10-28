-- Scheduled study sessions reuse the existing reminders table. These additive,
-- nullable columns let each scheduled session carry its own duration, a link to the
-- Study Session conversation it came from, an explicit status, and a stable key that
-- stops the same generated plan from being saved twice. No existing data is touched.

alter table public.reminders
  add column if not exists duration_minutes integer;

alter table public.reminders
  add column if not exists session_id uuid references public.study_sessions(id) on delete set null;

alter table public.reminders
  add column if not exists status text;

alter table public.reminders
  add column if not exists dedupe_key text;

-- One row per (student, dedupe key). NULL keys are ignored by the index, so ordinary
-- reminders are unaffected and can keep a NULL key.
create unique index if not exists reminders_user_dedupe_key_key
  on public.reminders (user_id, dedupe_key)
  where dedupe_key is not null;
