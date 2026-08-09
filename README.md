# Trecento Network v0.15.0

Consolidated admission, Zeri, source-default, and mobile release.

## Admission pass
`/discover.html` remains a finite, auditable discovery workflow, but now:
- visibly announces completion
- derives a working chronology and mapped region where supportable
- distinguishes `Ready for Expanded Trecento` from candidates needing placement
- admits only substantiated + placeable candidates after the crawl token is entered
- requires at least one external basis: ULAN, Wikipedia, or Zeri
- holds ambiguous duplicate-name cases rather than guessing
- writes new candidates as Expanded Trecento, not Core

## Default relationship source
- ULAN is ON by default
- Wikipedia is OFF by default
- users can still independently enable/disable either source

## Zeri connoisseurial associations
Core Trecento artist drawers now contain a separate section below Connections.
It reads Fondazione Zeri work records and reports other artists historically
associated with the same works through current/alternate attribution history.
These are explicitly not rendered as pupil/influence graph edges.

## Mobile
- graph drawers are constrained to the viewport
- relationship key becomes its own collapsible mobile drawer
- discovery results become stacked mobile cards instead of widening the viewport

Database maintenance is still never run by `npm run build`.
