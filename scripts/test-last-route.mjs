/**
 * Security tests for lib/last-route.ts validation and resume decisions.
 * Run: node --experimental-strip-types --experimental-detect-module scripts/test-last-route.mjs
 * Exits non-zero if any assertion fails.
 */
import { validateInternalAppRoute, resolveResumeRoute } from '../lib/last-route.ts';

const validate = validateInternalAppRoute;

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
function expectDecision(label, options, expected) {
  const result = resolveResumeRoute(options);
  if (result === expected) {
    console.log(`ok   decision: ${label} -> ${JSON.stringify(result)}`);
  } else {
    console.error(`FAIL decision ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(result)}`);
    failures++;
  }
}

// Malicious stored values must be rejected.
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

// ---- resolveResumeRoute decision tests ----
const base = {
  pathname: '/',
  authenticated: true,
  emailConfirmed: true,
  loading: false,
  recoveryActive: false,
  stored: '/app/calendar',
};

expectDecision('authenticated user on / restores last valid /app route', base, '/app/calendar');
expectDecision('authenticated user already on /app/tasks does not redirect',
  { ...base, pathname: '/app/tasks' }, null);
expectDecision('unauthenticated user is not redirected (goes to login via ProtectedRoute)',
  { ...base, authenticated: false }, null);
expectDecision('invalid stored route falls back to /app',
  { ...base, stored: '//evil.example' }, '/app');
expectDecision('absolute external stored route falls back to /app',
  { ...base, stored: 'https://evil.example' }, '/app');
expectDecision('no stored route falls back to /app', { ...base, stored: null }, '/app');
expectDecision('recovery flow is not interrupted', { ...base, recoveryActive: true }, null);
expectDecision('auth still loading: never decide', { ...base, loading: true }, null);
expectDecision('unconfirmed email: not redirected', { ...base, emailConfirmed: false }, null);
expectDecision('login page is never hijacked', { ...base, pathname: '/login' }, null);
expectDecision('reset-password page is never hijacked', { ...base, pathname: '/reset-password' }, null);
expectDecision('auth callback is never hijacked', { ...base, pathname: '/auth/callback' }, null);
expectDecision('signup page is never hijacked', { ...base, pathname: '/signup' }, null);
expectDecision('already on stored route: stay put', { ...base, stored: '/app/tasks', pathname: '/app/tasks' }, null);

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nAll last-route validation tests passed.');
