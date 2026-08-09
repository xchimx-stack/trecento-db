# Trecento Network v0.10.4 — direct Wikipedia search fallback

Wikipedia resolution now has three paths:

1. exact Wikidata ULAN (`P245`) match
2. conservative scored Wikidata match using English + Italian metadata
3. direct English/Italian Wikipedia title search, validated against:
   - ULAN preferred name
   - ULAN aliases
   - Italian `Master of` -> `Maestro di/del` query forms
   - chronology/date evidence
   - artist/painter language in the page introduction

The direct-search result must still exceed a high score threshold and clearly beat
the runner-up before it is accepted.

This is intended to recover obvious pages such as Bernardo Daddi or Duccio when
Wikidata entity search is not returning them reliably.

## Temporary diagnostics

The artist drawer displays a small testing line:

`Wikipedia match: ulan_exact`
`Wikipedia match: scored_fallback · score ...`
`Wikipedia match: direct_wikipedia_search · score ...`
`Wikipedia match: none`

This diagnostic can be removed once coverage is stable.
