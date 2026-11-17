/** Pure helpers for Rewrite Coach suggestions (no network, safe to test). */

export interface CoachSuggestion {
  id: string;
  start: number;
  end: number;
  original: string;
  replacement: string;
  type: string;
  why: string;
  major: boolean;
}

/**
 * Keeps only suggestions whose offsets still point at their quoted original in
 * `text`, and drops any that overlap an earlier one. Sorted by position.
 */
export function validSuggestions(text: string, suggestions: CoachSuggestion[]): CoachSuggestion[] {
  const sorted = [...suggestions].sort((a, b) => a.start - b.start);
  const out: CoachSuggestion[] = [];
  let lastEnd = -1;
  for (const s of sorted) {
    if (s.start < 0 || s.end > text.length || s.start >= s.end) continue;
    if (text.slice(s.start, s.end) !== s.original) continue;
    if (s.start < lastEnd) continue;
    out.push(s);
    lastEnd = s.end;
  }
  return out;
}

/** Applies the accepted suggestions to `text`. Never mutates the input. */
export function applySuggestions(text: string, suggestions: CoachSuggestion[], accepted: Set<string>): string {
  const chosen = validSuggestions(text, suggestions).filter((s) => accepted.has(s.id));
  let out = '';
  let cursor = 0;
  for (const s of chosen) {
    out += text.slice(cursor, s.start) + s.replacement;
    cursor = s.end;
  }
  return out + text.slice(cursor);
}

/** Splits text into plain runs and suggestion runs, for highlighting. */
export function segments(text: string, suggestions: CoachSuggestion[]): { text: string; suggestion?: CoachSuggestion }[] {
  const out: { text: string; suggestion?: CoachSuggestion }[] = [];
  let cursor = 0;
  for (const s of validSuggestions(text, suggestions)) {
    if (s.start > cursor) out.push({ text: text.slice(cursor, s.start) });
    out.push({ text: s.original, suggestion: s });
    cursor = s.end;
  }
  if (cursor < text.length) out.push({ text: text.slice(cursor) });
  return out;
}
