/**
 * Checkpoint templates for the Extended Essay, Internal Assessments and the TOK
 * essay, spread evenly between a start date and the final deadline. Pure.
 */
import { addDays, daysBetween } from '@/lib/revision-plan';

export type ProjectKind = 'ee' | 'ia' | 'tok';

export const PROJECT_LABEL: Record<ProjectKind, string> = {
  ee: 'Extended Essay',
  ia: 'Internal Assessment',
  tok: 'TOK essay',
};

export const TEMPLATES: Record<ProjectKind, string[]> = {
  ee: [
    'Choose a topic and draft your research question',
    'First meeting with supervisor + first reflection',
    'Find sources and start an annotated bibliography',
    'Plan the structure (headings and argument)',
    'Write the first 1,500 words',
    'Finish the full draft (about 4,000 words)',
    'Get supervisor feedback + interim reflection',
    'Revise using feedback; check word count and citations',
    'Final reflection (viva voce) and proofread',
    'Submit the Extended Essay',
  ],
  ia: [
    'Choose a topic and research question',
    'Plan your method or approach',
    'Collect your data or research',
    'Analyse your results',
    'Write the first draft',
    'Get teacher feedback on your draft',
    'Final draft: check criteria, word count and references',
    'Submit the IA',
  ],
  tok: [
    'Choose your prescribed title',
    'Plan knowledge questions, claims and examples',
    'Write the first draft',
    'Get teacher feedback',
    'Final essay: check word count (1,600) and references',
    'Submit the TOK essay',
  ],
};

export interface Milestone {
  n: number; // 1-based
  title: string;
  due_date: string; // YYYY-MM-DD
}

/** Spreads the template evenly; the last checkpoint lands on the deadline. */
export function buildMilestones(kind: ProjectKind, startDate: string, dueDate: string): Milestone[] {
  const steps = TEMPLATES[kind];
  const span = Math.max(daysBetween(startDate, dueDate), 1);
  return steps.map((title, i) => ({
    n: i + 1,
    title,
    due_date: addDays(startDate, Math.max(1, Math.round(((i + 1) / steps.length) * span))),
  }));
}
