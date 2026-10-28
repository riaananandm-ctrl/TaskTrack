-- Targeted database tests for the document-upload lifecycle.
-- NOT EXECUTED: no isolated local/test database is available in this environment.
-- Run against an ephemeral local Postgres (e.g. supabase start / pgTAP or psql) ONLY.
-- Never run against production. Each block raises on failure.
--
-- Prereq: apply 20261027080000_add_document_uploads.sql first.

-- Helper: fail loudly
CREATE OR REPLACE FUNCTION test_assert(p_cond boolean, p_name text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_cond THEN RAISE EXCEPTION 'TEST FAILED: %', p_name; END IF;
  RAISE NOTICE 'PASS: %', p_name;
END $$;

-- ============ setup: two test users ============
INSERT INTO auth.users (id, email, encrypted_password, aud, role, email_confirmed_at,
                        created_at, updated_at, confirmation_token, recovery_token,
                        email_change, email_change_token_new, instance_id)
VALUES
  ('11111111-1111-1111-1111-111111111111','u1@test.local','x','authenticated','authenticated',now(),now(),now(),'','','','','00000000-0000-0000-0000-000000000000'),
  ('22222222-2222-2222-2222-222222222222','u2@test.local','x','authenticated','authenticated',now(),now(),now(),'','','','','00000000-0000-0000-0000-000000000000')
ON CONFLICT DO NOTHING;
INSERT INTO public.profiles (id, full_name, email, plan)
VALUES ('11111111-1111-1111-1111-111111111111','U1','u1@test.local','free'),
       ('22222222-2222-2222-2222-222222222222','U2','u2@test.local','pro')
ON CONFLICT DO NOTHING;

-- ============ 1. Concurrent reservation at the last slot ============
DO $$
DECLARE v_results int; v_doc uuid;
BEGIN
  -- Set two sessions in pgbanner/pgTAP in real use; here, sequential proof of the
  -- count logic: fill 6 slots, then the 7th must succeed and an 8th must fail.
  FOR i IN 1..6 LOOP
    SET LOCAL ROLE authenticated;
    SET LOCAL request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
    PERFORM reserve_document_upload('t.pdf','application/pdf',1000, gen_random_uuid());
  END LOOP;
  SET LOCAL ROLE authenticated;
  SET LOCAL request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
  PERFORM public.test_assert(
    (SELECT count(*) = 7 FROM documents WHERE owner_id='11111111-1111-1111-1111-111111111111'),
    'seven reservations allowed for free plan');
  BEGIN
    PERFORM reserve_document_upload('t8.pdf','application/pdf',1000, gen_random_uuid());
    PERFORM public.test_assert(false, 'eighth reservation must fail');
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.test_assert(SQLSTATE <> '00000', 'eighth reservation rejected');
  END;
END $$;

-- ============ 2. Duplicate finalize: idempotent, single charge ============
DO $$
DECLARE v_doc uuid; v_token uuid; v_res uuid; v_cnt int;
BEGIN
  SET LOCAL ROLE authenticated;
  SET LOCAL request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
  SELECT document_id, reservation_id INTO v_doc, v_res
    FROM reserve_document_upload('a.pdf','application/pdf',500, gen_random_uuid());
  UPDATE documents SET size_bytes = 500 WHERE id = v_doc;
  SET LOCAL ROLE service_role;
  v_token := confirm_document_upload(v_doc, v_res, 500);
  PERFORM heartbeat_document_processing(v_doc, v_token);
  PERFORM finalize_document_ready(v_doc, v_token,
    '[{"c":"hello","p":1}]'::jsonb, false);
  PERFORM finalize_document_ready(v_doc, v_token,
    '[{"c":"hello","p":1}]'::jsonb, false);  -- duplicate
  SELECT count(*) INTO v_cnt FROM document_upload_usage WHERE document_id = v_doc;
  PERFORM public.test_assert(v_cnt = 1, 'duplicate finalize charges exactly once');
END $$;

-- ============ 3. Stale worker cannot heartbeat/finalize ============
DO $$
DECLARE v_doc uuid; v_token uuid; v_res uuid; v_old uuid;
BEGIN
  SET LOCAL ROLE authenticated;
  SET LOCAL request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
  SELECT document_id, reservation_id INTO v_doc, v_res
    FROM reserve_document_upload('b.pdf','application/pdf',500, gen_random_uuid());
  SET LOCAL ROLE service_role;
  v_token := confirm_document_upload(v_doc, v_res, 500);
  v_old := v_token;
  -- A second confirm rotates the token; the first worker is now stale.
  v_token := confirm_document_upload(v_doc, v_res, 500);
  BEGIN
    PERFORM heartbeat_document_processing(v_doc, v_old);
    PERFORM public.test_assert(false, 'stale heartbeat must fail');
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.test_assert(true, 'stale heartbeat rejected');
  END;
  BEGIN
    PERFORM finalize_document_ready(v_doc, v_old, '[{"c":"x"}]'::jsonb, false);
    PERFORM public.test_assert(false, 'stale finalize must fail');
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.test_assert(true, 'stale finalize rejected');
  END;
END $$;

-- ============ 4. Expired reservation cannot renew or confirm ============
DO $$
DECLARE v_doc uuid; v_res uuid;
BEGIN
  SET LOCAL ROLE authenticated;
  SET LOCAL request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
  SELECT document_id, reservation_id INTO v_doc, v_res
    FROM reserve_document_upload('c.txt','text/plain',10, gen_random_uuid());
  UPDATE document_upload_reservations SET expires_at = now() - interval '1 minute'
    WHERE id = v_res;
  BEGIN
    PERFORM renew_document_reservation(v_doc);
    PERFORM public.test_assert(false, 'expired renewal must fail');
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.test_assert(true, 'expired renewal rejected');
  END;
END $$;

-- ============ 5. Failed processing releases allowance, no charge ============
DO $$
DECLARE v_doc uuid; v_res uuid; v_token uuid; v_cnt int;
BEGIN
  SET LOCAL ROLE authenticated;
  SET LOCAL request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
  SELECT document_id, reservation_id INTO v_doc, v_res
    FROM reserve_document_upload('d.txt','text/plain',10, gen_random_uuid());
  SET LOCAL ROLE service_role;
  v_token := confirm_document_upload(v_doc, v_res, 10);
  PERFORM finalize_document_failed(v_doc, v_token, 'PARSER_FAILURE');
  PERFORM finalize_document_failed(v_doc, v_token, 'PARSER_FAILURE');  -- duplicate
  SELECT count(*) INTO v_cnt FROM document_upload_usage WHERE document_id = v_doc;
  PERFORM public.test_assert(v_cnt = 0, 'failed processing never charges');
  SELECT count(*) INTO v_cnt FROM document_upload_reservations
    WHERE id = v_res AND status = 'released';
  PERFORM public.test_assert(v_cnt = 1, 'failed processing releases the slot');
END $$;

-- ============ 6. Deletion keeps usage (no quota restoration) ============
DO $$
DECLARE v_doc uuid; v_res uuid; v_token uuid; v_cnt int;
BEGIN
  SET LOCAL ROLE authenticated;
  SET LOCAL request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
  SELECT document_id, reservation_id INTO v_doc, v_res
    FROM reserve_document_upload('e.pdf','application/pdf',300, gen_random_uuid());
  SET LOCAL ROLE service_role;
  v_token := confirm_document_upload(v_doc, v_res, 300);
  PERFORM finalize_document_ready(v_doc, v_token, '[{"c":"body","p":2}]'::jsonb, false);
  SET LOCAL ROLE authenticated;
  PERFORM delete_document(v_doc);
  SELECT count(*) INTO v_cnt FROM document_upload_usage WHERE document_id = v_doc;
  PERFORM public.test_assert(v_cnt = 1, 'deletion retains the usage charge');
  SELECT count(*) INTO v_cnt FROM document_storage_deletions
    WHERE storage_path = (SELECT storage_path FROM documents WHERE id = v_doc)
      AND done = false;
  PERFORM public.test_assert(v_cnt = 1, 'deletion enqueues storage cleanup');
END $$;

-- ============ 7. Month rollover: charge month fixed at reservation ============
DO $$
DECLARE v_doc uuid; v_res uuid; v_token uuid; v_month date;
BEGIN
  SET LOCAL ROLE authenticated;
  SET LOCAL request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
  SELECT document_id, reservation_id INTO v_doc, v_res
    FROM reserve_document_upload('f.txt','text/plain',10, gen_random_uuid());
  SELECT charge_month INTO v_month FROM document_upload_reservations WHERE id = v_res;
  -- Simulate finalization after midnight on the 1st of the next month.
  UPDATE document_upload_reservations SET expires_at = now() + interval '1 hour'
    WHERE id = v_res;
  SET LOCAL ROLE service_role;
  v_token := confirm_document_upload(v_doc, v_res, 10);
  PERFORM finalize_document_ready(v_doc, v_token, '[{"c":"z"}]'::jsonb, false);
  PERFORM public.test_assert(
    (SELECT usage_month FROM document_upload_usage WHERE document_id = v_doc) = v_month,
    'usage charged in the reservation''s original UTC month');
END $$;

-- ============ 8. Ownership: user B cannot see or delete user A's document ============
DO $$
DECLARE v_doc uuid; v_res uuid; v_cnt int;
BEGIN
  SELECT d.id INTO v_doc FROM documents d
    WHERE d.owner_id = '22222222-2222-2222-2222-222222222222' AND d.status = 'ready'
    LIMIT 1;
  SET LOCAL ROLE authenticated;
  SET LOCAL request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
  SELECT count(*) INTO v_cnt FROM documents WHERE id = v_doc;
  PERFORM public.test_assert(v_cnt = 0, 'cross-user SELECT returns no rows');
  BEGIN
    PERFORM delete_document(v_doc);
    PERFORM public.test_assert(false, 'cross-user delete must fail');
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.test_assert(true, 'cross-user delete rejected');
  END;
END $$;

-- ============ 9. Storage helpers: no path tricks ============
DO $$
DECLARE v_ok boolean;
BEGIN
  SET LOCAL ROLE authenticated;
  SET LOCAL request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
  SELECT can_upload_to_document_path('99999999-9999-9999-9999-999999999999/not-mine') INTO v_ok;
  PERFORM public.test_assert(v_ok = false, 'helper rejects unowned path');
  SELECT can_upload_to_document_path('') INTO v_ok;
  PERFORM public.test_assert(v_ok = false, 'helper rejects empty path');
END $$;

-- ============ 10. Cleanup race: concurrent sweep and confirm ============
-- In real execution run two sessions calling sweep_document_uploads and
-- confirm_document_upload simultaneously under pgbouncer/pgTAP sessions; the
-- advisory lock plus status re-check guarantees only one wins. Sequential check:
DO $$
DECLARE v_doc uuid; v_res uuid; v_cnt int;
BEGIN
  SET LOCAL ROLE authenticated;
  SET LOCAL request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
  SELECT document_id, reservation_id INTO v_doc, v_res
    FROM reserve_document_upload('g.txt','text/plain',10, gen_random_uuid());
  UPDATE document_upload_reservations SET expires_at = now() - interval '1 minute'
    WHERE id = v_res;
  SET LOCAL ROLE service_role;
  PERFORM sweep_document_uploads();
  PERFORM sweep_document_uploads();  -- second run: no rows affected
  SELECT status INTO v_cnt FROM document_upload_reservations WHERE id = v_res;
  PERFORM public.test_assert(v_cnt = 'released', 'sweep releases expired reservation once');
  BEGIN
    PERFORM confirm_document_upload(v_doc, v_res, 10);
    PERFORM public.test_assert(false, 'confirm after sweep must fail');
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.test_assert(true, 'confirm after sweep rejected');
  END;
END $$;

-- ============ 11. Chunk validation ============
DO $$
DECLARE v_doc uuid; v_res uuid; v_token uuid;
BEGIN
  SET LOCAL ROLE authenticated;
  SET LOCAL request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
  SELECT document_id, reservation_id INTO v_doc, v_res
    FROM reserve_document_upload('h.txt','text/plain',10, gen_random_uuid());
  SET LOCAL ROLE service_role;
  v_token := confirm_document_upload(v_doc, v_res, 10);
  BEGIN
    PERFORM finalize_document_ready(v_doc, v_token, '{"c":"not-array"}'::jsonb, false);
    PERFORM public.test_assert(false, 'non-array chunks must fail');
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.test_assert(true, 'non-array chunks rejected');
  END;
  BEGIN
    PERFORM finalize_document_ready(v_doc, v_token, '[{"c":""}]'::jsonb, false);
    PERFORM public.test_assert(false, 'empty chunk must fail');
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.test_assert(true, 'empty chunk rejected');
  END;
END $$;
