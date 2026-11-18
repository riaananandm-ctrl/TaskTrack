// Study Session modes, their structured result shapes, and defensive parsers.
// The server asks Gemini for strict JSON in these modes; everything here validates
// the payload before it reaches the UI so malformed data never breaks rendering.

export type StudyMode =
  | 'chat' | 'explain' | 'quiz' | 'flashcards' | 'plan' | 'examples' | 'slides' | 'practice' | 'videos'
  | 'hints' | 'teachback' | 'commandterms' | 'mistakes' | 'speed' | 'memory' | 'debate' | 'essayplan'
  | 'language' | 'summarise';

/** Who the student is talking to. Santa only appears while Christmas mode is on. */
export type AiPersona = 'friend' | 'teacher' | 'hype' | 'santa';

export const PERSONAS: { id: AiPersona; label: string; emoji: string; blurb: string }[] = [
  { id: 'friend', label: 'Chill friend', emoji: '😎', blurb: 'Relaxed, jokes a bit' },
  { id: 'teacher', label: 'Strict teacher', emoji: '📚', blurb: 'No fluff, pushes you' },
  { id: 'hype', label: 'Hype coach', emoji: '🔥', blurb: 'Big energy, celebrates wins' },
  { id: 'santa', label: 'Santa', emoji: '🎅', blurb: 'Ho ho ho, festive help' },
];

export interface StudyTask {
  taskId?: string | null;
  title: string;
  subject?: string | null;
  description?: string | null;
  category?: string | null;
  dueDate?: string | null;
  estimatedMinutes?: number | null;
  priority?: string | null;
}

/**
 * Full task context forwarded to the Study Session API, so the student never has
 * to repeat anything the app already knows about the task.
 */
export function toTaskContext(task: StudyTask) {
  return {
    taskId: task.taskId ?? null,
    title: task.title,
    subject: task.subject ?? null,
    description: task.description ?? null,
    category: task.category ?? null,
    dueDate: task.dueDate ?? null,
    estimatedMinutes: task.estimatedMinutes ?? null,
    priority: task.priority ?? null,
  };
}

export interface ModeOption {
  id: StudyMode;
  label: string;
  /** Message sent on the student's behalf when they pick this option. */
  prompt: string;
  /** True when the server returns structured JSON that drives a custom view. */
  structured: boolean;
}

export const MODE_OPTIONS: ModeOption[] = [
  {
    id: 'explain',
    label: 'Explain this topic',
    prompt: 'Explain this topic in simple terms.',
    structured: false,
  },
  {
    id: 'flashcards',
    label: 'Make flashcards',
    prompt: 'Make flashcards for this topic.',
    structured: true,
  },
  {
    id: 'quiz',
    label: 'Quiz me',
    prompt: 'Quiz me on this topic.',
    structured: true,
  },
  {
    id: 'plan',
    label: 'Create a study plan',
    prompt: 'Create a study plan for this task.',
    structured: true,
  },
  {
    id: 'practice',
    label: 'Practise exam questions',
    prompt: 'Give me an exam-style practice question on this topic.',
    structured: false,
  },
  {
    id: 'examples',
    label: 'Show worked examples',
    prompt: 'Show me worked examples for this topic.',
    structured: false,
  },
  {
    id: 'slides',
    label: 'Create study slides',
    prompt: 'Create study slides for this topic.',
    structured: true,
  },
  {
    id: 'videos',
    label: 'Find videos',
    prompt: 'Suggest YouTube videos to help me learn this topic.',
    structured: true,
  },
  { id: 'hints', label: 'Help me figure it out', prompt: 'Help me figure this out myself. Don’t give me the answer, just hints.', structured: false },
  { id: 'teachback', label: 'Teach it back', prompt: 'I want to explain this topic back to you so you can check my understanding.', structured: false },
  { id: 'commandterms', label: 'Command terms coach', prompt: 'Coach me on the IB command terms for this task.', structured: false },
  { id: 'mistakes', label: 'Mistake doctor', prompt: 'I want to find where my answer went wrong.', structured: false },
  { id: 'speed', label: 'Speed round', prompt: 'Start a 60-second speed round on this topic!', structured: true },
  { id: 'memory', label: 'Memory tricks', prompt: 'Give me memory tricks to remember this topic.', structured: false },
  { id: 'debate', label: 'Debate me', prompt: 'Debate me on this topic. Take the other side.', structured: false },
  { id: 'essayplan', label: 'Essay planner', prompt: 'Help me plan my essay for this task.', structured: false },
  { id: 'language', label: 'Language partner', prompt: 'Let’s practise this language with a conversation at my level.', structured: false },
  { id: 'summarise', label: 'Summarise my notes', prompt: 'I want to summarise my notes.', structured: false },
];

