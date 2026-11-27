import type { Metadata } from 'next';
import { FeaturePage } from '@/components/landing/feature-page';

const TITLE = 'A ManageBac planner that keeps up for you';
const INTRO =
  'Connect ManageBac to TaskTrack once and every deadline lands in one clear list, with a reminder the day before, a study plan for each task, and handed-in work cleared away automatically.';

export const metadata: Metadata = {
  title: { absolute: 'ManageBac Planner & Deadline Sync for Students | TaskTrack' },
  description:
    'Sync your ManageBac deadlines into TaskTrack: one list for every subject, reminders the day before, AI study help for each task, and changes picked up every 5 minutes.',
  alternates: { canonical: '/managebac-planner' },
};

const FAQS = [
  {
    q: 'How do I connect ManageBac to TaskTrack?',
    a: 'Copy your calendar link from ManageBac and paste it into TaskTrack once. Your deadlines import straight away, and TaskTrack checks for changes every 5 minutes after that.',
  },
  {
    q: 'What happens when a teacher changes a due date?',
    a: 'The change shows up at the next sync. If you edited that task yourself in TaskTrack, your edit is kept.',
  },
  {
    q: 'Do handed-in tasks disappear?',
    a: 'Tasks you tick off are cleared from your list. Pen-and-paper tests are ticked automatically once the test time has passed, and any task still open 5 days after its due date is ticked for you. If that was wrong, tap the tick to reopen it.',
  },
  {
    q: 'Can TaskTrack change anything in ManageBac?',
    a: 'No. TaskTrack only reads your calendar feed. It never submits work or changes anything in ManageBac.',
  },
];

export default function Page() {
  return (
    <FeaturePage
      path="/managebac-planner"
      eyebrow="ManageBac planner"
      title={TITLE}
      intro={INTRO}
      faqs={FAQS}
      sections={[
        {
          title: 'Every ManageBac deadline in one list',
          body: (
            <p>
              Summatives, formatives, homework and tests from every subject arrive in one list, sorted by what is due
              next. Each task keeps its subject, due time and the teacher’s description, and summatives are marked as
              urgent automatically.
            </p>
          ),
        },
        {
          title: 'Reminders before work is due',
          body: (
            <p>
              Every task gets a reminder the day before it is due, at the time you choose. You can add your own
              reminders and study sessions on top, and TaskTrack suggests good times to study.
            </p>
          ),
        },
        {
          title: 'Help with each task, not just a list',
          body: (
            <>
              <p>
                Open any task to start an AI study session for it: build a revision plan, make quizzes and flashcards on
                the topic, or watch a step-by-step video plan. For written work, the AI Grader checks your draft against
                the IB criteria and explains what would raise the mark.
              </p>
              <p>The AI explains and asks questions. It does not write graded work for you.</p>
            </>
          ),
        },
        {
          title: 'Also works with Google Classroom',
          body: (
            <p>
              If some teachers use Google Classroom, connect it too (in beta). Classroom assignments you turn in are
              ticked off in TaskTrack automatically.
            </p>
          ),
        },
      ]}
    />
  );
}
