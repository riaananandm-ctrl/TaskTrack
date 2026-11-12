/*
  # Group study rooms

  One student hosts a private study room; others join with a 6-character code.
  Members chat, and anyone can ask the TaskTrack AI to help the whole group.

  Security
  - Row-level security on all three tables. Only members can see a room, its member
    list and its messages. Membership is checked with a SECURITY DEFINER helper so the
    policies do not recurse.
  - Rooms are created and joined only through RPCs, which generate the code, enforce
    the member cap and take the display name from the student's own profile (first
    name only, so emails and surnames are never shown to other students).
  - Clients can only insert their own `user` messages. `ai` and `system` messages are
    written by the server (RPCs and the ai-tools edge function).
*/

CREATE TABLE IF NOT EXISTS public.study_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  topic text CHECK (topic IS NULL OR char_length(topic) <= 300),
  join_code text NOT NULL UNIQUE,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.study_group_members (
  group_id uuid NOT NULL REFERENCES public.study_groups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 40),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.study_group_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.study_groups(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 40),
  kind text NOT NULL DEFAULT 'user' CHECK (kind IN ('user', 'ai', 'system')),
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 6000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS study_group_messages_group_time_idx
  ON public.study_group_messages (group_id, created_at);
CREATE INDEX IF NOT EXISTS study_group_members_user_idx
  ON public.study_group_members (user_id);

ALTER TABLE public.study_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_group_messages ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_study_group_member(p_group uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.study_group_members
     WHERE group_id = p_group AND user_id = auth.uid()
  );
$$;

DROP POLICY IF EXISTS "Members can view their study groups" ON public.study_groups;
CREATE POLICY "Members can view their study groups" ON public.study_groups
  FOR SELECT TO authenticated
  USING (public.is_study_group_member(id));

DROP POLICY IF EXISTS "Members can view group members" ON public.study_group_members;
CREATE POLICY "Members can view group members" ON public.study_group_members
  FOR SELECT TO authenticated
  USING (public.is_study_group_member(group_id));

DROP POLICY IF EXISTS "Members can leave a group" ON public.study_group_members;
CREATE POLICY "Members can leave a group" ON public.study_group_members
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Members can read group messages" ON public.study_group_messages;
CREATE POLICY "Members can read group messages" ON public.study_group_messages
  FOR SELECT TO authenticated
  USING (public.is_study_group_member(group_id));

DROP POLICY IF EXISTS "Members can send their own messages" ON public.study_group_messages;
CREATE POLICY "Members can send their own messages" ON public.study_group_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND kind = 'user'
    AND public.is_study_group_member(group_id)
    AND EXISTS (SELECT 1 FROM public.study_groups g WHERE g.id = group_id AND g.ended_at IS NULL)
    -- The name on a message must be the member's own room name.
    AND display_name = (
      SELECT m.display_name FROM public.study_group_members m
       WHERE m.group_id = study_group_messages.group_id AND m.user_id = auth.uid()
    )
  );

-- First name from the student's profile; never the email or the full name.
CREATE OR REPLACE FUNCTION public.tasktrack_study_display_name()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_name text;
BEGIN
  SELECT split_part(btrim(full_name), ' ', 1) INTO v_name
    FROM public.profiles WHERE id = auth.uid();
  v_name := left(coalesce(nullif(v_name, ''), 'Student'), 40);
  RETURN v_name;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_study_group(p_name text, p_topic text DEFAULT NULL)
RETURNS TABLE (id uuid, join_code text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_code text;
  v_id uuid;
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_name text := left(btrim(coalesce(p_name, '')), 80);
  v_topic text := nullif(left(btrim(coalesce(p_topic, '')), 300), '');
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  IF v_name = '' THEN RAISE EXCEPTION 'name_required'; END IF;
  IF (SELECT count(*) FROM public.study_groups g WHERE g.host_id = v_uid AND g.ended_at IS NULL) >= 5 THEN
    RAISE EXCEPTION 'too_many_groups';
  END IF;

  LOOP
    SELECT string_agg(substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1), '')
      INTO v_code FROM generate_series(1, 6);
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.study_groups g WHERE g.join_code = v_code);
  END LOOP;

  INSERT INTO public.study_groups (host_id, name, topic, join_code)
  VALUES (v_uid, v_name, v_topic, v_code)
  RETURNING study_groups.id INTO v_id;

  INSERT INTO public.study_group_members (group_id, user_id, display_name)
  VALUES (v_id, v_uid, public.tasktrack_study_display_name());

  RETURN QUERY SELECT v_id, v_code;
END;
$$;

CREATE OR REPLACE FUNCTION public.join_study_group(p_code text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_group uuid;
  v_name text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;

  SELECT g.id INTO v_group FROM public.study_groups g
   WHERE g.join_code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'))
     AND g.ended_at IS NULL;
  IF v_group IS NULL THEN RAISE EXCEPTION 'group_not_found'; END IF;

  IF EXISTS (SELECT 1 FROM public.study_group_members m WHERE m.group_id = v_group AND m.user_id = v_uid) THEN
    RETURN v_group;
  END IF;

  IF (SELECT count(*) FROM public.study_group_members m WHERE m.group_id = v_group) >= 8 THEN
    RAISE EXCEPTION 'group_full';
  END IF;

  v_name := public.tasktrack_study_display_name();
  INSERT INTO public.study_group_members (group_id, user_id, display_name) VALUES (v_group, v_uid, v_name);
  INSERT INTO public.study_group_messages (group_id, user_id, display_name, kind, content)
  VALUES (v_group, v_uid, v_name, 'system', v_name || ' joined the group');
  RETURN v_group;
END;
$$;

CREATE OR REPLACE FUNCTION public.end_study_group(p_group uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  UPDATE public.study_groups SET ended_at = now()
   WHERE id = p_group AND host_id = auth.uid() AND ended_at IS NULL;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.is_study_group_member(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tasktrack_study_display_name() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_study_group(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.join_study_group(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.end_study_group(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_study_group_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_study_group(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.join_study_group(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.end_study_group(uuid) TO authenticated;

-- Live updates for the room.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'study_group_messages') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.study_group_messages;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'study_group_members') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.study_group_members;
    END IF;
  END IF;
END $$;
