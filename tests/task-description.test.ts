import { describe, expect, test } from 'vitest';
import { looksCutOff, splitLinks } from '@/lib/task-description';

describe('splitLinks', () => {
  test('makes https links clickable and keeps the rest as text', () => {
    expect(splitLinks('See https://example.com/a?b=1. Thanks')).toEqual([
      { text: 'See ' },
      { text: 'https://example.com/a?b=1', href: 'https://example.com/a?b=1' },
      { text: '. Thanks' },
    ]);
  });

  test('never links other schemes', () => {
    const parts = splitLinks('javascript:alert(1) http://plain.example');
    expect(parts.every((p) => !p.href)).toBe(true);
  });
});

describe('looksCutOff', () => {
  test('spots ManageBac shortened descriptions', () => {
    expect(looksCutOff('Forest degradation Climate...')).toBe(true);
    expect(looksCutOff('All done.')).toBe(false);
  });
});
