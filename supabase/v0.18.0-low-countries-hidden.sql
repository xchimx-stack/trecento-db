
create table if not exists public.networks (
  id text primary key,
  display_name text not null,
  public_visible boolean not null default false,
  core_target integer not null,
  expanded_target integer not null,
  created_at timestamptz not null default now()
);

insert into public.networks (id,display_name,public_visible,core_target,expanded_target)
values
  ('trecento','Italian Trecento',true,100,300),
  ('low_countries','Dutch & Flemish Golden Age',false,100,300)
on conflict (id) do update set
  display_name=excluded.display_name,
  public_visible=excluded.public_visible,
  core_target=excluded.core_target,
  expanded_target=excluded.expanded_target;

create table if not exists public.network_artists (
  network_id text not null references public.networks(id) on delete cascade,
  artist_id uuid not null references public.artists(id) on delete cascade,
  tier text not null check (tier in ('seed','candidate','core','expanded','uncharted')),
  geography_bucket text,
  crawl_depth integer,
  admitted_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (network_id,artist_id)
);

create index if not exists network_artists_network_tier_idx
  on public.network_artists(network_id,tier);

create table if not exists public.network_seed_queue (
  network_id text not null references public.networks(id) on delete cascade,
  seed_name text not null,
  ulan_id text,
  geography_bucket text,
  status text not null default 'pending' check (status in ('pending','resolved','crawled','held','failed')),
  notes text,
  created_at timestamptz not null default now(),
  primary key(network_id,seed_name)
);

insert into public.network_seed_queue(network_id,seed_name,geography_bucket,notes)
values
('low_countries','Rembrandt van Rijn','Amsterdam','high-connectivity seed'),
('low_countries','Nicolaes Maes','Dordrecht','Rembrandt pupil; geographic bridge'),
('low_countries','Ferdinand Bol','Amsterdam','Rembrandt orbit'),
('low_countries','Govert Flinck','Amsterdam','Rembrandt orbit'),
('low_countries','Carel Fabritius','Delft','Rembrandt-Delft bridge'),
('low_countries','Frans Hals','Haarlem','Haarlem portraiture'),
('low_countries','Salomon van Ruysdael','Haarlem','Haarlem landscape'),
('low_countries','Jacob van Ruisdael','Haarlem','landscape network'),
('low_countries','Pieter de Molijn','Haarlem','Haarlem landscape'),
('low_countries','Johannes Vermeer','Delft','Delft'),
('low_countries','Pieter de Hooch','Delft','Delft-Amsterdam bridge'),
('low_countries','Paulus Potter','The Hague','The Hague/Amsterdam'),
('low_countries','Gerrit Dou','Leiden','Leiden fijnschilders'),
('low_countries','Gabriel Metsu','Leiden','Leiden-Amsterdam bridge'),
('low_countries','Jan Steen','Leiden','Leiden/Haarlem/The Hague'),
('low_countries','Gerard van Honthorst','Utrecht','Utrecht Caravaggisti'),
('low_countries','Hendrick ter Brugghen','Utrecht','Utrecht Caravaggisti'),
('low_countries','Abraham Bloemaert','Utrecht','teacher hub'),
('low_countries','Aelbert Cuyp','Dordrecht','Dordrecht landscape'),
('low_countries','Jacob Gerritsz. Cuyp','Dordrecht','Dordrecht teacher/family'),
('low_countries','Peter Paul Rubens','Antwerp','Flemish hub'),
('low_countries','Anthony van Dyck','Antwerp','Rubens orbit/international bridge'),
('low_countries','Jacob Jordaens','Antwerp','Flemish hub'),
('low_countries','Frans Snyders','Antwerp','collaboration hub'),
('low_countries','David Teniers the Younger','Antwerp','Flemish genre network'),
('low_countries','Jan Brueghel the Elder','Antwerp','collaboration/family hub'),
('low_countries','Gerard ter Borch','Deventer','cross-regional connector'),
('low_countries','Adriaen Brouwer','Antwerp','Haarlem-Antwerp bridge'),
('low_countries','Pieter Lastman','Amsterdam','pre-Rembrandt teacher hub')
on conflict (network_id,seed_name) do nothing;
