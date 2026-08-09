# Trecento Network v0.13.1 — active ULAN identity resolver

v0.13.0 required Wikidata to already contain Getty ULAN property P245. The
first anonymous-master scan showed that this was far too restrictive: only a
small fraction of Wikipedia/Wikidata records carried a direct ULAN identifier.

v0.13.1 changes identity resolution.

## Resolution hierarchy

1. Wikidata P245
   - accepted as the direct ULAN identity path

2. Getty ULAN reconciliation search
   - Italian Wikipedia title
   - English Wikipedia title
   - Wikidata Italian and English aliases
   - natural-order variants of inverted authority names
   - Master / Maestro conventional-name variants

3. Candidate detail-page scoring
   - canonical/preferred name and aliases
   - chronology against the Wikipedia/Wikidata period
   - artist occupation/role
   - Italian geographic context
   - Getty record type
   - separation from the second-best ULAN candidate

## Automatic admission

A search result is auto-admitted only when:
- the combined score is at least 72
- it leads the runner-up by at least 14 points
- the ULAN record is artist-like
- normalized name similarity is at least 0.60
- the chronology still overlaps the 1270–1420 project window

Ambiguous results are not guessed.

## Expansion diagnostics

`/expand.html` now reports separately:

- Direct WD→ULAN
- ULAN search match
- Ambiguous
- No ULAN match
- Outside period / other skips
- Artists added
- Edges added

For ambiguous identities the top candidates and scores are written to the crawl
log, providing a useful manual-review list.

The 250-artist target remains in force. No images are downloaded during this
expansion phase.
