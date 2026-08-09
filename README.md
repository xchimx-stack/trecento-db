# Trecento Network v0.13.0 — controlled discovery expansion + elastic layout

## Expansion

Open `/expand.html` after deploying.

The expansion is intentionally one generation per run.

### Phase 1 — Italian anonymous masters

The browser enumerates the Italian Wikipedia category:

`Categoria:Maestri anonimi`

For each page it resolves:
Wikipedia.it → Wikidata → Getty ULAN.

Automatic admission requires:
- a Getty ULAN ID
- activity plausibly overlapping 1270–1420
- total accepted artist count below 250

Anonymous masters without a ULAN ID are skipped rather than guessed.

### Phase 2 — relationship discovery

The existing artist population is scanned in Italian and English Wikipedia for
explicit pupil/workshop/collaboration/influence relationships.

A linked person not already in the database can be admitted only when:
- the linked article resolves to Wikidata
- Wikidata supplies a Getty ULAN ID
- the article is artist-like
- chronology overlaps 1270–1420

The source relationship and Wikipedia evidence are stored with the new artist.

Newly admitted artists are NOT recursively crawled during the same run. This
prevents runaway expansion. Run another controlled generation only after
inspecting the graph.

### Hard growth limit

The automatic target is 250 total artists. This release downloads no image
media, so the expansion adds metadata/evidence only.

## Elastic graph

The graph no longer assumes the 126-node footprint.

- node circles target at least 18px edge-to-edge clearance
- label footprints also participate in collision resolution
- relationship edges act as elastic springs
- solid/direct workshop edges have shorter preferred spring length
- dashed/dotted edges can stretch farther
- chronology remains a strong vertical anchor
- geographic grouping remains a gentle horizontal gravity
- dense clusters expand the SVG world rather than shrinking nodes
- the Overview control fits the dynamically enlarged world
- ULAN/Wikipedia touching parallel evidence stripes still recalculate from the
  final node positions

This is designed to scale through the first 250-artist expansion without forcing
the graph back into a rigid grid.
