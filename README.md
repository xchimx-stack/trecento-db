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

## v0.16.0 consolidated stability/enrichment release

This release deliberately batches the post-v0.15.1 findings into one deployment.

### Mobile map interaction
- SVG viewport now tracks the actual browser viewport instead of using the full graph world as the viewBox.
- Mobile no longer tries to fit the entire Core/Expanded network into the phone.
- One-finger pan and two-finger pinch zoom are handled explicitly.
- Added floating mobile zoom-out, zoom-in, and Reset view controls.
- Drawer opening/closing does not alter the map transform.

### Node interaction
- Clicking a node no longer recenters the camera.
- Selected nodes grow ~5.5% and apply a very small elastic displacement to nearby nodes.
- Relationship/drawer navigation preserves the user's current map position.
- Search remains an explicit desktop "jump" action; mobile search does not move the hidden map behind a full-screen drawer.

### Zeri
- Removed free-text production matching.
- Zeri work discovery is scoped to the catalog's Author / Attributions / School field (`autore_OA`).
- Core-only cross-reference requires a matching ULAN, or VIAF when ULAN is unavailable.
- VIAF may be derived from an existing Wikidata identity; no fuzzy-name fallback is used for the cross-reference.
- Drawer recurrence thresholds are degree-sensitive: minimum 3 / 5 / 7 shared records.
- The drawer distinguishes no authority ID, failed authority cross-reference, no results, and results below threshold.

### Wikipedia identity + media cache
- Cached Wikipedia pages are revalidated against Wikidata/ULAN/VIAF before use.
- Authority-bearing artists do not fall back to a same-looking name when the authority identity differs.
- Newly admitted artists with a Wikipedia URL but no image now still run media resolution, allowing thumbnails to populate.

### Unmapped enrichment
- Before zero-edge artists are left Unmapped, the client checks full Wikipedia prose and categories for missing region/chronology.
- Regional vocabulary includes Emilia/Emilian -> Bologna layout region.
- Identity is authority-validated before enrichment is applied.
- Results are locally cached for seven days to avoid repeated Wikipedia calls.

### VIAF + duplicate safety
- VIAF IDs are stored as external IDs during admission and exposed by the graph API.
- Name-only duplicate collisions are never auto-merged; they are held for review, protecting same-name artists from different periods.

### Proposed identity
- `proposed identity` is accepted as a semantic relationship type and uses the existing dotted relationship language; the drawer label provides the distinction.

### Deployment architecture
- Remains at 5 Vercel API functions.
- No database migration is required for this release.
