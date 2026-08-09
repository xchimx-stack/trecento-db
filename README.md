# Trecento Network v0.10.4.1 — Wikipedia stale-cache repair

Fixes a cache bug in v0.10.4.

Earlier enrichment versions could successfully cache a Wikidata QID while failing
to attach a Wikipedia page. v0.10.4 then treated the presence of *either* Wikidata
or Wikipedia as a completed positive cache and returned immediately.

That prevented the newer English/Italian/direct-Wikipedia fallback logic from ever
running for those artists.

## New cache semantics

- cached Wikipedia URL = resolved; return immediately
- cached Wikidata QID without Wikipedia = unresolved
- reuse the cached QID directly and inspect fresh English/Italian sitelinks
- if that still gives no Wikipedia page, continue into direct EN/IT Wikipedia search
- failed/no-Wikipedia results are not permanently cached

The drawer diagnostic reports `cached_wikidata` when a previously stored QID is
successfully reused to repair the Wikipedia link.
