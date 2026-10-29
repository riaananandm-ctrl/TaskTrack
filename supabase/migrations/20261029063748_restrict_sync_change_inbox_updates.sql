/*
# Limit change-inbox edits to the read flag

1. Problem
  - `sync_change_inbox` granted UPDATE on every column, although the only intended
    client write is marking an entry as read. A user could rewrite `change_type`,
    `old_value` or `new_value` and so falsify the record of what their school
    calendar actually changed.

2. Security changes
  - Revoke table-level UPDATE from `anon` and `authenticated`.
  - Grant `UPDATE (is_read)` to `authenticated` only.
  - Remove the unused INSERT and DELETE grants: inbox rows are written by the
    calendar sync function with the service role, which is unaffected.

3. Notes
  1. The app's only update is `.update({ is_read: true })`, which continues to work.
  2. The existing owner-scoped policies are unchanged.
*/

REVOKE UPDATE, INSERT, DELETE ON public.sync_change_inbox FROM authenticated;
REVOKE UPDATE, INSERT, DELETE ON public.sync_change_inbox FROM anon;

GRANT UPDATE (is_read) ON public.sync_change_inbox TO authenticated;
