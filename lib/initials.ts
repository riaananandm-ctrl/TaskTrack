/**
 * Up to two initials for an avatar. Works on whole characters, so a name that starts
 * with an emoji ("🔥 Riya") or an accented or non-Latin letter shows that character
 * instead of half of it (which renders as a broken "�" box).
 */
export function initialsOf(name: string | null | undefined, email?: string | null): string {
  const source = (name || '').trim() || (email || '').trim() || '?';
  const firstChar = (word: string): string => {
    try {
      const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(s: string): Iterable<{ segment: string }> } }).Segmenter;
      if (Seg) {
        const first = Array.from(new Seg(undefined, { granularity: 'grapheme' }).segment(word))[0];
        if (first) return first.segment;
      }
    } catch {
      // fall through to the code-point split below
    }
    return Array.from(word)[0] ?? '';
  };
  const letters = source
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(firstChar)
    .join('')
    .toUpperCase();
  return letters || '?';
}

/** Longest name we store; a 5,000-word "name" is cut before it reaches the database. */
export const MAX_NAME_LENGTH = 80;
export const MAX_SCHOOL_LENGTH = 120;

/** Trims and collapses spaces; returns '' for a name made only of spaces. */
export function cleanName(raw: string, max = MAX_NAME_LENGTH): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, max);
}
