/**
 * Focused checks for ManageBac feed-link normalization (run with: npx tsx scripts/test-managebac-url.ts).
 * All fixtures are synthetic. No real calendar URL, token or shared link appears here.
 */
import { normalizeFeedUrl, maskFeedUrl } from '../lib/feed-url';

type Result = { name: string; pass: boolean; detail?: string };
const results: Result[] = [];
function check(name: string, condition: boolean, detail?: string) {
  results.push({ name, pass: condition, detail });
}

const SYNTH = {
  https: 'https://school.managebac.com/student/calendar/feed?token=SYNTHETIC_TOKEN_123&fmt=ics',
  webcal: 'webcal://school.managebac.com/student/calendar/feed?token=SYNTHETIC_TOKEN_123&fmt=ics',
  upperWebcal: 'WEBCAL://school.managebac.com/student/calendar/feed?token=SYNTHETIC_TOKEN_123',
  mixedWebcal: 'WebCal://school.managebac.com/student/calendar/feed?token=SYNTHETIC_TOKEN_123',
  pathCase: 'https://school.managebac.com/Student/Calendar/Feed.ICS?token=SYNTHETIC_TOKEN_123',
  padded: '   https://school.managebac.com/feed?token=SYNTHETIC_TOKEN_123   ',
};

// --- webcal -> https conversion ---
{
  const r = normalizeFeedUrl(SYNTH.webcal);
  check('webcal converts to https', r.ok && r.url.startsWith('https://') && r.converted, JSON.stringify(r));
  check('webcal conversion preserves host/path/token/query',
    r.ok && r.url === SYNTH.https, r.ok ? r.url : undefined);
}
{
  const r = normalizeFeedUrl(SYNTH.upperWebcal);
  check('uppercase WEBCAL converts', r.ok && r.url.startsWith('https://') && r.converted);
}
{
  const r = normalizeFeedUrl(SYNTH.mixedWebcal);
  check('mixed-case WebCal converts', r.ok && r.url.startsWith('https://') && r.converted);
}

// --- https unchanged ---
{
  const r = normalizeFeedUrl(SYNTH.https);
  check('https URL unchanged', r.ok && r.url === SYNTH.https && !r.converted);
}
{
  const r = normalizeFeedUrl(SYNTH.pathCase);
  check('path/query case preserved, .ics ending kept', r.ok && r.url === SYNTH.pathCase);
}

// --- whitespace ---
{
  const r = normalizeFeedUrl(SYNTH.padded);
  check('surrounding whitespace trimmed', r.ok && r.url === SYNTH.padded.trim());
}
{
  const r = normalizeFeedUrl('   ');
  check('whitespace-only rejected', !r.ok && r.reason === 'empty');
}

// --- unsupported protocols rejected, nothing guessed ---
{
  for (const bad of ['http://school.managebac.com/feed?token=T', 'ftp://school.managebac.com/feed', 'file:///calendar.ics', 'feed://school.managebac.com/feed']) {
    const r = normalizeFeedUrl(bad);
    check(`rejects ${bad.split(':')[0]}://`, !r.ok && r.reason === 'protocol');
  }
}
{
  const r = normalizeFeedUrl('school.managebac.com/feed?token=T');
  check('scheme-less link rejected without guessing', !r.ok && r.reason === 'invalid');
}
{
  const r = normalizeFeedUrl('https://');
  check('malformed https URL rejected', !r.ok);
}

// --- masking ---
{
  const masked = maskFeedUrl(SYNTH.https);
  check('mask keeps only origin', masked === 'https://school.managebac.com/\u2026', masked);
  check('mask hides token', !masked.includes('SYNTHETIC_TOKEN_123'));
  check('mask hides path', !masked.includes('/feed'));
}

const passed = results.filter((r) => r.pass).length;
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? ` (${r.detail})` : ''}`);
}
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
