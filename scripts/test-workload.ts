/**
 * Stage 2 workload engine tests: availability math, deadline attribution,
 * double-counting guards, and warning assumptions.
 * Run: npx tsx scripts/test-workload.ts
 */

import assert from 'node:assert';

// The workload engine imports via the project's path alias; resolve it manually.
import { buildWorkloadDays, buildWorkloadWarnings, remainingMinutesFor, plannedMinutesForDay } from '../lib/workload';
import type { Task, WeeklyPlan } from '../lib/types';

function task(partial: Partial<Task> & { id: string }): Task {
  return {
    user_id: 'u', title: 'T', description: null, category: 'homework', due_date: null,
    due_time: null, priority: 'medium', status: 'not_started', estimated_minutes: null,
    remaining_minutes: null, notes: null, external_link: null, is_archived: false,
    completed_at: null, external_source: null, external_uid: null,
    created_at: '', updated_at: '', subject: null,
    ...partial,
  } as Task;
}

function plan(partial: Partial<WeeklyPlan> & { id: string; task_id: string; planned_date: string }): WeeklyPlan {
  return {
    user_id: 'u', start_time: null, end_time: null,
    created_at: '', updated_at: '', task: null,
    ...partial,
  } as WeeklyPlan;
}

// --- remaining effort precedence ---
assert.strictEqual(remainingMinutesFor({ status: 'completed', estimated_minutes: 60, remaining_minutes: 60 }), 0);
assert.strictEqual(remainingMinutesFor({ status: 'not_started', estimated_minutes: 60, remaining_minutes: 20 }), 20);
assert.strictEqual(remainingMinutesFor({ status: 'not_started', estimated_minutes: 60, remaining_minutes: null }), 60);
assert.strictEqual(remainingMinutesFor({ status: 'not_started', estimated_minutes: null, remaining_minutes: null }), 30);

// --- planned minutes use explicit times when present ---
const day = '2026-11-02'; // a Monday
const plans: WeeklyPlan[] = [
  plan({ id: 'p1', task_id: 't1', planned_date: day, start_time: '15:00', end_time: '16:30' }),
  plan({ id: 'p2', task_id: 't2', planned_date: day }),
];
assert.strictEqual(plannedMinutesForDay(plans, day), 90 + 30);
assert.strictEqual(plannedMinutesForDay(plans, '2026-11-03'), 0);

// --- workload days: availability, planned vs required, no double-counting ---
const from = new Date(2026, 10, 2); // Mon 2026-11-02
const to = new Date(2026, 10, 8);   // Sun 2026-11-08
const tasks: Task[] = [
  // deadline Tuesday, unplanned: 60m required on Tuesday
  task({ id: 't1', due_date: '2026-11-03', due_time: null, estimated_minutes: 60 }),
  // planned on Monday with explicit block
  task({ id: 't2', due_date: '2026-11-04', estimated_minutes: 45 }),
  // completed: ignored
  task({ id: 't3', due_date: '2026-11-03', estimated_minutes: 999, status: 'completed' }),
  // overdue relative to `now`: ignored
  task({ id: 't4', due_date: '2026-11-01', estimated_minutes: 55 }),
  // no deadline: ignored
  task({ id: 't5', estimated_minutes: 55 }),
];
const weekPlans: WeeklyPlan[] = [
  plan({ id: 'p1', task_id: 't2', planned_date: '2026-11-02', start_time: '15:00', end_time: '16:00' }),
];

// Monday 1h available; Wednesday unavailable; else default 360.
const availability = [
  { weekday: 1, availableMinutes: 60, isUnavailable: false },   // Mon
  { weekday: 3, availableMinutes: 0, isUnavailable: true },     // Wed
];
const days = buildWorkloadDays(from, to, tasks, weekPlans, availability, new Date(2026, 10, 2, 8));
assert.strictEqual(days.length, 7);

const monday = days[0];
assert.strictEqual(monday.availableMinutes, 60);
assert.strictEqual(monday.plannedMinutes, 60);
assert.strictEqual(monday.requiredMinutes, 0);
assert.strictEqual(monday.slackMinutes, 0);

const tuesday = days[1];
assert.strictEqual(tuesday.requiredMinutes, 60, 'unplanned deadline work lands on the deadline day');
assert.strictEqual(tuesday.plannedMinutes, 0);
// t2 is planned, so its estimate is NOT also required on its Wednesday deadline:
assert.strictEqual(days[2].requiredMinutes, 0, 'planned work is not re-attributed to its deadline (no double-count)');

const wednesday = days[2];
assert.strictEqual(wednesday.availableMinutes, 0, 'unavailable day has zero available minutes');

// --- warnings carry assumptions ---
const warnings = buildWorkloadWarnings(days);
// Tuesday: 60m required vs 360m default available -> fits, no warning.
const tueWarning = warnings.find((w) => w.date === '2026-11-03');
assert.ok(!tueWarning);
// Wednesday unavailable but nothing due -> no warning.
assert.ok(!warnings.find((w) => w.date === '2026-11-04'));

// Overcommitted day: more planned than available.
const tight = buildWorkloadDays(from, to, [], [
  plan({ id: 'px', task_id: 't2', planned_date: '2026-11-02', start_time: '15:00', end_time: '18:00' }),
], availability, new Date(2026, 10, 2, 8));
const monWarnings = buildWorkloadWarnings(tight);
assert.ok(monWarnings.find((w) => w.date === '2026-11-02' && w.kind === 'overcommitted'));
assert.ok(monWarnings[0].message.includes('180m'), 'warning states the counted minutes');
assert.ok(monWarnings[0].message.includes('60m'), 'warning states the assumed availability');

// Unavailable day with a deadline -> insufficient_time warning.
const wedDue = buildWorkloadDays(from, to, [
  task({ id: 't9', due_date: '2026-11-04', estimated_minutes: 30 }),
], [], availability, new Date(2026, 10, 2, 8));
const wedWarnings = buildWorkloadWarnings(wedDue);
const insuff = wedWarnings.find((w) => w.date === '2026-11-04');
assert.ok(insuff && insuff.kind === 'insufficient_time_before_deadline');

console.log('test-workload: all assertions passed');
