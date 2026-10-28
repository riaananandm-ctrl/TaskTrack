/*
# Document uploads: private storage bucket + policies

1. Plain-English summary
   Creates the private `study-documents` bucket that holds uploaded files, and
   the storage policies that make it owner-only. A file can only be written to
   the exact path of a document the caller owns while a live upload reservation
   exists, and can only be read back by its owner after processing has finished.

2. Changes
   - `storage.buckets`: inserts `study-documents` (private, file_size_limit
     150000000 bytes = 150 MB). Insert is idempotent.
   - `storage.objects` policies:
     - INSERT allowed for `authenticated` only when the path belongs to one of
       their own documents in `awaiting_upload` with an active unexpired
       reservation (checked by the boolean helper `can_upload_to_document_path`).
       Overwrites are impossible because a completed upload leaves that state.
     - SELECT allowed for `authenticated` only on their own paths for documents
       in `ready`/`failed` (helper `can_read_document_path`).
     - No DELETE policy and DELETE revoked: object removal is enqueued by
       delete/sweep and performed by the service-role worker.

3. Security
   - The bucket is private: no anon role involvement, no public URLs.
*/

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('study-documents', 'study-documents', false, 150000000)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "insert_own_reserved_document_path" ON storage.objects;
CREATE POLICY "insert_own_reserved_document_path" ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'study-documents'
  AND public.can_upload_to_document_path(name)
);

DROP POLICY IF EXISTS "read_own_document_path" ON storage.objects;
CREATE POLICY "read_own_document_path" ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'study-documents'
  AND public.can_read_document_path(name)
);

REVOKE DELETE ON storage.objects FROM authenticated;
