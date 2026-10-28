/*
# Document uploads: tighten table grants

1. Plain-English summary
   Supabase grants broad default privileges on new public tables to anon and
   authenticated. RLS already blocks any row the owner does not own, but the
   least-privilege rule here is explicit grants only: anon gets nothing, and
   authenticated gets SELECT only (owners only, via the policies). All writes
   happen through SECURITY DEFINER functions or the service role.

2. Changes
   - Revokes every privilege from anon on documents, document_upload_usage,
     document_chunks, document_upload_reservations, document_storage_deletions,
     document_upload_config.
   - Authenticated keeps SELECT on documents, document_upload_usage,
     document_chunks (owner policies) and nothing on the three server-only
     tables.
*/

REVOKE ALL ON documents FROM anon;
REVOKE ALL ON document_upload_usage FROM anon;
REVOKE ALL ON document_chunks FROM anon;
REVOKE ALL ON document_upload_reservations FROM anon;
REVOKE ALL ON document_storage_deletions FROM anon;
REVOKE ALL ON document_upload_config FROM anon;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON documents FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON document_upload_usage FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON document_chunks FROM authenticated;