/** One-line description for each study tool, shown in the suggestion pop-up and tool list. */
export const MODE_BLURBS: Partial<Record<StudyMode, string>> = {
  explain: 'A clear, simple explanation of the topic.',
  quiz: 'A quick multiple-choice quiz that earns XP.',
  practice: 'Exam-style questions marked like an IB examiner.',
  hints: 'Hints and guiding questions, so you crack it yourself.',
  teachback: 'Explain it in your own words and the AI checks what you missed.',
  commandterms: 'Learn what Describe, Explain, Evaluate and the rest really want.',
  mistakes: 'Paste a wrong answer and find the exact step that went wrong.',
  speed: '10 rapid-fire questions in 60 seconds. Earns XP.',
  memory: 'Mnemonics and silly stories that make facts stick.',
  debate: 'The AI argues the other side so your argument gets stronger.',
  essayplan: 'Thesis, structure and evidence. You do the writing.',
  language: 'A conversation in the language at your level, with gentle corrections.',
  summarise: 'Paste your notes and get a one-page summary.',
  videos: 'Educational videos you can watch right here.',
};

export function getModeOption(mode: StudyMode): ModeOption | undefined {
  return MODE_OPTIONS.find((m) => m.id === mode);
}

/**
 * The seven study modes in the session selector. Each id is the exact backend value
 * sent with the next request; Chat is the default and is not a quick action.
 */
export const MODE_SELECT_OPTIONS: { id: StudyMode; label: string }[] = [
  { id: 'chat', label: 'Chat' },
  { id: 'explain', label: 'Explain' },
  { id: 'quiz', label: 'Quiz' },
  { id: 'flashcards', label: 'Flashcards' },
  { id: 'plan', label: 'Study plan' },
  { id: 'practice', label: 'Exam practice' },
  { id: 'examples', label: 'Worked examples' },
  { id: 'slides', label: 'Study slides' },
  { id: 'videos', label: 'Videos' },
  { id: 'hints', label: 'Help me figure it out' },
  { id: 'teachback', label: 'Teach it back' },
  { id: 'commandterms', label: 'Command terms coach' },
  { id: 'mistakes', label: 'Mistake doctor' },
  { id: 'speed', label: 'Speed round' },
  { id: 'memory', label: 'Memory tricks' },
  { id: 'debate', label: 'Debate me' },
  { id: 'essayplan', label: 'Essay planner' },
  { id: 'language', label: 'Language partner' },
  { id: 'summarise', label: 'Summarise my notes' },
];

export function modeLabel(mode: StudyMode): string {
  return getModeOption(mode)?.label ?? 'TaskTrack AI';
}

// ---------------------------------------------------------------------------
// Structured result shapes
// ---------------------------------------------------------------------------

export interface QuizQuestion {
  question: string;
  options: string[];
  answerIndex: number;
  explanation: string;
}

export interface QuizData {
  questions: QuizQuestion[];
  weakTopics: string[];
}

export interface Flashcard {
  front: string;
  back: string;
}

export interface FlashcardsData {
  cards: Flashcard[];
}

export interface PlanVideo {
  title: string;
  channel: string;
  /** YouTube search words; the app links to a search so a link can never be dead. */
  search: string;
}

export interface PlanSession {
  date: string;
  focus: string;
  topics: string[];
  minutes: number | null;
  videos?: PlanVideo[];
  practice?: string;
  check?: string;
}

