import { describe, expect, it } from 'vitest';
import { dpSummary, dpTotal, focusTip, mypGradeFromTotal, mypSummary, summarise, type GradeEntry } from '@/lib/ib-grades';
import { addDays, buildRevisionPlan } from '@/lib/revision-plan';
import { buildMilestones, TEMPLATES } from '@/lib/milestones';
import { pickDailyReview, topicWords } from '@/lib/daily-review';

let n = 0;
function g(p: Partial<GradeEntry>): GradeEntry {
  n += 1;
  return {
    id: `g${String(n).padStart(3, '0')}`, subject_name: 'Science', programme: 'MYP', level: null,
    assessment: null, criterion: 'A', mark: 5, assessed_on: '2026-10-01', ...p,
  };
}

describe('IB grades', () => {
  it('uses the MYP boundaries', () => {
    expect(mypGradeFromTotal(5)).toBe(1);
    expect(mypGradeFromTotal(6)).toBe(2);
    expect(mypGradeFromTotal(14)).toBe(3);
    expect(mypGradeFromTotal(19)).toBe(5);
    expect(mypGradeFromTotal(27)).toBe(6);
    expect(mypGradeFromTotal(32)).toBe(7);
  });

  it('averages the last three marks per criterion and finds the weakest', () => {
    const s = mypSummary('Science', [
      g({ criterion: 'A', mark: 2, assessed_on: '2026-01-01' }), // oldest, dropped
      g({ criterion: 'A', mark: 6, assessed_on: '2026-09-01' }),
      g({ criterion: 'A', mark: 7, assessed_on: '2026-10-01' }),
      g({ criterion: 'A', mark: 8, assessed_on: '2026-11-01' }),
      g({ criterion: 'B', mark: 4 }),
      g({ criterion: 'C', mark: 6 }),
      g({ criterion: 'D', mark: 6 }),
    ]);
    expect(s.criteria.A).toBe(7);
    expect(s.total).toBe(23);
    expect(s.grade).toBe(5);
    expect(s.weakest).toBe('B');
    expect(s.estimated).toBe(false);
    expect(s.toNextGrade).toBe(1);
  });

  it('scales up and flags an estimate when criteria are missing', () => {
    const s = mypSummary('Maths', [g({ criterion: 'A', mark: 6 }), g({ criterion: 'B', mark: 8 })]);
    expect(s.total).toBe(28);
    expect(s.grade).toBe(7);
    expect(s.estimated).toBe(true);
  });

  it('predicts DP grades from the last three and works out the total', () => {
    const d = dpSummary('Physics', [
      g({ programme: 'DP', criterion: null, mark: 3, assessed_on: '2026-01-01' }),
      g({ programme: 'DP', criterion: null, mark: 5, assessed_on: '2026-09-01' }),
      g({ programme: 'DP', criterion: null, mark: 5, assessed_on: '2026-10-01' }),
      g({ programme: 'DP', criterion: null, mark: 6, assessed_on: '2026-11-01' }),
    ]);
    expect(d.predicted).toBe(5);
    expect(d.trend).toBe('up');
    const six = ['A', 'B', 'C', 'D', 'E', 'F'].map((s) => g({ programme: 'DP', criterion: null, subject_name: s, mark: 6 }));
    expect(dpTotal(summarise(six))).toBe(36);
    expect(dpTotal(summarise(six.slice(0, 5)))).toBeNull();
  });

  it('puts the weakest subject first and gives a tip', () => {
    const list = summarise([
      g({ subject_name: 'English', criterion: 'A', mark: 8 }),
      g({ subject_name: 'Science', criterion: 'C', mark: 3 }),
    ]);
    expect(list[0].subject).toBe('Science');
    expect(focusTip(list)).toContain('criterion C');
  });
});

