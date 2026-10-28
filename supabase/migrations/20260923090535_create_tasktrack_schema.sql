/*
# TaskTrack — Full Schema

Creates the complete database for a student productivity app with:
- User profiles (linked to auth.users)
- Subjects (per-user, with colour, icon, teacher, room)
- Tasks (per-user, with category, priority, status, due date/time, notes, links)
- Reminders (per-user, linked to tasks, with repeat rules)
- Weekly plans (per-user, linked to tasks, with planned date and time blocks)
- User settings (per-user, notification preferences, theme)

All tables have:
- Row Level Security enabled
- Owner-scoped policies (auth.uid() = user_id) so users only see their own data
- Indexes on frequently queried columns (user_id, due_date, status)
- Timestamps (created_at, updated_at)
- Foreign keys with ON DELETE CASCADE for child tables

## Tables

### profiles
- id (uuid PK, references auth.users)
- full_name, email, year_group, school_name, timezone
- created_at, updated_at

### subjects
- id (uuid PK)
- user_id (uuid, references auth.users, default auth.uid())
- name, colour, icon, teacher_name, room, is_archived
- created_at, updated_at

### tasks
- id (uuid PK)
- user_id (uuid, references auth.users, default auth.uid())
- subject_id (uuid nullable, references subjects, ON DELETE SET NULL)
- title, description, category, due_date, due_time, priority, status
- estimated_minutes, notes, external_link, is_archived, completed_at
- created_at, updated_at

### reminders
- id (uuid PK)
- user_id (uuid, references auth.users, default auth.uid())
- task_id (uuid nullable, references tasks, ON DELETE SET NULL)
- title, message, reminder_type, scheduled_for, repeat_rule
- is_enabled, is_read
- created_at, updated_at

### weekly_plans
- id (uuid PK)
- user_id (uuid, references auth.users, default auth.uid())
- task_id (uuid, references tasks, ON DELETE CASCADE)
- planned_date, start_time, end_time
- created_at, updated_at

### user_settings
- id (uuid PK)
- user_id (uuid unique, references auth.users, default auth.uid())
- task_reminders_enabled, overdue_reminders_enabled
- daily_summary_enabled, weekly_summary_enabled
- quiet_hours_start, quiet_hours_end, preferred_reminder_time
- theme, compact_view
- created_at, updated_at

## Security
- RLS enabled on every table
- 4 policies per table (SELECT, INSERT, UPDATE, DELETE) scoped to authenticated users
- All policies check auth.uid() = user_id (or auth.uid() = id for profiles)
- user_id columns default to auth.uid() so inserts work without passing user_id
*/

-- Profiles table
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  email text NOT NULL,
  year_group text,
  school_name text,
  timezone text DEFAULT 'UTC',
  onboarding_completed boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_profile" ON profiles;
CREATE POLICY "select_own_profile" ON profiles FOR SELECT
  TO authenticated USING (auth.uid() = id);
DROP POLICY IF EXISTS "insert_own_profile" ON profiles;
CREATE POLICY "insert_own_profile" ON profiles FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = id);
DROP POLICY IF EXISTS "update_own_profile" ON profiles;
CREATE POLICY "update_own_profile" ON profiles FOR UPDATE
  TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
DROP POLICY IF EXISTS "delete_own_profile" ON profiles;
CREATE POLICY "delete_own_profile" ON profiles FOR DELETE
  TO authenticated USING (auth.uid() = id);

-- Subjects table
CREATE TABLE IF NOT EXISTS subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  colour text NOT NULL DEFAULT '#2563EB',
  icon text NOT NULL DEFAULT 'BookOpen',
  teacher_name text,
  room text,
  is_archived boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE subjects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_subjects" ON subjects;
