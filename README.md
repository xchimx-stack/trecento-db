# Trecento Network v0.12.1 — first controlled ULAN expansion

The source-aware schema is now active.

## This deployment

The first v0.12.1 Vercel deployment performs one controlled ULAN expansion and
writes the results directly into Supabase.

Hard rules:
- maximum total accepted artists: 300
- one ULAN relationship hop only
- ULAN Person records only
- approximately 1200–1500
- Italy / Italian activity relevance required
- preferred ULAN name becomes canonical name
- aliases are retained
- every new artist records `crawl_depth = 1`, discovery source, and the artist
  from whom it was discovered
- ULAN relationships are inserted only when both endpoints are accepted
- every inserted ULAN relationship gets a `relationship_evidence` row

The expansion records completion in `crawl_runs`; later deployments skip it.

## Important

Wikipedia relationship mining is NOT enabled in this pass. First verify that the
ULAN-only expansion produces a sensible ~300-artist network. Wikipedia-only
candidate edges come next.

## Source colors

- ULAN burgundy `#7A3038`
- Wikipedia blue `#55758A`
- RKD gold `#A47B32` reserved

The graph API now correctly sends relationship evidence/source metadata to the
frontend, so source filters and colors can operate on actual DB evidence.
