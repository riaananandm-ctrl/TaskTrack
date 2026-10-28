-- Document uploads: schema, quota config, lifecycle functions, storage authorization.
-- NOT APPLIED. Requires the upload worker (pending) before any of this is usable.
-- Draft for review; tests in scripts/test-document-uploads.sql.

-- 1. Quota configuration on the existing plan_limits schema (Free=7, Pro=50/month).
ALTER TABLE plan_limits
  ADD COLUMN IF NOT EXISTS max_uploads_per_month integer NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS max_document_bytes bigint NOT NULL DEFAULT 150000000;

INSERT INTO plan_limits (plan, daily_ai_messages, max_message_chars, quiz_questions,
                         flashcards, max_uploads_per_month, max_document_bytes)
VALUES ('free', 20, 2000, 5, 5, 7, 150000000), ('pro', 100, 2000, 8, 12, 50, 150000000)
ON CONFLICT (plan) DO UPDATE SET
  max_uploads_per_month = EXCLUDED.max_uploads_per_month,
  max_document_bytes = EXCLUDED.max_document_bytes;

-- 2. Tables
CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  declared_mime text NOT NULL DEFAULT 'application/octet-stream',
  verified_mime text,
  size_bytes bigint NOT NULL DEFAULT 0,
  storage_path text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'awaiting_upload'
    CHECK (status IN ('awaiting_upload','processing','ready','failed','cancelled')),
  error_code text,
  truncated boolean NOT NULL DEFAULT false,
  extracted_chars integer NOT NULL DEFAULT 0,
  charge_month date NOT NULL,
  attempt_token uuid,
  lease_expires_at timestamptz,
  processing_attempts integer NOT NULL DEFAULT 0,
  client_request_key uuid,
  storage_delete_pending boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, client_request_key)
);
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON documents TO authenticated;
CREATE POLICY "select_own_documents" ON documents FOR SELECT
  TO authenticated USING (auth.uid() = owner_id);

CREATE TABLE document_upload_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL UNIQUE REFERENCES documents(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','confirmed','released','completed')),
  charge_month date NOT NULL,
  expires_at timestamptz NOT NULL,
  max_deadline timestamptz NOT NULL,
  renewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at <= max_deadline)
);
ALTER TABLE document_upload_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON document_upload_reservations FROM authenticated, anon;

-- Permanent ledger; deleting a document never removes a charge.
CREATE TABLE document_upload_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document_id uuid NOT NULL UNIQUE,
  usage_month date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE document_upload_usage ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON document_upload_usage TO authenticated;
CREATE POLICY "select_own_upload_usage" ON document_upload_usage FOR SELECT
  TO authenticated USING (auth.uid() = owner_id);
CREATE INDEX idx_upload_usage_owner_month ON document_upload_usage (owner_id, usage_month);

CREATE TABLE document_chunks (
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL,
  content text NOT NULL,
  page integer,
  char_count integer NOT NULL,
  PRIMARY KEY (document_id, chunk_index)
);
ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON document_chunks TO authenticated;
CREATE POLICY "select_own_document_chunks" ON document_chunks FOR SELECT
  TO authenticated USING (auth.uid() = owner_id);

CREATE TABLE document_storage_deletions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_path text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  done boolean NOT NULL DEFAULT false,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE document_storage_deletions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON document_storage_deletions FROM authenticated, anon;

