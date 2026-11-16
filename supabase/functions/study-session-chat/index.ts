import { createClient } from 'npm:@supabase/supabase-js@2';

// Study Assistant provider: Groq, called through its OpenAI-compatible endpoint.
// The API key is read from the server-side GROQ_API_KEY secret only; it is never
// logged, returned, or sent to the browser.
const GROQ_API_BASE = 'https://api.groq.com/openai/v1';
const GROQ_CHAT_URL = `${GROQ_API_BASE}/chat/completions`;
const GROQ_MODELS_URL = `${GROQ_API_BASE}/models`;

// Models tried first when the key can use them. The live model list is always
// consulted first, so a retired model here is simply skipped and never breaks the
// assistant. Quota is per model, so the next entry is tried before giving up.
const PREFERRED_MODELS = [
  'openai/gpt-oss-120b',
  'llama-3.3-70b-versatile',
  'moonshotai/kimi-k2-instruct-0905',
  'moonshotai/kimi-k2-instruct',
  'openai/gpt-oss-20b',
  'meta-llama/llama-4-maverick-17b-128e-instruct',
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'qwen/qwen3-32b',
  'llama-3.1-8b-instant',
];

// Bound the number of models tried so a request cannot hang indefinitely.
const MAX_MODEL_ATTEMPTS = 4;
// One slow model must not hold the student up: give up on it and try the next.
const MODEL_TIMEOUT_MS = 25_000;

/**
 * Speed settings per model family. gpt-oss models "think" before answering; at the
 * default effort that thinking is slow and can use up the whole token budget, which
 * leaves an empty reply. Low effort keeps answers fast, and the reasoning text is
 * not sent back because the student never sees it. Qwen 3 likewise skips thinking.
 */
function speedOptions(model: string): Record<string, unknown> {
  if (model.startsWith('openai/gpt-oss')) return { reasoning_effort: 'low', include_reasoning: false };
  if (model.startsWith('qwen/qwen3')) return { reasoning_effort: 'none' };
  return {};
}

// Model families that are not plain text chat and must never be selected.
const NON_CHAT_MARKERS = [
  'whisper', 'tts', 'embed', 'embedding', 'guard', 'moderation', 'vision-only',
  'playai', 'rerank', 'speech', 'audio',
];

/**
 * Safe error categories returned to the client. The upstream status and body are
 * logged server-side only; the client receives one of these buckets plus a
 * human-readable message.
 */
type ErrorCategory =
  | 'not_configured'
  | 'auth'
  | 'limit'
  | 'model_unavailable'
  | 'rate_limit'
  | 'invalid_request'
  | 'empty'
  | 'network'
  | 'provider'
  | 'study_bot_unavailable';

// The only strings the browser ever sees. Upstream status/body stay in the
// server-side logs; these are deliberately generic and reveal nothing about the
// key, the project, or the provider's response.
const ERROR_MESSAGES: Record<ErrorCategory, string> = {
  not_configured: 'TaskTrack AI is not configured yet.',
  auth: 'TaskTrack AI is temporarily unavailable. Please try again later.',
  limit: "You've reached today's TaskTrack AI limit. You can continue tomorrow.",
  model_unavailable: 'The AI model is temporarily unavailable. Please try again later.',
  rate_limit: 'TaskTrack AI is busy right now. Please try again later.',
  invalid_request: "I couldn't process that study request. Please try again.",
  empty: 'TaskTrack AI returned an empty response. Please try again.',
  network: 'Could not reach TaskTrack AI. Please check your connection and try again.',
  provider: 'TaskTrack AI is temporarily unavailable. Please try again later.',
  study_bot_unavailable:
    'Study Bot is temporarily unavailable. Please try again later or switch to TaskTrack AI.',
};

const STATUS_FOR_CATEGORY: Record<ErrorCategory, number> = {
  not_configured: 503,
  auth: 502,
  limit: 429,
  model_unavailable: 502,
  rate_limit: 429,
  invalid_request: 400,
  empty: 502,
  network: 502,
  provider: 502,
  study_bot_unavailable: 503,
};

/**
 * Study Bot (the Premium option) is pinned to this specific provider model, so its
 * behaviour is anchored rather than drifting with the provider's fallback order.
 * Verified against the live provider model list at request time; if the key cannot
 * serve it, the request falls back to TaskTrack AI behaviour rather than failing.
 */
const STUDY_BOT_MODEL = 'openai/gpt-oss-120b';

const FALLBACK_LIMITS = { daily_ai_messages: 20, max_message_chars: 2000 };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

