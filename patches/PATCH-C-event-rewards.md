# Patch C — Event-bound rewards (XP ledger with per-event dedup)

Status: PROPOSED — not applied, nothing deployed.

## Problem (evidence)

- `award_xp` (deployed body read): fixed server-side amounts per reason, but **no
  deduplication whatsoever** — the same reason can be awarded in a loop.
- Browser call sites (grep-verified, the only two): `components/task-card.tsx:58`
  (`awardXp(20,'task_completed')` on every completion toggle) and
  `app/starter/page.tsx:77,150,224` (onboarding steps).
- Attack: a signed-in user calls the RPC directly with `p_reason='task_added'`
  repeatedly; no task is ever created; XP farms 10/call. The reason allowlist does not
  stop replay.
- Live facts: `tasks` has no recurrence columns (only `id, status, completed_at,
  external_source, external_uid` checked; only constraint is the PK); `user_xp` is a
  bare totals row (`user_id, total_xp, level`) — not an event ledger; `study_sessions`
  carries only `status/created_at/updated_at` (no client-editable duration to trust,
  and nothing records elapsed time server-side).

## Design decisions (per your constraints)

1. **Dedup identity for ordinary task completion = the task id itself** — NOT
   `completed_at`: one award per task lifetime, immune to complete/uncomplete toggles.
2. **Recurring tasks:** cannot be supported safely yet — the schema has no recurrence
   concept. The trigger deliberately awards once per `task_id`. Adding per-occurrence
   rewards requires a recurrence model (e.g. `recurrence_series_id` + occurrence date
   enforced server-side) and is out of scope here; flagged, not implemented.
3. **Study/focus XP:** `study_sessions` records no server-side elapsed time, so "25
   minutes" cannot be proven. Focus-session XP is therefore **suspended** in this
   patch (reason returns 0) until server-side timing exists. Client-claimable duration
   must never be the proof.
4. **One-shot rewards** (`onboarding_completed`, `managebac_connected`,
   `first_task_imported_from_managebac`, `first_ai_study_session`) award exactly once
   per user, keyed on verifiable state (see ledger), not on client assertion.
5. **Client calls are removed only when replacements exist** — see C3; the removal is
   gated and includes compatibility handling for existing users.

## C1. SQL migration (single, for approval)

```sql
-- The event ledger. Every XP award must claim one row here first; the unique key IS
-- the dedup guarantee. user_xp totals are derived, never incremented directly by clients.
CREATE TABLE IF NOT EXISTS public.xp_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_key   text NOT NULL,           -- e.g. 'task_completed:<task_id>'
  reason      text NOT NULL,
  xp_amount   integer NOT NULL CHECK (xp_amount >= 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, event_key)
);
ALTER TABLE public.xp_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.xp_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.xp_events TO authenticated;  -- users may see their own history
CREATE POLICY "select_own_xp_events" ON public.xp_events FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS xp_events_user_idx ON public.xp_events (user_id, created_at);

-- Central award. SECURITY DEFINER; inserted rows must pass an evidence check.
CREATE OR REPLACE FUNCTION public.award_xp_event(
  p_user_id uuid, p_event_key text, p_reason text, p_xp integer
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_inserted boolean := false; v_new_total integer;
BEGIN
  INSERT INTO public.xp_events (user_id, event_key, reason, xp_amount)
  VALUES (p_user_id, p_event_key, p_reason, p_xp)
  ON CONFLICT (user_id, event_key) DO NOTHING
  RETURNING true INTO v_inserted;
  IF NOT v_inserted THEN RETURN false; END IF;  -- replay: no-op

  INSERT INTO public.user_xp (user_id, total_xp, level)
  VALUES (p_user_id, p_xp, 1)
  ON CONFLICT (user_id) DO UPDATE
    SET total_xp = public.user_xp.total_xp + p_xp,
        level = GREATEST(1, FLOOR(SQRT(public.user_xp.total_xp + p_xp) / 5)::int + 1),
        updated_at = now()
  RETURNING total_xp INTO v_new_total;
  RETURN true;
END;
$$;

-- Evidence-checked trigger for task completion: task id is the identity, so a
-- completion is awarded once per task regardless of toggles. Fires on the status
-- transition, reading NEW directly (server data, not client claims).
CREATE OR REPLACE FUNCTION public.on_task_completed_award()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.status = 'completed' AND COALESCE(OLD.status,'') IS DISTINCT FROM 'completed' THEN
    PERFORM public.award_xp_event(NEW.user_id, 'task_completed:' || NEW.id, 'task_completed', 20);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS task_completed_award ON public.tasks;
CREATE TRIGGER task_completed_award
AFTER UPDATE OF status ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.on_task_completed_award();

-- One-shot event RPCs, each checking its own verifiable state:
CREATE OR REPLACE FUNCTION public.award_onboarding_completed()
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_user uuid := auth.uid(); v_profile record;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user;
  IF NOT COALESCE(v_profile.onboarding_completed, false) THEN RETURN false; END IF;
  RETURN public.award_xp_event(v_user, 'onboarding_completed', 'onboarding_completed', 50);
END;
$$;

-- task_added: tied to a real insert of the caller's own task, once per task.
CREATE OR REPLACE FUNCTION public.award_task_added()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.award_xp_event(NEW.user_id, 'task_added:' || NEW.id, 'task_added', 10);
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS task_added_award ON public.tasks;
CREATE TRIGGER task_added_award AFTER INSERT ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.award_task_added();

-- Backfill / compatibility for EXISTING users: grant one-shot events only when the
-- verifiable state already exists, so nobody loses rewards they legitimately earned,
-- and nobody gains ones they did not.
INSERT INTO public.xp_events (user_id, event_key, reason, xp_amount)
SELECT id, 'onboarding_completed', 'onboarding_completed', 50
FROM public.profiles WHERE onboarding_completed
ON CONFLICT (user_id, event_key) DO NOTHING;

-- Lock down the old client-callable RPC. Stages: first REPLACE award_xp so unknown
-- reasons award 0 and ONLY evidence-checked keys can be claimed directly; then, once
-- C3 ships, revoke EXECUTE from authenticated entirely.
CREATE OR REPLACE FUNCTION public.award_xp(p_amount integer, p_reason text, p_badge_key text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_user uuid := auth.uid(); v_xp integer; v_ok boolean;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  -- Direct RPC awards are limited to one-shot events whose evidence we can verify here.
  IF p_reason = 'onboarding_completed' THEN
    v_ok := public.award_onboarding_completed();
    RETURN;
  END IF;
  -- All other reasons: 0 XP. task/task_added/focus are trigger- or server-side only.
  v_xp := 0;
  IF v_xp > 0 THEN
    PERFORM public.award_xp_event(v_user, p_reason || ':rpc', p_reason, v_xp);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.award_xp_event(uuid,text,text,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.on_task_completed_award() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.award_task_added() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.award_onboarding_completed() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.award_onboarding_completed() TO authenticated; -- evidence-checked, idempotent
-- Badges remain written by server code paths (unchanged definer pattern).
```

