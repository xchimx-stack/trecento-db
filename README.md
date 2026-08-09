# Trecento Network v0.13.0.2 — frontend bootstrap repair

v0.13.0 introduced the elastic graph layout. Two frontend objects that older
versions effectively inherited from browser globals were no longer explicitly
declared:

- `relationships`
- `state`

This release repairs the whole graph bootstrap block rather than patching one
runtime error at a time.

Explicit declarations now exist for:
- artists
- relationships
- graph state
- canvas SVG
- world SVG group
- artist drawer
- imported database
- relationship metadata
- graph world dimensions

If required DOM elements are absent, the page now throws a clear bootstrap-DOM
error instead of failing later with an undefined variable.

No Supabase data or crawler/expansion records are changed.
