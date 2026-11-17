import { describe, expect, it } from 'vitest';
import { autoPriority } from '@/lib/auto-priority';
import { applySuggestions, segments, validSuggestions, type CoachSuggestion } from '@/lib/rewrite-coach-apply';

describe('autoPriority', () => {
  it('ranks summatives urgent and formatives high', () => {
    expect(autoPriority('Biology Summative: cells')).toBe('urgent');
    expect(autoPriority('formative quiz')).toBe('high');
    expect(autoPriority('Summative and formative')).toBe('urgent');
  });
  it('matches Task 3 but not Task 30', () => {
    expect(autoPriority('Task 3 draft', 'low')).toBe('medium');
    expect(autoPriority('Task 30 draft', 'low')).toBe('low');
  });
  it('falls back when nothing matches', () => {
    expect(autoPriority('Read chapter 4')).toBe('medium');
    expect(autoPriority(null, 'low')).toBe('low');
  });
});

const s = (id: string, start: number, end: number, original: string, replacement: string): CoachSuggestion => ({
  id, start, end, original, replacement, type: 'clarity', why: '', major: false,
});

describe('Rewrite Coach suggestions', () => {
  const text = 'The cat sat on the mat.';
  const a = s('a', 4, 7, 'cat', 'dog');
  const b = s('b', 19, 22, 'mat', 'rug');

  it('applies only the accepted edits', () => {
    expect(applySuggestions(text, [a, b], new Set(['b']))).toBe('The cat sat on the rug.');
    expect(applySuggestions(text, [a, b], new Set(['a', 'b']))).toBe('The dog sat on the rug.');
    expect(applySuggestions(text, [a, b], new Set())).toBe(text);
  });
  it('drops edits whose quote no longer matches, or that overlap', () => {
    const wrong = s('w', 0, 3, 'A c', 'X');
    const overlap = s('o', 5, 9, 'at s', 'zz');
    expect(validSuggestions(text, [wrong, a, overlap]).map((x) => x.id)).toEqual(['a']);
  });
  it('splits text for highlighting without losing any characters', () => {
    expect(segments(text, [a, b]).map((x) => x.text).join('')).toBe(text);
  });
});
