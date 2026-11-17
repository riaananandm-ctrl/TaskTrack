/**
 * Picks about five minutes of flashcards (15 cards) for the daily review.
 * Pure, so it's testable.
 *
 * Order: cards that are due, with cards about the student's weak topics (from
 * their exam practice quizzes) first, then the cards they find hardest (lowest
 * Leitner box, most wrong answers). If fewer than the limit are due, weak-topic
 * cards that aren't due yet top it up.
 */

export interface PickableCard {
  id: string;
  front: string;
  back: string;
  box: number;
  due_at: string;
  times_wrong: number;
}

export const DAILY_REVIEW_SIZE = 15;

const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'your', 'about']);

/** Lower-case keywords (4+ letters) from the weak topic names. */
export function topicWords(weakTopics: string[]): string[] {
  const words = new Set<string>();
  for (const t of weakTopics) {
    for (const w of t.toLowerCase().split(/[^a-z0-9]+/)) {
      if (w.length >= 4 && !STOP.has(w)) words.add(w);
    }
  }
  return Array.from(words);
}

export function matchesWeakTopic(card: PickableCard, words: string[]): boolean {
  if (!words.length) return false;
  const text = `${card.front} ${card.back}`.toLowerCase();
  return words.some((w) => text.includes(w));
}

export function pickDailyReview<T extends PickableCard>(
  cards: T[],
  weakTopics: string[],
  now: Date = new Date(),
  limit = DAILY_REVIEW_SIZE,
): T[] {
  const words = topicWords(weakTopics);
  const nowMs = now.getTime();
  const scored = cards.map((c) => {
    const due = Date.parse(c.due_at) <= nowMs;
    const weak = matchesWeakTopic(c, words);
    return { c, due, weak };
  });
  const byHardness = (a: { c: T; weak: boolean }, b: { c: T; weak: boolean }) =>
    Number(b.weak) - Number(a.weak) || a.c.box - b.c.box || b.c.times_wrong - a.c.times_wrong;

  const due = scored.filter((s) => s.due).sort(byHardness);
  const extra = scored.filter((s) => !s.due && s.weak).sort(byHardness);
  return [...due, ...extra].slice(0, limit).map((s) => s.c);
}
