-- v0.20.12-rev1 — structured ULAN place evidence for Low Countries layout.
-- Run before deploying this revision because /api/graph selects these columns.
-- Safe to run more than once.

begin;

alter table public.network_seed_queue
  add column if not exists birth_place text,
  add column if not exists death_place text,
  add column if not exists active_place text,
  add column if not exists geography_source text;

alter table public.low_countries_candidates
  add column if not exists birth_place text,
  add column if not exists death_place text,
  add column if not exists active_place text,
  add column if not exists geography_source text;

-- Preserve the intentionally curated geography of the Core seed list.
update public.network_seed_queue
set geography_source = coalesce(geography_source, 'curated seed location')
where network_id = 'low_countries'
  and geography_bucket is not null
  and btrim(geography_bucket) <> '';

commit;
