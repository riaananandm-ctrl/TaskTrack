/*
# Add spaced review decks, cards and review log (persistent active recall)

1. Plain-English explanation
   This adds durable spaced-repetition study material. A student can save any
   flashcard set they generated (or wrote by hand) as a "review deck", and every
   card they practise is logged. A documented scheduling algorithm (the Leitner
   box system) decides when each card comes back for review, so decks become a
   real revision queue instead of a one-off chat reply.

2. New Tables
   - `review_decks` — one saved flashcard deck per row
     - `id` (uuid, primary key)
     - `user_id` (uuid, not null, defaults to the authenticated user, cascades on
       account deletion) — owner
     - `task_id` (uuid, nullable, references tasks on delete set null)
     - `session_id` (uuid, nullable, references study_sessions on delete set null)
       — the study session it was saved from, if any
     - `title` (text, not null) — deck name
     - `created_at`, `updated_at` (timestamptz, defaults)
   - `review_cards` — one flashcard per row
     - `id` (uuid, primary key)
     - `deck_id` (uuid, not null, references review_decks on delete cascade)
     - `user_id` (uuid, not null, defaults to auth.uid(), cascades) — owner, denormalised
       so every policy is a direct owner check
     - `front` (text, not null), `back` (text, not null) — editable card content
     - `box` (smallint, not null, default 1, check 1-5) — Leitner box: 1 = hardest,
       5 = easiest. Correct answers move the card up (longer interval), wrong
       answers drop it back to box 1.
     - `due_at` (timestamptz, not null, default now()) — when the card next shows
       up for review
     - `last_reviewed_at` (timestamptz, nullable)
     - `times_correct`, `times_wrong` (integer, not null, default 0) — lifetime tally,
       so progress separates activity from accuracy
     - `created_at`, `updated_at` (timestamptz, defaults)
   - `review_log` — one row per card review
     - `id`, `user_id` (owner, default auth.uid(), cascade), `card_id` (references
       review_cards on delete cascade), `deck_id` (uuid, nullable, set null)
     - `was_correct` (boolean, not null)
     - `reviewed_at` (timestamptz, default now())

3. Modified Tables
   - none (quiz_attempts already stores quiz history from Stage 4)

4. Security
   - RLS enabled on all three tables.
   - review_decks and review_cards: four owner-scoped policies each
     (SELECT / INSERT / UPDATE / DELETE), `TO authenticated`,
     `auth.uid() = user_id`.
   - review_log rows are never edited after creation: SELECT/INSERT owner-scoped
     policies only — no UPDATE or DELETE policy, so history is tamper-evident.
   - Grants: authenticated SELECT/INSERT (log) or SELECT/INSERT/UPDATE/DELETE
     (decks/cards), service_role SELECT only. Anon gets nothing.

5. Important notes
   - Additive only; no existing table or column is changed or dropped.
   - Decks survive task or session deletion (links become null).
   - Indexes on (user_id), (deck_id), and due_at for the daily review queue.
*/

CREATE TABLE IF NOT EXISTS review_decks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  session_id uuid REFERENCES study_sessions(id) ON DELETE SET NULL,
  title text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS review_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deck_id uuid NOT NULL REFERENCES review_decks(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  front text NOT NULL,
  back text NOT NULL,
  box smallint NOT NULL DEFAULT 1 CHECK (box >= 1 AND box >= 1 AND box <= 5),
  due_at timestamptz NOT NULL DEFAULT now(),
  last_reviewed_at timestamptz,
  times_correct integer NOT NULL DEFAULT 0 CHECK (times_correct >= 0),
  times_wrong integer NOT NULL DEFAULT 0 CHECK (times_wrong >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS review_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  card_id uuid NOT NULL REFERENCES review_cards(id) ON DELETE CASCADE,
  deck_id uuid REFERENCES review_decks(id) ON DELETE SET NULL,
  was_correct boolean NOT NULL,
  reviewed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE review_decks ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_log ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_review_decks_user ON review_decks (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_review_cards_deck ON review_cards (deck_id);
CREATE INDEX IF NOT EXISTS idx_review_cards_due ON review_cards (user_id, due_at);
CREATE INDEX IF NOT EXISTS idx_review_log_user_time ON review_log (user_id, reviewed_at DESC);
CREATE INDEX IF NOT EXISTS idx_review_log_card ON review_log (card_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON review_decks TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON review_cards TO authenticated;
GRANT SELECT, INSERT ON review_log TO authenticated;
GRANT SELECT ON review_decks, review_cards, review_log TO service_role;

-- review_decks: owner-scoped CRUD
DROP POLICY IF EXISTS "select_own_review_decks" ON review_decks;
CREATE POLICY "select_own_review_decks" ON review_decks FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "insert_own_review_decks" ON review_decks;
CREATE POLICY "insert_own_review_decks" ON review_decks FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "update_own_review_decks" ON review_decks;
CREATE POLICY "update_own_review_decks" ON review_decks FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "delete_own_review_decks" ON review_decks;
CREATE POLICY "delete_own_review_decks" ON review_decks FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- review_cards: owner-scoped CRUD (owner column is denormalised on purpose)
DROP POLICY IF EXISTS "select_own_review_cards" ON review_cards;
CREATE POLICY "select_own_review_cards" ON review_cards FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "insert_own_review_cards" ON review_cards;
CREATE POLICY "insert_own_review_cards" ON review_cards FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "update_own_review_cards" ON review_cards;
CREATE POLICY "update_own_review_cards" ON review_cards FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "delete_own_review_cards" ON review_cards;
CREATE POLICY "delete_own_review_cards" ON review_cards FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- review_log: append-only history
DROP POLICY IF EXISTS "select_own_review_log" ON review_log;
CREATE POLICY "select_own_review_log" ON review_log FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "insert_own_review_log" ON review_log;
CREATE POLICY "insert_own_review_log" ON review_log FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
