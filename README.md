# TaskTrack

**Know what's next.**

TaskTrack is a study planner for IB MYP and DP students. It pulls tasks in from
ManageBac, sorts them by subject and priority, reminds you before deadlines, and
helps you study with AI study sessions, a rewrite coach, and practice grading.

**Live site:** https://tasktrackbm.vercel.app

## Features

- Imports assignments from ManageBac
- Sorts tasks by subject, due date, and priority
- Deadline reminders
- AI study sessions
- Rewrite coach for improving written work
- Practice grading

## Tech stack

- Next.js and React
- TypeScript
- Tailwind CSS
- Supabase for the database and authentication
- Vercel for deployment

## Run it locally

```bash
git clone https://github.com/riaananandm-ctrl/TaskTrack.git
cd TaskTrack
npm install
npm run dev
```

Create a `.env.local` file with your own Supabase values:

```text
NEXT_PUBLIC_SUPABASE_URL=your_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
```

The anon key is safe in the browser only because Row Level Security is on for
every table. Never put the Supabase service role key in this file.

## Project structure

- `app/` — pages and routes
- `components/` — reusable UI
- `lib/` — helpers and Supabase client
- `supabase/` and `sql/` — database schema and policies
- `tests/` — test files

## Author

Built by **Riaan Anand Mura**, an IB MYP student in Hyderabad.

## Copyright

© 2026 Riaan Anand Mura. **All rights reserved.**

This code is public for viewing only. You may not copy, reuse, modify, host, or
redistribute any part of TaskTrack without written permission. See
[LICENSE](LICENSE) for the full terms.
