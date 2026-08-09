alter table public.artists
  add column if not exists manual_tier text,
  add column if not exists manual_region text,
  add column if not exists manual_active_from integer,
  add column if not exists manual_active_to integer,
  add column if not exists merged_into_artist_id bigint,
  add column if not exists manual_override_note text,
  add column if not exists manual_override_updated_at timestamptz;

create index if not exists artists_merged_into_artist_id_idx
  on public.artists (merged_into_artist_id);
