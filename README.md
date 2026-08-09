# Trecento Network v0.12.3 — Wikipedia.it relationship candidates

The database remains ULAN-authoritative. Italian Wikipedia is now a secondary
relationship-evidence source.

## Why the crawler runs in the browser

Wikimedia repeatedly throttled Vercel's shared server IP. The crawler therefore
runs from `/wiki-crawl.html` in the user's browser and talks directly to
`it.wikipedia.org` using the CORS-enabled Action API.

Vercel never crawls Wikipedia.

## Scope

The first Wikipedia pass:
- scans only artists already in the database (currently 127)
- does not discover/add new artists
- uses Italian Wikipedia only
- requires explicit relationship phrases
- ignores mere hyperlinks and co-mentions

Recognized examples include:
- collaborò / collaborazione
- lavorò con / insieme a
- allievo di / discepolo di
- maestro di
- bottega di
- influenzato da / influenzò
- figlio di / padre di / fratello di

## Evidence behavior

If Wikipedia supports an existing ULAN relationship:
- no duplicate graph relationship is created
- a second `relationship_evidence` row with source `Wikipedia` is attached
- the edge remains burgundy in **All**
- it remains visible and turns blue in **Wikipedia-only**

If ULAN is silent:
- Wikipedia creates a new relationship with `review_status = candidate`
- the edge is blue
- Wikipedia evidence and the supporting Italian sentence are stored

If Wikipedia proposes a different relationship where ULAN already has one:
- ULAN is never overridden
- no competing edge is published
- the conflict is logged in `crawl_events`

## Security

The crawler write endpoint requires a Vercel environment variable:

`WIKI_CRAWL_TOKEN`

Use any long random string. The crawler page asks for it when you start a run;
the value is never stored in the frontend repository.

## Running

After deployment:
1. Add `WIKI_CRAWL_TOKEN` in Vercel if not already present.
2. Visit `/wiki-crawl.html`.
3. Enter the token.
4. Click **Start crawl**.
5. Leave the tab open until completion.

The main graph updates from Supabase after refresh.
