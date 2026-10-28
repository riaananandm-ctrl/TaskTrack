/*
# Add persistent Study Sessions

## 1. Purpose
The Study Assistant chat was previously ephemeral — closing it discarded the
conversation. This migration adds durable storage so a student can start a study
session from a task, close it, and reopen it later with every message intact.

This is the minimum data structure required. No existing table is modified.

## 2. New Tables

### study_sessions
One row per study session opened from a task.
- `id` (uuid, primary key)
- `user_id` (uuid, not null, defaults to the signed-in user)
- `task_id` (uuid, nullable, references tasks; set to null if the task is deleted
  so a student never loses a conversation they wrote)
- `title` (text, not null) — snapshot of the task title, editable so a student can rename
- `status` (text, not null, default 'active') — one of active, completed, archived
- `created_at`, `updated_at` (timestamptz)

### study_session_messages
One row per chat message, always belonging to exactly one session.
- `id` (uuid, primary key)
- `session_id` (uuid, not null, references study_sessions, deleted with the session)
- `user_id` (uuid, not null, defaults to the signed-in user)
- `role` (text, not null) — 'user' or 'assistant'
- `content` (text, not null) — the plain-text reply; also the fallback when a
  structured payload is malformed
- `mode` (text, nullable) — which study mode produced this message
  (chat, explain, quiz, flashcards, plan, examples, slides)
- `structured_data` (jsonb, nullable) — saved quiz/flashcard/plan/slide payload
- `created_at` (timestamptz)

## 3. Constraints
- `status` is restricted to active/completed/archived by a CHECK constraint.
- `role` is restricted to user/assistant by a CHECK constraint.
- A session can be deleted by its owner; its messages cascade away with it.

## 4. Security
- Row Level Security is enabled on BOTH tables. Nothing is readable without a policy.
- Four separate policies per table (SELECT, INSERT, UPDATE, DELETE) — no FOR ALL.
- All policies are scoped `TO authenticated`.
- `user_id` defaults to `auth.uid()` so an insert that omits it still satisfies the
  INSERT policy's ownership check.
- Message policies check BOTH that the row is the caller's own AND that the parent
  session belongs to the caller, so a user can never read or write a message in
  someone else's session. Frontend filtering is never relied upon.

## 5. Indexes
- study_sessions: user_id, task_id, status
- study_session_messages: session_id, user_id
*/

CREATE TABLE IF NOT EXISTS study_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT study_sessions_status_check CHECK (status IN ('active', 'completed', 'archived'))
);

ALTER TABLE study_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_study_sessions" ON study_sessions;
CREATE POLICY "select_own_study_sessions" ON study_sessions FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_study_sessions" ON study_sessions;
CREATE POLICY "insert_own_study_sessions" ON study_sessions FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_study_sessions" ON study_sessions;
CREATE POLICY "update_own_study_sessions" ON study_sessions FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_study_sessions" ON study_sessions;
CREATE POLICY "delete_own_study_sessions" ON study_sessions FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS study_session_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES study_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL,
  content text NOT NULL,
  mode text,
  structured_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT study_session_messages_role_check CHECK (role IN ('user', 'assistant'))
);

ALTER TABLE study_session_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_study_session_messages" ON study_session_messages;
CREATE POLICY "select_own_study_session_messages" ON study_session_messages FOR SELECT
  TO authenticated
  USING (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM study_sessions s
      WHERE s.id = study_session_messages.session_id
        AND s.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "insert_own_study_session_messages" ON study_session_messages;
CREATE POLICY "insert_own_study_session_messages" ON study_session_messages FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM study_sessions s
      WHERE s.id = study_session_messages.session_id
        AND s.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "update_own_study_session_messages" ON study_session_messages;
CREATE POLICY "update_own_study_session_messages" ON study_session_messages FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM study_sessions s
      WHERE s.id = study_session_messages.session_id
        AND s.user_id = auth.uid()
    )
  )
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM study_sessions s
      WHERE s.id = study_session_messages.session_id
        AND s.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "delete_own_study_session_messages" ON study_session_messages;
CREATE POLICY "delete_own_study_session_messages" ON study_session_messages FOR DELETE
  TO authenticated
  USING (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM study_sessions s
      WHERE s.id = study_session_messages.session_id
        AND s.user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_study_sessions_user_id ON study_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_study_sessions_task_id ON study_sessions(task_id);
CREATE INDEX IF NOT EXISTS idx_study_sessions_status ON study_sessions(status);
CREATE INDEX IF NOT EXISTS idx_study_sessions_updated_at ON study_sessions(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_study_session_messages_session_id ON study_session_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_study_session_messages_user_id ON study_session_messages(user_id);

DROP TRIGGER IF EXISTS update_study_sessions_updated_at ON study_sessions;
CREATE TRIGGER update_study_sessions_updated_at BEFORE UPDATE ON study_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
