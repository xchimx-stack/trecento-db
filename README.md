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

## v0.17.1 UUID correction

Supabase `artists.id` uses UUID primary keys. v0.17.0 incorrectly declared new
foreign keys as bigint and coerced artist IDs to JavaScript numbers in two
maintenance paths. v0.17.1 corrects the migration and all affected admin/Zeri
ID handling to UUID-safe strings.


## v0.17.2 — Zeri assisted import + performance patch

- Removed the failing server-driven Core Zeri batch from the Admin UI.
- Zeri now uses an assisted workflow: open the exact Zeri artist facet in the user's browser, paste OTHER ATTRIBUTIONS, apply the 3/5/7 threshold, exact-match only against existing ULAN-backed artists, manually confirm, and cache in Supabase.
- No fuzzy artist creation or automatic duplicate creation is allowed.
- Relationship admin now previews ULAN IDs as artist names before saving and offers an Open/refresh network button.
- Added requestAnimationFrame throttling for pan/pinch rendering and reduced selected-node visual overhead on mobile.


## v0.17.3 — Zeri rollback

Automated and assisted Zeri connoisseurial enrichment is disabled for now.
Zeri remains available as a clickable external research link in artist drawers
when a Zeri URL is stored. The connoisseurial drawer section, enrichment controls,
handlers, and graph cache reads are removed pending a reliable access method.


## v0.18.0 — hidden Low Countries staging

Adds database schema and a seed queue for a future Dutch & Flemish Golden Age network
(Core target 100; Expanded target 300) without exposing or loading that network in the
Trecento application. A hidden `/admin-low-countries.html` staging reference is included.
No public network switcher is added and the production Trecento graph endpoint is unchanged.


## v0.18.1 — hidden Low Countries ULAN seed crawl

Adds an admin-only ULAN crawl workflow to `/admin-low-countries.html`.
Resolved seeds and one-hop discoveries are stored exclusively in
`low_countries_candidates` and `low_countries_candidate_edges`; this release
does not insert Low Countries records into the shared `artists` or
`relationships` tables and therefore cannot expose them on the Trecento graph.

Batch controls include stop, retry-safe status persistence, and a four-failure
circuit breaker. Guild/member-of relationships are intentionally excluded.


## v0.18.2 — seed-resolution fix + raw network preview

- Fixes the Low Countries seed resolver so curated seeds are not held merely because
  ULAN page prose lacks explicit Low Countries geographic keywords.
- Seed acceptance now requires a strong name/person identity match; geography is
  deferred to candidate enrichment/admission.
- Batch summaries report semantic outcomes (`resolved`, `held`, `failed`, etc.)
  rather than calling every successful HTTP request a successful resolution.
- Adds `/admin-low-countries-preview.html`, opened from the staging crawler in a
  separate tab, for a force-directed raw preview of staged ULAN nodes/edges while
  another batch continues running.


## v0.18.3 — three-tier Low Countries prototype

- Adds a staged second-degree ULAN crawl from valid first-degree candidates.
- Hard-caps the hidden staging graph at the current 300-node Expanded target.
- Introduces a generic staged edge table supporting seed->1° and 1°->2° relationships.
- Raw preview now has Core / +1° / +2° visibility controls, clickable nodes with a detail drawer,
  wrapped labels, tier-aware node sizing, ~3× relationship spacing, collision-aware repulsion,
  and soft concentric tier geometry to prevent the graph collapsing into a single force ball.
- Held seeds are eligible for re-resolution from the admin page.
- Guild/member-of edges remain excluded and no Low Countries data is exposed to Trecento.


## v0.18.5 — Low Countries metadata re-enrichment patch

Candidate enrichment now retries any non-held/non-rejected staged artist missing
a preferred name, geography bucket, or birth-year chronology. This lets previously
enriched v0.18.3 candidates acquire the metadata required by the v0.18.4 geographic/
chronological layout without clearing or rebuilding the staging database.


