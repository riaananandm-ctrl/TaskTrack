-- In-app educational videos. The find-video function turns an AI-picked search into
-- one embeddable, safe-search, Education / Science & Technology YouTube video. Results
-- are cached here so the YouTube daily quota goes a long way. Only the server reads
-- and writes this table.
create table if not exists public.video_lookup_cache (
  query text primary key check (char_length(query) between 2 and 200),
  video_id text check (video_id is null or video_id ~ '^[A-Za-z0-9_-]{11}$'),
  title text,
  channel text,
  fetched_at timestamptz not null default now()
);
alter table public.video_lookup_cache enable row level security;
revoke all on public.video_lookup_cache from anon, authenticated;