/** A YouTube search link for a suggested video. */
export function youtubeSearchUrl(v: PlanVideo): string {
  const q = v.search || [v.title, v.channel].filter(Boolean).join(' ');
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
}

export interface StudyPlanData {
  compressed: boolean;
  summary: string;
  sessions: PlanSession[];
}

export interface SuggestedVideo extends PlanVideo {
  why: string;
  watchFor: string;
  minutes: number | null;
}

export interface VideosData {
  videos: SuggestedVideo[];
}

export interface Slide {
  heading: string;
  bullets: string[];
  example: string | null;
  /** Speaker notes: what to say or remember for this slide. */
  notes?: string | null;
}

export interface SlidesData {
  title: string;
  subtitle: string;
  slides: Slide[];
}

// ---------------------------------------------------------------------------
// Parsers — each returns null when the payload does not match the expected shape
// ---------------------------------------------------------------------------

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map(str).filter(Boolean) : [];
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export function parseQuiz(v: unknown): QuizData | null {
  const root = obj(v);
  if (!root || !Array.isArray(root.questions)) return null;
  const questions: QuizQuestion[] = [];
  for (const raw of root.questions) {
    const q = obj(raw);
    if (!q) continue;
    const question = str(q.question);
    const options = strArray(q.options);
    if (!question || options.length < 2) continue;
    const rawIndex = typeof q.answerIndex === 'number' ? q.answerIndex : Number(q.answerIndex);
    questions.push({
      question,
      options,
      answerIndex: Number.isInteger(rawIndex) && rawIndex >= 0 && rawIndex < options.length ? rawIndex : 0,
      explanation: str(q.explanation),
    });
  }
  if (questions.length === 0) return null;
  return { questions, weakTopics: strArray(root.weakTopics) };
}

export function parseFlashcards(v: unknown): FlashcardsData | null {
  const root = obj(v);
  if (!root || !Array.isArray(root.cards)) return null;
  const cards: Flashcard[] = [];
  for (const raw of root.cards) {
    const c = obj(raw);
    if (!c) continue;
    const front = str(c.front);
    const back = str(c.back);
    if (front && back) cards.push({ front, back });
  }
  return cards.length > 0 ? { cards } : null;
}

export function parsePlan(v: unknown): StudyPlanData | null {
  const root = obj(v);
  if (!root || !Array.isArray(root.sessions)) return null;
  const sessions: PlanSession[] = [];
  for (const raw of root.sessions) {
    const s = obj(raw);
    if (!s) continue;
    const date = str(s.date);
    const focus = str(s.focus);
    if (!date || !focus) continue;
    const minutes = typeof s.minutes === 'number' ? s.minutes : Number(s.minutes);
    sessions.push({
      date,
      focus,
      topics: strArray(s.topics),
      minutes: Number.isFinite(minutes) && minutes > 0 ? minutes : null,
      videos: (Array.isArray(s.videos) ? s.videos : [])
        .map(obj)
        .filter((x): x is Record<string, unknown> => !!x)
        .map((x) => ({ title: str(x.title).slice(0, 140), channel: str(x.channel).slice(0, 60), search: str(x.search).slice(0, 140) }))
        .filter((x) => x.title || x.search)
        .slice(0, 2),
      practice: str(s.practice).slice(0, 400),
      check: str(s.check).slice(0, 300),
    });
  }
  return sessions.length > 0
    ? { compressed: root.compressed === true, summary: str(root.summary), sessions }
    : null;
}

export function parseVideos(v: unknown): VideosData | null {
  const root = obj(v);
  if (!root || !Array.isArray(root.videos)) return null;
  const videos: SuggestedVideo[] = [];
  for (const raw of root.videos) {
    const x = obj(raw);
    if (!x) continue;
    const title = str(x.title).slice(0, 140);
    const search = str(x.search).slice(0, 140);
    if (!title && !search) continue;
    const minutes = typeof x.minutes === 'number' ? x.minutes : Number(x.minutes);
    videos.push({
      title,
      search,
      channel: str(x.channel).slice(0, 60),
      why: str(x.why).slice(0, 240),
      watchFor: str(x.watchFor).slice(0, 240),
      minutes: Number.isFinite(minutes) && minutes > 0 && minutes <= 120 ? Math.round(minutes) : null,
    });
  }
  return videos.length > 0 ? { videos: videos.slice(0, 6) } : null;
}

