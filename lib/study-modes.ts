// Study Session modes, their structured result shapes, and defensive parsers.
// The server asks Gemini for strict JSON in these modes; everything here validates
// the payload before it reaches the UI so malformed data never breaks rendering.

export type StudyMode = 'chat' | 'explain' | 'quiz' | 'flashcards' | 'plan' | 'examples' | 'slides';

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
];

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
  { id: 'examples', label: 'Worked examples' },
  { id: 'slides', label: 'Study slides' },
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

export interface PlanSession {
  date: string;
  focus: string;
  topics: string[];
  minutes: number | null;
}

export interface StudyPlanData {
  compressed: boolean;
  summary: string;
  sessions: PlanSession[];
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
    });
  }
  return sessions.length > 0
    ? { compressed: root.compressed === true, summary: str(root.summary), sessions }
    : null;
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
      return parseQuiz(v);
    case 'flashcards':
      return parseFlashcards(v);
    case 'plan':
      return parsePlan(v);
    case 'slides':
      return parseSlides(v);
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
