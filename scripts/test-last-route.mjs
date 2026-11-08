/**
 * Security tests for lib/last-route.ts validation.
 * Run: node scripts/test-last-route.mjs
 * Exits non-zero if any assertion fails.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(path.join(root, 'lib/last-route.ts'), 'utf8');

// Extract validateInternalAppRoute, strip TS type annotations, evaluate in this scope.
const fnMatch = src.match(/export function validateInternalAppRoute[\s\S]*?\n\}/);
if (!fnMatch) {
  console.error('FAIL: validateInternalAppRoute not found in lib/last-route.ts');
  process.exit(1);
}
const fnSource = fnMatch[0]
  .replace('export ', '')
  .replace('value: unknown', 'value')
  .replace(': string | null {', ' {');
const validate = new Function(`${fnSource}; return validateInternalAppRoute;`)();

let failures = 0;
function expectRejected(label, value) {
  if (validate(value) === null) {
    console.log(`ok   rejected: ${label}`);
  } else {
    console.error(`FAIL accepted malicious value: ${label} -> ${JSON.stringify(value)}`);
    failures++;
  }
}
function expectAccepted(label, value, expected) {
  const result = validate(value);
  if (result === expected) {
    console.log(`ok   accepted: ${label}`);
  } else {
    console.error(`FAIL expected ${JSON.stringify(expected)}, got ${JSON.stringify(result)} for ${label}`);
    failures++;
  }
}

// Malicious values must be rejected.
expectRejected('protocol-relative //evil.example', '//evil.example');
expectRejected('absolute https://evil.example', 'https://evil.example');
expectRejected('absolute http://evil.example', 'http://evil.example');
expectRejected('encoded %2f%2fevil.example', '%2f%2fevil.example');
expectRejected('encoded %2F%2Fevil.example', '%2F%2Fevil.example');
expectRejected('protocol in path /app/https://evil.example', '/app/https://evil.example');
expectRejected('userinfo @ /app/@evil.example', '/app/@evil.example');
expectRejected('backslash /app\\\\evil', '/app\\\\evil');
expectRejected('app double-slash /app//evil', '/app//evil');
expectRejected('missing app prefix /tasks', '/tasks');
expectRejected('app without trailing slash /app', '/app');
expectRejected('empty string', '');
expectRejected('non-string null', null);
expectRejected('non-string object', { url: 'https://evil.example' });
expectRejected('encoded path traversal /app/%2e%2e/other', '/app/%2e%2e/other');
expectRejected('newline /app/tasks\\nhttp://evil', '/app/tasks\nhttp://evil');
expectRejected('script tag /app/<script>', '/app/<script>');

// Legitimate routes must still pass.
expectAccepted('plain tasks route', '/app/tasks', '/app/tasks');
expectAccepted('dashboard subpage', '/app/calendar', '/app/calendar');
expectAccepted('query string', '/app/tasks?task=abc-123', '/app/tasks?task=abc-123');
expectAccepted('encoded but internal space', '/app/tasks?note=a%20b', '/app/tasks?note=a%20b');

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nAll last-route validation tests passed.');
