import Link from 'next/link';
import { CONTACT, LegalPage, Section } from '@/components/legal-page';

export const metadata = { title: 'Terms of Service | TaskTrack' };

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      updated="20 November 2026"
      intro={
        <p>
          These are the rules for using TaskTrack. By using it you agree to them and to our{' '}
          <Link href="/privacy" className="text-sky-300 underline">
            Privacy Policy
          </Link>
          . If you are under 18, please read them with a parent or guardian.
        </p>
      }
    >
      <Section title="1. Who can use TaskTrack">
        <ul>
          <li>TaskTrack is for school students and anyone planning their studies.</li>
          <li>
            A parent or guardian must agree before you use Group Study. You can use the rest of
            TaskTrack while you wait.
          </li>
          <li>Please give your real name and age. You are responsible for keeping your account secure.</li>
        </ul>
      </Section>

      <Section title="2. Group Study rules">
        <p>Group Study rooms are for studying together. In every room:</p>
        <ul>
          <li>Be kind. No bullying, threats, hate, or harassment.</li>
          <li>No swearing, sexual content, or anything that isn’t OK at school. Swear words are filtered automatically.</li>
          <li>Don’t share other people’s personal information, and think carefully before sharing your own.</li>
          <li>Only share room codes with people you know. Don’t pretend to be someone else.</li>
          <li>Use the flag icon to report anything that makes you uncomfortable, and tell a trusted adult.</li>
        </ul>
        <p>
          We review reports and may delete messages, end rooms, or suspend accounts that break these rules. If
          something may put a child in danger, we may share information with parents, the school, or the police.
        </p>
      </Section>

      <Section title="3. AI tools and academic honesty">
        <ul>
          <li>
            The AI tools (study sessions, the AI Grader and the Group Study AI) are for <strong>learning</strong>:
            explaining topics, practising, and getting feedback on your own work.
          </li>
          <li>
            Don’t submit AI-written work as your own. Schools and the IB treat that as academic misconduct. Follow your
            school’s and the IB’s academic integrity policy, and cite AI when your teacher asks you to.
          </li>
          <li>
            The AI Grader gives an <strong>estimate</strong> of an IB band. It is not an official IB grade, not
            moderated by the IB, and can be wrong. Your teacher’s assessment always comes first.
          </li>
          <li>AI can make mistakes. Check important facts with your notes, textbook or teacher.</li>
        </ul>
      </Section>

      <Section title="4. ManageBac">
        <p>
          You can connect the private calendar link your school’s ManageBac gives you. You confirm you’re allowed to
          use that link. TaskTrack only reads the deadlines in it. If your school changes or turns off the feed, your
          imported deadlines may stop updating. Always check ManageBac for official instructions.
        </p>
      </Section>

      <Section title="5. Your content">
        <p>
          Your tasks, notes, documents and messages belong to you. You give us permission to store and process them
          only to run TaskTrack for you, as described in the Privacy Policy. Don’t upload anything you don’t have the
          right to share.
        </p>
      </Section>

      <Section title="6. The service">
        <ul>
          <li>TaskTrack is provided “as is”. We work hard to keep it running, but we can’t promise it will
            always be available, error-free, or that reminders will always arrive on time.</li>
          <li>You are responsible for your own deadlines. Keep checking your school’s official systems.</li>
          <li>We may change, pause or remove features.</li>
        </ul>
      </Section>

      <Section title="7. Free and Premium plans">
        <ul>
          <li>The Free plan costs nothing. Premium is optional and costs ₹699 for 3 months, paid once by UPI. It
            does not renew automatically.</li>
          <li>The price and what you get are shown before you pay. We switch Premium on after checking your payment, usually within a few
            hours.</li>
          <li>Cancellations and refunds follow our{' '}
            <Link href="/refund-policy" className="text-sky-300 underline">Refund &amp; Cancellation Policy</Link>,
            including a full refund if you ask within 7 days of paying.</li>
          <li>As far as the law allows, we are not responsible for missed deadlines, grades, or other losses from using TaskTrack.</li>
        </ul>
      </Section>

      <Section title="8. Ending your account">
        <p>
          You can delete your account at any time in Settings → Delete account. We may suspend or close accounts that
          break these terms or put other students at risk.
        </p>
      </Section>

      <Section title="9. Changes, law and contact">
        <p>
          If we change these terms in a meaningful way, we’ll update the date above and ask you to accept the new
          version in the app. These terms are governed by the laws of India. Questions or complaints: {CONTACT}.
        </p>
      </Section>
    </LegalPage>
  );
}