describe('revision plan', () => {
  it('builds spaced sessions before the exam, never before today', () => {
    const plan = buildRevisionPlan([{ id: 'e1', subject_name: 'Chemistry', exam_date: '2026-12-10' }], '2026-11-30');
    expect(plan.map((p) => p.session_date)).toEqual(['2026-12-03', '2026-12-06', '2026-12-08', '2026-12-09']);
    expect(plan.at(-1)?.focus).toContain('Light review');
    expect(plan.every((p) => p.session_date < '2026-12-10')).toBe(true);
  });

  it('caps sessions per day and shifts extras earlier', () => {
    const exams = ['a', 'b', 'c'].map((id) => ({ id, subject_name: id, exam_date: '2026-12-10' }));
    const plan = buildRevisionPlan(exams, '2026-11-01', { maxPerDay: 2 });
    const counts: Record<string, number> = {};
    for (const p of plan) counts[p.session_date] = (counts[p.session_date] ?? 0) + 1;
    expect(Math.max(...Object.values(counts))).toBeLessThanOrEqual(2);
    expect(plan.filter((p) => p.exam_id === 'c').length).toBeGreaterThan(5);
  });

  it('adds days across month ends', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('milestones', () => {
  it('spreads EE checkpoints and ends on the deadline', () => {
    const m = buildMilestones('ee', '2026-11-17', '2027-03-01');
    expect(m).toHaveLength(TEMPLATES.ee.length);
    expect(m.at(-1)?.due_date).toBe('2027-03-01');
    for (let i = 1; i < m.length; i++) expect(m[i].due_date >= m[i - 1].due_date).toBe(true);
    expect(m[0].due_date > '2026-11-17').toBe(true);
  });
});

describe('daily review', () => {
  const now = new Date('2026-11-17T12:00:00Z');
  const card = (id: string, p: Partial<{ front: string; back: string; box: number; due_at: string; times_wrong: number }>) => ({
    id, front: 'q', back: 'a', box: 3, due_at: '2026-11-16T00:00:00Z', times_wrong: 0, ...p,
  });

  it('puts weak-topic and hard cards first, tops up with weak cards not yet due', () => {
    const picked = pickDailyReview(
      [
        card('easy', { box: 5 }),
        card('hard', { box: 1, times_wrong: 4 }),
        card('weak', { front: 'Define enthalpy change', box: 4 }),
        card('later-weak', { front: 'Enthalpy of combustion', due_at: '2026-12-01T00:00:00Z' }),
        card('later', { due_at: '2026-12-01T00:00:00Z' }),
      ],
      ['Enthalpy and energetics'],
      now,
    );
    expect(picked.map((c) => c.id)).toEqual(['weak', 'hard', 'easy', 'later-weak']);
  });

  it('respects the limit and ignores short words', () => {
    expect(topicWords(['pH and the acid'])).toEqual(['acid']);
    const many = Array.from({ length: 30 }, (_, i) => card(`c${i}`, {}));
    expect(pickDailyReview(many, [], now)).toHaveLength(15);
  });
});

describe('grader file text', () => {
  it('reads Word paragraphs, tabs, breaks and entities, skipping deletions', async () => {
    const { docxXmlToText, fileKind } = await import('@/lib/extract-text');
    const xml =
      '<w:document><w:body>' +
      '<w:p><w:r><w:t>Intro: </w:t></w:r><w:r><w:t xml:space="preserve">cats &amp; dogs</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>A</w:t><w:tab/><w:t>B</w:t><w:br/><w:t>C</w:t></w:r></w:p>' +
      '<w:p><w:del><w:r><w:t>gone</w:t></w:r></w:del><w:r><w:t>kept</w:t></w:r></w:p>' +
      '</w:body></w:document>';
    expect(docxXmlToText(xml)).toBe('Intro: cats & dogs\nA\tB\nC\nkept');
    expect(fileKind('Essay.DOCX')).toBe('docx');
    expect(fileKind('scan.png')).toBe('other');
  });
});

describe('pdf line joining', () => {
  it('joins wrapped lines into paragraphs and repairs hyphenation', async () => {
    const { joinPdfLines } = await import('@/lib/extract-text');
    expect(joinPdfLines(['Title', '', 'Light helps plants grow and the', 'second plant turned yel-', 'low over time. It needed light.', '', 'Next paragraph.'])).toBe(
      'Title\n\nLight helps plants grow and the second plant turned yellow over time. It needed light.\n\nNext paragraph.',
    );
  });
});

describe('DP year detection', () => {
  it('knows DP years from MYP years', async () => {
    const { isDpYear } = await import('@/lib/ib-grades');
    expect(isDpYear('Year 12 (IB DP Year 1)')).toBe(true);
    expect(isDpYear('Grade 11')).toBe(true);
    expect(isDpYear('Grade 10')).toBe(false);
    expect(isDpYear('MYP Year 5')).toBe(false);
    expect(isDpYear('Year 11')).toBe(false);
    expect(isDpYear(null)).toBeNull();
  });
});

describe('honour roll', () => {
  const run = async (g: number[]) => (await import('@/lib/ib-grades')).honourRoll(g);
  it('gives each level at its total', async () => {
    expect((await run([5, 5, 5, 5, 5, 5, 5, 5])).award).toBe('merit'); // 40
    expect((await run([6, 6, 6, 6, 5, 5, 5, 5])).award).toBe('honour'); // 44
    expect((await run([6, 6, 6, 6, 6, 6, 6, 6])).award).toBe('high_honour'); // 48
    expect((await run([7, 7, 7, 7, 6, 6, 6, 6])).award).toBe('chairman'); // 52
    expect((await run([5, 5, 5, 5, 5, 5, 5, 4])).award).toBeNull(); // 39
  });
  it('cancels every award for a grade below 4', async () => {
    const r = await run([7, 7, 7, 7, 7, 7, 7, 3]);
    expect(r.total).toBe(52);
    expect(r.award).toBeNull();
    expect(r.note).toMatch(/below 4/);
  });
  it('drops to the level the lowest grade allows', async () => {
    expect((await run([7, 7, 7, 7, 7, 7, 5, 5])).award).toBe('high_honour'); // 52 but a 5
    expect((await run([7, 7, 7, 7, 7, 7, 7, 4])).award).toBe('honour'); // 53 but a 4
    expect((await run([7, 7, 7, 7, 7, 7, 7, 4])).note).toMatch(/Chairman/);
  });
  it('waits for all 8 subjects', async () => {
    const r = await run([7, 7, 7]);
    expect(r.counted).toBe(3);
    expect(r.award).toBeNull();
  });
  it('says how far the next level is', async () => {
    expect((await run([6, 6, 5, 5, 5, 5, 5, 5])).next).toEqual({ award: 'honour', points: 2 }); // 42
  });
});
