# Trecento Network v0.12.6 — bilingual Wikipedia relationship evidence

Italian Wikipedia remains the primary secondary-source crawler.

English Wikipedia is now used as a fallback/secondary evidence source because
some artist relationships are stated more explicitly there.

## Order

For every existing database artist:

1. crawl Italian Wikipedia when an article can be resolved
2. then crawl English Wikipedia when an article can be resolved

No new artists are added by this crawler.

## Visualization

Both languages are stored under the same relationship evidence source:

`Wikipedia`

Therefore:
- Italian-only evidence = one blue Wikipedia stripe
- English-only evidence = one blue Wikipedia stripe
- Italian + English evidence = still one blue stripe

The underlying `relationship_evidence` table retains the separate article URLs
and evidence sentences, so corroboration across languages is preserved without
duplicating visible source lines.

## Example motivation

An artist such as Orcagna may have sparse explicit relationship language in the
Italian biography while the English article has a dedicated pupils section.
The English crawl can therefore add Wikipedia evidence such as Orcagna/Jacopo
without changing the authority hierarchy.

## Authority hierarchy

ULAN remains authoritative.

Wikipedia.it and Wikipedia.en:
- may corroborate a ULAN relationship
- may create a Wikipedia candidate relationship where ULAN is silent
- may not override a conflicting ULAN relationship

Identity disambiguation and chronology guards remain active.
