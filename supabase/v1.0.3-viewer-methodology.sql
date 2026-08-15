-- v1.0.3 — per-network methodology text for the generic viewer/admin.
-- Safe to run more than once. Does not touch legacy 0.20.x tables.

alter table public.v1_networks
  add column if not exists methodology_text text;
