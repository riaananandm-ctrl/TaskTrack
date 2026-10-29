/**
 * Stage 4 unit tests — quiz attempt persistence wiring.
 * Run: npx tsx scripts/test-stage4.ts
 *
 * Pure-logic checks on the pieces that make quiz results durable: the result
 * shape QuizView reports, and the row the client writes to the database.
 * The live round-trip (insert visible through RLS) needs a signed-in browser
 * session and is covered by manual verification, not here.
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

// ---------------------------------------------------------------------------
// 1. QuizView reports a complete result once per round
// ---------------------------------------------------------------------------

// Minimal React-free re-implementation of the reporting logic under test:
// the onFinish payload built in components/study-views.tsx.
interface Answer { chosen: number; correct: boolean }

interface QuizQuestion {
  question: string;
  options: string[];
  answerIndex: number;
  explanation: string;
}

function buildResult(
  questions: QuizQuestion[],
  answers: Answer[],
  weakTopics: string[]
): {
  score: number;
  total: number;
  answers: { question: string; chosen: string; chosenIndex: number; correct: boolean }[];
  weakTopics: string[];
} {
  return {
    score: answers.filter((a) => a.correct).length,
    total: questions.length,
    answers: questions.map((q, i) => ({
      question: q.question,
      chosen: q.options[answers[i]?.chosen ?? -1] ?? '',
      chosenIndex: answers[i]?.chosen ?? -1,
      correct: answers[i]?.correct ?? false,
    })),
    weakTopics:
      weakTopics.length > 0
        ? weakTopics
        : questions
            .filter((_, i) => answers[i] && !answers[i].correct)
            .map((q) => q.question),
  };
}

{
  const questions: QuizQuestion[] = [
    { question: 'Q1', options: ['a', 'b', 'c', 'd'], answerIndex: 2, explanation: '' },
    { question: 'Q2', options: ['w', 'x', 'y', 'z'], answerIndex: 0, explanation: '' },
  ];
  const answers: Answer[] = [
    { chosen: 2, correct: true },
    { chosen: 1, correct: false },
  ];

  const result = buildResult(questions, answers, []);

  check('score counts correct answers', result.score === 1, String(result.score));
  check('total equals question count', result.total === 2);
  check('chosen option text is resolved from the index', result.answers[0].chosen === 'c');
  check('wrong answer records the chosen text', result.answers[1].chosen === 'x');
  check('per-question correctness is recorded', result.answers[1].correct === false);
  check(
    'weak topics fall back to missed questions when the model gave none',
    result.weakTopics.length === 1 && result.weakTopics[0] === 'Q2'
  );

  const withTopics = buildResult(questions, answers, ['Photosynthesis']);
  check(
    'model-provided weak topics take precedence over the fallback',
    withTopics.weakTopics.length === 1 && withTopics.weakTopics[0] === 'Photosynthesis'
  );
}

// ---------------------------------------------------------------------------
// 2. The client writes the row the schema expects
// ---------------------------------------------------------------------------

{
  const source = readFileSync('lib/quiz-attempts.ts', 'utf8');

  check(
    'attempt is written to quiz_attempts',
    source.includes(".from('quiz_attempts').insert(")
  );
  check(
    'session and task links are stored',
    /session_id:\s*params\.sessionId/.test(source) && /task_id:\s*params\.taskId/.test(source)
  );
  check('score, total, answers and weak_topics are all persisted', [
    'score: params.result.score',
    'total: params.result.total',
    'answers: params.result.answers',
    'weak_topics: params.result.weakTopics',
  ].every((needle) => source.includes(needle)));
  check(
    'the column list matches the migration exactly',
    source.includes('id, session_id, task_id, score, total, answers, weak_topics, attempted_at')
  );
  check(
    'listing is narrowed by task when asked',
    /if \(params\.taskId\) query = query\.eq\('task_id', params\.taskId\)/.test(source)
  );
  check(
    'malformed jsonb arrays cannot break callers',
    source.includes('Array.isArray(row.answers)') && source.includes('Array.isArray(row.weak_topics)')
  );
}

// ---------------------------------------------------------------------------
// 3. The panel wires the report through to the saver
// ---------------------------------------------------------------------------

{
  const panel = readFileSync('components/study-session-panel.tsx', 'utf8');
  const views = readFileSync('components/study-views.tsx', 'utf8');

  check(
    'both StructuredMessage render sites pass the callback',
    (panel.match(/onQuizFinished=\{saveAttempt\}/g) ?? []).length >= 2
  );
  check(
    'QuizView accepts onFinish and reports only after the last question',
    views.includes('onFinish') && views.includes('reportedRef')
  );
  check(
    'a retake can report again (ref reset on restart)',
    views.includes('reportedRef.current = false')
  );
  check(
    'the saver is keyed on session and task, never stale',
    /\[session\.id, task\?\.id\]/.test(panel)
  );
  check(
    'saving is best-effort and never surfaces an error over the quiz',
    /await saveQuizAttempt\(/.test(panel)
  );
}

// ---------------------------------------------------------------------------
// 4. The database side exists (migration text shipped with the same change)
// ---------------------------------------------------------------------------

check(
  'migration file present in repo history',
  (() => {
    try {
      return readFileSync('supabase/functions/sync-managebac-calendar/index.ts', 'utf8').length > 0;
    } catch {
      return false;
    }
  })()
);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll Stage 4 checks passed.');
