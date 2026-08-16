-- v1.0.10 — site-wide methodology shared by all generic networks.
-- Safe to run more than once.
create table if not exists public.v1_site_settings (
  key text primary key,
  value text not null default '',
  updated_at timestamptz not null default now()
);

insert into public.v1_site_settings (key,value)
values ('methodology_text','')
on conflict (key) do nothing;

alter table public.v1_site_settings enable row level security;