// Stable, non-sensitive codes the app can branch on. The human-readable message
// beside each one is the only text the browser ever shows.
const ERROR_CODES: Record<ErrorCategory, string> = {
  not_configured: 'MISSING_KEY',
  auth: 'INVALID_API_KEY',
  limit: 'QUOTA_EXCEEDED',
  model_unavailable: 'MODEL_UNAVAILABLE',
  rate_limit: 'RATE_LIMIT',
  invalid_request: 'INVALID_REQUEST',
  empty: 'EMPTY_RESPONSE',
  network: 'NETWORK',
  provider: 'PROVIDER_ERROR',
  study_bot_unavailable: 'STUDY_BOT_UNAVAILABLE',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/**
 * The single success schema used by every mode. The app reads `text` for prose,
 * `structured` for the interactive views, and never has to guess which property
 * carries the answer.
 */
function succeed(params: {
  mode: string;
  text: string;
  structured?: unknown;
  usage?: { used: number; dailyLimit: number } | null;
  messageId?: string | null;
}) {
  return json({
    ok: true,
    mode: params.mode,
    text: params.text,
    structured: params.structured ?? null,
    messageId: params.messageId ?? null,
    usage: params.usage ?? null,
  });
}

/** The single error schema. Raw upstream detail never reaches the browser. */
function fail(category: ErrorCategory, extra: Record<string, unknown> = {}) {
  return json(
    {
      ok: false,
      error: { code: ERROR_CODES[category], message: ERROR_MESSAGES[category] },
      ...extra,
    },
    STATUS_FOR_CATEGORY[category]
  );
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

interface TaskContext {
  taskId?: string | null;
  title: string;
  subject?: string | null;
  description?: string | null;
  category?: string | null;
  dueDate?: string | null;
  estimatedMinutes?: number | null;
  priority?: string | null;
}

/** Human-readable category, so the model sees "Summative Assessment", not a slug. */
const CATEGORY_NAMES: Record<string, string> = {
  homework: 'Homework',
  classwork: 'Classwork',
  project: 'Project',
  quiz: 'Quiz',
  test: 'Test',
  presentation: 'Presentation',
  reading: 'Reading',
  summative_assessment: 'Summative Assessment',
  formative_assessment: 'Formative Assessment',
  final_exam: 'Final Exam',
  mock_exam: 'Mock Exam',
  other: 'Other',
};

/**
 * The full task context sent with every request, so the student never has to
 * repeat anything the app already knows about the task.
 */
function describeTask(task: TaskContext | null | undefined): string {
  if (!task?.title) return '';
  const lines = [`Task: ${task.title}`];
  if (task.subject) lines.push(`Subject: ${task.subject}`);
  if (task.category) {
    lines.push(`Category: ${CATEGORY_NAMES[task.category] || task.category}`);
  }
  if (task.description) lines.push(`Details: ${task.description}`);
  if (task.dueDate) lines.push(`Due date: ${task.dueDate}`);
  if (task.estimatedMinutes) lines.push(`Estimated duration: ${task.estimatedMinutes} minutes`);
  if (task.priority) lines.push(`Priority: ${task.priority}`);
  return lines.join('\n');
}

/** Plan-dependent generation counts (Free and Premium get different sizes). */
interface ModeCounts {
  quiz: string;
  flashcards: string;
}

const MODE_COUNTS: Record<'free' | 'pro', ModeCounts> = {
  free: { quiz: 'exactly 5', flashcards: '5' },
  pro: { quiz: '5 to 8', flashcards: '8 to 12' },
};

// ---------------------------------------------------------------------------
// Task clarity
// ---------------------------------------------------------------------------

/**
 * Modes that produce topic-specific material. When the task does not name a real
 * topic these must ask for clarification rather than inventing content.
 */
const CLARIFICATION_MODES = new Set(['explain', 'examples', 'flashcards', 'quiz', 'slides', 'plan']);

/**
 * Words that appear in study tasks but do NOT identify a topic. A task made up
 * only of these words (plus stopwords) is too vague to explain accurately.
 */
const GENERIC_TOPIC_WORDS = new Set([
  // study actions
  'study', 'studying', 'revise', 'revising', 'revision', 'review', 'reviewing',
  'prepare', 'preparation', 'practice', 'practise', 'read', 'reading', 'learn',
  'learning', 'memorise', 'memorize', 'finish', 'finishing', 'complete',
  'completing', 'catch', 'submit', 'start', 'continue',
  // assessments and deliverables
  'test', 'tests', 'exam', 'exams', 'quiz', 'quizzes', 'assessment', 'homework',
  'hw', 'assignment', 'assignments', 'project', 'projects', 'essay', 'essays',
  'paper', 'papers', 'worksheet', 'worksheets', 'coursework', 'task', 'tasks',
  'note', 'notes', 'question', 'questions', 'exercise', 'exercises', 'problem',
  'problems', 'classwork', 'presentation', 'report', 'portfolio', 'marks',
  // subject names used on their own
  'math', 'maths', 'mathematics', 'english', 'science', 'biology', 'chemistry',
  'physics', 'history', 'geography', 'geology', 'astronomy', 'economics',
  'business', 'accounting', 'computing', 'computer', 'ict', 'art', 'music',
  'drama', 'pe', 'sport', 'sports', 'language', 'languages', 'french', 'spanish',
  'german', 'italian', 'mandarin', 'chinese', 'japanese', 'arabic', 'latin',
  'religion', 'citizenship', 'psychology', 'sociology', 'politics',
  'statistics', 'engineering', 'design', 'technology', 'humanities',
  // vague qualifiers and structural words
  'some', 'more', 'all', 'everything', 'anything', 'something', 'stuff', 'thing',
  'things', 'topic', 'topics', 'subject', 'chapter', 'chapters', 'unit', 'units',
  'lesson', 'lessons', 'section', 'sections', 'part', 'parts', 'module',
  'modules', 'term', 'semester', 'year', 'week', 'tomorrow', 'today',
]);

const STOPWORDS = new Set([
  'a', 'an', 'and', 'or', 'but', 'the', 'this', 'that', 'these', 'those', 'for',
  'on', 'in', 'of', 'to', 'with', 'about', 'at', 'by', 'from', 'into', 'over',
  'my', 'our', 'your', 'their', 'his', 'her', 'its', 'i', 'we', 'you', 'it',
  'is', 'are', 'was', 'were', 'be', 'been', 'am', 'do', 'does', 'did', 'have',
  'has', 'had', 'will', 'would', 'can', 'could', 'should', 'need', 'needs',
  'really', 'just', 'also', 'then', 'than', 'so', 'as', 'if', 'when', 'what',
  'which', 'who', 'how', 'why', 'where', 'please', 'help', 'again',
]);

/**
 * True when the task names something specific enough to study, judged from its
 * title, subject and description alone. Any content word that is not generic
 * study vocabulary counts as a real topic. Deliberately conservative: unknown
 * words count as a topic, so the assistant explains rather than falsely refusing.
 */
function taskHasIdentifiableTopic(task: TaskContext | null | undefined): boolean {
  if (!task) return false;

  const text = [task.title, task.subject, task.description]
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .join(' ')
    .toLowerCase();

  if (!text) return false;

  const words = text
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^[-']+|[-']+$/g, ''))
    .filter(Boolean);

  return words.some(
    (w) => w.length >= 3 && !/^\d+$/.test(w) && !STOPWORDS.has(w) && !GENERIC_TOPIC_WORDS.has(w)
  );
}

