/*
# Tighten ManageBac browser privileges

## Purpose
Give the browser roles the least they need on the ManageBac tables.

## 1. managebac_calendar_connections
- Revoke INSERT/UPDATE/DELETE from `authenticated`, leaving only SELECT (owner-scoped by
  RLS). Connect, disconnect and delete all run in the Edge Function with the service role,
  which is also what holds the encryption key — so the browser never writes this row.

## 2. managebac_calendar_events
- Revoke INSERT and DELETE from `authenticated`. The app only reads entries and sets a
  disposition; rows are created and refreshed exclusively by the sync function. This
  prevents a client from deleting a row to try to force a re-import, and removes any
  path to writing provider fields directly.
- Keep SELECT (owner-scoped) and keep UPDATE limited to the `disposition` column.

## Notes
- Additive to the previous ManageBac migration; nothing is dropped or retyped.
- Safe to re-run.
*/

REVOKE INSERT, UPDATE, DELETE ON public.managebac_calendar_connections FROM authenticated;

REVOKE INSERT, DELETE ON public.managebac_calendar_events FROM authenticated;
REVOKE UPDATE ON public.managebac_calendar_events FROM authenticated;
GRANT UPDATE (disposition) ON public.managebac_calendar_events TO authenticated;
