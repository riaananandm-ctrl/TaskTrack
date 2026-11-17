import { describe, expect, it } from 'vitest';
import { parsePlan, parseQuiz, parseVideos, quizXp, youtubeSearchUrl } from '@/lib/study-modes';

describe('study plan parsing', () => {
  it('keeps videos, practice and check, capped at 2 videos', () => {
    const plan = parsePlan({
      summary: 'Two sessions',
      sessions: [
        {
          date: '2026-11-20', focus: 'Ionic bonding', topics: ['lattices'], minutes: 45,
          videos: [{ title: 'Ionic bonding', search: 'IB chem ionic' }, { title: 'v2' }, { title: 'v3' }],
          practice: 'Do 3 questions', check: 'Explain it in 1 minute',
        },
        { date: '', focus: 'missing date is dropped' },
      ],
    });
    expect(plan?.sessions).toHaveLength(1);
    expect(plan?.sessions[0].videos).toHaveLength(2);
    expect(plan?.sessions[0].practice).toBe('Do 3 questions');
    expect(plan?.sessions[0].check).toBe('Explain it in 1 minute');
  });
  it('returns null for junk', () => {
    expect(parsePlan(null)).toBeNull();
    expect(parsePlan({ sessions: 'no' })).toBeNull();
  });
  it('builds a safe YouTube search link', () => {
    expect(youtubeSearchUrl({ title: 'a & b', channel: '', search: '' })).toBe(
      'https://www.youtube.com/results?search_query=a%20%26%20b'
    );
  });
});

describe('quiz parsing', () => {
  it('fixes an out-of-range answer index and skips broken questions', () => {
    const quiz = parseQuiz({
      questions: [
        { question: 'Q1', options: ['a', 'b', 'c', 'd'], answerIndex: 9 },
        { question: '', options: ['a', 'b'] },
      ],
    });
    expect(quiz?.questions).toHaveLength(1);
    expect(quiz?.questions[0].answerIndex).toBe(0);
  });
});

describe('video suggestions', () => {
  it('keeps valid videos and drops empty ones', () => {
    const r = parseVideos({
      videos: [
        { title: 'Osmosis overview', channel: 'Michael Walker', search: 'IB Biology osmosis', why: 'Basics', watchFor: 'Water potential', minutes: '8' },
        { title: '', search: '' },
        { search: 'osmosis exam questions', minutes: 999 },
      ],
    });
    expect(r?.videos).toHaveLength(2);
    expect(r?.videos[0].minutes).toBe(8);
    expect(r?.videos[1].minutes).toBeNull();
    expect(youtubeSearchUrl(r!.videos[0])).toBe('https://www.youtube.com/results?search_query=IB%20Biology%20osmosis');
  });

  it('rejects the wrong shape', () => {
    expect(parseVideos({ videos: 'x' })).toBeNull();
    expect(parseVideos({ videos: [] })).toBeNull();
  });
});

describe('quiz XP', () => {
  it('matches the server rules', () => {
    expect(quizXp(3, 5)).toBe(15);
    expect(quizXp(5, 5)).toBe(35);
    expect(quizXp(2, 2)).toBe(10); // no bonus under 3 questions
    expect(quizXp(999, 999)).toBe(110); // clamped to 20 questions
    expect(quizXp(0, 5)).toBe(0);
  });
});
