import Link from 'next/link';
import { CONTACT, LegalPage, Section } from '@/components/legal-page';

export const metadata = { title: 'Refund & Cancellation Policy | TaskTrack' };

export default function RefundPolicyPage() {
  return (
    <LegalPage
      title="Refund & Cancellation Policy"
      updated="20 November 2026"
      intro={
        <p>
          TaskTrack is free to use. Premium is an optional paid plan. This page explains what you pay, how to cancel,
          and when you can get your money back. If you are under 18, a parent or guardian should make the payment and
          can ask for a refund for you.
        </p>
      }
    >
      <Section title="1. What you pay for">
        <ul>
          <li>
            <strong>Premium costs ₹699 for 3 months</strong>, paid once, in Indian rupees, by UPI to the TaskTrack UPI
            number shown in the app. The price is shown before you pay.
          </li>
          <li>
            Premium <strong>does not renew automatically</strong>. You are never charged again unless you choose to buy
            it again.
          </li>
          <li>
            After you pay and enter your UPI reference number (UTR), we check the payment and switch Premium on,
            usually within a few hours and always by the end of that day. Premium lasts 3 months from then. See what is included
            on the{' '}
            <Link href="/#plans">Plans section</Link>.
          </li>
          <li>TaskTrack sells a digital service only. There is nothing to ship or deliver.</li>
        </ul>
      </Section>

      <Section title="2. Cancelling">
        <ul>
          <li>
            Because Premium does not renew, there is no subscription to cancel. You keep Premium until the end of your
            3 months, and then your account goes back to the Free plan by itself.
          </li>
          <li>Your tasks, notes and study sessions stay in your account when Premium ends.</li>
          <li>
            You can delete your account at any time in Settings → Delete account. Deleting your account does not by
            itself refund a payment; ask us first if you want a refund (see below).
          </li>
        </ul>
      </Section>

      <Section title="3. Refunds">
        <ul>
          <li>
            <strong>7-day refund:</strong> if you are not happy with Premium, ask within 7 days of paying and we will
            refund the full amount. You don’t have to give a reason.
          </li>
          <li>
            After 7 days we don’t refund the remaining time, except where the next two points apply or where the law
            requires it.
          </li>
          <li>
            <strong>Charged by mistake:</strong> if you were charged twice, charged but didn’t get Premium, or a payment
            failed but money left your account, we refund it in full, whenever you tell us.
          </li>
          <li>
            <strong>If Premium stops working:</strong> if a major Premium feature is unavailable for a long time because
            of a problem on our side, we will offer a refund for the time you couldn’t use it.
          </li>
          <li>When a refund is made, your account moves back to the Free plan.</li>
        </ul>
      </Section>

      <Section title="4. How to ask for a refund">
        <ul>
          <li>
            Email {CONTACT} from the email address on your TaskTrack account. Include the UPI reference number (UTR) from
            your receipt, or the date and amount of the payment.
          </li>
          <li>We reply within 2 working days.</li>
          <li>
            Approved refunds are sent back by UPI to the account you paid from, within{' '}
            <strong>3 working days</strong> of approval.
          </li>
          <li>Never send us your card number, UPI PIN, OTP or bank password. We will never ask for them.</li>
        </ul>
      </Section>

      <Section title="5. Questions">
        <p>
          If something about a payment doesn’t look right, contact us before raising a dispute with your bank, and
          we’ll sort it out. See also our <Link href="/terms">Terms of Service</Link> and{' '}
          <Link href="/contact">Contact page</Link>.
        </p>
      </Section>
    </LegalPage>
  );
}
