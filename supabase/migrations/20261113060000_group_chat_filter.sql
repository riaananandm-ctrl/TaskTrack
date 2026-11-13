/*
  # Roblox-style swear filter for Group Study

  Students are often under 18, so every word in Group Study that looks like a swear
  word or slur is replaced with "#" characters (one per letter), like Roblox chat:
  "this is shit!" becomes "this is ####!".

  It runs inside the database (BEFORE INSERT/UPDATE triggers), so it cannot be skipped
  by a modified app, and it covers:
  - chat messages, including the TaskTrack AI's replies and "joined" notices
  - each member's room name
  - room names and topics

  How a word is checked
  - Each word is lower-cased, common look-alikes are mapped back to letters
    (@ → a, $ → s, 0 → o, 1/! → i, 3 → e, 4 → a, 5 → s, 7 → t), and dots, dashes
    and other symbols inside the word are dropped, so "f.u.c.k", "sh1t" and
    "fuuuuck" are all caught.
  - "Stems" are caught anywhere inside a word ("motherfucker", "bullshit").
  - Short words that appear inside normal words ("ass" in "class", "hell" in "hello",
    "cock" in "peacock", "dick" in "Dickens") are caught only as whole words.
  - Numbers, including phone numbers, are left alone on purpose.
  - A short allow list keeps real names and words that contain a stem, like the
    Indian name "Kshitij". "sex" alone is allowed for IB Biology ("sex cells");
    "sexy" is not.
*/