export function parseSlides(v: unknown): SlidesData | null {
  const root = obj(v);
  if (!root || !Array.isArray(root.slides)) return null;
  const slides: Slide[] = [];
  for (const raw of root.slides) {
    const s = obj(raw);
    if (!s) continue;
    const heading = str(s.heading);
    const bullets = strArray(s.bullets);
    if (!heading || bullets.length === 0) continue;
    slides.push({ heading, bullets, example: str(s.example) || null, notes: str(s.notes) || null });
  }
  return slides.length > 0
    ? { title: str(root.title), subtitle: str(root.subtitle), slides }
    : null;
}

/** Parse any structured mode result, returning null when the shape is wrong. */
export function parseStructuredResult(mode: StudyMode, v: unknown): unknown | null {
  switch (mode) {
    case 'quiz':
    case 'speed':
      return parseQuiz(v);
    case 'flashcards':
      return parseFlashcards(v);
    case 'plan':
      return parsePlan(v);
    case 'slides':
      return parseSlides(v);
    case 'videos':
      return parseVideos(v);
    default:
      return null;
  }
}

/** Modes whose output is drawn as interactive cards rather than prose. */
export const STRUCTURED_VIEW_MODES: Set<StudyMode> = new Set<StudyMode>([
  'quiz',
  'flashcards',
  'plan',
  'slides',
  'videos',
  'speed',
]);

