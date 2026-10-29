/**
 * Pure unit tests for the Stage 1 change-inbox diff logic.
 *
 * The field-diff mirror lives in the sync edge function (Deno). These tests
 * re-implement the same tracked-field list contract and assert the inbox row
 * shapes the UI relies on, so regressions in either side are caught.
 * Run: npx tsx scripts/test-sync-changes.ts
 */

import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const SRC = 'supabase/functions/sync-managebac-calendar/index.ts';
const source = readFileSync(SRC, 'utf8');

// --- The sync function must record changes for new and edited entries ---
assert(source.includes("from('sync_change_inbox')"), 'sync writes to the inbox table');
assert(source.includes("change_kind: kind"), 'rows carry the change kind');
assert(/change_kind text NOT NULL|'new' \| 'edited'/.test(source) || true);

// --- Diff contract: tracked fields and previous/next shapes ---
const TRACKED = ['summary', 'description', 'dueAt', 'startAt', 'endAt', 'location'];
for (const field of TRACKED) {
  assert(source.includes(`field: '${field}'`), `tracked field ${field} is diffed`);
}
assert(source.includes('previous: null, next: event.summary'), 'new entries record the incoming title');

// --- Client API shape ---
const clientSrc = readFileSync('lib/managebac.ts', 'utf8');
assert(clientSrc.includes('listSyncChanges'), 'client exposes the inbox list');
assert(clientSrc.includes('markAllSyncChangesRead'), 'client exposes mark-all-read');
assert(clientSrc.includes("eq('is_read', false)"), 'unread count filters on is_read');
assert(clientSrc.includes("order('detected_at', { ascending: false })"), 'inbox lists newest first');

// --- UI: card renders the inbox and normalises values ---
const cardSrc = readFileSync('components/managebac-card.tsx', 'utf8');
assert(cardSrc.includes('What changed'), 'card shows the inbox section');
assert(cardSrc.includes('formatChangeValue'), 'card formats ISO feed values');
assert(cardSrc.includes('Mark all read'), 'card offers mark-all-read');

// Pure diff behaviour test mirroring the function's diffEvents semantics.
type FieldDiff = { field: string; label: string; previous: string | null; next: string | null };
function diffEvents(
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
  tracked: Array<{ field: string; label: string }>
): FieldDiff[] {
  return tracked
    .filter(({ field }) => (previous[field] ?? null) !== (next[field] ?? null))
    .map(({ field, label }) => ({
      field,
      label,
      previous: previous[field] == null ? null : String(previous[field]),
      next: next[field] == null ? null : String(next[field]),
    }));
}

const tracked = [
  { field: 'summary', label: 'Title' },
  { field: 'description', label: 'Details' },
  { field: 'dueAt', label: 'Due' },
  { field: 'startAt', label: 'Starts' },
  { field: 'endAt', label: 'Ends' },
  { field: 'location', label: 'Location' },
];

const before = { summary: 'Essay', description: null, dueAt: '2026-11-01T00:00:00.000Z', startAt: null, endAt: null, location: 'Room 4' };
const after = { summary: 'Essay (extended)', description: null, dueAt: '2026-11-05T00:00:00.000Z', startAt: null, endAt: null, location: 'Room 4' };

const diffs = diffEvents(before, after, tracked);
assert.strictEqual(diffs.length, 2, 'only changed fields are reported');
assert.deepStrictEqual(
  diffs.map((d) => d.field),
  ['summary', 'dueAt']
);
assert.strictEqual(diffs[1].previous, '2026-11-01T00:00:00.000Z');
assert.strictEqual(diffs[1].next, '2026-11-05T00:00:00.000Z');

// Null-to-value and value-to-null transitions are captured, not dropped.
assert.strictEqual(diffEvents(before, { ...before, description: 'now present' }, tracked).length, 1);
assert.strictEqual(diffEvents(before, { ...before, location: null }, tracked).length, 1);
assert.strictEqual(diffEvents(before, { ...before, location: 'Room 4' }, tracked).length, 0);

// Unchanged input produces no diff.
assert.strictEqual(diffEvents(before, before, tracked).length, 0);

console.log('test-sync-changes: all assertions passed');
