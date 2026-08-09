
alter table public.network_seed_queue
  add column if not exists birth_year integer,
  add column if not exists death_year integer,
  add column if not exists preferred_name text;

create index if not exists network_seed_queue_low_countries_status_idx
  on public.network_seed_queue(network_id,status);
