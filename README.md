# Trecento Network v0.13.0.3 — SVG helper + frontend runtime audit

The elastic-layout refactor had also dropped the `svgEl()` SVG element factory,
causing:

`Graph load error: svgEl is not defined`

This release restores an explicit SVG namespace-safe element helper.

It also performs a broader build-time audit of the graph's required frontend
helpers and core state declarations rather than checking only JavaScript syntax.

Verified before packaging:
- state
- canvas
- world
- drawer
- artists
- relationships
- relationshipMeta
- importedDatabase
- importedByName
- importedGraphLoaded
- graph world dimensions
- svgEl
- render
- materializeImportedGraph
- renderedNodeRadius
- clippedEdge
- source-stripe helpers
- chronology/layout helpers

No database, Supabase, crawler, or expansion records are modified.
