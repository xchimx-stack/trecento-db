# Trecento Network v0.12.6.2 — MediaWiki link/context fix

The section parser itself was present in v0.12.6.1, but its artist-link selector
was too narrow. It only accepted internal links written as `/wiki/Foo`.

MediaWiki `action=parse` can also return relative article links such as `./Foo`.
Those links were therefore invisible to the relationship extractor, including
artists listed beneath headings such as `Pupils`.

This release accepts:
- `/wiki/Foo`
- `./Foo`
- full `https://it.wikipedia.org/wiki/Foo`
- full `https://en.wikipedia.org/wiki/Foo`

Non-article links (edit, File, Category, Help, Special, Template, Talk, etc.) are
excluded.

The crawler also emits an Orcagna-specific diagnostic line showing which IT/EN
article was parsed and how many proposals were extracted. This makes the Orcagna
test case observable rather than returning only the aggregate zero-result line.

Deploy and rerun `/wiki-crawl.html`.
