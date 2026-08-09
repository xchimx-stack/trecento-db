# Trecento Network v0.11.2 — CORS-safe Wikipedia Action API resolver

This replaces the browser-side REST summary lookup with Wikipedia's Action API.

## First-time enrichment

1. Read Supabase cache.
2. If uncached, make one English Wikipedia Action API search using `origin=*`.
3. If no validated result, make one Italian search.
4. For anonymous masters, Italian uses `Master of ...` -> `Maestro di/del ...`.
5. Each search returns candidate titles, intro text, canonical URL, and the single
   900px lead thumbnail in one request.
6. Rank candidates by name similarity plus artist/painter context.
7. Cache a successful Wikipedia URL + thumbnail URL in Supabase.

No Wikimedia request is made by Vercel.

## Diagnostics

The drawer reports:
- `client_action_api_en · score ...`
- `client_action_api_it · score ...`
- `none`
- `request failed`

This should distinguish Daddi-style matching misses from Duccio-style request failures.
