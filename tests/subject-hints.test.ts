import { describe, expect, test } from 'vitest';
import { CROSS_SUBJECT_TASK, titleSeriesKey } from '@/lib/subject-hints';

describe('titleSeriesKey', () => {
  test('keeps the series name before a separator', () => {
    expect(titleSeriesKey('CAS Task- Our Planet, Our Responsibility')).toBe('cas');
    expect(titleSeriesKey('FA-CR B&C- Rate of temperature change')).toBeNull();
    expect(titleSeriesKey('Get Pitch-Ready - Pitch Preparation Week')).toBe('get pitch');
  });

  test('ignores titles that are only generic words', () => {
    expect(titleSeriesKey('Summative Assessment 2')).toBeNull();
    expect(titleSeriesKey('TASK 4: CRITERION D(i) – EVALUATING')).toBeNull();
    expect(titleSeriesKey('Criterion D - Writing Summative')).toBeNull();
  });
});

describe('CROSS_SUBJECT_TASK', () => {
  test('spots CAS and service tasks', () => {
    expect(CROSS_SUBJECT_TASK.test('CAS Task- Our Planet')).toBe(true);
    expect(CROSS_SUBJECT_TASK.test('Service as Action reflection')).toBe(true);
    expect(CROSS_SUBJECT_TASK.test('Casual essay on casinos')).toBe(false);
    expect(CROSS_SUBJECT_TASK.test('Chemistry Unit 2 SA2')).toBe(false);
  });
});
