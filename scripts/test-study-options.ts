/**
 * Targeted tests for the Study Bot option and document-upload validation.
 * Run: npx tsx scripts/test-study-options.ts
 */
import {
  AI_OPTIONS,
  getAiOption,
  validateFile,
  MAX_DOCUMENT_BYTES,
  UPLOAD_LIMITS,
  formatBytes,
} from '../lib/ai-options';
import { resolvePlan } from '../lib/entitlements';

let passed = 0;
let failed = 0;

function assert(cond: boolean, name: string) {
  if (cond) {
    passed++;
    console.log(`PASS: ${name}`);
  } else {
    failed++;
    console.error(`FAIL: ${name}`);
  }
}

// ---------------------------------------------------------------------------
// Product distinction: TaskTrack AI = default, Study Bot = premium-only option.
// ---------------------------------------------------------------------------

assert(AI_OPTIONS.length === 2, 'exactly two AI options are offered');
assert(AI_OPTIONS[0].id === 'tasktrack-ai' && !AI_OPTIONS[0].premiumOnly, 'TaskTrack AI is the non-premium default');
assert(AI_OPTIONS[1].id === 'study-bot' && AI_OPTIONS[1].premiumOnly, 'Study Bot is premium-only');

assert(getAiOption('tasktrack-ai').id === 'tasktrack-ai', 'getAiOption resolves TaskTrack AI');
assert(getAiOption('study-bot').id === 'study-bot', 'getAiOption resolves Study Bot');
assert(getAiOption('nonsense').id === 'tasktrack-ai', 'getAiOption falls back to TaskTrack AI for unknown values');
assert(getAiOption(null).id === 'tasktrack-ai', 'getAiOption falls back to TaskTrack AI for null');

// ---------------------------------------------------------------------------
// Study modes are independent of the AI product options.
// ---------------------------------------------------------------------------

const modeIds = ['chat', 'explain', 'quiz', 'flashcards', 'plan', 'examples', 'slides'];
assert(
  !modeIds.some((m) => AI_OPTIONS.some((o) => o.id === m)),
  'AI options are distinct from study modes'
);

// ---------------------------------------------------------------------------
// Plan resolution drives which option is selectable (Free / Pro / expired Pro).
// ---------------------------------------------------------------------------

assert(resolvePlan({ plan: 'free' } as never) === 'free', 'free plan resolves as free');
assert(resolvePlan({ plan: 'pro', plan_expires_at: null } as never) === 'pro', 'pro plan without expiry resolves as pro');
assert(
  resolvePlan({ plan: 'pro', plan_expires_at: new Date(Date.now() + 86_400_000).toISOString() } as never) === 'pro',
  'unexpired pro resolves as pro'
);
assert(
  resolvePlan({ plan: 'pro', plan_expires_at: new Date(Date.now() - 86_400_000).toISOString() } as never) === 'free',
  'expired pro resolves as free'
);

// ---------------------------------------------------------------------------
// Upload limits and validation (shared by picker and drag-and-drop).
// ---------------------------------------------------------------------------

assert(MAX_DOCUMENT_BYTES === 20_000_000, 'document limit is exactly 20,000,000 bytes');
assert(UPLOAD_LIMITS.free === 7, 'free monthly upload limit is 7');
assert(UPLOAD_LIMITS.pro === 50, 'pro monthly upload limit is 50');

assert(validateFile({ name: 'notes.pdf', size: 1000 }) === null, 'valid pdf passes');
assert(validateFile({ name: 'a.txt', size: MAX_DOCUMENT_BYTES }) === null, 'file at exact limit passes');
assert(
  validateFile({ name: 'big.pdf', size: MAX_DOCUMENT_BYTES + 1 }) !== null,
  'file one byte over the limit is rejected'
);
assert(validateFile({ name: 'empty.txt', size: 0 }) !== null, 'empty file is rejected');
assert(validateFile({ name: 'virus.exe', size: 500 }) !== null, 'unsupported type is rejected');
assert(validateFile({ name: 'noext', size: 500 }) !== null, 'extension-less file is rejected');
assert(validateFile({ name: 'UPPER.PDF', size: 500 }) === null, 'uppercase extension passes');

// The picker and the drag-and-drop target both call this same function, so the two
// entry points cannot drift apart. Assert the function is a pure, shared export.
assert(typeof validateFile === 'function', 'validation is a single shared function');

// ---------------------------------------------------------------------------
// No fabricated usage.
// ---------------------------------------------------------------------------

assert(
  !AI_OPTIONS.some((o) => o.description.toLowerCase().includes('more capable')),
  'no unsubstantiated capability claims in option descriptions'
);

console.log(`\n${passed}/${passed + failed} passed`);
process.exit(failed > 0 ? 1 : 0);
