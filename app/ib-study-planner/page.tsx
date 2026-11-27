import type { Metadata } from 'next';
import { FeaturePage } from '@/components/landing/feature-page';

const TITLE = 'The free study planner built for IB students';
const INTRO =
  'TaskTrack plans your IB workload around real deadlines: it imports them from ManageBac or Google Classroom, reminds you before each one, and gives you AI study tools to prepare for tests and check your drafts.';

export const metadata: Metadata = {
  title: { absolute: 'IB Study Planner — Free for IB Students | TaskTrack' },
  description:
    'TaskTrack is a free IB study planner: deadlines from ManageBac and Google Classroom, reminders, AI quizzes and flashcards, drafts checked against IB criteria, CAS tracking and group study.',
  alternates: { canonical: '/ib-study-planner' },
};

const FAQS = [
  {
    q: 'Is TaskTrack free?',
    a: 'Yes. Free accounts get the planner, reminders, ManageBac and Google Classroom sync, the CAS tracker and 40 AI credits a month. Premium adds unlimited tasks and reminders, 500 AI credits a month and more study tools, from ₹149 for a month, paid once by UPI.',
  },
  {
    q: 'Which IB programmes does it work for?',
    a: 'TaskTrack works for MYP and DP students: anything with deadlines, tests and drafts. The CAS tracker is for the Diploma Programme.',
  },
  {
    q: 'Do I need ManageBac to use TaskTrack?',
    a: 'No. You can add subjects and tasks yourself. ManageBac and Google Classroom sync just save you the typing.',
  },
  {
    q: 'Does it work on my phone?',
    a: 'Yes. TaskTrack runs in any browser on phones, tablets and laptops, and you can add it to your home screen like an app.',
  },
];

export default function Page() {
  return (
    <FeaturePage
      path="/ib-study-planner"
      eyebrow="IB study planner"
      title={TITLE}
      intro={INTRO}
      faqs={FAQS}
      sections={[
        {
          title: 'Know what’s due, across every subject',
          body: (
            <p>
              Your dashboard shows what is due today, this week and later, with overdue work kept separate so nothing
              hides. Plan your week on the calendar, and split big tasks into study sessions that fit around school.
            </p>
          ),
        },
        {
          title: 'Revise with AI, without shortcuts',
          body: (
            <>
              <p>For every test or task, TaskTrack can help you study:</p>
              <ul>
                <li>Quizzes and flashcards made from the topic, with spaced review.</li>
                <li>Study sessions that explain, test you and plan your revision.</li>
                <li>The AI Grader, which checks a draft against the IB criteria and explains how to improve it.</li>
                <li>An extra boost of AI credits in exam week.</li>
              </ul>
              <p>The AI teaches and gives feedback. It never writes graded work for you.</p>
            </>
          ),
        },
        {
          title: 'CAS, group study and streaks',
          body: (
            <p>
              Track CAS experiences, hours and reflections in the same app. Study with friends in group sessions, keep a
              streak going, and climb the leaderboard if you want to.
            </p>
          ),
        },
        {
          title: 'Made by IB students',
          body: (
            <p>
              TaskTrack is built by a small team of IB students who wanted one place for deadlines and revision. It is
              free to start, and your data stays private to your account.
            </p>
          ),
        },
      ]}
    />
  );
}
