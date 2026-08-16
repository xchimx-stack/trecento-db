-- v1.1 RC12 — network-specific artist/candidate exclusions
-- Exclusions are intentionally network-scoped. Shared ULAN authority records,
-- media cache, and artist identities remain reusable across networks.

create table if not exists public.v1_network_exclusions (
  network_id uuid not null references public.v1_networks(id) on delete cascade,
  ulan_id text not null,
  preferred_name text,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (network_id, ulan_id)
);

create index if not exists v1_network_exclusions_network_idx
  on public.v1_network_exclusions(network_id, preferred_name);

alter table public.v1_network_exclusions enable row level security;
