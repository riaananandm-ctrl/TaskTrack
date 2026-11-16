/**
 * TaskTrack release notes, newest first. Shown on /app/whats-new and in the
 * "Recently added" strip on the homepage. Only list features that are live.
 */

export interface ReleaseItem {
  title: string;
  description: string;
  /** Where in the app to try it, if there is one place. */
  href?: string;
  tag?: 'Beta';
}

export interface Release {
  /** Stable id; bump by adding a new release at the top. */
  id: string;
  date: string; // ISO date
  title: string;
  items: ReleaseItem[];
}

export const RELEASES: Release[] = [
  {
    id: '2026-11-16',
    date: '2026-11-16',
    title: 'Google Classroom, better slides and monthly AI credits',
    items: [
      {
        title: 'Google Classroom import',
        description:
          'Connect your school Google account in Settings → Integrations. Assignments with due dates become tasks, sync every 10 minutes, and tick off when you turn them in. Read-only.',
        href: '/app/settings?tab=integrations',
        tag: 'Beta',
      },
      {
        title: 'Slides you can download',
        description: 'Study slide decks now come with speaker notes and download as PowerPoint, ready to open in Google Slides.',
        href: '/app/study-sessions',
      },
      {
        title: 'Monthly AI credits',
        description: 'Every account gets AI credits each month (Free 100, Premium 2,000). They refill on the 1st, and you get them back if the AI fails.',
      },
      {
        title: 'Export your tasks',
        description: 'Download all your tasks as a spreadsheet file from Settings → Data.',
        href: '/app/settings?tab=data',
      },
      {
        title: 'Faster AI',
        description: 'Study sessions, quizzes and the Grader answer noticeably quicker.',
      },
    ],
  },
  {
    id: '2026-11-13',
    date: '2026-11-13',
    title: 'Safer Group Study',
    items: [
      {
        title: 'Chat filter and reports',
        description: 'Group Study blocks swear words in messages, names and room names, and you can report a message.',
        href: '/app/group',
      },
      {
        title: 'Privacy policy and terms',
        description: 'Clear terms and privacy policy, with age consent and parent consent for Group Study.',
      },
    ],
  },
  {
    id: '2026-11-12',
    date: '2026-11-12',
    title: 'AI Grader, Group Study and New Tasks',
    items: [
      {
        title: 'AI Grader',
        description: 'Paste a draft and get an estimated IB level for each criterion, plus what to fix. Estimates are not official IB grades.',
        href: '/app/grader',
      },
      {
        title: 'Group Study',
        description: 'Private study rooms joined with a code, where the AI can help the whole group.',
        href: '/app/group',
      },
      {
        title: 'New Tasks',
        description: 'One page for tasks you have not looked at yet and what is due today.',
        href: '/app/new',
      },
      {
        title: 'Smarter sorting',
        description: 'The AI sorts imported tasks into your subjects and sets priorities from the title, so summatives come first.',
      },
    ],
  },
  {
    id: '2026-11-11',
    date: '2026-11-11',
    title: 'Day-before reminders and Google sign-in',
    items: [
      {
        title: 'Day-before reminders',
        description: 'Every task gets a reminder the day before it is due, at your default reminder time (8:00 unless you change it in Settings).',
        href: '/app/notifications',
      },
      {
        title: 'Continue with Google',
        description: 'Sign in with your Google account, and stay signed in between visits.',
      },
      {
        title: 'ManageBac every 10 minutes',
        description: 'Your ManageBac calendar now syncs every 10 minutes.',
        href: '/app/settings?tab=integrations',
      },
    ],
  },
];

export const LATEST_RELEASE_ID = RELEASES[0].id;
const SEEN_KEY = 'tasktrack.whatsnew.seen';

export function hasUnseenRelease(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) !== LATEST_RELEASE_ID;
  } catch {
    return false;
  }
}

export function markReleasesSeen(): void {
  try {
    window.localStorage.setItem(SEEN_KEY, LATEST_RELEASE_ID);
    window.dispatchEvent(new Event('tasktrack:whatsnew-seen'));
  } catch {
    // Storage blocked: the dot just keeps showing.
  }
}
