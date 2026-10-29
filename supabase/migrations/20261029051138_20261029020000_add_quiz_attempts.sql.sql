/*
# Add quiz_attempts table for durable quiz results and weak-topic tracking

1. Plain-English explanation
   When a student finishes a quiz inside a study session, the score, the
   per-question answer record, and the topics they got wrong are now stored in
   this table. Previously the quiz result only lived on the screen and was lost
   on reload. The stored history lets the app show real weak topics over time,
   and becomes the basis for targeted revision practice.

2. New Tables
   - `quiz_attempts`
     - `id` (uuid, primary key, defaults to gen_random_uuid())
     - `user_id` (uuid, not null, defaults to the authenticated user, references auth.users on delete cascade) — owner of the attempt
     - `session_id` (uuid, nullable, references study_sessions on delete set null) — the study session the quiz happened in
     - `task_id` (uuid, nullable, references tasks on delete set null) — the linked task, if any
     - `score` (integer, not null) — number of correct answers
     - `total` (integer, not null) — total number of questions
     - `answers` (jsonb, not null, default '[]') — array of { question, chosen, chosenIndex, correct }
     - `weak_topics` (jsonb, not null, default '[]') — array of topic strings to revise
     - `attempted_at` (timestamptz, not null, defaults to now()) — when the quiz was finished

3. Modified Tables
   - none

4. Security
   - RLS enabled on `quiz_attempts`.
   - Owner-scoped policies for SELECT / INSERT / UPDATE / DELETE, restricted to
     `authenticated` and keyed on `auth.uid() = user_id`. No anon access: the
     table only makes sense with a signed-in student.
   - Grants: SELECT/INSERT/DELETE to `authenticated` (the app never updates an
     attempt after the fact), plus SELECT/DELETE to `service_role` for future
     server-side analytics. Anon gets nothing.

5. Important notes
   - Additive only; no existing table or column is changed or dropped.
   - Rows are never auto-deleted when a task or session is removed — the
     attempt history (and its task_id/session_id) is set to null instead, so
     the record of what a student practised survives.
*/

CREATE TABLE IF NOT EXISTS quiz_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid REFERENCES study_sessions(id) ON DELETE SET NULL,
  task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  score integer NOT NULL CHECK (score >= 0),
  total integer NOT NULL CHECK (total > 0),
  answers jsonb NOT NULL DEFAULT '[]'::jsonb,
  weak_topics jsonb NOT NULL DEFAULT '[]'::jsonb,
  attempted_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE quiz_attempts ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_quiz_attempts_user_time
  ON quiz_attempts (user_id, attempted_at DESC);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_task
  ON quiz_attempts (task_id) WHERE task_id IS NOT NULL;

GRANT SELECT, INSERT, DELETE ON quiz_attempts TO authenticated;
GRANT SELECT, DELETE ON quiz_attempts TO service_role;

DROP POLICY IF EXISTS "select_own_quiz_attempts" ON quiz_attempts;
CREATE POLICY "select_own_quiz_attempts"
ON quiz_attempts FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_quiz_attempts" ON quiz_attempts;
CREATE POLICY "insert_own_quiz_attempts"
ON quiz_attempts FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_quiz_attempts" ON quiz_attempts;
CREATE POLICY "delete_own_quiz_attempts"
ON quiz_attempts FOR DELETE
TO authenticated
USING (auth.uid() = user_id);
