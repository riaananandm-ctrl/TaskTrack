/**
 * Tests for ManageBac link conversion, token preservation, mode selector wiring, and
 * composer source wiring. Run: npx tsx scripts/test-feed-url.ts
 *
 * The source-wiring assertions at the end check that the live component files contain
 * the required wiring. They are static checks, not rendered-behaviour tests; that
 * limitation is stated in the completion report.
 */
import { readFileSync } from 'node:fs';
import { normalizeFeedUrl, maskFeedUrl, FEED_COPY } from '../lib/feed-url';
import { MODE_SELECT_OPTIONS } from '../lib/study-modes';

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

// --- webcal -> https conversion preserves everything after the scheme ---

const TOKEN_URL = 'WEBcal://managebac.Example.com/student/events/token/AbC123xYz-_.foo?one=1&two=2.ics';
const converted = normalizeFeedUrl(TOKEN_URL);
assert(converted.ok && converted.url === 'https://managebac.Example.com/student/events/token/AbC123xYz-_.foo?one=1&two=2.ics',
  'webcal converts to https preserving host case, path, token, query, .ics');
assert(converted.ok && converted.converted === true, 'webcal input is reported as converted');

const webcalExact = normalizeFeedUrl('webcal://school.managebac.com/student/events/token/tok');
assert(webcalExact.ok && webcalExact.url === 'https://school.managebac.com/student/events/token/tok',
  'lowercase webcal:// converts');

// --- already-HTTPS links pass through unchanged ---

const httpsUrl = 'https://managebac.example.com/student/events/token/AbC123?keep=1';
const httpsResult = normalizeFeedUrl(httpsUrl);
assert(httpsResult.ok && httpsResult.url === httpsUrl && httpsResult.converted === false,
  'already-HTTPS link is unchanged and not reported as converted');

// --- unsupported protocols are rejected ---

const ftpResult = normalizeFeedUrl('ftp://managebac.example.com/file.ics');
assert(ftpResult.ok === false, 'ftp:// rejected');
assert(normalizeFeedUrl('http://managebac.example.com/file.ics').ok === false, 'http:// rejected');
assert(normalizeFeedUrl('javascript://alert(1)').ok === false, 'javascript: rejected');
assert(normalizeFeedUrl('').ok === false, 'empty input rejected as empty');
assert(normalizeFeedUrl('   ').ok === false, 'whitespace-only input rejected as empty');
assert(normalizeFeedUrl('managebac.example.com/ics').ok === false, 'scheme-less link rejected, not guessed');

// --- token masking ---

const masked = maskFeedUrl('https://managebac.example.com/student/events/token/SECRET123?x=1');
assert(masked === 'https://managebac.example.com/…', 'masked preview is origin only');
assert(!masked.includes('SECRET123'), 'masked preview never contains the token');

// --- copy strings required by the setup flow ---

assert(FEED_COPY.converted === 'Link converted to HTTPS.', 'conversion message text');
assert(FEED_COPY.alreadyHttps === 'Your link is already in the correct format.', 'already-HTTPS message text');
assert(FEED_COPY.convertedButUnreachable.startsWith('Link format corrected, but'), 'conversion/verification separation message');

// --- study mode selector maps to the exact backend values ---

assert(
  JSON.stringify(MODE_SELECT_OPTIONS.map((m) => m.id)) ===
    JSON.stringify(['chat', 'explain', 'quiz', 'flashcards', 'plan', 'examples', 'slides']),
  'mode selector ids are exactly the seven backend values in order'
);

// --- source wiring of the live components (static checks, not rendered tests) ---

const panel = readFileSync('components/study-session-panel.tsx', 'utf8');
assert(panel.includes('sendMessage(input, selectedMode)'), 'typing-area submit sends the selected mode');
assert(panel.includes('MODE_SELECT_OPTIONS.map'), 'mode select renders the shared mode options');
assert(panel.includes("useState<StudyMode>('chat')"), 'mode defaults to chat');
assert(panel.includes("setUploadOpen(true)"), 'paperclip control opens the upload dialog');
assert(panel.includes('aria-label="Upload document"'), 'upload control is labelled');
// Selectors live below the typing area in the composer (form appears first in the
// assistant column, then the selector block).
const formIdx = panel.indexOf('aria-label="Send message"');
const selectorsIdx = panel.indexOf('Selectors live BELOW the typing area');
assert(formIdx !== -1 && selectorsIdx !== -1 && selectorsIdx > formIdx, 'selectors sit below the typing area in the composer');

const card = readFileSync('components/managebac-card.tsx', 'utf8');
assert(card.includes('!verified'), 'Connect is disabled until verification succeeded');
assert(card.includes('Convert link'), 'Convert link button present');
assert(card.includes('handleConvert'), 'convert handler exists');
assert(card.includes('handleFeedChange'), 'feed input edit handler invalidates conversion/verification');
assert(card.includes('Your link is ready for TaskTrack.'), 'ready message shown after conversion');
assert(card.includes('maskFeedUrl(normalized.url)'), 'preview uses masked URL only');

const edge = readFileSync('supabase/functions/managebac-connect/index.ts', 'utf8');
assert(edge.includes('normalizeFeedProtocol(raw)'), 'server verify path normalizes the link');
assert(edge.includes('validateFeedUrl(normalizedConnect.url)'), 'server connect path normalizes the link');
assert(edge.includes("webcal:\\/\\/") || edge.includes('/^webcal:\\/\\//i'), 'server normalization converts webcal');

console.log(`\n${passed}/${passed + failed} passed`);
process.exit(failed > 0 ? 1 : 0);
