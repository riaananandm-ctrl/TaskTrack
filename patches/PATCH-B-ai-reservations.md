# Patch B — Request-bound AI quota accounting (exactly-once refunds)

Status: PROPOSED — not applied, nothing deployed, no revokes executed.

## Problem (evidence)

- `refund_ai_request()` (deployed body read): takes **no argument**, is EXECUTE-granted
  to `authenticated` (verified via `has_function_privilege` = true), and decrements
  today's `request_count` whenever it is > 0 and `refund_count < 3`. Any signed-in user
  can reclaim 3 reservations/day with no failed request. The cap is mitigation, not authorization.
- `reserve_ai_request()` (deployed body read): no argument, uses `auth.uid()`, works
  today only because the edge function calls it through the student's own Authorization
  header. It returns no reservation identity, so refunds cannot be bound to a request.
- Legitimate path: `study-session-chat` reserves before calling Groq and calls
  `refundAndFail` on provider failure (lines 999–1012, 1198–1206).

## Design principles applied

1. **Browser exclusion mandatory:** both quota functions are revoked from
   `anon`/`authenticated` and granted to `service_role` only.
2. **One verified identity path:** the edge function verifies the caller's JWT with the
   anon client (`auth.getUser()`), then performs quota writes with the service-role
   client passing `p_user_id` explicitly. The service role does **not** rely on
   `auth.uid()` — it would be NULL there; identity comes only from the verified JWT.
3. **Atomic transitions:** `reserved → consumed` and `reserved → refunded` are single
   conditional UPDATEs keyed on `status='reserved'`; zero rows updated ⇒ no effect
   (exactly-once, replay-safe).
4. **Cross-midnight safety:** the refund decrements the row for the reservation's
   original `usage_date`, not "today".

## B1. SQL migration 1 — new accounting (apply first, no revokes yet)

```sql
CREATE TABLE IF NOT EXISTS public.ai_usage_reservations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  usage_date    date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  request_key   text,
  status        text NOT NULL DEFAULT 'reserved'
                CHECK (status IN ('reserved','consumed','refunded','expired')),
  resolve_reason text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz,
  UNIQUE (user_id, request_key)
);
CREATE INDEX IF NOT EXISTS ai_usage_reservations_open_idx
  ON public.ai_usage_reservations (user_id, status)
  WHERE status = 'reserved';
ALTER TABLE public.ai_usage_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_usage_reservations FROM PUBLIC;
REVOKE ALL ON public.ai_usage_reservations FROM anon;
REVOKE ALL ON public.ai_usage_reservations FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON public.ai_usage_reservations TO service_role;

-- Lazy crash/timeout sweep: called at the start of every reserve. A reservation still
-- 'reserved' after 15 minutes means the edge function died and the provider outcome is
-- UNKNOWN: it is marked 'expired' and the count is LEFT CHARGED (conservative). We do
-- not refund what we cannot prove failed, and we do not double-charge — the count was
-- already taken once.
CREATE OR REPLACE FUNCTION public.expire_stale_ai_reservations()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  UPDATE public.ai_usage_reservations
     SET status = 'expired', resolved_at = now(), resolve_reason = 'timeout_unknown_outcome'
   WHERE status = 'reserved'
     AND created_at < now() - interval '15 minutes';
$$;

CREATE OR REPLACE FUNCTION public.reserve_ai_request(p_user_id uuid, p_request_key text)
RETURNS TABLE (allowed boolean, used integer, daily_limit integer, reservation_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_user uuid := p_user_id;
  v_today date := (now() AT TIME ZONE 'utc')::date;
  v_plan text; v_limit integer; v_count integer; v_existing record;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'user required'; END IF;
  PERFORM public.expire_stale_ai_reservations();

  -- Retry / duplicate request key: return the original reservation, never double-charge.
  IF p_request_key IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.ai_usage_reservations
     WHERE user_id = v_user AND request_key = p_request_key
     ORDER BY created_at DESC LIMIT 1;
    IF FOUND THEN
      SELECT request_count INTO v_count FROM public.ai_usage
       WHERE user_id = v_user AND usage_date = v_existing.usage_date;
      RETURN QUERY SELECT v_existing.status IN ('reserved','consumed'),
        COALESCE(v_count,0), 0, v_existing.id;  -- daily_limit filled below
    END IF;
  END IF;

  SELECT COALESCE(p.plan,'free') INTO v_plan FROM public.profiles p WHERE p.id = v_user;
  v_plan := COALESCE(v_plan,'free');
  SELECT pl.daily_ai_messages INTO v_limit FROM public.plan_limits pl WHERE pl.plan = v_plan;
  v_limit := COALESCE(v_limit, 20);

  INSERT INTO public.ai_usage (user_id, usage_date, request_count)
  VALUES (v_user, v_today, 0) ON CONFLICT (user_id, usage_date) DO NOTHING;

  SELECT request_count INTO v_count FROM public.ai_usage
   WHERE user_id = v_user AND usage_date = v_today FOR UPDATE;

  IF v_count >= v_limit THEN
    RETURN QUERY SELECT false, v_count, v_limit, NULL::uuid;
    RETURN;
  END IF;

  UPDATE public.ai_usage SET request_count = request_count + 1, updated_at = now()
   WHERE user_id = v_user AND usage_date = v_today;

  INSERT INTO public.ai_usage_reservations (user_id, usage_date, request_key)
  VALUES (v_user, v_today, p_request_key)
  RETURNING id INTO v_existing.id;

  RETURN QUERY SELECT true, v_count + 1, v_limit, v_existing.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_ai_request(p_reservation_id uuid, p_user_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_rows integer;
BEGIN
  UPDATE public.ai_usage_reservations
     SET status='consumed', resolved_at=now(), resolve_reason='served'
   WHERE id = p_reservation_id AND user_id = p_user_id AND status='reserved';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.refund_ai_request(p_reservation_id uuid, p_user_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_rows integer; v_usage_date date;
BEGIN
  UPDATE public.ai_usage_reservations
     SET status='refunded', resolved_at=now(), resolve_reason='provider_failure'
   WHERE id = p_reservation_id AND user_id = p_user_id AND status='reserved'
   RETURNING usage_date INTO v_usage_date;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN RETURN false; END IF;   -- exactly-once: replay is a no-op
  UPDATE public.ai_usage
     SET request_count = GREATEST(0, request_count - 1), updated_at = now()
   WHERE user_id = p_user_id AND usage_date = v_usage_date;  -- original date, not today
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_ai_request(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_ai_request(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refund_ai_request(uuid, uuid)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.expire_stale_ai_reservations() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_ai_request(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_ai_request(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.refund_ai_request(uuid, uuid)  TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_stale_ai_reservations() TO service_role;
```

