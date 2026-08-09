# Trecento Network v0.12.0 — source-aware expansion foundation

This release introduces the evidence architecture for controlled graph growth.

## Connection-source colors

- **ULAN:** dark burgundy `#7A3038`
- **Wikipedia:** muted blue `#55758A`
- **RKD:** ochre/gold `#A47B32` (schema/style reserved for the later Dutch network)

Line pattern continues to communicate relationship meaning. Color communicates
the evidence source.

Wikipedia edges are rendered at lower opacity than ULAN edges.

The graph UI includes:
- All
- ULAN
- Wikipedia

and a visible connection-source color key.

## Evidence priority

`ULAN > RKD > Wikipedia`

If more than one source supports the same relationship, the graph draws one edge
using the highest-priority source color while retaining all evidence records.

Wikipedia can fill a relationship where ULAN is silent. It cannot override,
reverse, delete, or relabel a ULAN relationship.

## Database

Run `supabase/v0.12.0-source-evidence.sql` once in Supabase SQL Editor before the
new expansion crawler is enabled. It adds:
- crawl depth / discovery provenance to artists
- generic `relationship_evidence`
- ULAN evidence backfill for the existing graph

## Controlled expansion policy

The first expansion target is 300 accepted artists, one ULAN relationship hop
from the current network. Wikipedia relationship extraction is phrase-driven,
not link-driven, and Wikipedia-only edges begin as review candidates.

Media enrichment remains lazy and separate from graph expansion.
