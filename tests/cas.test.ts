import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));

import { CAS_OUTCOMES, daysUntil, evidencedOutcomes, hoursByStrand, strandsAtRisk, totalHours } from '@/lib/cas';

describe('hoursByStrand', () => {
  it('counts a two-strand experience in both strands', () => {
    const totals = hoursByStrand([
      { strands: ['service', 'activity'], hours: 3 },
      { strands: ['creativity'], hours: 2.5 },
      { strands: ['service'], hours: 1 },
    ]);
    expect(totals).toEqual({ creativity: 2.5, activity: 3, service: 4 });
  });

  it('does not double count a repeated strand and ignores bad hours', () => {
    expect(hoursByStrand([{ strands: ['activity', 'activity'], hours: 2 }, { strands: ['activity'], hours: NaN }]))
      .toEqual({ creativity: 0, activity: 2, service: 0 });
  });

  it('total hours counts each experience once', () => {
    expect(totalHours([{ hours: 3 }, { hours: 2.5 }])).toBe(5.5);
  });
});

describe('strandsAtRisk', () => {
  const targets = { creativity: 50, activity: 50, service: 50 };
  const today = new Date('2026-11-26T10:00:00');

  it('warns for strands under half when the end date is within 90 days', () => {
    expect(strandsAtRisk({ creativity: 30, activity: 10, service: 25 }, targets, '2027-01-31', today)).toEqual(['activity']);
  });

  it('stays quiet when the end date is far away or missing', () => {
    expect(strandsAtRisk({ creativity: 0, activity: 0, service: 0 }, targets, '2027-12-31', today)).toEqual([]);
    expect(strandsAtRisk({ creativity: 0, activity: 0, service: 0 }, targets, null, today)).toEqual([]);
  });
});

describe('outcomes', () => {
  it('has seven outcomes in IB order', () => {
    expect(CAS_OUTCOMES.map((o) => o.id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(CAS_OUTCOMES[3].full).toMatch(/collaborativ/i);
    expect(CAS_OUTCOMES[4].full).toMatch(/persever/i);
  });

  it('collects evidenced outcomes across reflections', () => {
    expect(Array.from(evidencedOutcomes([{ outcomes: [1, 4] }, { outcomes: [4, 9] }])).sort()).toEqual([1, 4]);
  });

  it('counts days until a date', () => {
    expect(daysUntil('2026-11-28', new Date('2026-11-26T22:00:00'))).toBe(2);
  });
});