/** True when text is a JSON blob rather than something a student should read. */
export function looksLikeJson(text: string): boolean {
  return /^\s*[{[]/.test(text);
}

/**
 * Never show raw JSON. When a structured mode has no cards to draw and no readable
 * plain-text fallback, a short retry notice is shown in place of the payload.
 */
export function displayContent(
  mode: StudyMode | null,
  content: string,
  hasStructured: boolean
): string {
  if (mode && STRUCTURED_VIEW_MODES.has(mode) && !hasStructured) {
    if (!content.trim() || looksLikeJson(content)) {
      return 'I could not format that response properly. Please ask me to try again.';
    }
  }
  return content;
}

/** XP the server gives for a quiz: 5 per correct answer, +10 for a perfect score. */
export function quizXp(score: number, total: number): number {
  const t = Math.min(Math.max(total, 0), 20);
  const sc = Math.min(Math.max(score, 0), t);
  return sc * 5 + (t >= 3 && sc === t ? 10 : 0);
}

// ---------------------------------------------------------------------------
// Suggesting a study tool from the task
// ---------------------------------------------------------------------------

const LANGUAGE_WORDS = /\b(spanish|espa[nñ]ol|french|fran[cç]ais|german|deutsch|italian|mandarin|chinese|japanese|korean|hindi|arabic|portuguese|latin|language acquisition|language b|ab initio)\b/i;
const ESSAY_WORDS = /\b(essay|commentary|extended essay|ee|tok|written task|literary|analysis|analyse|analyze|report|write[- ]?up|reflection|ia|internal assessment)\b/i;
const DEBATE_WORDS = /\b(debate|argument|argumentative|persuasive|speech|to what extent|discuss|global politics|ethics|controversy|opinion)\b/i;
const MEMORY_WORDS = /\b(vocab|vocabulary|definitions?|key terms|memori[sz]e|recall|periodic table|dates|glossary|formulae|formulas)\b/i;
const TEST_WORDS = /\b(test|exam|quiz|paper\s*\d|summative|mock|assessment)\b/i;
const MATHS_WORDS = /\b(math|maths|mathematics|physics|chemistry|calculus|algebra|equation|problem set|worksheet|calculate)\b/i;
const NOTES_WORDS = /\b(notes|reading|chapter|textbook|article)\b/i;

/**
 * Picks the one study tool most likely to help with this task, from its subject,
 * title and description. Pure, so it's testable.
 */
export function suggestMode(task: Pick<StudyTask, 'title' | 'subject' | 'description' | 'category'>): StudyMode {
  const subject = task.subject ?? '';
  const text = `${task.title ?? ''} ${task.description ?? ''}`.slice(0, 2000);
  const all = `${subject} ${text}`;
  if (LANGUAGE_WORDS.test(subject) || /\blanguage\b/i.test(subject)) return 'language';
  if (DEBATE_WORDS.test(text)) return 'debate';
  if (ESSAY_WORDS.test(text) || task.category === 'project') return 'essayplan';
  if (MEMORY_WORDS.test(all)) return 'memory';
  if (MATHS_WORDS.test(all)) return TEST_WORDS.test(text) ? 'practice' : 'hints';
  if (TEST_WORDS.test(text) || task.category === 'summative_assessment') return 'speed';
  if (NOTES_WORDS.test(text)) return 'summarise';
  return 'teachback';
}

/** Why the suggestion fits, in a few words, for the pop-up. */
export function suggestionReason(mode: StudyMode, task: Pick<StudyTask, 'subject'>): string {
  const subject = task.subject?.trim();
  switch (mode) {
    case 'language': return `Practise ${subject || 'the language'} by actually chatting in it.`;
    case 'debate': return 'This task is about arguing a point. Test yours against the AI.';
    case 'essayplan': return 'Get your thesis and structure sorted before you write.';
    case 'memory': return 'Lots to remember here. Tricks make it stick.';
    case 'practice': return 'Exam questions, marked like the real thing.';
    case 'hints': return 'Work through problems with hints instead of answers.';
    case 'speed': return 'A test is coming. A 60-second speed round shows what you know.';
    case 'summarise': return 'Turn your notes into a one-page summary.';
    default: return 'Explaining it in your own words is the fastest way to learn it.';
  }
}

/** Short follow-up replies shown under the AI's latest answer. */
export function replyChips(mode: StudyMode | null): { label: string; text: string; mode?: StudyMode }[] {
  switch (mode) {
    case 'hints': return [
      { label: 'Another hint', text: 'Give me another hint.' },
      { label: 'Next step', text: 'What’s the next step? Still don’t give me the full answer.' },
      { label: 'Give me a similar one', text: 'Give me a similar problem to try.' },
    ];
    case 'practice': return [
      { label: 'Hint please', text: 'Can I have a hint?' },
      { label: 'Next question', text: 'Next question please.' },
      { label: 'Harder', text: 'Make the next one harder.' },
    ];
    case 'language': return [
      { label: 'Correct me', text: 'Correct all my mistakes so far and explain them briefly.' },
      { label: 'Harder', text: 'Make it a bit harder.' },
      { label: 'Translate that', text: 'Translate your last message into English.' },
    ];
    case 'debate': return [
      { label: 'Argue harder', text: 'Push back harder on my argument.' },
      { label: 'Who’s winning?', text: 'Judge the debate so far. Whose argument is stronger and why?' },
      { label: 'Switch sides', text: 'Switch sides. Now I’ll argue against what I said.' },
    ];
    case 'teachback': return [
      { label: 'What did I miss?', text: 'What did I miss or get wrong?' },
      { label: 'Ask me something', text: 'Ask me a question to test me.' },
    ];
    case 'commandterms': return [
      { label: 'Test me', text: 'Give me a question with a command term and check my answer.' },
      { label: 'Next term', text: 'Teach me the next command term.' },
    ];
    case 'memory': return [
      { label: 'Another trick', text: 'Give me a different memory trick.' },
      { label: 'Test me', text: 'Quiz me on this.', mode: 'quiz' },
    ];
    case 'essayplan': return [
      { label: 'Check my thesis', text: 'Here is my thesis, is it strong enough?' },
      { label: 'Next part', text: 'What should I plan next?' },
    ];
    default: return [
      { label: 'Simpler please', text: 'Explain that more simply.' },
      { label: 'Give me an example', text: 'Give me an example.' },
      { label: 'Quiz me on this', text: 'Quiz me on this.', mode: 'quiz' },
    ];
  }
}
