/*
# Add plans, AI usage limits, and plan limits

## Purpose
Introduce a Free/Pro plan model for TaskTrack with server-enforced daily AI usage
limits for the Study Assistant.

## 1. Modified tables

### profiles
- `plan` (text, NOT NULL, default 'free') — the user's active plan: 'free' or 'pro'.
- `plan_expires_at` (timestamptz, nullable) — when a Pro plan ends. Null means no expiry.

### Security change on profiles
The `plan` and `plan_expires_at` columns are privilege-bearing: they must never be
writable by the user themselves. Row-level security controls WHICH ROWS a user may
update, not WHICH COLUMNS, so the table-wide UPDATE grant is revoked and re-granted
only for the columns users genuinely own:
- full_name, year_group, school_name, timezone, onboarding_completed
Plan changes therefore can only happen through a trusted server-side path
(e.g. a future payment webhook using the service role), never from the browser.

## 2. New tables

### plan_limits
Server-side configuration of what each plan is allowed. Readable by signed-in users
so the UI can display limits, writable by nobody (service role only).
- `plan` (text, primary key)
- `daily_ai_messages` (integer) — max successful AI requests per calendar day
- `max_message_chars` (integer) — max length of a single user message
- `quiz_questions` (integer) — questions per generated quiz
- `flashcards` (integer) — cards per generated flashcard set

### ai_usage
One row per user per calendar day, tracking successful AI requests.
- `user_id` (uuid, defaults to the signed-in user)
- `usage_date` (date) — UTC calendar day
- `request_count` (integer, default 0)
- Unique on (user_id, usage_date)

## 3. Security
- RLS enabled on both new tables.
- `plan_limits`: SELECT for authenticated only; no write policies (deny-by-default).
- `ai_usage`: SELECT for the owning user only; no write policies. All increments and
  decrements happen inside SECURITY DEFINER functions, so the browser cannot inflate
  or reset its own usage.

## 4. Functions
- `reserve_ai_request()` — atomically checks the caller's plan, refuses when the daily
  limit is reached, and otherwise increments today's counter. Returns whether the
  request is allowed, the count used, and the daily limit. Reads the limit from
  `plan_limits` so the caller cannot choose its own limit.
- `refund_ai_request()` — decrements today's counter (never below zero). Called when an
  upstream AI request fails, so failed requests are not counted.

Both derive the user from auth.uid() and pin search_path.
*/

-- 1. profiles: plan columns
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'free';
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS plan_expires_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_plan_check'
  ) THEN
    ALTER TABLE profiles
      ADD CONSTRAINT profiles_plan_check CHECK (plan IN ('free', 'pro'));
  END IF;
END $$;

-- 2. plan_limits configuration table
CREATE TABLE IF NOT EXISTS plan_limits (
  plan text PRIMARY KEY,
  daily_ai_messages integer NOT NULL,
  max_message_chars integer NOT NULL,
  quiz_questions integer NOT NULL,
  flashcards integer NOT NULL,
  updated_at timestamptz DEFAULT now()
);

INSERT INTO plan_limits (plan, daily_ai_messages, max_message_chars, quiz_questions, flashcards)
VALUES
  ('free', 20, 2000, 5, 5),
  ('pro', 100, 2000, 8, 12)
ON CONFLICT (plan) DO UPDATE SET
  daily_ai_messages = EXCLUDED.daily_ai_messages,
  max_message_chars = EXCLUDED.max_message_chars,
  quiz_questions = EXCLUDED.quiz_questions,
  flashcards = EXCLUDED.flashcards;

ALTER TABLE plan_limits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read_plan_limits" ON plan_limits;
CREATE POLICY "read_plan_limits" ON plan_limits FOR SELECT
  TO authenticated USING (true);

-- 3. ai_usage table
CREATE TABLE IF NOT EXISTS ai_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  usage_date date NOT NULL DEFAULT ((now() AT TIME ZONE 'utc')::date),
  request_count integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (user_id, usage_date)
);

ALTER TABLE ai_usage ENABLE ROW LEVEL SECURITY;

-- Read-only for the owner. Writes happen only through the functions below, so
-- there are deliberately no INSERT/UPDATE/DELETE policies (deny by default).
DROP POLICY IF EXISTS "select_own_ai_usage" ON ai_usage;
CREATE POLICY "select_own_ai_usage" ON ai_usage FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_ai_usage_user_date ON ai_usage(user_id, usage_date);

-- 4. Narrow the profiles UPDATE grant so plan columns are not user-writable
REVOKE UPDATE ON profiles FROM authenticated;
GRANT UPDATE (full_name, year_group, school_name, timezone, onboarding_completed)
  ON profiles TO authenticated;
GRANT INSERT (id, full_name, email, year_group, school_name, timezone, onboarding_completed)
  ON profiles TO authenticated;

-- 5. reserve_ai_request(): atomic check-and-increment
CREATE OR REPLACE FUNCTION reserve_ai_request()
RETURNS TABLE(allowed boolean, used integer, daily_limit integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_today date := (now() AT TIME ZONE 'utc')::date;
  v_plan text;
  v_limit integer;
  v_count integer;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT COALESCE(p.plan, 'free') INTO v_plan FROM profiles p WHERE p.id = v_user;
  v_plan := COALESCE(v_plan, 'free');

  SELECT pl.daily_ai_messages INTO v_limit FROM plan_limits pl WHERE pl.plan = v_plan;
  v_limit := COALESCE(v_limit, 20);

  INSERT INTO ai_usage (user_id, usage_date, request_count)
  VALUES (v_user, v_today, 0)
  ON CONFLICT (user_id, usage_date) DO NOTHING;

  SELECT request_count INTO v_count
  FROM ai_usage
  WHERE user_id = v_user AND usage_date = v_today
  FOR UPDATE;

  IF v_count >= v_limit THEN
    RETURN QUERY SELECT false, v_count, v_limit;
    RETURN;
  END IF;

  UPDATE ai_usage
  SET request_count = request_count + 1, updated_at = now()
  WHERE user_id = v_user AND usage_date = v_today;

  RETURN QUERY SELECT true, v_count + 1, v_limit;
END;
$$;

REVOKE EXECUTE ON FUNCTION reserve_ai_request() FROM anon;
GRANT EXECUTE ON FUNCTION reserve_ai_request() TO authenticated;

-- 6. refund_ai_request(): undo a reservation when the AI call fails
CREATE OR REPLACE FUNCTION refund_ai_request()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_today date := (now() AT TIME ZONE 'utc')::date;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE ai_usage
  SET request_count = GREATEST(request_count - 1, 0), updated_at = now()
  WHERE user_id = v_user AND usage_date = v_today;
END;
$$;

REVOKE EXECUTE ON FUNCTION refund_ai_request() FROM anon;
GRANT EXECUTE ON FUNCTION refund_ai_request() TO authenticated;
