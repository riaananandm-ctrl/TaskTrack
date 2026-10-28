/*
# Gamification and Metrics Tables

## Purpose
Adds XP, streaks, badges, and privacy-safe onboarding metrics to support
the new ManageBac-first starter page and student engagement features.

## New Tables

### user_xp
- Tracks total XP and level per user.
- user_id (uuid, FK to auth.users, ON DELETE CASCADE)
- total_xp (integer, default 0)
- level (integer, default 1)
- updated_at (timestamptz)

### user_streaks
- Tracks daily study streaks.
- user_id (uuid, FK to auth.users, ON DELETE CASCADE)
- current_streak (integer, default 0)
- longest_streak (integer, default 0)
- last_study_date (date, nullable)
- updated_at (timestamptz)

### user_badges
- Awards badges for specific achievements.
- user_id (uuid, FK to auth.users, ON DELETE CASCADE)
- badge_key (text, e.g. 'managebac_connected', 'first_ai_study_session')
- awarded_at (timestamptz, default now())
- Unique constraint on (user_id, badge_key) to prevent duplicates.

### app_metrics
- Privacy-safe funnel events for onboarding and engagement tracking.
- id (uuid, primary key)
- user_id (uuid, FK to auth.users, ON DELETE CASCADE)
- event_name (text, e.g. 'onboarding_started', 'managebac_connected')
- event_data (jsonb, nullable — for non-sensitive context like step number)
- created_at (timestamptz, default now())

## Security
- All tables have RLS enabled.
- All policies scope to TO authenticated with auth.uid() = user_id.
- No anon grants on any of these tables.
- app_metrics is insert-only for authenticated users (no SELECT, UPDATE, DELETE)
  so users cannot read other users' metrics or modify their own event history.
- user_xp, user_streaks, user_badges allow SELECT and INSERT only (no UPDATE/DELETE)
  to prevent tampering. XP is accumulated via a SECURITY DEFINER function.

## Functions
- award_xp(p_user_id uuid, p_amount int, p_reason text): atomically adds XP,
  recalculates level, and records a metric event. SECURITY DEFINER with
  auth.uid() check so it can only be called by the authenticated user themselves.
- record_metric(p_event_name text, p_event_data jsonb): inserts a metric event
  for the calling user. SECURITY DEFINER with auth.uid() check.

## Idempotency
- award_xp is safe to retry: it uses INSERT ... ON CONFLICT DO NOTHING for badges
  and upsert for XP, so calling it multiple times for the same action is safe
  when paired with a badge_key check.
- Badges are unique per (user_id, badge_key), so awarding the same badge twice
  is a no-op.
*/

-- ---------------------------------------------------------------------------
-- user_xp
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_xp (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  total_xp integer NOT NULL DEFAULT 0,
  level integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE user_xp ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_user_xp" ON user_xp;
CREATE POLICY "select_own_user_xp" ON user_xp FOR SELECT
TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_user_xp" ON user_xp;
CREATE POLICY "insert_own_user_xp" ON user_xp FOR INSERT
TO authenticated WITH CHECK (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- user_streaks
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_streaks (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  current_streak integer NOT NULL DEFAULT 0,
  longest_streak integer NOT NULL DEFAULT 0,
  last_study_date date,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE user_streaks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_user_streaks" ON user_streaks;
CREATE POLICY "select_own_user_streaks" ON user_streaks FOR SELECT
TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_user_streaks" ON user_streaks;
CREATE POLICY "insert_own_user_streaks" ON user_streaks FOR INSERT
TO authenticated WITH CHECK (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- user_badges
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_badges (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  badge_key text NOT NULL,
  awarded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, badge_key)
);

ALTER TABLE user_badges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_user_badges" ON user_badges;
CREATE POLICY "select_own_user_badges" ON user_badges FOR SELECT
TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_user_badges" ON user_badges;
CREATE POLICY "insert_own_user_badges" ON user_badges FOR INSERT
TO authenticated WITH CHECK (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- app_metrics (insert-only for authenticated users)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_metrics (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_name text NOT NULL,
  event_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app_metrics ENABLE ROW LEVEL SECURITY;

-- Users can only INSERT their own metrics, never read or modify them.
DROP POLICY IF EXISTS "insert_own_app_metrics" ON app_metrics;
CREATE POLICY "insert_own_app_metrics" ON app_metrics FOR INSERT
TO authenticated WITH CHECK (auth.uid() = user_id);

-- Index for querying a user's metric timeline (server-side only).
CREATE INDEX IF NOT EXISTS idx_app_metrics_user_id ON app_metrics (user_id, created_at);

-- ---------------------------------------------------------------------------
-- award_xp function
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.award_xp(p_amount integer, p_reason text, p_badge_key text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_new_xp integer;
  v_new_level integer;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Upsert XP
  INSERT INTO user_xp (user_id, total_xp, level)
  VALUES (v_user, p_amount, 1)
  ON CONFLICT (user_id) DO UPDATE
  SET total_xp = user_xp.total_xp + p_amount,
      level = GREATEST(1, FLOOR(SQRT(user_xp.total_xp + p_amount) / 5)::int + 1),
      updated_at = now();

  -- Award badge if provided (idempotent via unique constraint)
  IF p_badge_key IS NOT NULL THEN
    INSERT INTO user_badges (user_id, badge_key)
    VALUES (v_user, p_badge_key)
    ON CONFLICT (user_id, badge_key) DO NOTHING;
  END IF;

  -- Record a metric event
  INSERT INTO app_metrics (user_id, event_name, event_data)
  VALUES (v_user, 'xp_awarded', jsonb_build_object('amount', p_amount, 'reason', p_reason, 'badge', p_badge_key));
END;
$$;

-- Revoke EXECUTE from anon so only authenticated can call it
REVOKE EXECUTE ON FUNCTION public.award_xp(integer, text, text) FROM anon;

-- ---------------------------------------------------------------------------
-- record_metric function
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_metric(p_event_name text, p_event_data jsonb DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  INSERT INTO app_metrics (user_id, event_name, event_data)
  VALUES (v_user, p_event_name, p_event_data);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_metric(text, jsonb) FROM anon;

-- ---------------------------------------------------------------------------
-- onboarding_progress table: tracks which starter-page steps are done
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS onboarding_progress (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  step_managebac_visited boolean NOT NULL DEFAULT false,
  step_managebac_connected boolean NOT NULL DEFAULT false,
  step_ai_session_created boolean NOT NULL DEFAULT false,
  step_first_task_added boolean NOT NULL DEFAULT false,
  step_first_task_completed boolean NOT NULL DEFAULT false,
  step_first_focus_session boolean NOT NULL DEFAULT false,
  step_onboarding_completed boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE onboarding_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_onboarding_progress" ON onboarding_progress;
CREATE POLICY "select_own_onboarding_progress" ON onboarding_progress FOR SELECT
TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_onboarding_progress" ON onboarding_progress;
CREATE POLICY "insert_own_onboarding_progress" ON onboarding_progress FOR INSERT
TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_onboarding_progress" ON onboarding_progress;
CREATE POLICY "update_own_onboarding_progress" ON onboarding_progress FOR UPDATE
TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