(Note: in the duplicate-key branch above, `daily_limit` is returned as 0 — the edge
function already read limits for display; if you prefer, re-read `plan_limits` there.
Flagging for review rather than silently choosing.)

## B2. SQL migration 2 — close the old client-callable overloads (apply ONLY after B3 is deployed and verified)

```sql
REVOKE ALL ON FUNCTION public.refund_ai_request()  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reserve_ai_request() FROM PUBLIC, anon, authenticated;
-- Optional later cleanup once confirmed nothing calls them:
-- DROP FUNCTION public.refund_ai_request();
-- DROP FUNCTION public.reserve_ai_request();
```

Kept as revoke-then-(optionally)-drop so rollback is trivial during the transition.

## B3. Edge function diff (`supabase/functions/study-session-chat/index.ts`)

- After `auth.getUser()` succeeds (verified identity, lines 823–829), create a
  service-role client `admin` (in addition to the existing user client used for
  attachment/ownership reads, which correctly run under the user's RLS).
- Request key for retry dedupe: stable per logical request, e.g.
  `sha256(userId + sessionId + lastUserMessage.content)` truncated — the same retry of
  the same message reuses its reservation instead of double-charging.
- Replace line 999:

```ts
    const { data: reserveData, error: reserveError } = await admin.rpc('reserve_ai_request', {
      p_user_id: userData.user.id,
      p_request_key: requestKey,
    });
```

- On every success return path (structured + plain, lines 1136–1177), call
  `await admin.rpc('consume_ai_request', { p_reservation_id: reservation.reservation_id, p_user_id: userData.user.id })`
  before responding (best-effort; a missed consume times out to 'expired', charged).
- `refundAndFail` becomes:

```ts
async function refundAndFail(admin, userId, reservationId, category) {
  if (reservationId) {
    const { error } = await admin.rpc('refund_ai_request', {
      p_reservation_id: reservationId, p_user_id: userId,
    });
    if (error) console.error('AI usage refund failed:', error.message);
  }
  return fail(category);
}
```

- `refund_count` on `ai_usage` is retained as an audit column but no longer gates refunds.

## Affected callers

- `study-session-chat` only (grep-verified: no browser code calls either RPC).
- `app/api/study-session/chat/route.ts` proxies to the edge function — unchanged.

## Tests (isolated accounts, requires approval)

1. Free user, provider healthy: message succeeds; reservation `consumed`; count 1/7.
2. Provider failure forced (invalid model pin): refund decrements the correct date's count; second refund call with the same id returns false, count unchanged (exactly-once).
3. Direct browser RPC attempt as authenticated for both old and new functions → permission denied.
4. Duplicate request (same key) retried → no double charge.
5. Request spanning midnight, failed at 00:05 → yesterday's row decremented, today untouched.
6. Killed request (reservation left 'reserved' > 15 min) → swept to 'expired', count stays charged (documented conservative behavior).
7. Daily limit still enforced: 7 free messages then 8th → `limitReached`.
8. Refund for another user's reservation id → false (user_id binding).

## Deployment order

1. Migration B1 (additive; old code keeps using old no-arg functions unchanged).
2. Deploy `study-session-chat` (now uses new functions).
3. Verify tests 1–8.
4. Migration B2 (revoke old overloads from clients).

## Compatibility risks

- Between steps 2 and 4 the old no-arg functions remain client-callable (pre-existing
  exposure, unchanged). Minimized by ordering, not eliminated until B2.
- If the edge deploy succeeds but B2 is forgotten, old vulnerable functions remain
  revoked only from anon — the audit finding F2-era exposure persists for
  `authenticated`. B2 is mandatory, not optional cleanup.
- Unconsumed 'reserved' rows from a mid-deploy crash are conservatively charged after
  15 minutes (no proof of provider outcome). This is the deliberate trade-off; a
  support path can manually refund a specific reservation if a student reports it.

## Rollback

- B2: re-grant EXECUTE on old overloads to `authenticated` (one statement each).
- B3: redeploy previous function source.
- B1: tables/functions are additive; dropping them loses only the reservation audit
  trail. `ai_usage.request_count` semantics are unchanged throughout.
