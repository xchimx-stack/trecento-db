# Trecento Network v0.11.4 — lead-image-first representative artwork

This fixes the Vitale da Bologna false-image problem introduced by the broad
color-image heuristic.

## Image-selection rules

1. Treat Wikipedia's lead image as contextually authoritative.
2. If the lead image has meaningful color, keep it. No alternative search occurs.
3. Only when the lead is monochrome or missing, inspect article images.
4. During that fallback search, prioritize filenames containing meaningful tokens
   from the artist's Wikipedia page title.
5. If no artist-associated color file works, inspect only a small bounded set of
   other usable article images.
6. If no convincing color alternative exists, fall back to the original lead
   image even if it is black-and-white.

This keeps correct color lead works such as Vitale's representative artwork while
still allowing a color painting to replace a monochrome Vasari portrait where a
reasonable alternative exists.

One proportional, uncropped image is displayed.
