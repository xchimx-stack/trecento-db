# Trecento Network v0.10.2 — Wikipedia fallback matching + larger media drawer

## Wikipedia/Wikidata matching

Resolution remains ULAN-first.

1. Exact Wikidata `P245` ULAN match -> accept automatically.
2. If P245 is absent, score Wikidata candidates using:
   - ULAN preferred name
   - stored ULAN aliases
   - dates / floruit
   - artist/painter occupation language
   - presence of an English Wikipedia sitelink
3. Accept fallback only when the best candidate is strong and clearly ahead of the runner-up.

Old `WikipediaNone` negative cache entries are ignored. Failed matches are no
longer cached permanently, so sparse Wikidata records can be retried later.

## Drawer media

- drawer width increased from ~350px to ~440px
- exactly two thumbnails remain
- thumbnails are larger and use a 3:2 footprint
- images are still lazy-loaded only when the artist drawer opens
- selection centering compensates for the wider drawer
