/*
# Document uploads: worker sweep config

1. Plain-English summary
   Adds a tiny server-only config table holding the shared secret that the
   scheduled document-sweep job presents to the `documents-worker` edge
   function. The secret is generated once here and never exposed to clients.

2. New tables
   - `document_upload_config` — single row (id = 1) with `sweep_cron_secret`.
     RLS enabled, no policies, all client access revoked: only the service
     role (edge functions) can read it.
*/

CREATE TABLE IF NOT EXISTS document_upload_config (
  id integer PRIMARY KEY DEFAULT 1,
  sweep_cron_secret text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_upload_config_singleton CHECK (id = 1)
);

ALTER TABLE document_upload_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON document_upload_config FROM anon;
REVOKE ALL ON document_upload_config FROM authenticated;

INSERT INTO document_upload_config (id, sweep_cron_secret)
VALUES (1, encode(gen_random_bytes(32), 'hex'))
ON CONFLICT (id) DO NOTHING;
