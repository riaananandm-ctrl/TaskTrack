-- Live Google Doc for a study session.
--
-- A student can link a study session to a Google Doc that TaskTrack keeps up to date as
-- they chat with the study AI. Access uses Google's narrow "drive.file" scope, so
-- TaskTrack can only see and edit the docs it created, never the rest of their Drive.
-- The refresh token is AES-GCM encrypted with integration_secrets.enc_key and only the
-- google-docs Edge Function (service role) reads or writes these rows' secrets.

CREATE TABLE IF NOT EXISTS public.google_docs_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  google_email text,
  enc_refresh_token text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'reconnect')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.google_docs_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.google_docs_connections FROM anon, authenticated;
-- The browser may see that it is connected (and to which account), never the token.
GRANT SELECT (id, user_id, google_email, status, created_at, updated_at) ON public.google_docs_connections TO authenticated;
DROP POLICY IF EXISTS "select_own_google_docs_connection" ON public.google_docs_connections;
CREATE POLICY "select_own_google_docs_connection" ON public.google_docs_connections
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.google_docs_oauth_states (
  state text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  return_to text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.google_docs_oauth_states ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.google_docs_oauth_states FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.study_session_docs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL UNIQUE REFERENCES public.study_sessions(id) ON DELETE CASCADE,
  google_doc_id text NOT NULL,
  doc_url text NOT NULL,
  title text NOT NULL,
  auto_update boolean NOT NULL DEFAULT true,
  last_written_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.study_session_docs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.study_session_docs FROM anon, authenticated;
GRANT SELECT ON public.study_session_docs TO authenticated;
GRANT UPDATE (auto_update) ON public.study_session_docs TO authenticated;
DROP POLICY IF EXISTS "select_own_session_doc" ON public.study_session_docs;
CREATE POLICY "select_own_session_doc" ON public.study_session_docs
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "update_own_session_doc" ON public.study_session_docs;
CREATE POLICY "update_own_session_doc" ON public.study_session_docs
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
