import Link from 'next/link';
import { LegalPage, Section } from '@/components/legal-page';

export const metadata = { title: 'Contact Us | TaskTrack' };

const TEAM = ['riaananandm@sis.edu.in', 'vayung@sis.edu.in', 'nagasaim@sis.edu.in'];

export default function ContactPage() {
  return (
    <LegalPage
      title="Contact Us"
      updated="20 November 2026"
      intro={
        <p>
          TaskTrack is run by a small team of students. Email us about your account, Premium, payments, refunds, or
          anything that isn’t working, and we’ll get back to you.
        </p>
      }
    >
      <Section title="Email">
        <ul>
          {TEAM.map((email) => (
            <li key={email}>
              <a href={`mailto:${email}`}>{email}</a>
            </li>
          ))}
        </ul>
        <p>We reply within 2 working days, usually sooner.</p>
      </Section>

      <Section title="Payments and refunds">
        <p>
          For a payment or refund, email us from the address on your TaskTrack account and include the payment ID from
          your Razorpay receipt, or the date and amount. Our{' '}
          <Link href="/refund-policy">Refund &amp; Cancellation Policy</Link> explains how refunds work.
        </p>
      </Section>

      <Section title="Reporting a safety problem">
        <p>
          To report something in Group Study, use the flag icon in the room so we can see the message, and tell a
          trusted adult. You can also email us.
        </p>
      </Section>

      <Section title="Keep your details safe">
        <p>
          Please don’t send passwords, OTPs, card or bank details, ManageBac tokens, reset links, or other students’
          private information. We will never ask for them.
        </p>
      </Section>

      <Section title="More">
        <p>
          <Link href="/terms">Terms of Service</Link> · <Link href="/privacy">Privacy Policy</Link> ·{' '}
          <Link href="/refund-policy">Refund &amp; Cancellation Policy</Link>
        </p>
      </Section>
    </LegalPage>
  );
}
