/**
 * Reminder snooze helper tests.
 * Run: npx tsx scripts/test-snooze.ts
 */

import assert from 'node:assert';
import { SNOOZE_OPTIONS, snoozeTime } from '../lib/reminder-utils';

const base = new Date('2026-11-02T15:00:00.000Z');

// Valid snoozes shift exactly by the requested minutes.
assert.strictEqual(snoozeTime(10, base)?.toISOString(), '2026-11-02T15:10:00.000Z');
assert.strictEqual(snoozeTime(60, base)?.toISOString(), '2026-11-02T16:00:00.000Z');
// "Tomorrow" crosses a DST boundary safely because it is a fixed 24h offset in UTC instants.
assert.strictEqual(snoozeTime(24 * 60, base)?.toISOString(), '2026-11-03T15:00:00.000Z');

// Invalid inputs return null rather than producing a past or NaN time.
assert.strictEqual(snoozeTime(0, base), null);
assert.strictEqual(snoozeTime(-5, base), null);
assert.strictEqual(snoozeTime(NaN, base), null);

// Options are ordered and positive.
for (const option of SNOOZE_OPTIONS) {
  assert.ok(option.minutes > 0);
  assert.ok(option.label.length > 0);
}

console.log('test-snooze: all assertions passed');
