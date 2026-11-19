import { describe, expect, it } from 'vitest';
import { isSubmissionTask, saysWorkIsDone } from '@/lib/managebac-submit';

describe('saysWorkIsDone', () => {
  it('spots a finished note', () => {
    for (const m of ['done', "I'm done!", 'finished it', 'im done with my work', 'completed', 'all done 🎉']) {
      expect(saysWorkIsDone(m)).toBe(true);
    }
  });
  it('ignores questions, not-yet and normal chat', () => {
    for (const m of ['not done yet', 'almost done', 'am i done?', 'how do i finish', 'I haven\'t finished', 'Explain photosynthesis']) {
      expect(saysWorkIsDone(m)).toBe(false);
    }
  });
});

describe('isSubmissionTask', () => {
  const mb = { external_source: 'managebac_calendar', external_uid: '123' };
  it('accepts ManageBac tasks handed in online', () => {
    expect(isSubmissionTask({ ...mb, title: 'Grasp Task', description: 'Energy_Climate.docx' })).toBe(true);
    expect(isSubmissionTask({ ...mb, title: 'Service Task', description: 'Please add the image or document work. The submission is mandatory.' })).toBe(true);
  });
  it('rejects tests, in-class assessments and non-ManageBac tasks', () => {
    expect(isSubmissionTask({ ...mb, title: 'Summative test # 2' })).toBe(false);
    expect(isSubmissionTask({ ...mb, title: 'FA2 Unit2', description: 'The assessment will be conducted on Thursday.' })).toBe(false);
    expect(isSubmissionTask({ ...mb, title: 'Essay', category: 'test' })).toBe(false);
    expect(isSubmissionTask({ external_source: null, external_uid: null, title: 'Essay' })).toBe(false);
  });
});
