-- The school's ManageBac address (for example "school.managebac.com"). The study chat
-- fills it in from the saved calendar link the first time it needs it, and uses it to
-- point a student at ManageBac to hand in a finished task. Only the host is stored,
-- never the private feed link.
ALTER TABLE managebac_calendar_connections
  ADD COLUMN IF NOT EXISTS school_host text;
