import { describe, expect, it } from 'vitest';
import { MAX_PLAN_VIDEOS, parsePlan, parseVideos, planPlaylist, videoSearch } from '@/lib/study-modes';

describe('video plan', () => {
  it('keeps order, days, summary and caps the length', () => {
    const videos = Array.from({ length: 14 }, (_, i) => ({
      title: `Part ${i + 1}`,
      search: `ib spanish part ${i + 1}`,
      day: Math.floor(i / 3) + 1,
      minutes: 10,
    }));
    const out = parseVideos({ summary: 'From basics to exam-ready.', videos })!;
    expect(out.summary).toBe('From basics to exam-ready.');
    expect(out.videos).toHaveLength(MAX_PLAN_VIDEOS);
    expect(out.videos[0]).toMatchObject({ title: 'Part 1', day: 1, minutes: 10 });
    expect(out.videos[3].day).toBe(2);
  });

  it('still reads old saved video lists with no days or summary', () => {
    const out = parseVideos({ videos: [{ title: 'Photosynthesis', search: 'photosynthesis ib' }] })!;
    expect(out.summary).toBeUndefined();
    expect(out.videos[0].day).toBeNull();
  });

  it('ignores bad days', () => {
    const out = parseVideos({ videos: [{ title: 'A', day: 0 }, { title: 'B', day: 'two' }] })!;
    expect(out.videos.map((v) => v.day)).toEqual([null, null]);
  });

  it('numbers study plan videos across every session', () => {
    const plan = parsePlan({
      sessions: [
        { date: 'Mon', focus: 'Basics', videos: [{ title: 'Intro', search: 'intro' }, { title: 'Verbs', search: 'verbs' }] },
        { date: 'Tue', focus: 'Practice' },
        { date: 'Wed', focus: 'Exam', videos: [{ title: 'Exam tips', channel: 'Some channel', search: '' }] },
      ],
    })!;
    const list = planPlaylist(plan);
    expect(list.map((v) => v.label)).toEqual(['Intro', 'Verbs', 'Exam tips']);
    expect(list.map((v) => v.session)).toEqual([0, 0, 2]);
    expect(list[2].search).toBe('Exam tips Some channel');
  });

  it('builds search words from the title when no search is given', () => {
    expect(videoSearch({ title: 'Cells', channel: 'Amoeba Sisters', search: '' })).toBe('Cells Amoeba Sisters');
  });
});
