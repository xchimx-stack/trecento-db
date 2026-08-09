# v0.9.0 — Supabase runtime graph

The database is now the runtime source for imported artists and relationships.

## Deployment

Normal Vercel deployment no longer:
- crawls Getty ULAN
- seeds Supabase
- generates `imported-artists.json`

It only verifies the static frontend exists.

## Runtime flow

Browser:
    GET /api/graph

Vercel serverless function:
    reads SUPABASE_URL + SUPABASE_SECRET_KEY
    queries Supabase artists + relationships
    converts them into the graph format expected by the current frontend
    returns JSON

The secret key never reaches browser JavaScript.

## Current transitional limitation

The original hand-curated prototype artists/edges are still embedded in the frontend
and are merged with the Supabase records, exactly as they were merged with the old
`imported-artists.json` dataset.

The next database phase should migrate those curated records/evidence into Supabase too,
so the frontend eventually contains no historical data at all.
