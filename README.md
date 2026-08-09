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

## v0.15.1 deployment correction

The Hobby plan's direct `/api` deployment model allows at most 12 Vercel
Functions. v0.15.0 accidentally created 13 by adding `zeri-connections.js`
alongside the older `zeri-resolve.js`.

v0.15.1 merges both Zeri operations into `api/zeri-connections.js`:
- default mode: Core Trecento connoisseurial attribution associations
- `?mode=resolve`: discovery-time Zeri identity/basis resolution

`api/zeri-resolve.js` has been removed. A regression test now fails locally if
the `/api` directory ever exceeds 12 deployable function files.


## v0.15.1 API consolidation revision

The same v0.15.1 feature release has been reorganized before further feature growth.
Eleven narrow serverless endpoints were moved into ordinary server handler modules
and exposed through four domain routers, while `graph.js` remains separate:

- `api/graph.js` — graph read model
- `api/artists.js` — artist media/cache, manual override, candidate admission
- `api/discovery.js` — finite discovery, expansion data, expansion admission
- `api/wikipedia.js` — crawl data and relationship candidates
- `api/authorities.js` — ULAN and Zeri

Result: **5 Vercel Functions instead of 12**, leaving substantial Hobby-plan headroom.
A regression guard now fails locally above 8 deployed API functions.


## v0.17.0 — admin, methodology, authority transparency, cached Zeri

- Added `/admin.html` as the single maintenance hub.
- Added `/admin-edit.html`; it can modify existing artists only. It cannot create artists.
- Manual relationship additions require two existing ULAN IDs.
- Added auditable admin-change and cached Zeri-association tables (migration required).
- Zeri enrichment now uses the exact `AUTN_AUTP_AAT_ROFA_ATBD=<artist>` AUTHOR / ATTRIBUTIONS / SCHOOL search field and parses Zeri's OTHER ATTRIBUTIONS facet.
- Zeri results are cached in Supabase and read from the graph payload; drawers no longer scrape Zeri on every click.
- Added 3/5/7 recurrence thresholds based on graph degree.
- Added Methodology UI with source roles and machine-extraction caveats.
- Added clickable Getty ULAN and VIAF authority records to artist drawers.
- Connection lists are source-grouped and sort direct influence to the top, general influence to the bottom.
- Clicking a drawer connection performs a short guided pan to the target artist; clicking a node directly still does not recenter.
- Initial/tier-change viewport anchors on Giotto, then Duccio fallback.
- Closing the artist drawer no longer deselects the node; clicking blank graph space does.
