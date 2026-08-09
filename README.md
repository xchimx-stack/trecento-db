# Trecento Network v0.10.3 — Italian Wikipedia fallback

Wikipedia enrichment now uses both English and Italian coverage.

## Resolution order

1. Wikidata exact ULAN (`P245`) match when present.
2. Otherwise conservative scored Wikidata matching using both English and Italian
   labels, aliases, descriptions, dates, and sitelinks.
3. Prefer English Wikipedia when the matched Wikidata item has an English article.
4. If English is absent and Italian Wikipedia exists, use the Italian article.

The drawer labels the latter explicitly as `Wikipedia (Italiano)`.

## Anonymous-master query rule

For Italian searches:

- `Master of X` -> `Maestro di X`
- `Master of the X` -> `Maestro del X`

ULAN aliases are searched as well, and any aliases beginning with `Master of`
receive the same Italian query transformation.

## Images

The same selected Wikipedia language is used to obtain the two lazy-loaded
representative thumbnails. Thumbnail request size is increased to 900px while
the drawer still loads only two images.
