# Trecento Network v0.12.1.1 — controlled expansion retry fix

The first v0.12.1 run successfully:
- scanned the initial 106 artists
- discovered 24 one-hop ULAN candidates
- accepted 21 candidates

It then failed while writing `relationship_evidence` because the table does not
have the composite UNIQUE constraint required by the prior `upsert(onConflict=...)`.

## Fix

Relationship evidence now uses:
1. explicit lookup for an existing `(relationship_id, source, source_url)` row
2. plain insert only when absent

No additional Supabase SQL is required.

## Retry safety

The failed run may already have inserted the 21 accepted artists. To preserve the
one-hop rule, v0.12.1.1 scans only artists whose `crawl_depth` is null or 0.
Existing depth-1 artists are never used as crawl seeds.

The hard target remains 300 total artists.