## C2. Frontend diff 1 — `components/task-card.tsx`

Remove line 58 `await awardXp(20, 'task_completed');` (keep
`completeStudySessionsForTask` and the onboarding-progress upsert). The trigger now
awards on the real status transition. Nothing replaces this call — the database is the
replacement.

## C3. Frontend diff 2 — `app/starter/page.tsx`

- Line 77 (`awardXp(xp, reason, badge)` in the generic step path): replace with the
  evidence-checked RPCs — after `onboarding_completed` is genuinely set, call
  `supabase.rpc('award_onboarding_completed')` once; idempotent on the server, so
  retries and re-steps are safe.
- Lines 150 and 224: same substitution (the `managebac_connected` and
  `first_task_imported_from_managebac` events need equivalent evidence-checked RPCs or
  server-side triggers at their real sources — connection row insert and first imported
  task respectively; if you prefer triggers over RPCs, say so and I will produce that
  variant before anything is applied).
- `awardXp` is removed from this file only when every call site above has a working
  replacement (per your "remove only when replacements exist" rule).

## Existing-user compatibility

- Backfill in C1 grants `onboarding_completed` XP to users whose profile already says
  so — no double award (unique key), no loss.
- Users mid-onboarding: their next completed step triggers the new evidence-checked
  path; if they already earned a pre-patch award that lives only in `user_xp` totals
  (not in `xp_events`), the backfill deliberately does NOT invent event rows for
  unstated reasons — only the verifiable one. Residual: pre-patch `task_completed`
  XP is not retro-credited as ledger events; totals are untouched (no one loses XP;
  the ledger starts fresh going forward).

## Tests (isolated accounts, requires approval)

1. Complete task A → +20, ledger row `task_completed:<A>`. Toggle A back and forth →
   no further XP (same task id). Complete task B → +20 again.
2. Two different tasks completed in the same minute → both award (identity is task id,
   not time).
3. Direct RPC `award_xp(9999,'task_completed')` → 0 XP awarded.
4. Direct RPC `award_xp(50,'onboarding_completed')` before completing onboarding →
   false/0; after profile flag set → exactly once, replay no-op.
5. Insert task via another user's session → their trigger awards them, not me (user_id
   taken from NEW).
6. Existing user with `onboarding_completed=true` → backfill row present exactly once.
7. Focus-session reason → 0 XP (documented suspension).
8. `user_xp` total equals `sum(xp_events.xp_amount)` after all tests.

## Deployment order

1. Migration C1 (additive; old client calls keep working but award 0 for non-onboarding
   reasons — brief window where completing tasks yields no XP until C2 deploys).
2. Deploy frontend with C2/C3.
3. Optionally (second migration, only after verification): revoke EXECUTE on
   `award_xp` from `authenticated` and leave the triggers as the sole path.

## Compatibility risks

- Order matters: applying C1 without C2 creates a gap where completions award nothing.
  Mitigation: ship C1+C2+C3 in the same release cycle; the gap is client-deploy
  latency, not data loss.
- Focus XP suspension is a behavior change students may notice; it is required because
  no server-side duration evidence exists. Alternative (rejected): trusting
  client-submitted minutes.
- Recurring tasks: currently awarded once per task id — if the product later treats a
  recurring series as one task, rewards under-count occurrences until a recurrence
  model exists. Flagged, deliberately not guessed at.

## Rollback

- Drop the trigger(s) and re-apply the previous `award_xp` definition (stored in
  migration 20261029063550) — one statement each.
- `xp_events` rows are additive history; dropping the table loses the ledger but not
  `user_xp` totals. Totals are never reduced by this patch.