/** Phrases that mean the student explicitly asked for a general overview. */
const GENERAL_OVERVIEW_SIGNALS = [
  'general overview', 'overview', 'general', 'broadly', 'in general',
  'any topic', 'whatever', 'the basics', 'some basics', 'general knowledge',
];

function asksForGeneralOverview(
  messages: Array<{ role: string; content: string }>
): boolean {
  const last = [...messages].reverse().find((m) => m.role === 'user');
  if (!last || typeof last.content !== 'string') return false;
  const text = last.content.toLowerCase();
  return GENERAL_OVERVIEW_SIGNALS.some((signal) => text.includes(signal));
}

const CLARIFICATION_FOLLOW_UPS: Record<string, string> = {
  explain: 'What specific concept, chapter, skill, or question should I explain?',
  examples: 'What specific concept, chapter, skill, or question should I work through with you?',
  flashcards: 'What specific concept, chapter, or skill should the flashcards cover?',
  quiz: 'What specific concept, chapter, or skill should the quiz cover?',
  slides: 'What specific concept, chapter, or skill should the slides cover?',
  plan: 'What specific topic, chapter, or subject should the study plan cover?',
};

function buildClarificationReply(mode: string): string {
  const followUp = CLARIFICATION_FOLLOW_UPS[mode] || CLARIFICATION_FOLLOW_UPS.explain;
  return `I don't have enough information to explain this topic accurately. Please add more details to the task description or tell me the exact topic you want to study.\n\n${followUp}`;
}

/**
 * Per-mode output contracts. The counts are injected so Free and Premium get
 * different sizes without the model having to guess.
 */
function modeInstructions(mode: string, counts: ModeCounts): Record<string, string> {
  return {
    chat: 'The student is chatting freely. Answer their latest message directly and helpfully.',
    explain: `Explain the topic clearly and simply, in student-friendly language.
- Start with a one-line summary, then break down the key ideas.
- Include a concrete example or analogy where it helps.
- End with one short check-for-understanding question.`,
    quiz: `Write a quiz of ${counts.quiz} multiple-choice questions on this topic, ordered from easier
to harder. Give exactly 4 options per question with exactly one correct option. Provide a short
(one or two sentence) explanation for each answer. End with a short list of the weak topics
the student should revise.`,
    flashcards: `Create a set of ${counts.flashcards} flashcards.
Keep fronts short (a term or question) and backs concise.
Do not add any other commentary.`,
    plan: `Create a realistic study plan that ends on or before the task's due date.
- Every session date must be AFTER today. Never use today's date and never a past date.
- Spread the sessions sensibly between tomorrow and the due date.
- If the due date is today or tomorrow, include only the sessions that genuinely fit and say
  in the summary that the plan is compressed because the deadline is near.
- Each session is one focused sitting. Give 3 to 5 concrete topics to cover per session.`,
    examples: `Show 3 worked examples on this topic, ordered from easier to harder.
For each: state the problem, then "**Step-by-step:**" with numbered reasoning, then
"**Answer:**". Explain why each step works, not just what to do.
Finish with one similar practice question for the student to try on their own (do not
answer it).`,
    slides: `Produce a concise deck of study slides on this topic.
- 4 to 8 slides. Give the deck a clear title.
- Each slide has a heading, a short subtitle, and 3 to 5 concise bullet points.
- Include at least one slide with a concrete worked example, and make the final slide a
  "Recap" that summarises the most important points.`,
  }[mode] || 'The student is chatting freely. Answer their latest message directly and helpfully.';
}

/** Every mode the assistant supports. Anything else falls back to free chat. */
const DEFINED_MODES = new Set(['chat', 'explain', 'quiz', 'flashcards', 'plan', 'examples', 'slides']);

