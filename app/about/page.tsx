import type { Metadata } from 'next';
import { FeaturePage } from '@/components/landing/feature-page';

export const metadata: Metadata = {
  title: { absolute: 'About TaskTrack — Founded by Riaan Anand Mura | TaskTrack' },
  description:
    'TaskTrack is a free IB study planner built by IB students. Founded by Riaan Anand Mura, with co-founder Vayun Gottumukkala.',
  alternates: { canonical: '/about' },
};

export default function Page() {
  return (
    <FeaturePage
      path="/about"
      eyebrow="About"
      title="About TaskTrack"
      intro="TaskTrack is a free study planner for IB students, built by IB students. It started as a way to stop missing ManageBac deadlines and grew into one place to plan, revise and track CAS."
      sections={[
        {
          title: 'The founders',
          body: (
            <ul>
              <li>
                <strong>Riaan Anand Mura</strong>, founder. Started TaskTrack and leads the product.
              </li>
              <li>
                <strong>Vayun Gottumukkala</strong>, co-founder.
              </li>
            </ul>
          ),
        },
        {
          title: 'Why we built it',
          body: (
            <p>
              IB students juggle summatives, formatives, tests and CAS across six subjects, with deadlines spread over
              ManageBac, Google Classroom and teachers&rsquo; messages. TaskTrack pulls them into one list, reminds you
              before each one, and gives you AI study tools that teach and give feedback without doing the work for you.
            </p>
          ),
        },
        {
          title: 'How we work',
          body: (
            <ul>
              <li>Free to start, with no card needed. Paid plans are paid once by UPI and never renew by themselves.</li>
              <li>Your data stays private to your account. TaskTrack only reads ManageBac and Google Classroom.</li>
              <li>The AI explains, quizzes and gives feedback. It never writes graded work or CAS reflections for you.</li>
            </ul>
          ),
        },
      ]}
    />
  );
}
