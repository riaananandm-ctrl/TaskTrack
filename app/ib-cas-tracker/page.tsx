import type { Metadata } from 'next';
import { FeaturePage } from '@/components/landing/feature-page';

const TITLE = 'IB CAS tracker: log experiences, hours and reflections';
const INTRO =
  'TaskTrack tracks your IB CAS in one place: log each experience in about a minute, see your Creativity, Activity and Service hours against your targets, and write reflections that show the seven learning outcomes.';

export const metadata: Metadata = {
  title: { absolute: 'IB CAS Tracker for Students | TaskTrack' },
  description:
    'Free IB CAS tracker: log CAS experiences and hours by strand, tick off the seven learning outcomes, and get reflection feedback that asks questions instead of writing for you.',
  alternates: { canonical: '/ib-cas-tracker' },
};

const FAQS = [
  {
    q: 'Does an experience with two strands count toward both?',
    a: 'Yes. A three-hour beach clean-up logged as Service and Activity adds three hours to each strand, which is how most CAS coordinators read strand balance. Your total hours count each experience once.',
  },
  {
    q: 'Will the AI write my CAS reflection?',
    a: 'No. TaskTrack’s AI only asks questions and points out vague sentences. It never writes, rewrites or suggests wording for your reflection, because a CAS reflection has to be your own.',
  },
  {
    q: 'Which learning outcomes does TaskTrack track?',
    a: 'All seven IB CAS learning outcomes: strengths and growth, challenges and new skills, initiative and planning, collaboration, perseverance and commitment, issues of global significance, and the ethics of choices and actions.',
  },
  {
    q: 'Is the CAS tracker free?',
    a: 'Yes. Logging experiences, hours, outcomes and reflections is free. AI feedback is limited to 20 checks per student per day.',
  },
];

export default function Page() {
  return (
    <FeaturePage
      path="/ib-cas-tracker"
      eyebrow="IB CAS tracker"
      title={TITLE}
      intro={INTRO}
      faqs={FAQS}
      sections={[
        {
          title: 'Log a CAS experience in about a minute',
          body: (
            <>
              <p>
                Add what you did, pick every strand it fits, and enter the dates and hours. Add your supervisor and a
                photo or certificate as evidence if you have one. TaskTrack then takes you straight to the reflection, so
                you can write it while the details are fresh.
              </p>
              <p>Not ready to reflect yet? TaskTrack reminds you 48 hours later.</p>
            </>
          ),
        },
        {
          title: 'See your hours and balance at a glance',
          body: (
            <>
              <p>
                Your CAS dashboard shows Creativity, Activity and Service as three progress bars against the targets you
                set. If a strand is still under half its target and your CAS end date is less than 90 days away, you get a
                clear warning so there is time to plan more.
              </p>
            </>
          ),
        },
        {
          title: 'Show all seven learning outcomes',
          body: (
            <>
              <p>
                Each reflection can be linked to the IB CAS learning outcomes it shows. The dashboard keeps a checklist of
                all seven, so you can see which are evidenced and which still need an experience.
              </p>
              <p>
                TaskTrack can also read your reflection and suggest outcomes it clearly shows, with a one-line reason. You
                accept or dismiss each one.
              </p>
            </>
          ),
        },
        {
          title: 'Better reflections, still in your own words',
          body: (
            <>
              <p>
                Sentences like “I learned a lot” or “it was a great experience” are flagged as you type, with a question
                that would make them specific. Ask for feedback and you get two or three questions about a decision you
                made, a difficulty you hit, or someone you worked with.
              </p>
              <ul>
                <li>No AI-written text, ever: only questions and flags.</li>
                <li>Your reflections stay private to your account.</li>
              </ul>
            </>
          ),
        },
      ]}
    />
  );
}
