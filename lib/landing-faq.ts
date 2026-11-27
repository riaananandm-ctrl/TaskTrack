/** Homepage FAQ. Also published as FAQPage structured data for search. */
export const LANDING_FAQS: { q: string; a: string }[] = [
  {
    q: 'Do I need ManageBac?',
    a: 'No. TaskTrack works on its own. If your school uses ManageBac, paste your calendar link once and its deadlines import into TaskTrack.',
  },
  {
    q: 'Does it work with Google Classroom?',
    a: 'Yes, in beta. Connect your school Google account in Settings → Integrations. TaskTrack can only read your classes and your own assignments, never change them. Some schools need their IT admin to allow TaskTrack first.',
  },
  {
    q: 'How do reminders work?',
    a: 'Every task automatically gets a reminder the day before it is due, at your default reminder time (8:00 unless you change it). You can add your own reminders too, and TaskTrack suggests good times. Reminders arrive as notifications in TaskTrack and as push notifications when you allow them. Email reminders are coming soon.',
  },
  {
    q: 'Does TaskTrack alert me when teachers change something?',
    a: 'ManageBac syncs every 5 minutes and Google Classroom every 10 minutes, so changed due dates show up quickly. If you already edited a task yourself, your edit is kept. There are no instant alerts when a teacher changes something.',
  },
  {
    q: 'How do AI credits work?',
    a: 'Every AI action uses credits: a chat message or explanation is 1, flashcards are 2, an AI Grader check is 5, and a quiz, study plan or slide deck is 8. Bigger requests use a little more. Free accounts get 40 credits a month, Premium 500 and Max 1,000. They refill on the 1st of every month, and if the AI fails you get them back.',
  },
  {
    q: 'What do Premium and Max add?',
    a: 'Premium (₹499 for 3 months) gives 500 AI credits a month, the AI whiteboard tutor, the AI Detector, unlimited tasks and reminders, worked examples, study plans, and bigger quizzes and flashcard sets. Max (₹999 for 3 months) adds 1,000 credits a month and Rewrite Coach. Premium also comes as a single month for ₹149. Every account can try Premium free for 7 days. All plans are paid once by UPI and never renew by themselves.',
  },
];