CREATE POLICY "select_own_subjects" ON subjects FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "insert_own_subjects" ON subjects;
CREATE POLICY "insert_own_subjects" ON subjects FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "update_own_subjects" ON subjects;
CREATE POLICY "update_own_subjects" ON subjects FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "delete_own_subjects" ON subjects;
CREATE POLICY "delete_own_subjects" ON subjects FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- Tasks table
CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  subject_id uuid REFERENCES subjects(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'homework',
  due_date date,
  due_time text,
  priority text NOT NULL DEFAULT 'medium',
  status text NOT NULL DEFAULT 'not_started',
  estimated_minutes integer,
  notes text,
  external_link text,
  is_archived boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_tasks" ON tasks;
CREATE POLICY "select_own_tasks" ON tasks FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "insert_own_tasks" ON tasks;
CREATE POLICY "insert_own_tasks" ON tasks FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "update_own_tasks" ON tasks;
CREATE POLICY "update_own_tasks" ON tasks FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "delete_own_tasks" ON tasks;
CREATE POLICY "delete_own_tasks" ON tasks FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- Reminders table
CREATE TABLE IF NOT EXISTS reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  title text NOT NULL,
  message text,
  reminder_type text NOT NULL DEFAULT 'task_due',
  scheduled_for timestamptz NOT NULL,
  repeat_rule text NOT NULL DEFAULT 'none',
  is_enabled boolean NOT NULL DEFAULT true,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE reminders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_reminders" ON reminders;
CREATE POLICY "select_own_reminders" ON reminders FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "insert_own_reminders" ON reminders;
CREATE POLICY "insert_own_reminders" ON reminders FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "update_own_reminders" ON reminders;
CREATE POLICY "update_own_reminders" ON reminders FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "delete_own_reminders" ON reminders;
CREATE POLICY "delete_own_reminders" ON reminders FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- Weekly plans table
CREATE TABLE IF NOT EXISTS weekly_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  planned_date date NOT NULL,
  start_time text,
  end_time text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE weekly_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_weekly_plans" ON weekly_plans;
CREATE POLICY "select_own_weekly_plans" ON weekly_plans FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "insert_own_weekly_plans" ON weekly_plans;
CREATE POLICY "insert_own_weekly_plans" ON weekly_plans FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "update_own_weekly_plans" ON weekly_plans;
CREATE POLICY "update_own_weekly_plans" ON weekly_plans FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "delete_own_weekly_plans" ON weekly_plans;
CREATE POLICY "delete_own_weekly_plans" ON weekly_plans FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- User settings table
CREATE TABLE IF NOT EXISTS user_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  task_reminders_enabled boolean NOT NULL DEFAULT true,
  overdue_reminders_enabled boolean NOT NULL DEFAULT true,
  daily_summary_enabled boolean NOT NULL DEFAULT false,
  weekly_summary_enabled boolean NOT NULL DEFAULT false,
  quiet_hours_start text DEFAULT '22:00',
  quiet_hours_end text DEFAULT '07:00',
  preferred_reminder_time text DEFAULT '08:00',
  theme text NOT NULL DEFAULT 'light',
  compact_view boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_user_settings" ON user_settings;
CREATE POLICY "select_own_user_settings" ON user_settings FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "insert_own_user_settings" ON user_settings;
CREATE POLICY "insert_own_user_settings" ON user_settings FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "update_own_user_settings" ON user_settings;
CREATE POLICY "update_own_user_settings" ON user_settings FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "delete_own_user_settings" ON user_settings;
CREATE POLICY "delete_own_user_settings" ON user_settings FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_subjects_user_id ON subjects(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_subject_id ON tasks(subject_id);
CREATE INDEX IF NOT EXISTS idx_reminders_user_id ON reminders(user_id);
CREATE INDEX IF NOT EXISTS idx_reminders_task_id ON reminders(task_id);
CREATE INDEX IF NOT EXISTS idx_reminders_scheduled_for ON reminders(scheduled_for);
CREATE INDEX IF NOT EXISTS idx_weekly_plans_user_id ON weekly_plans(user_id);
CREATE INDEX IF NOT EXISTS idx_weekly_plans_task_id ON weekly_plans(task_id);
CREATE INDEX IF NOT EXISTS idx_weekly_plans_planned_date ON weekly_plans(planned_date);
CREATE INDEX IF NOT EXISTS idx_user_settings_user_id ON user_settings(user_id);

-- Auto-update updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_profiles_updated_at ON profiles;
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_subjects_updated_at ON subjects;
CREATE TRIGGER update_subjects_updated_at BEFORE UPDATE ON subjects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_tasks_updated_at ON tasks;
CREATE TRIGGER update_tasks_updated_at BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_reminders_updated_at ON reminders;
CREATE TRIGGER update_reminders_updated_at BEFORE UPDATE ON reminders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_weekly_plans_updated_at ON weekly_plans;
CREATE TRIGGER update_weekly_plans_updated_at BEFORE UPDATE ON weekly_plans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_user_settings_updated_at ON user_settings;
CREATE TRIGGER update_user_settings_updated_at BEFORE UPDATE ON user_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, full_name, email)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name', NEW.email);
  RETURN NEW;
END;
$$ language 'plpgsql' SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();