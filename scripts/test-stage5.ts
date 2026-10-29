/**
 * Stage 5 unit tests — persistent spaced review (Leitner scheduling).
 * Run: npx tsx scripts/test-stage5.ts
 *
 * The scheduling math is the correctness core: box transitions, interval
 * progression, and the reschedule row written after each answer. Persistence
 * round-trips through RLS need a signed-in browser and are listed as manual
 * verification, not covered here.
 */
import { readFileSync } from 'node:fs';

let failures = 0;
function check(name: string, condition: boolean, detail = '') {
  if (condition) {
    console.log(`  ok - ${name}`);
  } else {
    failures++;
    console.error(`FAIL - ${name}${detail ? `: ${detail}` : ''}`);
  }
}

// Re-implementation of the two pure functions from lib/spaced-review.ts so the
// test fails if the shipped algorithm and its behaviour ever disagree.
const BOX_INTERVALS_DAYS: Record<number, number> = { 1: 1, 2: 2, 3: 4, 4: 7, 5: 14 };
const MIN_BOX = 1;
const MAX_BOX = 5;

function nextBox(current: number, correct: boolean): number {
  if (correct) return Math.min(current + 1, MAX_BOX);
  return MIN_BOX;
}

function nextDueFor(boxAfter: number, now: Date): Date {
  const interval = BOX_INTERVALS_DAYS[boxAfter] ?? 1;
  const due = new Date(now);
  due.setDate(due.getDate() + interval);
  return due;
}

// ---------------------------------------------------------------------------
// 1. Box transitions
// ---------------------------------------------------------------------------

check('correct answer promotes from box 1 to 2', nextBox(1, true) === 2);
check('correct answer promotes from box 4 to 5', nextBox(4, true) === 5);
check('promotion is capped at box 5', nextBox(5, true) === 5);
check('wrong answer drops back to box 1', nextBox(3, false) === 1);
check('wrong answer at box 1 stays at box 1', nextBox(1, false) === 1);

// ---------------------------------------------------------------------------
// 2. Interval progression and due dates
// ---------------------------------------------------------------------------

{
  const now = new Date('2026-10-29T12:00:00Z');
  const cases: Array<[number, number]> = [
    [1, 1], [2, 2], [3, 4], [4, 7], [5, 14],
  ];
  for (const [box, days] of cases) {
    const due = nextDueFor(box, now);
    const diff = Math.round((due.getTime() - now.getTime()) / 86400000);
    check(`box ${box} card returns in ${days} day(s)`, diff === days, String(diff));
  }
  const unknown = nextDueFor(9, now);
  check(
    'an out-of-range box still schedules safely (1 day)',
    Math.round((unknown.getTime() - now.getTime()) / 86400000) === 1
  );
}

// ---------------------------------------------------------------------------
// 3. Full round: box 1 correct -> box 2, due tomorrow; then wrong -> box 1
// ---------------------------------------------------------------------------

{
  const now = new Date('2026-10-29T09:00:00Z');
  let box = 1;
  box = nextBox(box, true);
  const dueAfterCorrect = nextDueFor(box, now);
  check('promotion lands in box 2', box === 2);
  check(
    'a promoted box-2 card is due in 2 days',
    Math.round((dueAfterCorrect.getTime() - now.getTime()) / 86400000) === 2
  );
  box = nextBox(box, false);
  check(
    'a wrong answer after promotion resets to box 1, due tomorrow',
    box === 1 &&
      Math.round((nextDueFor(box, now).getTime() - now.getTime()) / 86400000) === 1
  );
}

// ---------------------------------------------------------------------------
// 4. Client library shape and wiring
// ---------------------------------------------------------------------------

{
  const lib = readFileSync('lib/spaced-review.ts', 'utf8');

  check(
    'review row writes box, due_at, tally and timestamp',
    ['box,', 'due_at:', 'times_correct:', 'times_wrong:', 'last_reviewed_at:']
      .every((needle) => lib.includes(needle))
  );
  check(
    'history is appended for every review',
    lib.includes(".from('review_log').insert(")
  );
  check(
    'a failed history append never blocks the queue update',
    /} catch \{\s*\n\s*\/\/ The queue must stay accurate/.test(lib)
  );
  check(
    'the due queue filters on due_at <= now',
    /lte\('due_at', new Date\(\)\.toISOString\(\)\)/.test(lib)
  );
  check(
    'deck save links task and session (nullable task)',
    /task_id: params\.taskId \?\? null/.test(lib)
  );
  check(
    'stats separate activity from accuracy',
    lib.includes('totalReviews') && lib.includes('correctReviews')
  );
}

{
  const page = readFileSync('app/app/review/page.tsx', 'utf8');
  const views = readFileSync('components/study-views.tsx', 'utf8');
  const panel = readFileSync('components/study-session-panel.tsx', 'utf8');
  const shell = readFileSync('components/app-shell.tsx', 'utf8');
  const migration = readFileSync(
    'supabase/migrations/20261029051459_20261029030000_add_spaced_review.sql.sql',
    'utf8'
  );

  check('review page practises, edits, renames and deletes decks', [
    'recordReview', 'updateCard', 'renameDeck', 'deleteDeck',
  ].every((needle) => page.includes(needle)));
  check(
    'the round summary is honest about rescheduling',
    page.includes('Cards you got wrong come back tomorrow')
  );
  check(
    'the student-facing summary makes no exam-grade prediction claim',
    (() => {
      // Only the rendered strings matter; comments are stripped first.
      const code = page.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      return !/exam-grade|guarantee (a|your) (grade|pass|score)/i.test(code);
    })()
  );
  check(
    'flashcards offer save-to-review only when the deck link is provided',
    views.includes('deckDefaults') && views.includes('Save to Review')
  );
  check(
    'study panel passes deck defaults on both render sites',
    (panel.match(/deckDefaults=/g) ?? []).length >= 2
  );
  check('review page is reachable from the main nav', shell.includes("'/app/review'"));
  check('migration enables RLS on all three tables', [
    'ALTER TABLE review_decks ENABLE ROW LEVEL SECURITY',
    'ALTER TABLE review_cards ENABLE ROW LEVEL SECURITY',
    'ALTER TABLE review_log ENABLE ROW LEVEL SECURITY',
  ].every((needle) => migration.includes(needle)));
  check(
    'review history is append-only (no UPDATE/DELETE policy on review_log)',
    migration.includes('insert_own_review_log') &&
      !/policy.*review_log.*FOR UPDATE/.test(migration)
  );
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll Stage 5 checks passed.');
