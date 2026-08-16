-- v1.1 RC1 — generic network completion
-- Adds nondestructive per-network Wikipedia relationship sourcing.
-- Existing network-specific tables already use ON DELETE CASCADE.

create table if not exists public.v1_wikipedia_relationships (
  id uuid primary key default gen_random_uuid(),
  network_id uuid not null references public.v1_networks(id) on delete cascade,
  subject_artist_id uuid not null references public.v1_artists(id) on delete cascade,
  counterpart_artist_id uuid not null references public.v1_artists(id) on delete cascade,
  from_artist_id uuid not null references public.v1_artists(id) on delete cascade,
  to_artist_id uuid not null references public.v1_artists(id) on delete cascade,
  normalized_family text not null,
  directed boolean not null default true,
  visual_class text not null default 'dotted' check (visual_class in ('solid','dashed','dotted')),
  relationship_type text,
  source_url text not null,
  evidence_text text,
  confidence numeric not null default 0.70,
  status text not null default 'candidate' check (status in ('candidate','accepted','rejected')),
  active boolean not null default true,
  discovered_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists v1_wiki_rel_network_idx
  on public.v1_wikipedia_relationships(network_id,active);
create index if not exists v1_wiki_rel_subject_idx
  on public.v1_wikipedia_relationships(network_id,subject_artist_id);

-- Media throttling introduced a temporary retry state. Make the status
-- constraint explicit for both fresh and previously migrated installs.
alter table public.v1_media_cache drop constraint if exists v1_media_cache_status_check;
alter table public.v1_media_cache
  add constraint v1_media_cache_status_check
  check (status in ('unresolved','valid','stale','invalid','no_image','retry'));
