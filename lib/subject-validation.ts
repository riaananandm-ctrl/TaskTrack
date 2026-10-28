/**
 * Subject-title validation shared between the frontend and the database CHECK
 * constraint. The rule is about length and structure, not about whether a word
 * sounds academic — "Skibidi" is just as valid as "Mathematics".
 *
 * Limits:
 *  - 1–5 words (split on whitespace after normalising)
 *  - 1–60 characters
 *  - Letters (including Unicode), numbers, spaces, hyphens, apostrophes,
 *    ampersands, periods, parentheses only
 *  - No control characters, HTML tags, or script content
 */

export const SUBJECT_MAX_WORDS = 5;
export const SUBJECT_MAX_CHARS = 60;

/** Characters allowed in a subject name. */
const ALLOWED_PATTERN = /^[\p{L}\p{N}\s\-'.&()]+$/u;

/** Tags and control characters that must never appear in a subject name. */
const BLOCKED_PATTERN = /<[\w/!?]+>|\x00-\x1f|\x7f/i;

export interface SubjectValidationResult {
  ok: boolean;
  error: string | null;
  wordCount: number;
  normalized: string;
}

/** Collapse repeated spaces and trim. */
export function normalizeSubjectName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

/** Count words in a normalised subject name. Empty string = 0 words. */
export function countSubjectWords(name: string): number {
  const trimmed = name.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * Validate a subject name. Returns a result with the normalised name, word count,
 * and a user-facing error if invalid.
 */
export function validateSubjectName(raw: string): SubjectValidationResult {
  const normalized = normalizeSubjectName(raw);
  const wordCount = countSubjectWords(normalized);

  if (!normalized) {
    return { ok: false, error: 'Subject name cannot be empty.', wordCount: 0, normalized };
  }
  if (normalized.length > SUBJECT_MAX_CHARS) {
    return { ok: false, error: `Subject names can be up to ${SUBJECT_MAX_CHARS} characters.`, wordCount, normalized };
  }
  if (wordCount > SUBJECT_MAX_WORDS) {
    return { ok: false, error: `Subject names can contain up to ${SUBJECT_MAX_WORDS} words.`, wordCount, normalized };
  }
  if (BLOCKED_PATTERN.test(normalized)) {
    return { ok: false, error: 'Subject names cannot contain code or control characters.', wordCount, normalized };
  }
  if (!ALLOWED_PATTERN.test(normalized)) {
    return { ok: false, error: 'Subject names can only contain letters, numbers, spaces, and basic punctuation.', wordCount, normalized };
  }

  return { ok: true, error: null, wordCount, normalized };
}

/** Quick boolean for form gating. */
export function isValidSubjectName(raw: string): boolean {
  return validateSubjectName(raw).ok;
}
