-- v1.0.4 — publish-ready network snapshots.
-- Public viewers read one compact JSON payload instead of rebuilding a graph
-- from normalized tables on every page load. Safe to run more than once.

create table if not exists public.v1_published_networks (
  network_id uuid primary key references public.v1_networks(id) on delete cascade,
  payload jsonb not null,
  artist_count integer not null default 0,
  relationship_count integer not null default 0,
  content_hash text,
  build_version text not null default '1.0.4',
  published_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists v1_published_networks_published_idx
  on public.v1_published_networks(published_at desc);
