-- v1.0.7 — UI parity + cache-first Wikipedia media.
-- Safe to run more than once. Legacy 0.20.x tables are untouched.

alter table public.v1_media_cache
  add column if not exists file_size_bytes bigint;

-- Public thumbnails are derivative display media. Uploads are performed only
-- by the server-side service role; the public bucket allows the viewer to
-- render cached thumbnails without a live Wikipedia/Wikimedia request.
insert into storage.buckets (id,name,public)
values ('v1-media','v1-media',true)
on conflict (id) do update set public=true;
