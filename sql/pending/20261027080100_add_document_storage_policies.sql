-- Storage policies for the study-documents bucket. NOT APPLIED.
-- Requires the bucket (created at apply time or via approved infra step).

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('study-documents', 'study-documents', false, 150000000)
ON CONFLICT (id) DO NOTHING;

-- Upload: only the exact path of an owned document with an active unexpired
-- reservation, via the hardened boolean helper. Overwrites are blocked because an
-- accepted file leaves 'awaiting_upload', which fails the helper on any second write
-- (no upsert; the TUS x-upsert header must not be sent by the client).
CREATE POLICY "insert_own_reserved_document_path" ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'study-documents'
  AND public.can_upload_to_document_path(name)
);

-- Read: exact-path ownership only; the helper checks owner and document state.
CREATE POLICY "read_own_document_path" ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'study-documents'
  AND public.can_read_document_path(name)
);

-- No DELETE policy and no DELETE grant: removal goes through delete_document /
-- sweep, which enqueue document_storage_deletions for the service-role worker.
REVOKE DELETE ON storage.objects FROM authenticated;
