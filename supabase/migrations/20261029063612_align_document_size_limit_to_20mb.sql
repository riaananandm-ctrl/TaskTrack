/*
# Enforce the advertised 20 MB document limit server-side

1. Problem
  - `plan_limits.max_document_bytes` was 150,000,000 for both plans and the
    `study-documents` bucket's `file_size_limit` was also 150,000,000, while the
    app advertises and client-checks a 20 MB ceiling. A caller skipping the browser
    could reserve and store a 150 MB file, costing far more storage than intended.

2. Modified data
  - `plan_limits.max_document_bytes` set to 20,000,000 for every plan.
  - `storage.buckets.file_size_limit` set to 20,000,000 for `study-documents`.

3. Notes
  1. This matches `MAX_DOCUMENT_BYTES` in the app and the "20 MB" copy shown in the
     upload dialog, so no legitimate upload is affected.
  2. `reserve_document_upload` already rejects declared sizes above the plan limit,
     so the check now rejects at 20 MB instead of 150 MB.
*/

UPDATE public.plan_limits
SET max_document_bytes = 20000000
WHERE max_document_bytes IS DISTINCT FROM 20000000;

UPDATE storage.buckets
SET file_size_limit = 20000000
WHERE id = 'study-documents'
  AND (file_size_limit IS NULL OR file_size_limit > 20000000);