## v0.18.6 — adaptive geography + focus interaction + artwork thumbnails

- Geographic band widths now scale automatically with node counts. Dense hubs such
  as Antwerp receive substantially more horizontal territory without globally
  widening sparse regions.
- Artist drawer moves to the left.
- Selected nodes turn red, expand slightly, and push immediate neighbors outward.
  Unrelated nodes and edges fade into the background while direct connections stay prominent.
- Low Countries drawer media now reuses the Trecento representative-artwork selector:
  ULAN-verified Wikipedia identity first, then color-image detection and bounded article-image
  search to prefer a painting/artwork over a monochrome engraving when available.


## v0.18.7 — shared renderer + public Low Countries beta

- Adds a public network toggle: `Trecento Italy` / `Dutch & Flemish Golden Age · BETA`.
- Both networks now run through the same `index.html` renderer and viewport/navigation code.
- Trecento remains the default URL. Low Countries uses `?network=low_countries` and loads only its own graph payload.
- Low Countries inherits Trecento cursor-centered wheel zoom, pinch zoom, pan, drawer, representative-artwork selection, selection fade, and local selection "breath".
- Low Countries geography is invisible layout force only: empty geographic regions receive zero width, while occupied regions expand by sqrt(node count).
- Low Countries starts at Core and exposes Tier 2 (+1 degree) and Tier 3 (+2 degree).
- Wikipedia relationship edges remain disabled for Low Countries; ULAN is the only relationship source.


## v0.18.8 — Low Countries duplicate + display repair

- Collapses Low Countries staged ULAN rows to one visual relationship per unordered artist pair.
  Multiple ULAN relation statements remain preserved as evidence on that one pair.
- Adds the same pair-dedupe defensively in the shared renderer and removes repeated drawer neighbors.
- Low Countries Tier 2/3 nodes no longer pass through Trecento Core→Expanded animation scaling.
- Selecting a hidden +1°/+2° artist reveals the required Low Countries tier directly.
- If all active relationship sources are disabled, selection no longer fades the entire remaining graph.


## v0.18.9 — Low Countries Wikipedia media fallback

Low Countries artists are staged outside the canonical `artists` table, so the Trecento
media-cache endpoint can legitimately return a miss for their ULAN IDs. The shared drawer
now treats that cache as optional in Low Countries mode and continues directly into the
ULAN/Wikidata-verified Wikipedia resolver and representative-artwork selector.

Low Countries also no longer attempts to write staging-record media back into the canonical
Trecento media cache.


## v0.19.0 — Low Countries visual-density stress pass

Bloemaert is treated as the reference high-degree stress case.

- Low Countries default edges are substantially lighter and thinner.
- Selecting an artist switches the canvas to a readable ego-network: unrelated edges disappear.
- Direct pupil/workshop/direct-influence relationships remain fully visible.
- General ULAN associations are progressively disclosed by zoom (8/14/24/40/80).
  The drawer remains exhaustive.
- Labels are progressively disclosed by zoom and node importance/degree; circles remain visible.
- Geography remains node-count adaptive but uses a lower growth coefficient and hard width cap.
- Low Countries chronology is vertically compressed.
- Selection "breath" is more local and smaller than Trecento.

## v0.19.1 — Trecento Wikipedia placement evidence pass

- Replaces first-regex-wins Trecento region inference with evidence-weighted scoring across the artist name, article lead, full Wikipedia prose/categories, and explicit activity/location phrases.
- Prevents incidental mentions of another school or city from overriding stronger biographical placement evidence.
- Holds near-tied mixed-region evidence for manual review instead of forcing a geographic bucket.
- Carries a compact region-evidence note through the discovery result payload/log for auditability.
- Adds regression fixtures for Master of 1302 (Emilia/Bologna bucket), Master of 1310 (Pistoia/Florence bucket), Barna da Siena, Paolo Veneziano, and an intentionally ambiguous mixed-school case.