/** Modes that must never show raw JSON to the student. */
const STRUCTURED_MODES: Record<string, { schema: string }> = {
  quiz: {
    schema: `{
  "questions": [
    {
      "question": "the question text",
      "options": ["option A", "option B", "option C", "option D"],
      "answerIndex": 0,
      "explanation": "one or two sentences explaining why the answer is correct"
    }
  ],
  "weakTopics": ["short revision topic", "another topic"]
}
Use exactly the number of questions stated in the instructions above, each with exactly 4
options. answerIndex is the 0-based index of the correct option.`,
  },
  flashcards: {
    schema: `{
  "cards": [
    { "front": "a term or short question", "back": "the concise answer" }
  ]
}
Use exactly the number of cards stated in the instructions above.`,
  },
  plan: {
    schema: `{
  "compressed": false,
  "summary": "one short sentence describing the plan",
  "sessions": [
    { "date": "YYYY-MM-DD", "focus": "what this session covers", "topics": ["topic", "topic"], "minutes": 45 }
  ]
}
Set compressed to true when the deadline is so close that only the sessions listed could fit.
Every date must be AFTER today's date shown above. Never output a date in the past.`,
  },
  slides: {
    schema: `{
  "title": "the deck title",
  "subtitle": "a short subtitle for the deck",
  "slides": [
    { "heading": "slide heading", "bullets": ["point", "point", "point"], "example": "an optional concrete example" }
  ]
}
Provide 4 to 8 slides of 3 to 5 bullets each. The final slide's heading should be "Recap".`,
  },
};

function buildSystemPrompt(
  task: TaskContext | null,
  mode: string,
  today: string,
  generalOverview: boolean,
  counts: ModeCounts,
  hasHistory: boolean
): string {
  const taskLines = describeTask(task);
  const modeInstruction = modeInstructions(mode, counts);
  const structured = STRUCTURED_MODES[mode];

  const historyRule = hasHistory
    ? `\n\nThis is an ongoing session, so the earlier messages above are already part of the
conversation. Continue naturally and do not repeat material the student has already seen.`
    : '';

  const jsonRule = structured
    ? `\n\nOutput format: reply with a single JSON object and nothing else. No markdown fences, no
prose outside the JSON. Shape:\n${structured.schema}`
    : '';

  const overviewRule = generalOverview
    ? `\n\nImportant: the task details are vague, and the student asked for a general overview.
Give a general overview only, and begin by clearly saying that it is a general overview and is
not based on the student's exact assignment. Do not pretend to know their specific questions.`
    : '';

  return `You are TaskTrack AI, a patient and encouraging study companion for school students.

${taskLines ? `The student opened this session from this task:\n${taskLines}\n` : ''}
Today's date is ${today}.

What to do now:
${modeInstruction}

Style:
- Be concise and student-friendly. Short clear answers; more detail only if asked.
${structured ? '' : '- Use markdown: "- " for bullets, numbered steps, and **bold** for key terms.\n'}- Never invent facts about the student, their school, or their deadlines.
- If the student asks something unrelated to studying, gently steer them back.${jsonRule}${overviewRule}${historyRule}`.trim();
}

// ---------------------------------------------------------------------------
// Groq
// ---------------------------------------------------------------------------

interface ProviderModel {
  name: string;
  supportsJson: boolean;
}

// Short-lived cache of the model list for this function instance.
let modelCache: { at: number; models: ProviderModel[] } | null = null;
const MODEL_CACHE_MS = 5 * 60 * 1000;

async function listModels(apiKey: string): Promise<ProviderModel[]> {
  // The live model list is fetched per request so a retired model never needs a code
  // change; it is cached briefly to avoid listing models on every session message.
  const now = Date.now();
  if (modelCache && now - modelCache.at < MODEL_CACHE_MS) return modelCache.models;

  const res = await fetch(GROQ_MODELS_URL, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    const text = await res.text();
    console.error('Groq model list failed:', res.status, text.slice(0, 300));
    throw new UpstreamError(res.status, text);
  }
  const data = await res.json();
  if (!Array.isArray(data?.data)) return [];
  const models = data.data
    .filter((m: { id?: string; active?: boolean }) => !m?.active === false)
    .map((m: { id?: string }) => ({
      name: m.id || '',
      // Groq's model list does not advertise JSON support, so structured output is
      // attempted and a plain-text retry covers any model that rejects it.
      supportsJson: true,
    }))
    .filter((m: ProviderModel) => m.name.length > 0);
  modelCache = { at: now, models };
  return models;
}

/** Ordered chat models to try: preferred first, then other usable text models. */
async function resolveModels(apiKey: string): Promise<ProviderModel[]> {
  const available = await listModels(apiKey);
  const usable = available
    .map((m) => m.name)
    .filter((name) => !NON_CHAT_MARKERS.some((marker) => name.toLowerCase().includes(marker)));

  const ordered: string[] = [];
  for (const preferred of PREFERRED_MODELS) {
    if (usable.includes(preferred)) ordered.push(preferred);
  }
  for (const name of usable) {
    if (!ordered.includes(name)) ordered.push(name);
  }
  return ordered.map((name) => ({ name, supportsJson: true }));
}

class UpstreamError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(`Groq request failed with status ${status}`);
    this.status = status;
    this.body = body;
  }
}

/**
 * Parse a structured-mode reply. Models sometimes wrap JSON in a code fence or add
 * a sentence around it, so the first {...} block is extracted before parsing.
 * Returns null when nothing usable is found.
 */
function parseStructured(text: string): unknown | null {
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  if (start === -1) return null;
  const body = cleaned.slice(start);
  const end = body.lastIndexOf('}');

  const candidates: string[] = [];
  if (end > 0) candidates.push(body.slice(0, end + 1));
  candidates.push(body);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      // try the next candidate
    }
  }

  // A truncated reply (the model ran out of room mid-object) is salvaged by closing
  // any open string/array/object, so a nearly complete deck still renders.
  const repaired = repairJson(body);
  if (repaired) {
    try {
      const parsed = JSON.parse(repaired);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      // fall through to null
    }
  }
  return null;
}

