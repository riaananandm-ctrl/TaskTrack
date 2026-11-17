import Link from 'next/link';
import { CONTACT, LegalPage, Section } from '@/components/legal-page';

export const metadata = { title: 'Privacy Policy | TaskTrack' };

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      updated="13 November 2026"
      intro={
        <p>
          This explains, in plain English, what TaskTrack collects, why, who helps us run it, and the choices you have.
          Many of our users are school students under 18, so we follow India’s Digital Personal Data Protection Act,
          2023 (DPDP Act) and treat everyone under 18 as a child. If you are under 18, please read this with a parent
          or guardian.
        </p>
      }
    >
      <Section title="1. Who we are">
        <p>
          TaskTrack (“we”) is a free study planner built and run by a small team of students in India. For this
          policy, TaskTrack is the “data fiduciary”: we decide how your data is used. You can reach us at {CONTACT}.
        </p>
      </Section>

      <Section title="2. What we collect">
        <ul>
          <li>
            <strong>Account details:</strong> your name, email address, year group and, if you add it, your school
            name. If you sign in with Google, we receive your name and email from Google. We never see your Google
            password.
          </li>
          <li>
            <strong>Age and consent:</strong> whether you are 18 or older, when you accepted these terms, and, for
            students under 18, the name a parent or guardian typed and when they gave consent. If you say you are 18 or
            older and do the camera age check, we keep only its result (&ldquo;18 or older&rdquo; or &ldquo;under
            18&rdquo;), when you agreed to it and when it ran. We never receive or store your camera image or any face
            data.
          </li>
          <li>
            <strong>Your schoolwork:</strong> tasks, deadlines, subjects, notes, reminders, documents you upload, study
            sessions and work you paste into the AI Grader.
          </li>
          <li>
            <strong>ManageBac calendar:</strong> if you connect it, the private calendar link you paste and the
            deadlines it contains. We only read the calendar feed. We never ask for your ManageBac password.
          </li>
          <li>
            <strong>Group Study:</strong> rooms you create or join, your first name in those rooms, your messages, and
            any reports you make.
          </li>
          <li>
            <strong>Notifications:</strong> if you turn them on, the technical address your browser gives us to deliver
            reminders.
          </li>
          <li>
            <strong>Basic technical data:</strong> sign-in records and error logs our hosting providers keep to run and
            protect the service.
          </li>
        </ul>
        <p>
          We do <strong>not</strong> collect your location, contacts, photos or payment details, and we don’t use
          advertising or tracking cookies.
        </p>
      </Section>

      <Section title="3. Why we use it">
        <ul>
          <li>To run your account and show your tasks, reminders and study tools.</li>
          <li>To import your deadlines from ManageBac when you connect it.</li>
          <li>To generate AI explanations, quizzes, flashcards, study plans and grade estimates you ask for.</li>
          <li>To run Group Study, filter swear words, and review reports to keep students safe.</li>
          <li>To send reminders you turn on, and to fix bugs and stop abuse.</li>
        </ul>
        <p>
          We only use your data for these purposes. We <strong>never sell</strong> your data, never show ads, and
          never build profiles of children for advertising or behavioural tracking.
        </p>
      </Section>

      <Section title="4. Students under 18 and parental consent">
        <p>
          When you start using TaskTrack, we ask whether you are 18 or older. If you are under 18, you can plan your
          own schoolwork straight away, but <strong>Group Study</strong>, where you chat with other students, stays
          locked until a parent or guardian agrees using a one-time link you send them. They see what we collect and
          type their name to confirm.
        </p>
        <p>
          <strong>Camera age check.</strong> If you say you are 18 or older, we ask you to agree separately to a short
          camera scan that estimates your age. It runs entirely on your device using a model loaded from our own site:
          your camera image never leaves your device and is not saved. Only the result is stored. Age estimates can be
          wrong by a few years, so a result of &ldquo;under 18&rdquo; simply means Group Study needs a parent or
          guardian&rsquo;s OK, as above. You can skip the scan and continue as under 18 instead.
        </p>
        <p>
          A parent or guardian can withdraw consent, see the data we hold about their child, or ask us to delete the
          account at any time by contacting {CONTACT}. If we learn that a child is using Group Study without consent,
          we will lock it until consent is given.
        </p>
      </Section>

      <Section title="5. Who helps us run TaskTrack">
        <p>We use these services to run the app. They only process your data to provide their service to us:</p>
        <ul>
          <li>
            <strong>Supabase</strong>: our database, sign-in and file storage.
          </li>
          <li>
            <strong>Vercel</strong>: hosts the website.
          </li>
          <li>
            <strong>Groq</strong>: runs the AI models behind study sessions, the AI Grader and the Group Study AI. Only
            the text needed to answer your request is sent.
          </li>
          <li>
            <strong>Google</strong>: only if you choose “Continue with Google”.
          </li>
          <li>
            <strong>ManageBac (Faria Education Group)</strong>: only if you connect your calendar link; we read the
            feed your school publishes for you.
          </li>
          <li>
            <strong>Your browser’s push service</strong> (for example Google or Apple): only if you turn on
            notifications.
          </li>
        </ul>
        <p>
          Some of these providers store data outside India. We only use reputable providers that protect it, and we
          share as little as possible.
        </p>
      </Section>

      <Section title="6. What other students can see">
        <p>
          Your tasks, notes and AI sessions are private to you. In Group Study, other people in the same room see your
          <strong> first name</strong> and the messages you send. They never see your email, surname or school. Swear
          words are replaced with “#” automatically, and anyone can report a message.
        </p>
      </Section>

      <Section title="7. How long we keep data">
        <ul>
          <li>Your account data is kept while your account is open.</li>
          <li>
            When you delete your account (Settings → Delete account), your profile, tasks, notes, documents and
            messages are deleted, normally within 30 days, including from backups as they cycle out.
          </li>
          <li>
            Reports about Group Study messages are kept for up to 1 year so we can deal with repeated problems, then
            deleted.
          </li>
        </ul>
      </Section>

      <Section title="8. Your rights">
        <p>Under the DPDP Act you (or your parent or guardian, if you are under 18) can:</p>
        <ul>
          <li>ask what data we hold about you and how it is used;</li>
          <li>correct or update it (most of it you can edit yourself in Settings);</li>
          <li>delete it, by deleting your account in Settings or by asking us;</li>
          <li>withdraw consent at any time;</li>
          <li>raise a complaint with us, and if you aren’t satisfied, with the Data Protection Board of India;</li>
          <li>nominate someone to act for you if you are unable to.</li>
        </ul>
        <p>Contact {CONTACT}. We aim to reply within 7 days and to resolve requests within 30 days.</p>
      </Section>

      <Section title="9. Keeping data safe">
        <p>
          Data is encrypted in transit, every table is protected so students can only reach their own data, and AI
          and calendar keys are kept on the server. No system is perfectly secure: if a breach affects you, we will
          tell you and the authorities as the law requires.
        </p>
      </Section>

      <Section title="10. Changes">
        <p>
          If we change this policy in a meaningful way, we will update the date above and ask you to accept the new
          version the next time you open the app.
        </p>
        <p>
          See also our <Link href="/terms">Terms of Service</Link>.
        </p>
      </Section>
    </LegalPage>
  );
}