-- 3. Shared helpers
CREATE OR REPLACE FUNCTION lock_user_quota(p_user uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS
$$ SELECT pg_advisory_xact_lock(hashtextextended(p_user::text, 0)); $$;
REVOKE ALL ON FUNCTION lock_user_quota(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lock_user_quota(uuid) TO service_role;

-- Quota in force = confirmed usage + active unexpired reservations + processing
-- under any lease (an expired lease still counts until the sweeper atomically
-- fails/releases it, so no worker that can still finalize loses its slot).
CREATE OR REPLACE FUNCTION document_quota_in_force(p_user uuid, p_month date)
RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT (SELECT count(*) FROM document_upload_usage
           WHERE owner_id = p_user AND usage_month = p_month)
       + (SELECT count(*) FROM document_upload_reservations r
           WHERE r.owner_id = p_user AND r.charge_month = p_month
             AND ( (r.status = 'active' AND r.expires_at > now())
                OR (r.status = 'confirmed' AND EXISTS (
                      SELECT 1 FROM documents d WHERE d.id = r.document_id
                        AND d.status = 'processing')) ));
$$;
REVOKE ALL ON FUNCTION document_quota_in_force(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION document_quota_in_force(uuid, date) TO service_role;

-- Storage authorization helper: auth.uid + exact bucket/path + ownership + document
-- state + active unexpired reservation. Boolean only; exposes no reservation records.
CREATE OR REPLACE FUNCTION can_upload_to_document_path(p_path text) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM documents d
    JOIN document_upload_reservations r ON r.document_id = d.id
    WHERE d.storage_path = p_path
      AND d.owner_id = auth.uid()
      AND d.status = 'awaiting_upload'
      AND r.status = 'active'
      AND r.expires_at > now()
  );
$$;
REVOKE ALL ON FUNCTION can_upload_to_document_path(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION can_upload_to_document_path(text) TO authenticated;

CREATE OR REPLACE FUNCTION can_read_document_path(p_path text) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM documents d
                 WHERE d.storage_path = p_path AND d.owner_id = auth.uid()
                   AND d.status IN ('ready','failed'));
$$;
REVOKE ALL ON FUNCTION can_read_document_path(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION can_read_document_path(text) TO authenticated;

-- 4. Lifecycle functions. Every transition: advisory lock, re-read, conditional
-- update with row-count check. Usage is written only on successful finalization.

CREATE OR REPLACE FUNCTION reserve_document_upload(
  p_file_name text, p_declared_mime text, p_size_bytes bigint, p_client_request_key uuid
) RETURNS TABLE(document_id uuid, reservation_id uuid, storage_path text, expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_month date := (date_trunc('month', now() AT TIME ZONE 'utc'))::date;
  v_plan text; v_limit integer; v_max_bytes bigint; v_ext text;
  v_doc documents%ROWTYPE; v_res document_upload_reservations%ROWTYPE;
  v_existing uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_client_request_key IS NULL THEN RAISE EXCEPTION 'client_key_required'; END IF;

  PERFORM lock_user_quota(v_user);

  -- Idempotent retry; payload conflict detected via size/name mismatch.
  SELECT d.id INTO v_existing FROM documents d
    WHERE d.owner_id = v_user AND d.client_request_key = p_client_request_key;
  IF v_existing IS NOT NULL THEN
    SELECT * INTO v_doc FROM documents WHERE id = v_existing;
    IF v_doc.size_bytes <> p_size_bytes OR v_doc.file_name <> p_file_name
      THEN RAISE EXCEPTION 'request_key_conflict'; END IF;
    SELECT * INTO v_res FROM document_upload_reservations WHERE document_id = v_doc.id;
    RETURN QUERY SELECT v_doc.id, v_res.id, v_doc.storage_path, v_res.expires_at;
    RETURN;
  END IF;

  v_ext := lower(split_part(p_file_name, '.', -1));
  IF v_ext NOT IN ('pdf','docx','pptx','xlsx','txt','md','csv')
    THEN RAISE EXCEPTION 'unsupported_type'; END IF;

  SELECT COALESCE(plan,'free') INTO v_plan FROM profiles WHERE id = v_user;
  IF v_plan = 'pro' AND EXISTS (SELECT 1 FROM profiles WHERE id = v_user
       AND plan_expires_at IS NOT NULL AND plan_expires_at < now())
    THEN v_plan := 'free'; END IF;
  SELECT pl.max_uploads_per_month, pl.max_document_bytes
    INTO v_limit, v_max_bytes FROM plan_limits pl WHERE pl.plan = v_plan;
  v_limit := COALESCE(v_limit, 7);
  v_max_bytes := COALESCE(v_max_bytes, 150000000);
  IF p_size_bytes <= 0 OR p_size_bytes > v_max_bytes THEN RAISE EXCEPTION 'size_out_of_range'; END IF;
  IF document_quota_in_force(v_user, v_month) >= v_limit THEN RAISE EXCEPTION 'quota_exceeded'; END IF;

  INSERT INTO documents (owner_id, file_name, declared_mime, size_bytes, storage_path,
                         charge_month, client_request_key)
    VALUES (v_user,
            left(regexp_replace(p_file_name, '[^\w .''\-,!*&$@=;:+?()]', '_', 'g'), 255),
            p_declared_mime, p_size_bytes, v_user::text || '/' || gen_random_uuid()::text,
            v_month, p_client_request_key)
    RETURNING * INTO v_doc;
  UPDATE documents SET storage_path = v_user::text || '/' || v_doc.id::text
    WHERE id = v_doc.id RETURNING * INTO v_doc;

  INSERT INTO document_upload_reservations (document_id, owner_id, charge_month,
                                            expires_at, max_deadline)
    VALUES (v_doc.id, v_user, v_month, now() + interval '15 minutes', now() + interval '24 hours')
    RETURNING * INTO v_res;

  RETURN QUERY SELECT v_doc.id, v_res.id, v_doc.storage_path, v_res.expires_at;
END $$;
REVOKE ALL ON FUNCTION reserve_document_upload(text, text, bigint, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION reserve_document_upload(text, text, bigint, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION renew_document_reservation(p_document_id uuid)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user uuid := auth.uid(); v_new timestamptz;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  PERFORM lock_user_quota(v_user);
  UPDATE document_upload_reservations r
    SET expires_at = LEAST(now() + interval '15 minutes', r.max_deadline),
        renewed_at = now(), updated_at = now()
    WHERE r.document_id = p_document_id AND r.status = 'active'
      AND r.expires_at > now() AND r.max_deadline > now()
      AND EXISTS (SELECT 1 FROM documents d
                  WHERE d.id = r.document_id AND d.owner_id = v_user)
    RETURNING expires_at INTO v_new;
  IF v_new IS NULL THEN RAISE EXCEPTION 'not_renewable'; END IF;
  RETURN v_new;
END $$;
REVOKE ALL ON FUNCTION renew_document_reservation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION renew_document_reservation(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION confirm_document_upload(
  p_document_id uuid, p_reservation_id uuid, p_actual_bytes bigint
) RETURNS uuid  -- returns the NEW processing attempt token for the worker
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_res document_upload_reservations%ROWTYPE; v_doc documents%ROWTYPE;
  v_rows int; v_new_token uuid;
BEGIN
  SELECT * INTO v_res FROM document_upload_reservations WHERE id = p_reservation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'reservation_not_found'; END IF;
  PERFORM lock_user_quota(v_res.owner_id);
  SELECT * INTO v_res FROM document_upload_reservations WHERE id = p_reservation_id;
  SELECT * INTO v_doc FROM documents WHERE id = p_document_id FOR UPDATE;
  IF NOT FOUND OR v_doc.id <> v_res.document_id OR v_doc.owner_id <> v_res.owner_id
    THEN RAISE EXCEPTION 'document_mismatch'; END IF;

  -- Idempotent replay: already confirmed, still processing under a live token.
  IF v_res.status = 'confirmed' THEN
    IF v_doc.status = 'processing' THEN RETURN v_doc.attempt_token; END IF;
    RAISE EXCEPTION 'invalid_state';
  END IF;
  IF v_res.status <> 'active' OR v_res.expires_at < now()
    THEN RAISE EXCEPTION 'reservation_expired'; END IF;
  IF v_doc.status <> 'awaiting_upload' THEN RAISE EXCEPTION 'invalid_state'; END IF;
  IF p_actual_bytes IS NULL OR p_actual_bytes <> v_doc.size_bytes
    THEN RAISE EXCEPTION 'size_mismatch'; END IF;

  UPDATE document_upload_reservations SET status='confirmed', updated_at=now()
    WHERE id = v_res.id AND status = 'active';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN RAISE EXCEPTION 'reservation_expired'; END IF;

  v_new_token := gen_random_uuid();
  UPDATE documents SET status='processing', attempt_token = v_new_token,
      lease_expires_at = now() + interval '10 minutes',
      processing_attempts = processing_attempts + 1, updated_at = now()
    WHERE id = v_doc.id AND status = 'awaiting_upload';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN RAISE EXCEPTION 'invalid_state'; END IF;

  RETURN v_new_token;
END $$;
REVOKE ALL ON FUNCTION confirm_document_upload(uuid, uuid, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION confirm_document_upload(uuid, uuid, bigint) TO service_role;

CREATE OR REPLACE FUNCTION heartbeat_document_processing(
  p_document_id uuid, p_attempt_token uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rows int; v_owner uuid;
BEGIN
  SELECT owner_id INTO v_owner FROM documents WHERE id = p_document_id;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  PERFORM lock_user_quota(v_owner);
  UPDATE documents SET lease_expires_at = now() + interval '10 minutes', updated_at = now()
    WHERE id = p_document_id AND status = 'processing'
      AND attempt_token = p_attempt_token;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN RAISE EXCEPTION 'stale_attempt'; END IF;
END $$;
REVOKE ALL ON FUNCTION heartbeat_document_processing(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION heartbeat_document_processing(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION finalize_document_ready(
  p_document_id uuid, p_attempt_token uuid, p_chunks jsonb, p_truncated boolean
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_doc documents%ROWTYPE; v_rows int;
  v_len integer; v_total integer := 0; v_i integer;
  v_chunk jsonb; v_page integer;
BEGIN
  SELECT * INTO v_doc FROM documents WHERE id = p_document_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  PERFORM lock_user_quota(v_doc.owner_id);
  SELECT * INTO v_doc FROM documents WHERE id = p_document_id FOR UPDATE;

  -- Idempotent duplicate success.
  IF v_doc.status = 'ready'
     AND EXISTS (SELECT 1 FROM document_upload_usage WHERE document_id = p_document_id)
    THEN RETURN; END IF;

  -- Requires live matching lease and valid processing state; never revives
  -- cancelled/failed documents; stale workers rejected.
  IF v_doc.status <> 'processing' OR v_doc.attempt_token IS DISTINCT FROM p_attempt_token
     OR v_doc.lease_expires_at IS NULL OR v_doc.lease_expires_at < now()
    THEN RAISE EXCEPTION 'stale_attempt'; END IF;

  -- Validate chunk structure and extraction limits before storing anything.
  IF jsonb_typeof(p_chunks) <> 'array' THEN RAISE EXCEPTION 'invalid_chunks'; END IF;
  IF jsonb_array_length(p_chunks) > 2000 THEN RAISE EXCEPTION 'too_many_chunks'; END IF;
  FOR v_i IN 0 .. jsonb_array_length(p_chunks) - 1 LOOP
    v_chunk := p_chunks -> v_i;
    IF jsonb_typeof(v_chunk -> 'c') <> 'string' THEN RAISE EXCEPTION 'invalid_chunks'; END IF;
    v_len := length(v_chunk ->> 'c');
    IF v_len = 0 OR v_len > 20000 THEN RAISE EXCEPTION 'invalid_chunks'; END IF;
    v_total := v_total + v_len;
    IF v_total > 400000 THEN RAISE EXCEPTION 'too_large_extraction'; END IF;
    IF v_chunk ? 'p' THEN
      v_page := (v_chunk ->> 'p')::integer;
      IF v_page IS NULL OR v_page < 0 OR v_page > 100000 THEN RAISE EXCEPTION 'invalid_chunks'; END IF;
    ELSE
      v_page := NULL;
    END IF;
  END LOOP;

  UPDATE document_upload_reservations SET status='completed', updated_at=now()
    WHERE document_id = p_document_id AND status = 'confirmed';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN RAISE EXCEPTION 'reservation_not_confirmed'; END IF;

  INSERT INTO document_upload_usage (owner_id, document_id, usage_month)
    VALUES (v_doc.owner_id, p_document_id, v_doc.charge_month);  -- original UTC month

  DELETE FROM document_chunks WHERE document_id = p_document_id;
  INSERT INTO document_chunks (document_id, owner_id, chunk_index, content, page, char_count)
    SELECT p_document_id, v_doc.owner_id, ord - 1,
           e ->> 'c', (e ->> 'p')::integer, length(e ->> 'c')
    FROM jsonb_array_elements(p_chunks) WITH ORDINALITY AS t(e, ord);

  UPDATE documents SET status='ready', truncated=p_truncated,
      extracted_chars = v_total, lease_expires_at = NULL, updated_at = now()
    WHERE id = p_document_id AND status = 'processing';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN RAISE EXCEPTION 'invalid_state'; END IF;
END $$;
REVOKE ALL ON FUNCTION finalize_document_ready(uuid, uuid, jsonb, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION finalize_document_ready(uuid, uuid, jsonb, boolean) TO service_role;

CREATE OR REPLACE FUNCTION finalize_document_failed(
  p_document_id uuid, p_attempt_token uuid, p_error text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_doc documents%ROWTYPE; v_rows int;
BEGIN
  SELECT * INTO v_doc FROM documents WHERE id = p_document_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  PERFORM lock_user_quota(v_doc.owner_id);
  SELECT * INTO v_doc FROM documents WHERE id = p_document_id FOR UPDATE;

  IF v_doc.status = 'failed' THEN RETURN; END IF;  -- idempotent duplicate failure

  IF v_doc.status <> 'processing' OR v_doc.attempt_token IS DISTINCT FROM p_attempt_token
     OR v_doc.lease_expires_at IS NULL OR v_doc.lease_expires_at < now()
    THEN RAISE EXCEPTION 'stale_attempt'; END IF;

  UPDATE document_upload_reservations SET status='released', updated_at=now()
    WHERE document_id = p_document_id AND status = 'confirmed';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN RAISE EXCEPTION 'reservation_not_confirmed'; END IF;

  -- Released without charge: usage was never written for this attempt.
  UPDATE documents SET status='failed', error_code = left(p_error, 64),
      lease_expires_at = NULL, updated_at = now()
    WHERE id = p_document_id AND status = 'processing';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN RAISE EXCEPTION 'invalid_state'; END IF;
END $$;
REVOKE ALL ON FUNCTION finalize_document_failed(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION finalize_document_failed(uuid, uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION delete_document(p_document_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user uuid := auth.uid(); v_doc documents%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  PERFORM lock_user_quota(v_user);
  SELECT * INTO v_doc FROM documents
    WHERE id = p_document_id AND owner_id = v_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_owner'; END IF;

  UPDATE document_upload_reservations SET status='released', updated_at=now()
    WHERE document_id = v_doc.id AND status IN ('active','confirmed');
  -- Usage rows are intentionally NOT deleted: the charge is permanent.
  -- Storage deletion is enqueued, never attempted inside this transaction.
  UPDATE documents SET status='cancelled', storage_delete_pending = true, updated_at=now()
    WHERE id = v_doc.id;
  INSERT INTO document_storage_deletions (storage_path)
    VALUES (v_doc.storage_path)
    ON CONFLICT DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION delete_document(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION delete_document(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION sweep_document_uploads()
RETURNS TABLE(released int, docs_cancelled int, stale_failed int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_doc documents%ROWTYPE;
  v_released int := 0; v_cancelled int := 0; v_stale int := 0; v_rows int;
BEGIN
  FOR v_doc IN
    SELECT d.* FROM documents d
    JOIN document_upload_reservations r ON r.document_id = d.id
    WHERE r.status = 'active' AND r.expires_at < now()
    LIMIT 500
  LOOP
    PERFORM lock_user_quota(v_doc.owner_id);
    -- Re-read under the lock; skip if a competing transition already resolved it.
    IF NOT EXISTS (SELECT 1 FROM document_upload_reservations
                   WHERE document_id = v_doc.id AND status='active' AND expires_at < now())
      THEN CONTINUE; END IF;
    UPDATE document_upload_reservations SET status='released', updated_at=now()
      WHERE document_id = v_doc.id AND status='active' AND expires_at < now();
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_released := v_released + v_rows;
    IF v_rows > 0 THEN
      UPDATE documents SET status='cancelled', storage_delete_pending = true, updated_at=now()
        WHERE id = v_doc.id AND status='awaiting_upload';
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      v_cancelled := v_cancelled + v_rows;
      IF v_rows > 0 THEN
        INSERT INTO document_storage_deletions (storage_path) VALUES (v_doc.storage_path)
          ON CONFLICT DO NOTHING;
      END IF;
    END IF;
  END LOOP;

  -- Stale processing under an expired lease: atomically failed + slot released.
  -- While the lease is merely expired the reservation stays 'confirmed', so quota
  -- still counts it; only this transition frees the slot.
  FOR v_doc IN
    SELECT * FROM documents
    WHERE status='processing' AND lease_expires_at < now() - interval '10 minutes'
    LIMIT 500
  LOOP
    PERFORM lock_user_quota(v_doc.owner_id);
    UPDATE documents SET status='failed', error_code='PROCESSING_TIMEOUT',
        lease_expires_at = NULL, updated_at=now()
      WHERE id = v_doc.id AND status='processing'
        AND lease_expires_at < now() - interval '10 minutes';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows > 0 THEN
      UPDATE document_upload_reservations SET status='released', updated_at=now()
        WHERE document_id = v_doc.id AND status='confirmed';
      v_stale := v_stale + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_released, v_cancelled, v_stale;
END $$;
REVOKE ALL ON FUNCTION sweep_document_uploads() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION sweep_document_uploads() TO service_role;
