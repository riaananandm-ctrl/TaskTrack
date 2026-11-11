// Tests for the keyword priority rules. Run: npx tsx scripts/test-auto-priority.ts
import { autoPriority } from '../lib/auto-priority';
const cases: [string, string][] = [
  ['Summative Assessment: Comparative essay', 'urgent'],
  ['English SUMMATIVE', 'urgent'],
  ['Formative quiz – Algebra', 'high'],
  ['Formative before summative', 'urgent'],
  ['Task 3 – lab report', 'medium'],
  ['task3 draft', 'medium'],
  ['Criterion B Task 3', 'medium'],
  ['Task 30 worksheet', 'medium'],
  ['Read chapter 4', 'medium'],
  ['Informative speech', 'medium'],
  ['Presummative check', 'medium'],
];
let fail = 0;
for (const [t, want] of cases) { const got = autoPriority(t); const ok = got === want; if (!ok) fail++; console.log(ok ? 'PASS' : 'FAIL', JSON.stringify(t), '->', got); }
process.exit(fail);
