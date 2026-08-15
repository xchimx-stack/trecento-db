-- v0.20.19 — persist Getty ULAN role strings for Trecento role filtering.
-- Safe to run more than once.
alter table public.artists add column if not exists ulan_roles text;