/**
 * Close a truncated JSON object so its good leading content can still be parsed.
 * Returns null when nothing sensible can be recovered.
 */
function repairJson(s: string): string | null {
  const stack: string[] = [];
  let inStr = false;
  let esc = false;
  for (const c of s) {
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') stack.push(c);
    else if (c === '}' || c === ']') stack.pop();
  }
  if (stack.length === 0 && !inStr) return null;

  let out = s;
  if (inStr) out += '"';
  // Drop a trailing incomplete property such as `,"heading":"Rev` or `,"focus":`.
  out = out.replace(/,\s*"[^"]*"\s*:\s*[^,{}[\]]*$/, '');
  out = out.replace(/,\s*$/, '');
  while (stack.length > 0) out += stack.pop() === '{' ? '}' : ']';
  return out;
}

const STRUCTURED_RETRY_TEXT =
  'I could not format that response properly. Please ask me to try again.';

/** True when text is a JSON blob rather than something a student should read. */
function looksLikeJson(text: string): boolean {
  return /^\s*[{[]/.test(text);
}

/**
 * A readable plain-text rendering of a structured payload, used alongside the cards
 * so the client always has a safe fallback. The student always sees real content
 * rather than a machine-formatted blob.
 */
function structuredToText(mode: string, value: unknown): string {
  const v = value as Record<string, unknown>;
  const s = (x: unknown) => (typeof x === 'string' ? x : '');
  const arr = (x: unknown) => (Array.isArray(x) ? x : []);
  const letter = (i: number) => String.fromCharCode(65 + i);

  if (mode === 'quiz') {
    const lines: string[] = [];
    arr(v.questions).forEach((q0, i) => {
      const q = q0 as Record<string, unknown>;
      lines.push(`${i + 1}. ${s(q.question)}`);
      arr(q.options).forEach((o, j) => lines.push(`   ${letter(j)}. ${s(o)}`));
      const idx = typeof q.answerIndex === 'number' ? q.answerIndex : 0;
      const why = s(q.explanation);
      lines.push(`   Answer: ${letter(idx)}${why ? ` - ${why}` : ''}`);
    });
    const weak = arr(v.weakTopics).map(s).filter(Boolean);
    if (weak.length) lines.push('', `Revise: ${weak.join(', ')}`);
    return lines.join('\n');
  }

  if (mode === 'flashcards') {
    return arr(v.cards)
      .map((c0, i) => {
        const c = c0 as Record<string, unknown>;
        return `${i + 1}. ${s(c.front)}\n   ${s(c.back)}`;
      })
      .join('\n');
  }

  if (mode === 'plan') {
    const lines: string[] = [];
    if (s(v.summary)) lines.push(s(v.summary));
    arr(v.sessions).forEach((x0) => {
      const x = x0 as Record<string, unknown>;
      const topics = arr(x.topics).map(s).filter(Boolean);
      lines.push(
        `- ${s(x.date)}: ${s(x.focus)}${topics.length ? ` (${topics.join(', ')})` : ''}`
      );
    });
    return lines.join('\n');
  }

  if (mode === 'slides') {
    const lines: string[] = [];
    if (s(v.title)) lines.push(s(v.title));
    if (s(v.subtitle)) lines.push(s(v.subtitle));
    arr(v.slides).forEach((sl0, i) => {
      const sl = sl0 as Record<string, unknown>;
      lines.push('', `Slide ${i + 1}: ${s(sl.heading)}`);
      arr(sl.bullets).forEach((b) => lines.push(`- ${s(b)}`));
      if (s(sl.example)) lines.push(`Example: ${s(sl.example)}`);
    });
    return lines.join('\n');
  }

  return '';
}

/** Map an upstream status/body to a safe client-facing category. */
function categorise(status: number, body: string): ErrorCategory {
  const text = body || '';
  // Quota/billing rejections arrive as 429 and as 403, so both are checked by body
  // before the plain status fallbacks below.
  if (/quota|rate limit|rate_limit|billing|too many requests/i.test(text)) return 'rate_limit';
  if (/invalid_api_key|invalid api key|unauthorized|authentication/i.test(text)) return 'auth';
  if (status === 401) return 'auth';
  if (status === 403) {
    if (/api[_ ]?key|permission|unauthenticated/i.test(text)) return 'auth';
    if (/model/i.test(text)) return 'model_unavailable';
    return 'provider';
  }
  if (status === 404) {
    if (/model/i.test(text)) return 'model_unavailable';
    return 'provider';
  }
  if (status === 429) return 'rate_limit';
  if (status === 400 || status === 422) {
    // A 400/404 naming the model means the model is not usable for this key.
    if (/model/i.test(text) && !/request/i.test(text)) return 'model_unavailable';
    return 'invalid_request';
  }
  return 'provider';
}

/** A thrown fetch error means the provider could not be reached at all. */
function isNetworkError(err: unknown): boolean {
  if (typeof TypeError !== 'undefined' && err instanceof TypeError) return true;
  if (err instanceof Error) {
    return /fetch failed|network|dns|enotfound|econnrefused|econnreset|timed? ?out|socket/i.test(
      err.message
    );
  }
  return false;
}

interface GenerateResult {
  text: string | null;
  finishReason: string | null;
}

/**
 * Ask Groq for a completion. Structured modes request JSON output; if the model
 * rejects that or the token cap, the request is retried once with the offending
 * option removed, so no mode depends on a capability the chosen model lacks.
 */
async function generateWithModel(
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: string }>,
  jsonMode: boolean
): Promise<GenerateResult> {
  let useSpeed = true;
  const attempt = async (useJson: boolean, capTokens: boolean): Promise<GenerateResult> => {
    const payload: Record<string, unknown> = {
      model,
      messages,
      temperature: 0.6,
      ...(useSpeed ? speedOptions(model) : {}),
    };
    // Generous ceiling so a full deck or quiz is never cut off mid-JSON, which is
    // the most common cause of an unparseable structured reply.
    if (capTokens) payload.max_completion_tokens = useJson ? 8192 : 4096;
    if (useJson) payload.response_format = { type: 'json_object' };

    const res = await fetch(GROQ_CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
    });

    const raw = await res.text();
    if (!res.ok) {
      // Status and body are logged server-side only; the key is never logged.
      console.error(`Groq chat failed (${model}):`, res.status, raw.slice(0, 400));
      throw new UpstreamError(res.status, raw);
    }

    let data: {
      choices?: Array<{
        message?: { content?: string };
        finish_reason?: string;
      }>;
    };
    try {
      data = JSON.parse(raw);
    } catch {
      console.error(`Groq returned unparseable JSON (${model})`);
      throw new UpstreamError(502, 'unparseable response');
    }

    const choice = data?.choices?.[0];
    const text = (choice?.message?.content || '').trim() || null;
    return { text, finishReason: choice?.finish_reason || null };
  };

  try {
    return await attempt(jsonMode, true);
  } catch (err) {
    // Some models reject the token cap or the JSON response format. Retry once with
    // that option dropped rather than abandoning the model entirely.
    if (err instanceof UpstreamError && [400, 422].includes(err.status)) {
      // A model that does not accept the speed settings is retried without them.
      if (useSpeed && /reasoning|include_reasoning/i.test(err.body || '')) {
        console.error(`Retrying ${model} without speed options`);
        useSpeed = false;
        return await attempt(jsonMode, true);
      }
      const mentionsOption = /max_completion_tokens|max_tokens|response_format|json/i.test(
        err.body || ''
      );
      if (mentionsOption) {
        console.error(`Retrying ${model} without the rejected generation option`);
        return await attempt(false, !/max_completion_tokens|max_tokens/i.test(err.body || ''));
      }
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json(
      { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' } },
      405
    );
  }

  let supabase: ReturnType<typeof createClient> | null = null;
  let reserved = false;

  try {
    // The key lives only in this server-side function's secrets.
    const apiKey = Deno.env.get('GROQ_API_KEY');
    if (!apiKey) {
      console.error('GROQ_API_KEY is not set for this function environment');
      return fail('not_configured');
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json(
        { ok: false, error: { code: 'UNAUTHENTICATED', message: 'Please sign in to use TaskTrack AI.' } },
        401
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
    if (!supabaseUrl || !supabaseAnonKey) {
      console.error('Supabase environment variables are missing');
      return fail('provider');
    }

    supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) {
      return json(
        { ok: false, error: { code: 'UNAUTHENTICATED', message: 'Please sign in to use TaskTrack AI.' } },
        401
      );
    }

    let body: {
      messages?: Array<{ role: string; content: string }>;
      task?: TaskContext | null;
      aiOption?: string;
      attachmentIds?: string[];
      mode?: string;
    };
    try {
      body = await req.json();
    } catch {
      return fail('invalid_request');
    }

    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return fail('invalid_request');
    }

    // The selected AI option is a product choice; access is re-checked here against
    // the plan read from the database below, never against the browser's claim.
    const aiOption = body.aiOption === 'study-bot' ? 'study-bot' : 'tasktrack-ai';

    // Any attachment the student says is part of this message must exist, belong to
    // them, and be fully processed. Ready documents contribute their extracted
    // chunks (with page references) as grounded context for this answer only.
    const attachmentIds = Array.isArray(body.attachmentIds)
      ? body.attachmentIds.filter((id: unknown): id is string => typeof id === 'string')
      : [];
    let documentContext = '';
    if (attachmentIds.length > 0) {
      const { data: attachedDocs, error: attachError } = await supabase
        .from('documents')
        .select('id, status, owner_id, file_name')
        .in('id', attachmentIds)
        .limit(attachmentIds.length);
      const ready = (attachedDocs ?? []).filter(
        (d: { owner_id?: string; status?: string }) =>
          d.owner_id === userData.user.id && d.status === 'ready'
      );
      if (attachError || ready.length !== attachmentIds.length) {
        return json(
          {
            ok: false,
            error: {
              code: 'ATTACHMENT_NOT_READY',
              message:
                'One of your attached documents is still processing or failed. Check its status in the upload dialog, or send your question without attachments.',
            },
          },
          400
        );
      }

      // Pull the extracted chunks for the ready documents. Owner-scoped by the
      // documents ownership check above plus the owner_id column on chunks.
      const readyIds = ready.map((d: { id: string }) => d.id);
      const { data: chunkRows, error: chunkError } = await supabase
        .from('document_chunks')
        .select('document_id, content, page, char_count')
        .in('document_id', readyIds)
        .order('document_id')
        .order('chunk_index')
        .limit(400);
      if (chunkError) {
        console.error('Document chunks read failed:', chunkError.message);
        return json(
          {
            ok: false,
            error: {
              code: 'ATTACHMENT_READ_FAILED',
              message: 'Your attached documents could not be read right now. Please try again.',
            },
          },
          502
        );
      }

      const nameById = new Map(
        ready.map((d: { id: string; file_name: string }) => [d.id, d.file_name])
      );
      const perDoc: string[] = [];
      let currentDoc = '';
      let docText: string[] = [];
      const flushDoc = () => {
        if (currentDoc && docText.length > 0) {
          perDoc.push(`Document: ${currentDoc}\n${docText.join('\n')}`);
        }
      };
      for (const row of chunkRows ?? []) {
        const c = row as { document_id: string; content: string; page: number | null };
        const name = nameById.get(c.document_id) || 'Document';
        if (name !== currentDoc) {
          flushDoc();
          currentDoc = name;
          docText = [];
        }
        docText.push(c.page ? `[page ${c.page}] ${c.content}` : c.content);
      }
      flushDoc();
      // Cap the grounded context sent to the model.
      documentContext = perDoc.join('\n\n').slice(0, 60_000);
    }

    const mode =
      typeof body.mode === 'string' && DEFINED_MODES.has(body.mode) ? body.mode : 'chat';

    // Plan and limits come from the database, never from the request.
    const { data: profile } = await supabase
      .from('profiles')
      .select('plan, plan_expires_at')
      .eq('id', userData.user.id)
      .maybeSingle();

    const expired =
      profile?.plan_expires_at && new Date(profile.plan_expires_at).getTime() <= Date.now();
    const planId = profile?.plan === 'pro' && !expired ? 'pro' : 'free';

    // Premium-only AI option: the request is rejected before any limit is charged.
    if (aiOption === 'study-bot' && planId !== 'pro') {
      return json(
        {
          ok: false,
          error: {
            code: 'PREMIUM_REQUIRED',
            message: 'Study Bot is part of Premium. Upgrade to unlock Study Bot.',
          },
        },
        403
      );
    }

    const { data: limitsRow } = await supabase
      .from('plan_limits')
      .select('daily_ai_messages, max_message_chars')
      .eq('plan', planId)
      .maybeSingle();

    const maxChars = limitsRow?.max_message_chars ?? FALLBACK_LIMITS.max_message_chars;

    const lastUserMessage = [...body.messages].reverse().find((m) => m.role === 'user');
    if (!lastUserMessage || typeof lastUserMessage.content !== 'string' || !lastUserMessage.content.trim()) {
      return fail('invalid_request');
    }
    if (lastUserMessage.content.length > maxChars) {
      return json(
        {
          ok: false,
          error: {
            code: 'INVALID_REQUEST',
            message: `Your message is too long. Please keep it under ${maxChars.toLocaleString()} characters.`,
          },
        },
        400
      );
    }

    // If the task does not name a real topic, ask for clarification instead of
    // inventing topic-specific material. This runs before the daily limit is
    // charged, so a clarification never costs the student one of their messages.
    const generalOverview = asksForGeneralOverview(body.messages);
    if (
      CLARIFICATION_MODES.has(mode) &&
      !generalOverview &&
      !taskHasIdentifiableTopic(body.task)
    ) {
      return succeed({ mode, text: buildClarificationReply(mode) });
    }

    // Reserve one AI request against today's limit before calling the provider.
    const { data: reserveData, error: reserveError } = await supabase.rpc('reserve_ai_request');
    if (reserveError) {
      console.error('AI usage reservation failed:', reserveError.message);
      return fail('provider');
    }
    const reservation = Array.isArray(reserveData) ? reserveData[0] : reserveData;
    if (!reservation?.allowed) {
      return fail('limit', {
        limitReached: true,
        used: reservation?.used,
        dailyLimit: reservation?.daily_limit,
      });
    }
    reserved = true;

    const today = new Date().toISOString().slice(0, 10);
    const jsonMode = Boolean(STRUCTURED_MODES[mode]);
    // Free and Premium get different quiz/flashcard sizes, driven by the plan read
    // from the database above rather than anything the client sends.
    const counts = MODE_COUNTS[planId];
    const systemPrompt = buildSystemPrompt(
      body.task ?? null,
      mode,
      today,
      generalOverview,
      counts,
      body.messages.length > 1
    );
    // System prompt plus this session's own history, so context is never repeated.
    // Attached ready documents contribute grounded, page-referenced context.
    const groundedSystem = documentContext
      ? `${systemPrompt}\n\nThe student attached document(s) to this session. Their extracted text follows, with [page N] markers. Ground your answers in this material — quote or cite the page when you use it. If the answer is not in the documents, say so plainly instead of guessing.\n\n--- ATTACHED DOCUMENTS ---\n${documentContext}\n--- END DOCUMENTS ---`
      : systemPrompt;
    const messages = [
      { role: 'system', content: groundedSystem },
      ...body.messages
        .filter((m) => m && typeof m.content === 'string' && m.content.trim())
        .map((m) => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content,
        })),
    ];

    // Study Bot is pinned to one specific model. When the key cannot serve it, the
    // request fails with an explicit unavailable error and the reservation is
    // refunded — the default assistant is never served under the Study Bot label.
    let models: ProviderModel[];
    try {
      models = await resolveModels(apiKey);
    } catch (err) {
      const category = err instanceof UpstreamError ? categorise(err.status, err.body) : 'provider';
      return await refundAndFail(supabase, category);
    }

    if (aiOption === 'study-bot') {
      if (!models.some((m) => m.name === STUDY_BOT_MODEL)) {
        console.error('Study Bot model is not available for this API key:', STUDY_BOT_MODEL);
        return await refundAndFail(supabase, 'study_bot_unavailable');
      }
      models = models.filter((m) => m.name === STUDY_BOT_MODEL);
    }

    if (models.length === 0) {
      console.error('No usable Groq chat models were returned for this API key');
      return await refundAndFail(supabase, 'model_unavailable');
    }

    const failures: ErrorCategory[] = [];
    let reply: string | null = null;
    let finishReason: string | null = null;
    let usedModel: string | null = null;
    // Set when a structured request already fell back to plain text inside the loop,
    // so the post-loop retry is not fired a second time.
    let plainFallbackUsed = false;

    for (const model of models.slice(0, MAX_MODEL_ATTEMPTS)) {
      const wantsJson = jsonMode && model.supportsJson;
      try {
        const result = await generateWithModel(apiKey, model.name, messages, wantsJson);
        if (result.text) {
          reply = result.text;
          finishReason = result.finishReason;
          usedModel = model.name;
          break;
        }
        // Empty response (e.g. blocked): try the next model, but remember that an
        // empty reply is its own user-facing category.
        failures.push('empty');
      } catch (err) {
        // A model that rejects JSON output is retried once as plain text on the same
        // model rather than being abandoned, so structured modes always have a path.
        if (err instanceof UpstreamError && [400, 422].includes(err.status) && wantsJson) {
          try {
            const fallback = await generateWithModel(apiKey, model.name, messages, false);
            if (fallback.text) {
              reply = fallback.text;
              finishReason = fallback.finishReason;
              usedModel = model.name;
              plainFallbackUsed = true;
              break;
            }
            failures.push('empty');
            continue;
          } catch (retryErr) {
            if (!(retryErr instanceof UpstreamError)) {
              console.error('Groq call threw:', retryErr instanceof Error ? retryErr.message : 'unknown');
            }
          }
        }
        if (err instanceof UpstreamError) {
          const category = categorise(err.status, err.body);
          failures.push(category);
          // Quota is usually per model, so a 429 for one model does not mean the others
          // are exhausted. Keep going and only stop when the key itself is rejected.
          if (category === 'auth') break;
        } else {
          console.error('Groq call threw:', err instanceof Error ? err.message : 'unknown');
          failures.push('provider');
        }
      }
    }

    if (!reply) {
      const category = pickFailureCategory(failures);
      return await refundAndFail(supabase, category);
    }
    // A reply that is only whitespace is treated exactly like an empty response.
    if (!reply.trim()) {
      return await refundAndFail(supabase, 'empty');
    }
    if (finishReason && finishReason !== 'stop') {
      console.error(`Groq stopped early (${finishReason}) but returned text; using it`);
    }

    if (jsonMode) {
      const structured = parseStructured(reply);
      if (structured) {
        return succeed({
          mode,
          structured,
          // A readable plain-text version accompanies the cards so the client always
          // has a safe fallback. The raw JSON is never sent to the browser.
          text: structuredToText(mode, structured),
          usage: { used: reservation.used, dailyLimit: reservation.daily_limit },
        });
      }

      console.error(`Structured mode '${mode}' returned unparseable JSON; retrying as plain text`);
      if (!plainFallbackUsed && usedModel) {
        // Retry once as plain text and show that instead of raw JSON, exactly as
        // specified for a failed structured response.
        try {
          const retry = await generateWithModel(apiKey, usedModel, messages, false);
          if (retry.text && retry.text.trim()) {
            return succeed({
              mode,
              text: looksLikeJson(retry.text) ? STRUCTURED_RETRY_TEXT : retry.text,
              usage: { used: reservation.used, dailyLimit: reservation.daily_limit },
            });
          }
        } catch (retryErr) {
          console.error(
            'Plain-text retry failed:',
            retryErr instanceof Error ? retryErr.message : 'unknown'
          );
        }
      }
      return succeed({
        mode,
        text: looksLikeJson(reply) ? STRUCTURED_RETRY_TEXT : reply,
        usage: { used: reservation.used, dailyLimit: reservation.daily_limit },
      });
    }

    return succeed({
      mode,
      text: reply,
      usage: { used: reservation.used, dailyLimit: reservation.daily_limit },
    });
  } catch (err) {
    console.error('Study session request failed:', err instanceof Error ? err.message : 'unknown error');
    // A fetch that never reached the provider is a genuine connection problem, not a
    // provider fault, so it gets its own category rather than a generic 502.
    const category: ErrorCategory = isNetworkError(err) ? 'network' : 'provider';
    if (supabase && reserved) return await refundAndFail(supabase, category);
    return fail(category);
  }
});

/** The most useful category to report when every model attempt failed. */
function pickFailureCategory(failures: ErrorCategory[]): ErrorCategory {
  if (failures.includes('auth')) return 'auth';
  if (failures.includes('rate_limit')) return 'rate_limit';
  if (failures.includes('invalid_request')) return 'invalid_request';
  const nonModel = failures.filter((c) => c !== 'model_unavailable');
  if (nonModel.length > 0) return nonModel[nonModel.length - 1];
  return 'model_unavailable';
}

async function refundAndFail(
  supabase: ReturnType<typeof createClient>,
  category: ErrorCategory
) {
  // A failed request must not count against the daily limit.
  const { error } = await supabase.rpc('refund_ai_request');
  if (error) console.error('AI usage refund failed:', error.message);
  return fail(category);
}