CREATE OR REPLACE FUNCTION public.tasktrack_mask_profanity(p_text text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  -- Caught anywhere inside a word. Each letter may repeat ("fuuuck").
  stems constant text :=
    'f+u+c+k|f+u+k+(r|i|e|a|ing|n)|f+c+k|f+v+c+k|s+h+i+t|s+h+y+t|b+i+t+c+h|b+i+a+t+c+h|c+u+n+t|'
    'a+s+s+h+o+l+e|a+s+s+w+i+p+e|a+s+s+k+i+c+k|a+s+s+h+a+t|d+u+m+b+a+s+s|j+a+c+k+a+s+s|b+a+d+a+s+s|'
    'b+a+s+t+a+r+d|d+a+m+n|g+o+d+d+a+m|p+i+s+s|w+h+o+r+e|s+l+u+t|'
    'n+i+g+g|n+i+g+a|n+i+g+r|f+a+g+g+o+t|f+a+g+o+t|r+e+t+a+r+d|d+i+l+d+o|'
    'b+o+l+l+o+c+k|w+a+n+k+e+r|b+l+o+w+j+o+b|h+a+n+d+j+o+b|p+o+r+n|'
    'c+h+o+d|c+h+u+t+i+y|c+h+u+t+i+a|c+h+u+t+y|b+h+o+s+d|m+a+d+a+r+c|b+h+e+n+c|b+e+h+e+n+c|'
    'g+a+n+d+u|l+a+v+d+e|l+a+w+d+e|l+o+d+u|h+a+r+a+m+i|r+a+n+d+w+a';
  -- Whole words only, with an optional plural or -ing/-er/-y ending.
  words constant text :=
    'a+s+s|a+r+s+e|h+e+l+l|d+i+c+k|c+o+c+k|t+i+t+s?|t+i+t+t+y|t+i+t+t+i+e+s|b+o+o+b+s?|'
    'p+u+s+s+y|p+u+s+s+i+e+s|c+r+a+p|c+r+a+p+p+y|t+w+a+t|w+a+n+k|p+r+i+c+k|f+a+g|f+a+g+s|'
    'h+o+e|h+o+e+s|t+h+o+t|s+e+x+y|n+u+d+e+s?|'
    'w+t+f|s+t+f+u|f+f+s|f+m+l|l+m+f+a+o|'
    'm+c|b+s+d+k|b+k+l|g+a+a+n+d|g+a+n+d|l+u+n+d|r+a+n+d+i|k+u+t+t+i+y+a';
  -- Real words and names that contain a filtered stem ("Kshitij" contains "shit").
  allowed constant text := '^(k?shitij|shiitake|scunthorpe|penistone|cockburn|sussex|essex|middlesex|dickens|matsushita|pissarro|cassandra|bassist|grassland)';
  result text := '';
  part text[];
  tok text;
  core text;
  tail text;
  norm text;
BEGIN
  IF p_text IS NULL OR p_text = '' THEN
    RETURN p_text;
  END IF;

  -- Walk the text as alternating runs of spaces and words, keeping spacing as is.
  FOR part IN SELECT regexp_matches(p_text, '(\s+|\S+)', 'g') LOOP
    tok := part[1];
    IF tok ~ '^\s+$' THEN
      result := result || tok;
      CONTINUE;
    END IF;

    -- Keep closing punctuation visible: "shit!" -> "####!".
    core := regexp_replace(tok, '[.,!?:;)"''\]]+$', '');
    tail := substr(tok, length(core) + 1);
    IF core = '' THEN
      result := result || tok;
      CONTINUE;
    END IF;

    -- Leave numbers (phone numbers, scores, dates) alone.
    IF core ~ '^[+0-9()\-./ ]+$' THEN
      result := result || tok;
      CONTINUE;
    END IF;

    norm := lower(core);
    norm := translate(norm, '@4$501!|37', 'aassoiiiet');
    norm := regexp_replace(norm, '[^a-z]', '', 'g');

    IF norm <> '' AND norm !~ allowed AND (
         norm ~ ('(' || stems || ')')
      OR norm ~ ('^(' || words || ')(s|es|er|ers|ing|ed|y)?$')
    ) THEN
      result := result || regexp_replace(core, '.', '#', 'g') || tail;
    ELSE
      result := result || tok;
    END IF;
  END LOOP;

  RETURN result;
END;
$$;

COMMENT ON FUNCTION public.tasktrack_mask_profanity(text) IS
  'Roblox-style filter: replaces swear words and slurs with # characters. Numbers are left alone.';

-- Messages: filter the content (covers students, the AI and system notices).
CREATE OR REPLACE FUNCTION public.tasktrack_filter_group_message()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  NEW.content := public.tasktrack_mask_profanity(NEW.content);
  NEW.display_name := public.tasktrack_mask_profanity(NEW.display_name);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tasktrack_filter_group_message ON public.study_group_messages;
CREATE TRIGGER tasktrack_filter_group_message
  BEFORE INSERT OR UPDATE OF content, display_name ON public.study_group_messages
  FOR EACH ROW EXECUTE FUNCTION public.tasktrack_filter_group_message();

-- Members: filter the name shown in the room.
CREATE OR REPLACE FUNCTION public.tasktrack_filter_group_member()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  NEW.display_name := public.tasktrack_mask_profanity(NEW.display_name);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tasktrack_filter_group_member ON public.study_group_members;
CREATE TRIGGER tasktrack_filter_group_member
  BEFORE INSERT OR UPDATE OF display_name ON public.study_group_members
  FOR EACH ROW EXECUTE FUNCTION public.tasktrack_filter_group_member();

-- Rooms: filter the name and topic other members see.
CREATE OR REPLACE FUNCTION public.tasktrack_filter_study_group()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  NEW.name := public.tasktrack_mask_profanity(NEW.name);
  NEW.topic := public.tasktrack_mask_profanity(NEW.topic);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tasktrack_filter_study_group ON public.study_groups;
CREATE TRIGGER tasktrack_filter_study_group
  BEFORE INSERT OR UPDATE OF name, topic ON public.study_groups
  FOR EACH ROW EXECUTE FUNCTION public.tasktrack_filter_study_group();

-- Clean anything already written before this filter existed.
UPDATE public.study_group_messages
   SET content = content, display_name = display_name
 WHERE content IS DISTINCT FROM public.tasktrack_mask_profanity(content)
    OR display_name IS DISTINCT FROM public.tasktrack_mask_profanity(display_name);
UPDATE public.study_group_members
   SET display_name = display_name
 WHERE display_name IS DISTINCT FROM public.tasktrack_mask_profanity(display_name);
UPDATE public.study_groups
   SET name = name, topic = topic
 WHERE name IS DISTINCT FROM public.tasktrack_mask_profanity(name)
    OR topic IS DISTINCT FROM public.tasktrack_mask_profanity(topic);

REVOKE ALL ON FUNCTION public.tasktrack_filter_group_message() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tasktrack_filter_group_member() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tasktrack_filter_study_group() FROM PUBLIC, anon, authenticated;
