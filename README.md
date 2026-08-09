# Trecento Network v0.9.0 — database runtime

The `trecento-db` branch now reads imported artists and relationships from Supabase at runtime.

Normal Vercel deploys no longer run the Getty crawler or the Supabase seeder.

- `/api/graph` = graph data from Supabase
- `/api/graph?status=1` = database counts/status
- browser secret credentials are never exposed
- the existing visual interface remains unchanged

This is the first database-backed application checkpoint.
