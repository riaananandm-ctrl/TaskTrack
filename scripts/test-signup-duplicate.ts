/**
 * Focused checks for the signup duplicate-account handling (run with: npx tsx scripts/test-signup-duplicate.ts).
 * The classifySignupError logic is pure, so it is tested directly; the signed-in signup
 * screen state is covered by typecheck + build and manual verification.
 */
import {
  classifySignupError, ACCOUNT_EXISTS_MESSAGE, SIGNUP_GENERIC_NOTICE, safeAuthMessage,
} from '../lib/auth-email';

type Result = { name: string; pass: boolean; detail?: string };
const results: Result[] = [];

function check(name: string, condition: boolean, detail?: string) {
  results.push({ name, pass: condition, detail });
}

// --- 1. Duplicate-account errors: structured codes first ---
check('code user_already_exists -> duplicate', classifySignupError({ code: 'user_already_exists' }) === 'duplicate-account');
check('code email_exists -> duplicate', classifySignupError({ code: 'email_exists' }) === 'duplicate-account');
check('code is case-insensitive', classifySignupError({ code: 'User_Already_Exists' }) === 'duplicate-account');
// A structured code that says something else must NOT be treated as duplicate, even if
// the message text would text-match.
check('different code wins over message text', classifySignupError({ code: 'over_email_send_rate_limit', message: 'User already registered' }) === 'other');

// Text fallback only when there is no code at all (older error shapes).
check('no code, text user already registered -> duplicate', classifySignupError({ message: 'User already registered' }) === 'duplicate-account');
check('no code, text email exists -> duplicate', classifySignupError({ message: 'A user with this email address exists' }) === 'duplicate-account');

// Must NOT infer duplicate from anything ambiguous.
check('unknown error -> other', classifySignupError({ message: 'Something failed' }) === 'other');
check('empty error -> other', classifySignupError({}) === 'other');
check('null error -> other', classifySignupError(null) === 'other');
// Anti-enumeration: a successful signup response shape must never classify as duplicate.
check('success response shape is not an error', classifySignupError({ message: '' }) === 'other');

// --- 2. User-facing copy ---
check('duplicate message is the agreed copy', ACCOUNT_EXISTS_MESSAGE === 'This account already exists. Please log in.');
check('generic notice is the agreed copy', SIGNUP_GENERIC_NOTICE === 'Check your inbox for any required confirmation. Already have an account? Log in or reset your password.');

// --- 3. Other auth messages unaffected ---
check('login screen duplicate wording unchanged', safeAuthMessage('User already registered').includes('Try logging in instead.'));
check('confirm-required message unchanged', safeAuthMessage('Email not confirmed').startsWith('Please confirm your email'));

const passed = results.filter((r) => r.pass).length;
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? ` (${r.detail})` : ''}`);
}
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
