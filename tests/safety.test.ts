import { describe, expect, it } from 'vitest';
import { safeHttpUrl } from '@/lib/safe-url';
import { maskFeedUrl, normalizeFeedUrl } from '@/lib/feed-url';

describe('safeHttpUrl', () => {
  it('keeps normal web links', () => {
    expect(safeHttpUrl(' https://example.com/a?b=1 ')).toBe('https://example.com/a?b=1');
    expect(safeHttpUrl('http://example.com')).toBe('http://example.com/');
  });
  it('blocks script and data links', () => {
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull();
    expect(safeHttpUrl('data:text/html,hi')).toBeNull();
    expect(safeHttpUrl('JaVaScRiPt:alert(1)')).toBeNull();
  });
  it('handles empty and broken input', () => {
    expect(safeHttpUrl(null)).toBeNull();
    expect(safeHttpUrl('   ')).toBeNull();
    expect(safeHttpUrl('not a url')).toBeNull();
  });
});

describe('ManageBac feed links', () => {
  it('turns webcal:// into https:// and keeps the rest exactly', () => {
    const r = normalizeFeedUrl(' WEBCAL://school.managebac.com/student/events/token/AbC123.ics?x=1 ');
    expect(r).toEqual({ ok: true, url: 'https://school.managebac.com/student/events/token/AbC123.ics?x=1', converted: true });
  });
  it('accepts https links as they are', () => {
    expect(normalizeFeedUrl('https://a.managebac.com/f.ics')).toEqual({ ok: true, url: 'https://a.managebac.com/f.ics', converted: false });
  });
  it('rejects other schemes, missing schemes and empty input', () => {
    expect(normalizeFeedUrl('http://a.com/f.ics')).toEqual({ ok: false, reason: 'protocol' });
    expect(normalizeFeedUrl('a.managebac.com/f.ics')).toEqual({ ok: false, reason: 'invalid' });
    expect(normalizeFeedUrl('')).toEqual({ ok: false, reason: 'empty' });
  });
  it('never shows the private token when masked', () => {
    const masked = maskFeedUrl('https://a.managebac.com/student/events/token/SECRET.ics');
    expect(masked).not.toContain('SECRET');
    expect(masked.startsWith('https://a.managebac.com/')).toBe(true);
  });
});
